import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { MODULOS_DE_ESCRITURA, type ModuloEscritura } from '../../src/comun/autorizacion.js';
import { autorizarEscritura } from '../../src/comun/autorizarEscritura.js';
import { cargarConfiguracion } from '../../src/comun/configuracion.js';
import { RelojFijo } from '../../src/comun/reloj.js';
import type { Rol } from '../../src/generado/prisma/client.js';
import { hashearContrasena } from '../../src/modulos/m1-identidad/contrasenas.js';
import { crearModuloIdentidad } from '../../src/modulos/m1-identidad/index.js';
import { ENTORNO_PRUEBA, loggerCapturado, ORIGEN_APP } from '../ayudantes.js';
import { db } from './base.js';
import { crearPaciente, crearUsuario, ingresarComoAdministradorVerificado } from './fabricas.js';

const CLAVE = 'clave-de-prueba-larga';
const ERROR_NO_AUTORIZADO = {
  error: { codigo: 'no_autorizado', mensaje: 'No estás autorizado para realizar esta acción.' },
};

// Argon2 es lento a propósito: se calcula una vez y se reutiliza en todas las pruebas.
const hashClave = hashearContrasena(CLAVE);

/**
 * App con sesiones reales y una ruta de prueba por módulo. Cada ruta escribe de verdad en la base
 * para poder comprobar que un rechazo no altera datos.
 */
async function appConEscrituras() {
  const config = cargarConfiguracion(ENTORNO_PRUEBA);
  const reloj = new RelojFijo('2026-10-07T12:00:00Z');
  const capturado = loggerCapturado();
  const identidad = await crearModuloIdentidad({ db, reloj, config });
  const escrituras = Router();
  for (const modulo of MODULOS_DE_ESCRITURA) {
    escrituras.post(`/prueba/${modulo}`, identidad.exigirSesion, autorizarEscritura(modulo), async (_req, res, next) => {
      try {
        await crearPaciente();
        res.status(201).json({ modulo });
      } catch (err) {
        next(err);
      }
    });
  }
  // Mal montada a propósito: la autorización sin sesión previa (falla cerrada).
  escrituras.post('/prueba/sin-sesion', autorizarEscritura('pacientes'), async (_req, res, next) => {
    try {
      await crearPaciente();
      res.status(201).json({});
    } catch (err) {
      next(err);
    }
  });
  const app = crearApp({ config, logger: capturado.logger, reloj, rutas: [identidad.rutas, escrituras] });
  return { app, ...capturado };
}

/** Crea una cuenta del rol, ingresa y devuelve el valor de la cookie `sesion`. */
async function ingresarComo(app: Awaited<ReturnType<typeof appConEscrituras>>['app'], rol: Rol): Promise<string> {
  // El administrador exige el segundo factor (RNF-04): se usa el ayudante compartido.
  if (rol === 'administrador') return (await ingresarComoAdministradorVerificado(app)).token;
  const nombreUsuario = `ficticio-${rol}`;
  await crearUsuario({ rol, nombreUsuario, hashContrasena: await hashClave });
  const res = await request(app)
    .post('/api/sesion')
    .set('Origin', ORIGEN_APP)
    .send({ nombreUsuario, contrasena: CLAVE });
  expect(res.status).toBe(200);
  const cookie = (res.headers['set-cookie'] as string[] | undefined)?.[0];
  if (!cookie) throw new Error('El ingreso no trajo cookie.');
  return /^sesion=([^;]*)/.exec(cookie)![1]!;
}

describe('matriz de autorización por rol y módulo (RF-03)', () => {
  // El resultado esperado de cada combinación está escrito a mano: no se deriva de la tabla.
  const casos: [Rol, ModuloEscritura, boolean][] = [
    ['administrador', 'cuentas', true],
    ['administrador', 'kinesiologos', true],
    ['administrador', 'consultorio', true],
    ['administrador', 'pacientes', true],
    ['administrador', 'turnos', true],
    ['secretaria', 'cuentas', false],
    ['secretaria', 'kinesiologos', false],
    ['secretaria', 'consultorio', true],
    ['secretaria', 'pacientes', true],
    ['secretaria', 'turnos', true],
    ['kinesiologo', 'cuentas', false],
    ['kinesiologo', 'kinesiologos', false],
    ['kinesiologo', 'consultorio', false],
    ['kinesiologo', 'pacientes', false],
    ['kinesiologo', 'turnos', false],
  ];

  it.each(casos)('%s escribe en %s: %s', async (rol, modulo, permitido) => {
    const { app } = await appConEscrituras();
    const token = await ingresarComo(app, rol);

    const res = await request(app)
      .post(`/api/prueba/${modulo}`)
      .set('Origin', ORIGEN_APP)
      .set('Cookie', `sesion=${token}`)
      .send({});

    if (permitido) {
      expect(res.status).toBe(201);
      await expect(db.paciente.count()).resolves.toBe(1);
    } else {
      expect(res.status).toBe(403);
      expect(res.body).toEqual(ERROR_NO_AUTORIZADO);
      await expect(db.paciente.count()).resolves.toBe(0);
    }
  });
});

describe('el rol sale de la sesión (RF-03)', () => {
  it('un kinesiólogo no gana permisos declarando otro rol en el cuerpo o en una cabecera', async () => {
    const { app } = await appConEscrituras();
    const token = await ingresarComo(app, 'kinesiologo');

    const res = await request(app)
      .post('/api/prueba/turnos')
      .set('Origin', ORIGEN_APP)
      .set('Cookie', `sesion=${token}`)
      .set('X-Rol', 'administrador')
      .send({ rol: 'administrador' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual(ERROR_NO_AUTORIZADO);
    await expect(db.paciente.count()).resolves.toBe(0);
  });
});

describe('sin sesión (RF-03, RF-11)', () => {
  it('responde 401 sesion_invalida y no escribe', async () => {
    const { app } = await appConEscrituras();

    const res = await request(app).post('/api/prueba/pacientes').set('Origin', ORIGEN_APP).send({});

    expect(res.status).toBe(401);
    expect(res.body.error.codigo).toBe('sesion_invalida');
    await expect(db.paciente.count()).resolves.toBe(0);
  });
});

describe('falla cerrada (plan.md §4.8)', () => {
  it('una ruta con autorizarEscritura pero sin exigirSesion responde 500 y no escribe, aun con una cookie válida', async () => {
    const { app } = await appConEscrituras();
    const token = await ingresarComo(app, 'administrador');

    const res = await request(app)
      .post('/api/prueba/sin-sesion')
      .set('Origin', ORIGEN_APP)
      .set('Cookie', `sesion=${token}`)
      .send({});

    expect(res.status).toBe(500);
    expect(res.body.error.codigo).toBe('error_interno');
    await expect(db.paciente.count()).resolves.toBe(0);
  });
});
