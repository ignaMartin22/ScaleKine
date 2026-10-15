import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { crearApp } from '../../src/app.js';
import { cargarConfiguracion } from '../../src/comun/configuracion.js';
import { RelojFijo } from '../../src/comun/reloj.js';
import { verificarContrasena } from '../../src/modulos/m1-identidad/contrasenas.js';
import { crearRutas } from '../../src/rutas.js';
import { ENTORNO_PRUEBA, loggerCapturado, ORIGEN_APP } from '../ayudantes.js';
import { db } from './base.js';
import { AHORA, crearKinesiologo, crearTurno, crearUsuario, ingresarComo } from './fabricas.js';

const TEMPORAL = 'temporal-del-admin-1';
const NUEVA_TEMPORAL = 'otra-temporal-del-admin-2';
const ERROR_NO_AUTORIZADO = {
  error: { codigo: 'no_autorizado', mensaje: 'No estás autorizado para realizar esta acción.' },
};
const ALTA = {
  nombre: 'Kinesiólogo Ficticio Uno',
  bloque: 'manana',
  nombreUsuario: 'kine-uno',
  contrasenaTemporal: TEMPORAL,
};

async function crearAppDePrueba() {
  const config = cargarConfiguracion({ ...ENTORNO_PRUEBA, COOKIE_SECURE: 'false' });
  const reloj = new RelojFijo(AHORA);
  const capturado = loggerCapturado();
  const rutas = await crearRutas({ db, reloj, config });
  return { app: crearApp({ config, logger: capturado.logger, reloj, rutas }), ...capturado };
}
type App = Awaited<ReturnType<typeof crearAppDePrueba>>['app'];

async function ingresar(app: App, nombreUsuario: string, contrasena: string) {
  const res = await request(app).post('/api/sesion').set('Origin', ORIGEN_APP).send({ nombreUsuario, contrasena });
  const cookie = (res.headers['set-cookie'] as string[] | undefined)?.[0]?.split(';')[0] ?? '';
  return { res, cookie };
}

const conCookie = (cookie?: string) => (cookie ? { Origin: ORIGEN_APP, Cookie: cookie } : { Origin: ORIGEN_APP });
const listar = (app: App, cookie?: string, consulta = '') =>
  request(app).get(`/api/kinesiologos${consulta}`).set(conCookie(cookie));
const alta = (app: App, cookie: string | undefined, cuerpo: unknown) =>
  request(app)
    .post('/api/kinesiologos')
    .set(conCookie(cookie))
    .send(cuerpo as object);
const cambiarBloque = (app: App, cookie: string | undefined, id: number | string, cuerpo: unknown) =>
  request(app)
    .put(`/api/kinesiologos/${id}/bloque`)
    .set(conCookie(cookie))
    .send(cuerpo as object);

describe('alta de kinesiólogo (RF-14)', () => {
  it('crea la cuenta y el perfil: rol kinesiólogo, activa, con cambio de contraseña pendiente', async () => {
    const { app } = await crearAppDePrueba();
    const admin = (await ingresarComo(app, 'administrador')).cookie;

    const res = await alta(app, admin, ALTA);

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      kinesiologo: { id: expect.any(Number), nombre: ALTA.nombre, bloque: 'manana', activo: true },
    });
    const perfil = await db.kinesiologo.findUniqueOrThrow({
      where: { id: res.body.kinesiologo.id },
      include: { usuario: true },
    });
    expect(perfil.usuario).toMatchObject({
      nombreUsuario: 'kine-uno',
      rol: 'kinesiologo',
      activo: true,
      debeCambiarContrasena: true,
    });
    // La contraseña se guarda con hash y la temporal sirve para ingresar.
    expect(perfil.usuario.hashContrasena).not.toContain(TEMPORAL);
    expect(await verificarContrasena(perfil.usuario.hashContrasena, TEMPORAL)).toBe(true);
    expect((await ingresar(app, 'kine-uno', TEMPORAL)).res.status).toBe(200);
  });

  it('no devuelve hashes ni datos de la cuenta, y no registra nombres ni contraseñas en los logs', async () => {
    const { app, texto } = await crearAppDePrueba();
    const admin = (await ingresarComo(app, 'administrador')).cookie;

    const res = await alta(app, admin, ALTA);

    expect(Object.keys(res.body.kinesiologo).sort()).toEqual(['activo', 'bloque', 'id', 'nombre']);
    expect(JSON.stringify(res.body)).not.toMatch(/hash|kine-uno|argon/i);
    const registro = texto();
    expect(registro).not.toContain(TEMPORAL);
    expect(registro).not.toContain(ALTA.nombre);
    expect(registro).not.toContain(ALTA.nombreUsuario);
  });

  it('un rol u otras claves en el cuerpo se ignoran: la cuenta siempre es de kinesiólogo', async () => {
    const { app } = await crearAppDePrueba();
    const admin = (await ingresarComo(app, 'administrador')).cookie;

    const res = await alta(app, admin, { ...ALTA, rol: 'administrador', activo: false, usuarioId: 1 });

    expect(res.status).toBe(201);
    const perfil = await db.kinesiologo.findUniqueOrThrow({
      where: { id: res.body.kinesiologo.id },
      include: { usuario: true },
    });
    expect(perfil.usuario.rol).toBe('kinesiologo');
    expect(perfil.usuario.activo).toBe(true);
  });

  it('crea las dos filas o ninguna: si falla la del perfil, la cuenta no queda', async () => {
    const { app } = await crearAppDePrueba();
    const admin = (await ingresarComo(app, 'administrador')).cookie;
    const usuariosAntes = await db.usuario.count();
    const original = db.$transaction.bind(db);
    const espia = vi.spyOn(db, '$transaction').mockImplementation(((callback: (tx: never) => Promise<unknown>) =>
      original(async (tx) => {
        const intermediario = {
          usuario: tx.usuario,
          kinesiologo: { create: () => Promise.reject(new Error('fallo forzado de la segunda escritura')) },
        };
        return callback(intermediario as never);
      })) as never);
    let res;
    try {
      res = await alta(app, admin, ALTA);
    } finally {
      espia.mockRestore();
    }

    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/fallo forzado|at .*\.ts|stack/i);
    expect(await db.usuario.count()).toBe(usuariosAntes);
    expect(await db.usuario.count({ where: { nombreUsuario: 'kine-uno' } })).toBe(0);
    expect(await db.kinesiologo.count()).toBe(0);
  });

  it('nombre de usuario en uso: 409 y no se crea nada', async () => {
    const { app } = await crearAppDePrueba();
    const admin = (await ingresarComo(app, 'administrador')).cookie;
    await crearUsuario({ nombreUsuario: 'kine-uno' });

    const res = await alta(app, admin, ALTA);

    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe('nombre_usuario_en_uso');
    expect(await db.kinesiologo.count()).toBe(0);
  });

  it('dos altas simultáneas con el mismo nombre de usuario: una gana y la otra recibe 409', async () => {
    const { app } = await crearAppDePrueba();
    const admin = (await ingresarComo(app, 'administrador')).cookie;

    const [a, b] = await Promise.all([
      alta(app, admin, ALTA),
      alta(app, admin, { ...ALTA, nombre: 'Kinesiólogo Ficticio Dos' }),
    ]);

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect([a, b].find((r) => r.status === 409)!.body.error.codigo).toBe('nombre_usuario_en_uso');
    expect(await db.kinesiologo.count()).toBe(1);
    expect(await db.usuario.count({ where: { nombreUsuario: 'kine-uno' } })).toBe(1);
  });

  it.each([
    ['sin nombre', { ...ALTA, nombre: undefined }],
    ['nombre vacío', { ...ALTA, nombre: '   ' }],
    ['bloque inexistente', { ...ALTA, bloque: 'noche' }],
    ['sin bloque', { ...ALTA, bloque: undefined }],
    ['nombre de usuario corto', { ...ALTA, nombreUsuario: 'ab' }],
    ['contraseña corta', { ...ALTA, contrasenaTemporal: 'corta' }],
    ['contraseña común', { ...ALTA, contrasenaTemporal: 'password1234' }],
    ['NUL en el nombre', { ...ALTA, nombre: 'Ana\u0000' }],
  ])('%s: 400 y no se crea nada', async (_caso, cuerpo) => {
    const { app } = await crearAppDePrueba();
    const admin = (await ingresarComo(app, 'administrador')).cookie;

    const res = await alta(app, admin, cuerpo);

    expect(res.status).toBe(400);
    expect(await db.kinesiologo.count()).toBe(0);
    expect(await db.usuario.count({ where: { rol: 'kinesiologo' } })).toBe(0);
  });

  it.each(['secretaria', 'kinesiologo'] as const)('%s recibe 403 y no se crea nada', async (rol) => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, rol)).cookie;

    const res = await alta(app, cookie, ALTA);

    expect(res.status).toBe(403);
    expect(res.body).toEqual(ERROR_NO_AUTORIZADO);
    expect(await db.kinesiologo.count()).toBe(0);
  });

  it('sin sesión recibe 401', async () => {
    const { app } = await crearAppDePrueba();
    expect((await alta(app, undefined, ALTA)).status).toBe(401);
    expect(await db.kinesiologo.count()).toBe(0);
  });
});

describe('cuenta de kinesiólogo gestionada desde /api/cuentas (T-13)', () => {
  it('se restablece: contraseña nueva, cambio pendiente y sesiones revocadas', async () => {
    const { app } = await crearAppDePrueba();
    const admin = (await ingresarComo(app, 'administrador')).cookie;
    const creado = await alta(app, admin, ALTA);
    const { cookie } = await ingresar(app, 'kine-uno', TEMPORAL);
    expect((await request(app).get('/api/sesion').set('Cookie', cookie)).status).toBe(200);
    const usuarioId = (await db.kinesiologo.findUniqueOrThrow({ where: { id: creado.body.kinesiologo.id } })).usuarioId;

    const res = await request(app)
      .post(`/api/cuentas/${usuarioId}/restablecimiento`)
      .set(conCookie(admin))
      .send({ contrasenaTemporal: NUEVA_TEMPORAL });

    expect(res.status).toBe(204);
    expect((await request(app).get('/api/sesion').set('Cookie', cookie)).status).toBe(401);
    expect((await ingresar(app, 'kine-uno', TEMPORAL)).res.status).toBe(401);
    expect((await ingresar(app, 'kine-uno', NUEVA_TEMPORAL)).res.status).toBe(200);
  });

  it('se desactiva: revoca sus sesiones, no puede ingresar y el listado la marca inactiva', async () => {
    const { app } = await crearAppDePrueba();
    const admin = (await ingresarComo(app, 'administrador')).cookie;
    const creado = await alta(app, admin, ALTA);
    const { cookie } = await ingresar(app, 'kine-uno', TEMPORAL);
    const usuarioId = (await db.kinesiologo.findUniqueOrThrow({ where: { id: creado.body.kinesiologo.id } })).usuarioId;

    const res = await request(app).post(`/api/cuentas/${usuarioId}/desactivacion`).set(conCookie(admin)).send({});

    expect(res.status).toBe(204);
    expect((await request(app).get('/api/sesion').set('Cookie', cookie)).status).toBe(401);
    expect(await db.sesion.count({ where: { usuarioId, revocadaEn: null } })).toBe(0);
    expect((await ingresar(app, 'kine-uno', TEMPORAL)).res.status).toBe(401);
    const listado = await listar(app, admin);
    expect(listado.body.kinesiologos).toEqual([
      { id: creado.body.kinesiologo.id, nombre: ALTA.nombre, bloque: 'manana', activo: false },
    ]);
  });
});

describe('cambio de bloque (RF-16)', () => {
  it('el administrador cambia el bloque y no se toca ningún turno', async () => {
    const { app } = await crearAppDePrueba();
    const admin = (await ingresarComo(app, 'administrador')).cookie;
    const kinesiologo = await crearKinesiologo({ bloque: 'manana' });
    const turno = await crearTurno({ kinesiologoId: kinesiologo.id, horaInicio: '08:00' });
    const eventosAntes = await db.turnoEvento.count();

    const res = await cambiarBloque(app, admin, kinesiologo.id, { bloque: 'tarde' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      kinesiologo: { id: kinesiologo.id, nombre: kinesiologo.nombre, bloque: 'tarde', activo: true },
    });
    expect((await db.kinesiologo.findUniqueOrThrow({ where: { id: kinesiologo.id } })).bloque).toBe('tarde');
    // El turno existente queda idéntico, con su hora de la mañana, y no aparecen eventos.
    expect(await db.turno.findUniqueOrThrow({ where: { id: turno.id } })).toEqual(turno);
    expect(await db.turnoEvento.count()).toBe(eventosAntes);
  });

  it('es idempotente: repetir el mismo bloque responde 200', async () => {
    const { app } = await crearAppDePrueba();
    const admin = (await ingresarComo(app, 'administrador')).cookie;
    const kinesiologo = await crearKinesiologo({ bloque: 'tarde' });

    expect((await cambiarBloque(app, admin, kinesiologo.id, { bloque: 'tarde' })).status).toBe(200);
  });

  it('un kinesiólogo inexistente da 404', async () => {
    const { app } = await crearAppDePrueba();
    const admin = (await ingresarComo(app, 'administrador')).cookie;

    const res = await cambiarBloque(app, admin, 999_999, { bloque: 'tarde' });

    expect(res.status).toBe(404);
    expect(res.body.error.codigo).toBe('kinesiologo_no_encontrado');
  });

  it.each([
    ['bloque inexistente', 1, { bloque: 'noche' }],
    ['sin bloque', 1, {}],
    ['id no numérico', 'abc', { bloque: 'tarde' }],
    ['id cero', 0, { bloque: 'tarde' }],
    ['id fuera de rango', '99999999999', { bloque: 'tarde' }],
  ])('%s: 400', async (_caso, id, cuerpo) => {
    const { app } = await crearAppDePrueba();
    const admin = (await ingresarComo(app, 'administrador')).cookie;
    const kinesiologo = await crearKinesiologo({ bloque: 'manana' });

    const res = await cambiarBloque(app, admin, id, cuerpo);

    expect(res.status).toBe(400);
    expect((await db.kinesiologo.findUniqueOrThrow({ where: { id: kinesiologo.id } })).bloque).toBe('manana');
  });

  it.each(['secretaria', 'kinesiologo'] as const)('%s recibe 403 y el bloque no cambia', async (rol) => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, rol)).cookie;
    const kinesiologo = await crearKinesiologo({ bloque: 'manana' });

    const res = await cambiarBloque(app, cookie, kinesiologo.id, { bloque: 'tarde' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual(ERROR_NO_AUTORIZADO);
    expect((await db.kinesiologo.findUniqueOrThrow({ where: { id: kinesiologo.id } })).bloque).toBe('manana');
  });

  it('sin sesión recibe 401', async () => {
    const { app } = await crearAppDePrueba();
    const kinesiologo = await crearKinesiologo({ bloque: 'manana' });
    expect((await cambiarBloque(app, undefined, kinesiologo.id, { bloque: 'tarde' })).status).toBe(401);
  });
});

describe('listado de kinesiólogos', () => {
  it.each(['secretaria', 'administrador'] as const)('%s lista id, nombre, bloque y si está activo', async (rol) => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, rol)).cookie;
    const a = await crearKinesiologo({ bloque: 'tarde' });
    const b = await crearKinesiologo({ bloque: 'manana' });
    await db.usuario.update({ where: { id: b.usuarioId }, data: { activo: false } });

    const res = await listar(app, cookie);

    expect(res.status).toBe(200);
    expect(res.body.kinesiologos).toEqual(
      [
        { id: a.id, nombre: a.nombre, bloque: 'tarde', activo: true },
        { id: b.id, nombre: b.nombre, bloque: 'manana', activo: false },
      ].sort((x, y) => x.nombre.localeCompare(y.nombre)),
    );
    expect(JSON.stringify(res.body)).not.toMatch(/hash|usuarioId|totp|intentos/i);
  });

  it('filtra por bloque', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;
    const manana = await crearKinesiologo({ bloque: 'manana' });
    const tarde = await crearKinesiologo({ bloque: 'tarde' });

    const deManana = await listar(app, cookie, '?bloque=manana');
    const deTarde = await listar(app, cookie, '?bloque=tarde');

    expect(deManana.body.kinesiologos.map((k: { id: number }) => k.id)).toEqual([manana.id]);
    expect(deTarde.body.kinesiologos.map((k: { id: number }) => k.id)).toEqual([tarde.id]);
  });

  it('un bloque inválido da 400', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;
    expect((await listar(app, cookie, '?bloque=noche')).status).toBe(400);
  });

  it('sin kinesiólogos devuelve una lista vacía', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;
    const res = await listar(app, cookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ kinesiologos: [] });
  });

  it('el kinesiólogo recibe 403 y no ve a nadie (D-16)', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'kinesiologo')).cookie;
    await crearKinesiologo();

    const res = await listar(app, cookie);

    expect(res.status).toBe(403);
    expect(res.body).toEqual(ERROR_NO_AUTORIZADO);
  });

  it('sin sesión recibe 401', async () => {
    const { app } = await crearAppDePrueba();
    expect((await listar(app)).status).toBe(401);
  });
});
