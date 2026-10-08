import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { crearApp } from '../../src/app.js';
import { cargarConfiguracion } from '../../src/comun/configuracion.js';
import { RelojFijo } from '../../src/comun/reloj.js';
import { hashearContrasena, verificarContrasena } from '../../src/modulos/m1-identidad/contrasenas.js';
import { crearRutas } from '../../src/rutas.js';
import { ENTORNO_PRUEBA, loggerCapturado, ORIGEN_APP } from '../ayudantes.js';
import { db } from './base.js';
import {
  AHORA,
  CONTRASENA_ADMINISTRADOR_VERIFICADO,
  crearUsuario,
  ingresarComoAdministradorVerificado,
} from './fabricas.js';

const CLAVE = 'clave-de-prueba-0001';
const TEMPORAL = 'temporal-del-admin-1';
const NUEVA_TEMPORAL = 'otra-temporal-del-admin-2';

// Argon2 es lento a propósito: se calcula una vez y se reutiliza en todas las pruebas.
const hashClave = hashearContrasena(CLAVE);

async function crearAppDePrueba(reloj = new RelojFijo(AHORA)) {
  const config = cargarConfiguracion({
    ...ENTORNO_PRUEBA,
    COOKIE_SECURE: 'false',
  });
  const { logger } = loggerCapturado();
  const rutas = await crearRutas({ db, reloj, config });
  return crearApp({ config, logger, reloj, rutas });
}

type App = Awaited<ReturnType<typeof crearAppDePrueba>>;

async function ingresar(app: App, nombreUsuario: string, contrasena: string) {
  const res = await request(app)
    .post('/api/sesion')
    .set('Origin', ORIGEN_APP)
    .send({ nombreUsuario, contrasena });
  const cookie = (res.headers['set-cookie'] as string[] | undefined)?.[0]?.split(';')[0] ?? '';
  return { res, cookie };
}

/** Administrador con el segundo factor verificado (RNF-04), por el ayudante compartido. */
async function ingresarComoAdministrador(app: App) {
  const { cookie } = await ingresarComoAdministradorVerificado(app, { nombreUsuario: 'admin1' });
  return cookie;
}

const conCookie = (cookie: string) => ({ Origin: ORIGEN_APP, Cookie: cookie });

const crear = (app: App, cookie: string, cuerpo: Record<string, unknown>) =>
  request(app).post('/api/cuentas').set(conCookie(cookie)).send(cuerpo);

const restablecer = (
  app: App,
  cookie: string,
  id: number | string,
  cuerpo: Record<string, unknown> = { contrasenaTemporal: TEMPORAL },
) => request(app).post(`/api/cuentas/${id}/restablecimiento`).set(conCookie(cookie)).send(cuerpo);

const desactivar = (app: App, cookie: string, id: number | string) =>
  request(app).post(`/api/cuentas/${id}/desactivacion`).set(conCookie(cookie)).send({});

const sesionActual = (app: App, cookie: string) => request(app).get('/api/sesion').set('Cookie', cookie);

/** Cuenta de secretaría con sesión abierta, lista para restablecer o desactivar. */
async function secretariaConSesion(app: App, nombreUsuario = 'secre1') {
  const usuario = await crearUsuario({
    nombreUsuario,
    hashContrasena: await hashClave,
  });
  const { res, cookie } = await ingresar(app, nombreUsuario, CLAVE);
  expect(res.status).toBe(200);
  return { usuario, cookie };
}

describe('crear una cuenta (RF-04)', () => {
  it('queda activa, como secretaría y marcada para cambiar la contraseña', async () => {
    const app = await crearAppDePrueba();
    const admin = await ingresarComoAdministrador(app);

    const res = await crear(app, admin, {
      nombreUsuario: 'secre-nueva',
      contrasenaTemporal: TEMPORAL,
    });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      cuenta: {
        id: expect.any(Number) as number,
        nombreUsuario: 'secre-nueva',
        rol: 'secretaria',
        activo: true,
        debeCambiarContrasena: true,
      },
    });

    const guardada = await db.usuario.findUniqueOrThrow({
      where: { nombreUsuario: 'secre-nueva' },
    });
    expect(guardada.creadoEn).toEqual(AHORA);
    expect(guardada.hashContrasena.startsWith('$argon2id$')).toBe(true);
    expect(await verificarContrasena(guardada.hashContrasena, TEMPORAL)).toBe(true);
  });

  it('puede ingresar con la contraseña temporal y recibe la marca de cambio', async () => {
    const app = await crearAppDePrueba();
    const admin = await ingresarComoAdministrador(app);
    await crear(app, admin, {
      nombreUsuario: 'secre-nueva',
      contrasenaTemporal: TEMPORAL,
    });

    const { res } = await ingresar(app, 'secre-nueva', TEMPORAL);
    expect(res.status).toBe(200);
    expect(res.body.usuario).toEqual({
      nombreUsuario: 'secre-nueva',
      rol: 'secretaria',
      debeCambiarContrasena: true,
    });
  });

  it('un nombre repetido da 409 y no crea otra cuenta', async () => {
    const app = await crearAppDePrueba();
    const admin = await ingresarComoAdministrador(app);
    await crear(app, admin, {
      nombreUsuario: 'secre-nueva',
      contrasenaTemporal: TEMPORAL,
    });

    const res = await crear(app, admin, {
      nombreUsuario: 'secre-nueva',
      contrasenaTemporal: NUEVA_TEMPORAL,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe('nombre_usuario_en_uso');
    expect(await db.usuario.count({ where: { nombreUsuario: 'secre-nueva' } })).toBe(1);
  });

  it('rechaza con 400 una contraseña corta o común, y un nombre inválido', async () => {
    const app = await crearAppDePrueba();
    const admin = await ingresarComoAdministrador(app);

    const corta = await crear(app, admin, {
      nombreUsuario: 'secre-nueva',
      contrasenaTemporal: 'Corta-1',
    });
    expect(corta.status).toBe(400);
    expect(corta.body.error.codigo).toBe('contrasena_corta');

    const comun = await crear(app, admin, {
      nombreUsuario: 'secre-nueva',
      contrasenaTemporal: 'password1234',
    });
    expect(comun.status).toBe(400);
    expect(comun.body.error.codigo).toBe('contrasena_comun');

    const nombreCorto = await crear(app, admin, {
      nombreUsuario: ' a ',
      contrasenaTemporal: TEMPORAL,
    });
    expect(nombreCorto.status).toBe(400);

    expect(await db.usuario.count({ where: { nombreUsuario: 'secre-nueva' } })).toBe(0);
  });

  it('ignora un rol en el cuerpo: nunca crea un administrador', async () => {
    const app = await crearAppDePrueba();
    const admin = await ingresarComoAdministrador(app);

    const res = await crear(app, admin, {
      nombreUsuario: 'secre-nueva',
      contrasenaTemporal: TEMPORAL,
      rol: 'administrador',
    });
    expect(res.status).toBe(201);
    expect(res.body.cuenta.rol).toBe('secretaria');
    expect(await db.usuario.count({ where: { rol: 'administrador' } })).toBe(1);
  });
});

describe('listar las cuentas', () => {
  it('responde el formato exacto, ordenado por nombre y sin campos sensibles', async () => {
    const app = await crearAppDePrueba();
    const admin = await ingresarComoAdministrador(app);
    const zeta = await crearUsuario({ nombreUsuario: 'zeta', activo: false });
    const beta = await crearUsuario({
      nombreUsuario: 'beta',
      debeCambiarContrasena: true,
    });

    const res = await request(app).get('/api/cuentas').set('Cookie', admin);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      cuentas: [
        {
          id: expect.any(Number) as number,
          nombreUsuario: 'admin1',
          rol: 'administrador',
          activo: true,
          debeCambiarContrasena: false,
        },
        {
          id: beta.id,
          nombreUsuario: 'beta',
          rol: 'secretaria',
          activo: true,
          debeCambiarContrasena: true,
        },
        {
          id: zeta.id,
          nombreUsuario: 'zeta',
          rol: 'secretaria',
          activo: false,
          debeCambiarContrasena: false,
        },
      ],
    });
    expect(JSON.stringify(res.body)).not.toMatch(/hash|argon2|secreto|totp|bloque|codigos/i);
  });
});

describe('restablecer una contraseña (RF-08)', () => {
  it('la contraseña vieja deja de servir, la temporal funciona y la cuenta queda marcada', async () => {
    const app = await crearAppDePrueba();
    const admin = await ingresarComoAdministrador(app);
    const { usuario } = await secretariaConSesion(app);

    const res = await restablecer(app, admin, usuario.id);
    expect(res.status).toBe(204);

    expect((await ingresar(app, 'secre1', CLAVE)).res.status).toBe(401);
    const nuevo = await ingresar(app, 'secre1', TEMPORAL);
    expect(nuevo.res.status).toBe(200);
    expect(nuevo.res.body.usuario.debeCambiarContrasena).toBe(true);
    const guardada = await db.usuario.findUniqueOrThrow({
      where: { id: usuario.id },
    });
    expect(guardada.debeCambiarContrasena).toBe(true);
  });

  it('revoca las sesiones abiertas: la cookie vieja da 401', async () => {
    const app = await crearAppDePrueba();
    const admin = await ingresarComoAdministrador(app);
    const { usuario, cookie } = await secretariaConSesion(app);
    expect((await sesionActual(app, cookie)).status).toBe(200);

    expect((await restablecer(app, admin, usuario.id)).status).toBe(204);

    expect((await sesionActual(app, cookie)).status).toBe(401);
    expect(
      await db.sesion.count({
        where: { usuarioId: usuario.id, revocadaEn: null },
      }),
    ).toBe(0);
    // Las sesiones se conservan, marcadas; las de otras cuentas no se tocan.
    expect(await db.sesion.count({ where: { usuarioId: usuario.id } })).toBe(1);
    expect((await sesionActual(app, admin)).status).toBe(200);
  });

  it('levanta el bloqueo por intentos (RNF-02)', async () => {
    const app = await crearAppDePrueba();
    const admin = await ingresarComoAdministrador(app);
    const usuario = await crearUsuario({
      nombreUsuario: 'secre1',
      hashContrasena: await hashClave,
    });
    await db.usuario.update({
      where: { id: usuario.id },
      data: {
        ingresosFallidos: 5,
        bloqueosConsecutivos: 2,
        bloqueadoHasta: new Date(AHORA.getTime() + 60 * 60 * 1000),
      },
    });
    expect((await ingresar(app, 'secre1', CLAVE)).res.status).toBe(401);

    expect((await restablecer(app, admin, usuario.id)).status).toBe(204);

    const guardada = await db.usuario.findUniqueOrThrow({
      where: { id: usuario.id },
    });
    expect(guardada.bloqueadoHasta).toBeNull();
    expect(guardada.ingresosFallidos).toBe(0);
    expect(guardada.bloqueosConsecutivos).toBe(0);
    expect((await ingresar(app, 'secre1', TEMPORAL)).res.status).toBe(200);
  });

  it('no toca los campos del segundo factor de la cuenta', async () => {
    const app = await crearAppDePrueba();
    const admin = await ingresarComoAdministrador(app);
    const usuario = await crearUsuario({
      nombreUsuario: 'kine1',
      rol: 'kinesiologo',
      hashContrasena: await hashClave,
    });
    await db.usuario.update({
      where: { id: usuario.id },
      data: { totpActivo: true, codigosRecuperacion: ['hash-ficticio-1', 'hash-ficticio-2'] },
    });

    expect((await restablecer(app, admin, usuario.id)).status).toBe(204);

    const guardada = await db.usuario.findUniqueOrThrow({ where: { id: usuario.id } });
    expect(guardada.totpActivo).toBe(true);
    expect(guardada.codigosRecuperacion).toEqual(['hash-ficticio-1', 'hash-ficticio-2']);
  });

  it('rechaza una temporal fuera de la política, sin tocar la cuenta', async () => {
    const app = await crearAppDePrueba();
    const admin = await ingresarComoAdministrador(app);
    const { usuario, cookie } = await secretariaConSesion(app);

    const res = await restablecer(app, admin, usuario.id, {
      contrasenaTemporal: 'corta',
    });
    expect(res.status).toBe(400);
    expect((await sesionActual(app, cookie)).status).toBe(200);
    expect((await ingresar(app, 'secre1', CLAVE)).res.status).toBe(200);
  });

  it('el administrador da 409, la inexistente 404, la inactiva 409 y un id inválido 400', async () => {
    const app = await crearAppDePrueba();
    const admin = await ingresarComoAdministrador(app);
    const adminDb = await db.usuario.findUniqueOrThrow({
      where: { nombreUsuario: 'admin1' },
    });
    const inactiva = await crearUsuario({
      nombreUsuario: 'inactiva1',
      activo: false,
    });

    const deAdmin = await restablecer(app, admin, adminDb.id);
    expect(deAdmin.status).toBe(409);
    expect(deAdmin.body.error.codigo).toBe('cuenta_de_administrador');
    const hashAdmin = (await db.usuario.findUniqueOrThrow({ where: { id: adminDb.id } })).hashContrasena;
    expect(await verificarContrasena(hashAdmin, CONTRASENA_ADMINISTRADOR_VERIFICADO)).toBe(true);

    const inexistente = await restablecer(app, admin, 99999);
    expect(inexistente.status).toBe(404);
    expect(inexistente.body.error.codigo).toBe('cuenta_no_encontrada');

    const deInactiva = await restablecer(app, admin, inactiva.id);
    expect(deInactiva.status).toBe(409);
    expect(deInactiva.body.error.codigo).toBe('cuenta_inactiva');

    expect((await restablecer(app, admin, 'abc')).status).toBe(400);
    expect((await restablecer(app, admin, 0)).status).toBe(400);
    expect((await restablecer(app, admin, '99999999999')).status).toBe(400);
  });
});

describe('desactivar una cuenta (RF-09)', () => {
  it('no puede ingresar, con el error genérico de credenciales', async () => {
    const app = await crearAppDePrueba();
    const admin = await ingresarComoAdministrador(app);
    const { usuario } = await secretariaConSesion(app);

    expect((await desactivar(app, admin, usuario.id)).status).toBe(204);

    const { res } = await ingresar(app, 'secre1', CLAVE);
    expect(res.status).toBe(401);
    expect(res.body.error.codigo).toBe('credenciales_invalidas');
  });

  it('revoca la sesión abierta y conserva la fila', async () => {
    const app = await crearAppDePrueba();
    const admin = await ingresarComoAdministrador(app);
    const { usuario, cookie } = await secretariaConSesion(app);

    expect((await desactivar(app, admin, usuario.id)).status).toBe(204);

    expect((await sesionActual(app, cookie)).status).toBe(401);
    expect(
      await db.sesion.count({
        where: { usuarioId: usuario.id, revocadaEn: null },
      }),
    ).toBe(0);
    const guardada = await db.usuario.findUniqueOrThrow({
      where: { id: usuario.id },
    });
    expect(guardada.activo).toBe(false);
    expect(guardada.nombreUsuario).toBe('secre1');
  });

  it('es idempotente', async () => {
    const app = await crearAppDePrueba();
    const admin = await ingresarComoAdministrador(app);
    const { usuario } = await secretariaConSesion(app);

    expect((await desactivar(app, admin, usuario.id)).status).toBe(204);
    expect((await desactivar(app, admin, usuario.id)).status).toBe(204);
    expect((await db.usuario.findUniqueOrThrow({ where: { id: usuario.id } })).activo).toBe(false);
  });

  it('el administrador da 409 y sigue activo; la inexistente da 404', async () => {
    const app = await crearAppDePrueba();
    const admin = await ingresarComoAdministrador(app);
    const adminDb = await db.usuario.findUniqueOrThrow({
      where: { nombreUsuario: 'admin1' },
    });

    const res = await desactivar(app, admin, adminDb.id);
    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe('cuenta_de_administrador');
    expect((await db.usuario.findUniqueOrThrow({ where: { id: adminDb.id } })).activo).toBe(true);
    expect((await sesionActual(app, admin)).status).toBe(200);

    const inexistente = await desactivar(app, admin, 99999);
    expect(inexistente.status).toBe(404);
    expect(inexistente.body.error.codigo).toBe('cuenta_no_encontrada');
  });
});

describe('autorización (RF-03)', () => {
  it.each(['secretaria', 'kinesiologo'] as const)('%s recibe 403 en las cuatro rutas', async (rol) => {
    const app = await crearAppDePrueba();
    const objetivo = await crearUsuario({
      nombreUsuario: 'objetivo1',
      hashContrasena: await hashClave,
    });
    await crearUsuario({
      rol,
      nombreUsuario: 'sin-permiso',
      hashContrasena: await hashClave,
    });
    const { res, cookie } = await ingresar(app, 'sin-permiso', CLAVE);
    expect(res.status).toBe(200);

    const respuestas = [
      await request(app).get('/api/cuentas').set('Cookie', cookie),
      await crear(app, cookie, {
        nombreUsuario: 'intruso',
        contrasenaTemporal: TEMPORAL,
      }),
      await restablecer(app, cookie, objetivo.id),
      await desactivar(app, cookie, objetivo.id),
    ];
    for (const r of respuestas) {
      expect(r.status).toBe(403);
      expect(r.body.error.codigo).toBe('no_autorizado');
    }
    expect(await db.usuario.count({ where: { nombreUsuario: 'intruso' } })).toBe(0);
    const intacto = await db.usuario.findUniqueOrThrow({
      where: { id: objetivo.id },
    });
    expect(intacto.activo).toBe(true);
    expect(await verificarContrasena(intacto.hashContrasena, CLAVE)).toBe(true);
  });

  it('un administrador con la sesión sin verificar recibe 403 en las cuatro rutas y no cambia nada', async () => {
    const app = await crearAppDePrueba();
    const objetivo = await crearUsuario({ nombreUsuario: 'objetivo1', hashContrasena: await hashClave });
    await crearUsuario({
      rol: 'administrador',
      nombreUsuario: 'admin-sin-verificar',
      hashContrasena: await hashClave,
      totpActivo: true,
    });
    const { res, cookie } = await ingresar(app, 'admin-sin-verificar', CLAVE);
    expect(res.status).toBe(200);
    expect(res.body.pasoPendiente).toBe('verificar_segundo_factor');

    const respuestas = [
      await request(app).get('/api/cuentas').set('Cookie', cookie),
      await crear(app, cookie, { nombreUsuario: 'intruso', contrasenaTemporal: TEMPORAL }),
      await restablecer(app, cookie, objetivo.id),
      await desactivar(app, cookie, objetivo.id),
    ];
    for (const r of respuestas) {
      expect(r.status).toBe(403);
      expect(r.body.error.codigo).toBe('debe_verificar_segundo_factor');
    }
    expect(await db.usuario.count({ where: { nombreUsuario: 'intruso' } })).toBe(0);
    const intacto = await db.usuario.findUniqueOrThrow({ where: { id: objetivo.id } });
    expect(intacto.activo).toBe(true);
    expect(await verificarContrasena(intacto.hashContrasena, CLAVE)).toBe(true);
  });

  it('sin sesión recibe 401 en las cuatro rutas', async () => {
    const app = await crearAppDePrueba();
    const respuestas = [
      await request(app).get('/api/cuentas'),
      await request(app).post('/api/cuentas').set('Origin', ORIGEN_APP).send({}),
      await request(app).post('/api/cuentas/1/restablecimiento').set('Origin', ORIGEN_APP).send({}),
      await request(app).post('/api/cuentas/1/desactivacion').set('Origin', ORIGEN_APP).send({}),
    ];
    for (const r of respuestas) expect(r.status).toBe(401);
  });
});

describe('carreras con un ingreso concurrente (RF-08, RF-09)', () => {
  /**
   * Ejecuta `accion` y hace que un ingreso arranque justo después de la PRIMERA sentencia de
   * escritura (`usuario.updateMany` o `sesion.updateMany`) de la transacción del servicio de cuentas.
   * Con el orden correcto esa primera sentencia es la de `Usuario` y ya tiene el lock de la fila: el
   * `updateMany` del ingreso espera y al liberarse ve la cuenta cambiada. Con el orden invertido, las
   * sesiones ya están revocadas y el ingreso crea y confirma una sesión que nadie revoca.
   *
   * El ingreso no se espera dentro de la transacción (con el orden correcto sería un bloqueo mutuo):
   * se espera como mucho 500 ms para darle tiempo a llegar a su escritura.
   */
  async function ejecutarConIngresoTrasLaPrimeraSentencia(app: App, accion: () => Promise<void>) {
    const original = db.$transaction.bind(db);
    let armado = true;
    let ingreso: ReturnType<typeof ingresar> | undefined;
    const espia = vi.spyOn(db, '$transaction').mockImplementation(((
      callback: (tx: never) => Promise<unknown>,
    ) => {
      // Solo la primera transacción es la del servicio de cuentas; la del ingreso ya no se envuelve.
      if (!armado) return original(callback as never);
      armado = false;
      return original(async (tx) => {
        let primera = true;
        const despuesDeLaPrimera = async <T>(sentencia: Promise<T>): Promise<T> => {
          const resultado = await sentencia;
          if (primera) {
            primera = false;
            ingreso = ingresar(app, 'secre1', CLAVE);
            await Promise.race([ingreso, new Promise((resolver) => setTimeout(resolver, 500))]);
          }
          return resultado;
        };
        const intermediario = {
          usuario: { updateMany: (args: never) => despuesDeLaPrimera(tx.usuario.updateMany(args)) },
          sesion: { updateMany: (args: never) => despuesDeLaPrimera(tx.sesion.updateMany(args)) },
        };
        return callback(intermediario as never);
      });
    }) as never);
    try {
      await accion();
    } finally {
      espia.mockRestore();
    }
    expect(ingreso).toBeDefined();
    return (await ingreso)!;
  }

  async function verificarSinSesionViva(app: App, usuarioId: number, cookie: string) {
    expect(await db.sesion.count({ where: { usuarioId, revocadaEn: null } })).toBe(0);
    if (cookie !== '') expect((await sesionActual(app, cookie)).status).toBe(401);
  }

  it('un ingreso que entra entre las dos sentencias de la desactivación no deja una sesión viva', async () => {
    const app = await crearAppDePrueba();
    const admin = await ingresarComoAdministrador(app);
    const usuario = await crearUsuario({ nombreUsuario: 'secre1', hashContrasena: await hashClave });

    const { cookie } = await ejecutarConIngresoTrasLaPrimeraSentencia(app, async () => {
      expect((await desactivar(app, admin, usuario.id)).status).toBe(204);
    });

    await verificarSinSesionViva(app, usuario.id, cookie);
    expect((await ingresar(app, 'secre1', CLAVE)).res.status).toBe(401);
  });

  it('un ingreso que entra entre las dos sentencias del restablecimiento no deja una sesión viva', async () => {
    const app = await crearAppDePrueba();
    const admin = await ingresarComoAdministrador(app);
    const usuario = await crearUsuario({ nombreUsuario: 'secre1', hashContrasena: await hashClave });

    const { cookie } = await ejecutarConIngresoTrasLaPrimeraSentencia(app, async () => {
      expect((await restablecer(app, admin, usuario.id)).status).toBe(204);
    });

    await verificarSinSesionViva(app, usuario.id, cookie);
    expect((await ingresar(app, 'secre1', TEMPORAL)).res.status).toBe(200);
  });
});
