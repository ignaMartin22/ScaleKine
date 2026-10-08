import { createHash } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { cargarConfiguracion } from '../../src/comun/configuracion.js';
import { RelojFijo } from '../../src/comun/reloj.js';
import { crearModuloIdentidad } from '../../src/modulos/m1-identidad/index.js';
import { hashearContrasena, verificarContrasena } from '../../src/modulos/m1-identidad/contrasenas.js';
import { DURACION_SESION_MS } from '../../src/modulos/m1-identidad/servicio.js';
import { ENTORNO_PRUEBA, loggerCapturado, ORIGEN_APP } from '../ayudantes.js';
import { db } from './base.js';
import { crearUsuario } from './fabricas.js';

const CLAVE = 'clave-de-prueba-larga';
const INICIO = '2026-10-07T12:00:00Z';
const ERROR_CREDENCIALES = {
  error: { codigo: 'credenciales_invalidas', mensaje: 'Las credenciales no son válidas.' },
};

// Argon2 es lento a propósito: se calcula una vez y se reutiliza en todas las pruebas.
const hashClave = hashearContrasena(CLAVE);

function appConIdentidad({ cookieSegura = false } = {}) {
  const config = cargarConfiguracion({ ...ENTORNO_PRUEBA, COOKIE_SECURE: String(cookieSegura) });
  const reloj = new RelojFijo(INICIO);
  const capturado = loggerCapturado();
  const identidad = crearModuloIdentidad({ db, reloj, config });
  const app = crearApp({ config, logger: capturado.logger, reloj, rutas: [identidad.rutas] });
  return { app, reloj, ...capturado };
}

async function usuarioConClave(datos: { nombreUsuario?: string; activo?: boolean } = {}) {
  return crearUsuario({ ...datos, hashContrasena: await hashClave });
}

const cookiesDe = (res: { headers: Record<string, unknown> }): string[] =>
  (res.headers['set-cookie'] as string[] | undefined) ?? [];

/** Valor del token en la cabecera `set-cookie` de un ingreso. */
function tokenDe(res: { headers: Record<string, unknown> }): string {
  const cookie = cookiesDe(res)[0];
  if (!cookie) throw new Error('La respuesta no trajo cookie.');
  return /^[^=]+=([^;]*)/.exec(cookie)![1]!;
}

const sha256 = (valor: string) => createHash('sha256').update(valor).digest('hex');

async function ingresar(app: ReturnType<typeof appConIdentidad>['app'], nombreUsuario: string) {
  return request(app).post('/api/sesion').set('Origin', ORIGEN_APP).send({ nombreUsuario, contrasena: CLAVE });
}

describe('ingreso (RF-01, RF-02)', () => {
  it('con credenciales correctas responde el usuario y abre una sesión', async () => {
    const usuario = await usuarioConClave({ nombreUsuario: 'ficticio1' });
    const { app } = appConIdentidad();

    const res = await ingresar(app, 'ficticio1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ usuario: { nombreUsuario: 'ficticio1', rol: usuario.rol } });

    const actual = await request(app).get('/api/sesion').set('Cookie', `sesion=${tokenDe(res)}`);
    expect(actual.status).toBe(200);
    expect(actual.body).toEqual(res.body);
  });

  it('da el mismo error si falla la contraseña, no existe el usuario o la cuenta está inactiva (RF-02, RF-09)', async () => {
    await usuarioConClave({ nombreUsuario: 'ficticio1' });
    await usuarioConClave({ nombreUsuario: 'inactivo1', activo: false });
    const { app } = appConIdentidad();

    const intentos = [
      { nombreUsuario: 'ficticio1', contrasena: 'otra-clave-incorrecta' },
      { nombreUsuario: 'no-existe', contrasena: CLAVE },
      { nombreUsuario: 'inactivo1', contrasena: CLAVE },
    ];
    for (const intento of intentos) {
      const res = await request(app).post('/api/sesion').set('Origin', ORIGEN_APP).send(intento);
      expect(res.status).toBe(401);
      expect(res.body).toEqual(ERROR_CREDENCIALES);
      expect(cookiesDe(res)).toEqual([]);
    }
    await expect(db.sesion.count()).resolves.toBe(0);
  });

  it('rechaza un cuerpo inválido con 400 datos_invalidos', async () => {
    await usuarioConClave({ nombreUsuario: 'ficticio1' });
    const { app } = appConIdentidad();

    const res = await request(app).post('/api/sesion').set('Origin', ORIGEN_APP).send({ nombreUsuario: 'ficticio1' });

    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe('datos_invalidos');
  });
});

describe('sesión actual (RF-11)', () => {
  it('sin cookie responde 401 sesion_invalida', async () => {
    const { app } = appConIdentidad();

    const res = await request(app).get('/api/sesion');

    expect(res.status).toBe(401);
    expect(res.body.error.codigo).toBe('sesion_invalida');
  });

  it('con un token inventado bien formado responde 401', async () => {
    const { app } = appConIdentidad();

    const res = await request(app).get('/api/sesion').set('Cookie', `sesion=${'a'.repeat(43)}`);

    expect(res.status).toBe(401);
    expect(res.body.error.codigo).toBe('sesion_invalida');
  });
});

describe('cierre de sesión (RF-10)', () => {
  it('revoca la sesión sin borrarla y vence la cookie', async () => {
    await usuarioConClave({ nombreUsuario: 'ficticio1' });
    const { app, reloj } = appConIdentidad();
    const token = tokenDe(await ingresar(app, 'ficticio1'));

    const res = await request(app).delete('/api/sesion').set('Origin', ORIGEN_APP).set('Cookie', `sesion=${token}`);

    expect(res.status).toBe(204);
    expect(cookiesDe(res)[0]).toMatch(/^sesion=;.*Expires=Thu, 01 Jan 1970/);
    const filas = await db.sesion.findMany();
    expect(filas).toHaveLength(1);
    expect(filas[0]!.revocadaEn).toEqual(reloj.ahora());

    const despues = await request(app).get('/api/sesion').set('Cookie', `sesion=${token}`);
    expect(despues.status).toBe(401);
  });

  it('sin cookie también responde 204', async () => {
    const { app } = appConIdentidad();

    const res = await request(app).delete('/api/sesion').set('Origin', ORIGEN_APP);

    expect(res.status).toBe(204);
  });
});

describe('vencimiento a las 12 horas, sin renovación (RF-11, D-14)', () => {
  it('la sesión dura 12 horas exactas', async () => {
    await usuarioConClave({ nombreUsuario: 'ficticio1' });
    const { app, reloj } = appConIdentidad();
    const token = tokenDe(await ingresar(app, 'ficticio1'));
    const [fila] = await db.sesion.findMany();
    expect(fila!.venceEn.getTime() - fila!.creadaEn.getTime()).toBe(DURACION_SESION_MS);
    expect(DURACION_SESION_MS).toBe(12 * 60 * 60 * 1000);

    reloj.avanzar(DURACION_SESION_MS - 1);
    expect((await request(app).get('/api/sesion').set('Cookie', `sesion=${token}`)).status).toBe(200);

    reloj.avanzar(1);
    expect((await request(app).get('/api/sesion').set('Cookie', `sesion=${token}`)).status).toBe(401);
  });

  it('la actividad no extiende la sesión', async () => {
    await usuarioConClave({ nombreUsuario: 'ficticio1' });
    const { app, reloj } = appConIdentidad();
    const token = tokenDe(await ingresar(app, 'ficticio1'));
    const [antes] = await db.sesion.findMany();

    reloj.avanzar(11 * 60 * 60 * 1000);
    expect((await request(app).get('/api/sesion').set('Cookie', `sesion=${token}`)).status).toBe(200);

    const [despues] = await db.sesion.findMany();
    expect(despues!.venceEn).toEqual(antes!.venceEn);
  });
});

describe('cuenta desactivada (RF-09)', () => {
  it('su sesión abierta deja de valer', async () => {
    const usuario = await usuarioConClave({ nombreUsuario: 'ficticio1' });
    const { app } = appConIdentidad();
    const token = tokenDe(await ingresar(app, 'ficticio1'));

    await db.usuario.update({ where: { id: usuario.id }, data: { activo: false } });

    const res = await request(app).get('/api/sesion').set('Cookie', `sesion=${token}`);
    expect(res.status).toBe(401);
  });
});

describe('cookie de sesión (RNF-01)', () => {
  it('sin HTTPS: HttpOnly, SameSite=Strict, Path=/, vence a las 12 horas y no lleva Secure', async () => {
    await usuarioConClave({ nombreUsuario: 'ficticio1' });
    const { app } = appConIdentidad();

    const cookie = cookiesDe(await ingresar(app, 'ficticio1'))[0]!;

    expect(cookie).toMatch(/^sesion=/);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Secure');
    const vence = /Expires=([^;]+)/.exec(cookie)![1]!;
    expect(new Date(vence).getTime()).toBe(new Date(INICIO).getTime() + DURACION_SESION_MS);
  });

  it('con HTTPS: nombre con prefijo __Host- y atributo Secure', async () => {
    await usuarioConClave({ nombreUsuario: 'ficticio1' });
    const { app } = appConIdentidad({ cookieSegura: true });

    const cookie = cookiesDe(await ingresar(app, 'ficticio1'))[0]!;

    expect(cookie).toMatch(/^__Host-sesion=/);
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Domain');
  });
});

describe('almacenamiento del token (RNF-01)', () => {
  it('en la base solo está el hash SHA-256 del token', async () => {
    await usuarioConClave({ nombreUsuario: 'ficticio1' });
    const { app } = appConIdentidad();

    const token = tokenDe(await ingresar(app, 'ficticio1'));

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const [fila] = await db.sesion.findMany();
    expect(fila!.hashToken).toBe(sha256(token));
    expect(fila!.hashToken).not.toBe(token);
    expect(JSON.stringify(fila)).not.toContain(token);
  });
});

describe('registros (RNF-08)', () => {
  it('no contienen la contraseña, el token ni el nombre de usuario', async () => {
    await usuarioConClave({ nombreUsuario: 'ficticio-secreto' });
    const { app, texto } = appConIdentidad();

    const ok = await ingresar(app, 'ficticio-secreto');
    const token = tokenDe(ok);
    await request(app)
      .post('/api/sesion')
      .set('Origin', ORIGEN_APP)
      .send({ nombreUsuario: 'ficticio-secreto', contrasena: 'clave-incorrecta-xyz' });
    await request(app).delete('/api/sesion').set('Origin', ORIGEN_APP).set('Cookie', `sesion=${token}`);

    const log = texto();
    expect(log).toContain('petición');
    for (const secreto of [CLAVE, 'clave-incorrecta-xyz', token, 'ficticio-secreto']) {
      expect(log).not.toContain(secreto);
    }
  });
});

describe('hash de contraseñas (RNF-03)', () => {
  it('usa argon2id con los parámetros de OWASP', async () => {
    const hash = await hashearContrasena(CLAVE);

    expect(hash.startsWith('$argon2id$v=19$m=19456,p=1,t=2$')).toBe(true);
    await expect(verificarContrasena(hash, CLAVE)).resolves.toBe(true);
    await expect(verificarContrasena(hash, 'otra-clave')).resolves.toBe(false);
  });

  it('un hash mal formado da false sin lanzar', async () => {
    await expect(verificarContrasena('hash-ficticio', CLAVE)).resolves.toBe(false);
  });
});
