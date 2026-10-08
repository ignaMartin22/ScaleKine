import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { DURACION_SESION_MS } from '../../src/modulos/m1-identidad/servicio.js';
import { crearApp } from '../../src/app.js';
import { cargarConfiguracion } from '../../src/comun/configuracion.js';
import { RelojFijo } from '../../src/comun/reloj.js';
import { hashearContrasena, verificarContrasena } from '../../src/modulos/m1-identidad/contrasenas.js';
import { crearModuloIdentidad } from '../../src/modulos/m1-identidad/index.js';
import { ENTORNO_PRUEBA, loggerCapturado, ORIGEN_APP } from '../ayudantes.js';
import { db } from './base.js';
import { crearUsuario } from './fabricas.js';

const TEMPORAL = 'temporal-del-admin-1';
const NUEVA = 'mi-clave-elegida-2026';

// Argon2 es lento a propósito: se calcula una vez y se reutiliza en todas las pruebas.
const hashTemporal = hashearContrasena(TEMPORAL);

async function appConRutaProtegida(reloj = new RelojFijo('2026-10-07T12:00:00Z')) {
  const config = cargarConfiguracion({ ...ENTORNO_PRUEBA, COOKIE_SECURE: 'false' });
  const { logger } = loggerCapturado();
  const identidad = await crearModuloIdentidad({ db, reloj, config });
  // Ruta de negocio cualquiera, que exige sesión como lo harán las de las tareas futuras.
  const rutaDeNegocio = Router();
  rutaDeNegocio.get('/protegida', identidad.exigirSesion, (_req, res) => {
    res.json({ ok: true });
  });
  return crearApp({
    config,
    logger,
    reloj,
    rutas: [identidad.rutas, rutaDeNegocio],
  });
}

type App = Awaited<ReturnType<typeof appConRutaProtegida>>;

async function cuentaMarcada() {
  return crearUsuario({
    nombreUsuario: 'marcada1',
    hashContrasena: await hashTemporal,
    debeCambiarContrasena: true,
  });
}

async function ingresar(app: App, contrasena = TEMPORAL, nombreUsuario = 'marcada1') {
  const res = await request(app)
    .post('/api/sesion')
    .set('Origin', ORIGEN_APP)
    .send({ nombreUsuario, contrasena });
  const cookie = (res.headers['set-cookie'] as string[] | undefined)?.[0]?.split(';')[0] ?? '';
  return { res, cookie };
}

const cambiar = (app: App, cookie: string, cuerpo: Record<string, unknown>) =>
  request(app).put('/api/sesion/contrasena').set('Origin', ORIGEN_APP).set('Cookie', cookie).send(cuerpo);

describe('cuenta marcada para cambio de contraseña (RF-06)', () => {
  it('el ingreso y la sesión informan la marca', async () => {
    await cuentaMarcada();
    const app = await appConRutaProtegida();

    const { res, cookie } = await ingresar(app);
    expect(res.status).toBe(200);
    expect(res.body.usuario.debeCambiarContrasena).toBe(true);

    const actual = await request(app).get('/api/sesion').set('Cookie', cookie);
    expect(actual.status).toBe(200);
    expect(actual.body.usuario).toEqual({
      nombreUsuario: 'marcada1',
      rol: 'secretaria',
      debeCambiarContrasena: true,
    });
  });

  it('rechaza con 403 y un código estable toda ruta que exija sesión', async () => {
    await cuentaMarcada();
    const app = await appConRutaProtegida();
    const { cookie } = await ingresar(app);

    const res = await request(app).get('/api/protegida').set('Cookie', cookie);
    expect(res.status).toBe(403);
    expect(res.body.error.codigo).toBe('debe_cambiar_contrasena');
  });

  it('deja consultar la sesión y cerrarla', async () => {
    await cuentaMarcada();
    const app = await appConRutaProtegida();
    const { cookie } = await ingresar(app);

    expect((await request(app).get('/api/sesion').set('Cookie', cookie)).status).toBe(200);
    expect(
      (await request(app).delete('/api/sesion').set('Origin', ORIGEN_APP).set('Cookie', cookie)).status,
    ).toBe(204);
  });

  it('queda libre al cambiar la contraseña con la temporal como actual (RF-07)', async () => {
    const usuario = await cuentaMarcada();
    const app = await appConRutaProtegida();
    const { cookie } = await ingresar(app);

    const res = await cambiar(app, cookie, {
      contrasenaActual: TEMPORAL,
      contrasenaNueva: NUEVA,
    });
    expect(res.status).toBe(204);

    // La misma sesión ya accede a las rutas de negocio y la sesión informa la marca apagada.
    expect((await request(app).get('/api/protegida').set('Cookie', cookie)).status).toBe(200);
    const actual = await request(app).get('/api/sesion').set('Cookie', cookie);
    expect(actual.body.usuario.debeCambiarContrasena).toBe(false);

    const guardado = await db.usuario.findUniqueOrThrow({
      where: { id: usuario.id },
    });
    expect(guardado.debeCambiarContrasena).toBe(false);
    expect(guardado.hashContrasena.startsWith('$argon2id$')).toBe(true);
    expect(await verificarContrasena(guardado.hashContrasena, NUEVA)).toBe(true);
    expect(await verificarContrasena(guardado.hashContrasena, TEMPORAL)).toBe(false);

    // Se puede ingresar con la nueva y ya no con la temporal.
    expect((await ingresar(app, NUEVA)).res.status).toBe(200);
    expect((await ingresar(app, TEMPORAL)).res.status).toBe(401);
  });

  it('una sesión vencida de una cuenta marcada recibe 401 y no 403', async () => {
    await cuentaMarcada();
    const reloj = new RelojFijo('2026-10-07T12:00:00Z');
    const app = await appConRutaProtegida(reloj);
    const { cookie } = await ingresar(app);

    reloj.avanzar(DURACION_SESION_MS);
    const res = await request(app).get('/api/protegida').set('Cookie', cookie);
    expect(res.status).toBe(401);
    expect(res.body.error.codigo).toBe('sesion_invalida');
  });

  it('una cuenta sin la marca accede a las rutas de negocio', async () => {
    await crearUsuario({
      nombreUsuario: 'libre1',
      hashContrasena: await hashTemporal,
    });
    const app = await appConRutaProtegida();
    const { cookie } = await ingresar(app, TEMPORAL, 'libre1');

    expect((await request(app).get('/api/protegida').set('Cookie', cookie)).status).toBe(200);
  });
});

describe('cambio de la propia contraseña (RF-07, RNF-03)', () => {
  it('exige la contraseña actual correcta, con un código que no es 401', async () => {
    const usuario = await cuentaMarcada();
    const app = await appConRutaProtegida();
    const { cookie } = await ingresar(app);

    const res = await cambiar(app, cookie, {
      contrasenaActual: 'otra-que-no-es-la-actual',
      contrasenaNueva: NUEVA,
    });
    expect(res.status).toBe(403);
    expect(res.body.error.codigo).toBe('contrasena_actual_incorrecta');

    // No se cambió nada: la marca sigue y la contraseña también.
    const guardado = await db.usuario.findUniqueOrThrow({
      where: { id: usuario.id },
    });
    expect(guardado.debeCambiarContrasena).toBe(true);
    expect(await verificarContrasena(guardado.hashContrasena, TEMPORAL)).toBe(true);
  });

  it('rechaza una contraseña nueva corta o común y deja la cuenta como estaba', async () => {
    const usuario = await cuentaMarcada();
    const app = await appConRutaProtegida();
    const { cookie } = await ingresar(app);

    const corta = await cambiar(app, cookie, {
      contrasenaActual: TEMPORAL,
      contrasenaNueva: 'Corta-1',
    });
    expect(corta.status).toBe(400);
    expect(corta.body.error.codigo).toBe('contrasena_corta');

    const comun = await cambiar(app, cookie, {
      contrasenaActual: TEMPORAL,
      contrasenaNueva: 'password1234',
    });
    expect(comun.status).toBe(400);
    expect(comun.body.error.codigo).toBe('contrasena_comun');

    const guardado = await db.usuario.findUniqueOrThrow({
      where: { id: usuario.id },
    });
    expect(guardado.debeCambiarContrasena).toBe(true);
    expect(await verificarContrasena(guardado.hashContrasena, TEMPORAL)).toBe(true);
  });

  it('rechaza elegir la misma contraseña que la actual', async () => {
    await cuentaMarcada();
    const app = await appConRutaProtegida();
    const { cookie } = await ingresar(app);

    const res = await cambiar(app, cookie, {
      contrasenaActual: TEMPORAL,
      contrasenaNueva: TEMPORAL,
    });
    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe('contrasena_igual_a_la_actual');
  });

  it('valida el cuerpo y exige sesión', async () => {
    await cuentaMarcada();
    const app = await appConRutaProtegida();
    const { cookie } = await ingresar(app);

    const sinCampos = await cambiar(app, cookie, {
      contrasenaActual: TEMPORAL,
    });
    expect(sinCampos.status).toBe(400);

    const sinSesion = await request(app)
      .put('/api/sesion/contrasena')
      .set('Origin', ORIGEN_APP)
      .send({ contrasenaActual: TEMPORAL, contrasenaNueva: NUEVA });
    expect(sinSesion.status).toBe(401);
  });

  it('rechaza el carácter NUL en cualquiera de las dos contraseñas', async () => {
    const usuario = await cuentaMarcada();
    const app = await appConRutaProtegida();
    const { cookie } = await ingresar(app);

    const enNueva = await cambiar(app, cookie, {
      contrasenaActual: TEMPORAL,
      contrasenaNueva: `${NUEVA}\u0000`,
    });
    expect(enNueva.status).toBe(400);
    const enActual = await cambiar(app, cookie, {
      contrasenaActual: `${TEMPORAL}\u0000`,
      contrasenaNueva: NUEVA,
    });
    expect(enActual.status).toBe(400);

    const guardado = await db.usuario.findUniqueOrThrow({ where: { id: usuario.id } });
    expect(guardado.debeCambiarContrasena).toBe(true);
  });

  it('rechaza una contraseña nueva de solo espacios', async () => {
    await cuentaMarcada();
    const app = await appConRutaProtegida();
    const { cookie } = await ingresar(app);

    const res = await cambiar(app, cookie, { contrasenaActual: TEMPORAL, contrasenaNueva: ' '.repeat(14) });
    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe('contrasena_en_blanco');
  });

  it('una cuenta sin la marca también puede cambiarla (RF-07)', async () => {
    await crearUsuario({
      nombreUsuario: 'libre1',
      hashContrasena: await hashTemporal,
    });
    const app = await appConRutaProtegida();
    const { cookie } = await ingresar(app, TEMPORAL, 'libre1');

    const res = await cambiar(app, cookie, {
      contrasenaActual: TEMPORAL,
      contrasenaNueva: NUEVA,
    });
    expect(res.status).toBe(204);
    expect((await ingresar(app, NUEVA, 'libre1')).res.status).toBe(200);
  });
});

describe('cierre de las demás sesiones al cambiar la contraseña (RF-07)', () => {
  async function dosSesiones(app: App) {
    const propia = await ingresar(app);
    const ajena = await ingresar(app);
    expect(propia.cookie).not.toBe(ajena.cookie);
    return { propia: propia.cookie, ajena: ajena.cookie };
  }

  it('en el primer ingreso cierra las sesiones abiertas con la temporal y deja la propia', async () => {
    const usuario = await cuentaMarcada();
    const app = await appConRutaProtegida();
    const { propia, ajena } = await dosSesiones(app);

    const res = await cambiar(app, propia, { contrasenaActual: TEMPORAL, contrasenaNueva: NUEVA });
    expect(res.status).toBe(204);

    const deLaAjena = await request(app).get('/api/sesion').set('Cookie', ajena);
    expect(deLaAjena.status).toBe(401);
    expect((await request(app).get('/api/protegida').set('Cookie', ajena)).status).toBe(401);
    expect((await request(app).get('/api/protegida').set('Cookie', propia)).status).toBe(200);

    const sesiones = await db.sesion.findMany({ where: { usuarioId: usuario.id } });
    expect(sesiones).toHaveLength(2);
    expect(sesiones.filter((s) => s.revocadaEn === null)).toHaveLength(1);
  });

  it('en un cambio voluntario también cierra las demás sesiones', async () => {
    await crearUsuario({ nombreUsuario: 'marcada1', hashContrasena: await hashTemporal });
    const app = await appConRutaProtegida();
    const { propia, ajena } = await dosSesiones(app);

    const res = await cambiar(app, propia, { contrasenaActual: TEMPORAL, contrasenaNueva: NUEVA });
    expect(res.status).toBe(204);

    expect((await request(app).get('/api/protegida').set('Cookie', ajena)).status).toBe(401);
    expect((await request(app).get('/api/protegida').set('Cookie', propia)).status).toBe(200);
  });

  it('un cambio rechazado no cierra ninguna sesión', async () => {
    await cuentaMarcada();
    const app = await appConRutaProtegida();
    const { propia, ajena } = await dosSesiones(app);

    const res = await cambiar(app, propia, {
      contrasenaActual: 'incorrecta-de-largo-ok',
      contrasenaNueva: NUEVA,
    });
    expect(res.status).toBe(403);

    expect((await request(app).get('/api/sesion').set('Cookie', ajena)).status).toBe(200);
  });

  it('no toca las sesiones de otras cuentas', async () => {
    await cuentaMarcada();
    await crearUsuario({ nombreUsuario: 'otra1', hashContrasena: await hashTemporal });
    const app = await appConRutaProtegida();
    const { cookie: propia } = await ingresar(app);
    const { cookie: deOtra } = await ingresar(app, TEMPORAL, 'otra1');

    await cambiar(app, propia, { contrasenaActual: TEMPORAL, contrasenaNueva: NUEVA });

    expect((await request(app).get('/api/protegida').set('Cookie', deOtra)).status).toBe(200);
  });

  it('no pisa un restablecimiento concurrente de la contraseña (RF-08)', async () => {
    const usuario = await cuentaMarcada();
    const app = await appConRutaProtegida();
    const { cookie } = await ingresar(app);

    // Entre la lectura del hash y la escritura, un restablecimiento cambia la contraseña. Se simula
    // restableciéndola justo después de que el servicio lee el hash.
    const hashRestablecido = await hashearContrasena('restablecida-por-admin-9');
    const original = db.usuario.findUnique.bind(db.usuario);
    let primera = true;
    const espia = vi.spyOn(db.usuario, 'findUnique').mockImplementation(((args: never) => {
      const lectura = original(args);
      if (!primera) return lectura;
      primera = false;
      return lectura.then(async (usuarioLeido) => {
        await db.usuario.update({ where: { id: usuario.id }, data: { hashContrasena: hashRestablecido } });
        return usuarioLeido;
      });
    }) as never);
    try {
      const res = await cambiar(app, cookie, { contrasenaActual: TEMPORAL, contrasenaNueva: NUEVA });
      expect(res.status).toBe(409);
      expect(res.body.error.codigo).toBe('contrasena_modificada');
    } finally {
      espia.mockRestore();
    }

    const guardado = await db.usuario.findUniqueOrThrow({ where: { id: usuario.id } });
    expect(guardado.hashContrasena).toBe(hashRestablecido);
    expect(guardado.debeCambiarContrasena).toBe(true);
    // La transacción se deshizo entera: ninguna sesión quedó revocada.
    expect(await db.sesion.count({ where: { usuarioId: usuario.id, revocadaEn: { not: null } } })).toBe(0);
  });
});
