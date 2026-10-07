import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ErrorNegocio, errorParaLog } from '../../src/comun/errores.js';
import { datosValidados, validar } from '../../src/comun/validacion.js';
import { appDePrueba, loggerCapturado, ORIGEN_APP } from '../ayudantes.js';

const esquemaAlta = { body: z.object({ cantidad: z.number().int().positive() }) };

function rutasDePrueba(): Router {
  const router = Router();
  router.get('/falla', () => {
    throw new Error('detalle interno: conexión a db-interna:5432 rechazada');
  });
  router.get('/falla-async', async () => {
    await Promise.resolve();
    throw new Error('detalle interno asincrónico');
  });
  router.get('/negocio', () => {
    throw new ErrorNegocio('franja_ocupada', 'La franja ya está ocupada.', 409);
  });
  router.post('/alta', validar(esquemaAlta), (_req, res) => {
    const { body } = datosValidados(res.locals, esquemaAlta);
    res.status(201).json({ cantidad: body.cantidad });
  });
  return router;
}

describe('manejo centralizado de errores (RNF-10)', () => {
  it('un error inesperado responde 500 sin traza ni detalle interno', async () => {
    const { app, texto } = appDePrueba([rutasDePrueba()]);
    const res = await request(app).get('/api/falla');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { codigo: 'error_interno', mensaje: 'Ocurrió un error inesperado. Intentá de nuevo.' },
    });
    expect(res.text).not.toContain('detalle interno');
    expect(res.text).not.toMatch(/\bat\s.+\(/);
    expect(res.text).not.toContain('.ts');

    // El detalle sí queda en el log del servidor.
    expect(texto()).toContain('detalle interno');
  });

  it('un error en un manejador asincrónico también llega al manejador central', async () => {
    const { app } = appDePrueba([rutasDePrueba()]);
    const res = await request(app).get('/api/falla-async');

    expect(res.status).toBe(500);
    expect(res.text).not.toContain('detalle interno');
  });

  it('un error de negocio responde su estado, código y mensaje', async () => {
    const { app } = appDePrueba([rutasDePrueba()]);
    const res = await request(app).get('/api/negocio');

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: { codigo: 'franja_ocupada', mensaje: 'La franja ya está ocupada.' } });
  });

  it('una ruta inexistente responde 404 con código', async () => {
    const { app } = appDePrueba();
    const res = await request(app).get('/api/no-existe');

    expect(res.status).toBe(404);
    expect(res.body.error.codigo).toBe('no_encontrado');
  });
});

describe('errores de Prisma en el log (RNF-08)', () => {
  it('se registran sin el mensaje, que puede copiar los argumentos de la consulta', () => {
    const error = new Error('Invalid `prisma.paciente.create()` invocation: { dni: "30111222" }');
    error.name = 'PrismaClientValidationError';
    const { logger, texto } = loggerCapturado();

    logger.error({ err: errorParaLog(error) }, 'error no controlado');

    expect(texto()).not.toContain('30111222');
    expect(texto()).toContain('PrismaClientValidationError');
  });

  it('los demás errores se registran completos', () => {
    const error = new Error('detalle útil para depurar');

    expect(errorParaLog(error)).toBe(error);
  });
});

describe('validación de entrada con zod (RNF-10)', () => {
  it('rechaza datos inválidos con los campos que fallaron, sin los valores', async () => {
    const { app } = appDePrueba([rutasDePrueba()]);
    const res = await request(app).post('/api/alta').set('Origin', ORIGEN_APP).send({ cantidad: 'valor-raro' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { codigo: 'datos_invalidos', mensaje: 'Los datos enviados no son válidos.', campos: ['body.cantidad'] },
    });
    expect(res.text).not.toContain('valor-raro');
  });

  it('deja pasar los datos válidos ya parseados', async () => {
    const { app } = appDePrueba([rutasDePrueba()]);
    const res = await request(app).post('/api/alta').set('Origin', ORIGEN_APP).send({ cantidad: 3 });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ cantidad: 3 });
  });

  it('rechaza un cuerpo que no es JSON válido', async () => {
    const { app } = appDePrueba([rutasDePrueba()]);
    const res = await request(app)
      .post('/api/alta')
      .set('Origin', ORIGEN_APP)
      .set('Content-Type', 'application/json')
      .send('{"cantidad":');

    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe('json_invalido');
  });

  it('rechaza una petición de más de 100 kB', async () => {
    const { app } = appDePrueba([rutasDePrueba()]);
    const res = await request(app)
      .post('/api/alta')
      .set('Origin', ORIGEN_APP)
      .send({ relleno: 'x'.repeat(101 * 1024) });

    expect(res.status).toBe(413);
    expect(res.body.error.codigo).toBe('peticion_demasiado_grande');
  });
});
