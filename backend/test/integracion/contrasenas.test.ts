import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
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

async function appConRutaProtegida() {
  const config = cargarConfiguracion({
    ...ENTORNO_PRUEBA,
    COOKIE_SECURE: 'false',
  });
  const reloj = new RelojFijo('2026-10-07T12:00:00Z');
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

  it('deja consultar la sesión, cerrarla y cambiar la contraseña', async () => {
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
    expect(await verificarContrasena(guardado.hashContrasena, NUEVA)).toBe(true);
    expect(await verificarContrasena(guardado.hashContrasena, TEMPORAL)).toBe(false);

    // Se puede ingresar con la nueva y ya no con la temporal.
    expect((await ingresar(app, NUEVA)).res.status).toBe(200);
    expect((await ingresar(app, TEMPORAL)).res.status).toBe(401);
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
