import { Router } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { appDePrueba, ORIGEN_APP } from '../ayudantes.js';

function rutasDeEscritura(): Router {
  const router = Router();
  router.post('/eco', (req, res) => {
    res.json({ recibido: req.body });
  });
  return router;
}

describe('cabeceras de seguridad (RNF-01, RNF-10)', () => {
  it('están presentes en /api/salud, que responde sin datos', async () => {
    const { app } = appDePrueba();
    const res = await request(app).get('/api/salud');

    expect(res.status).toBe(200);
    expect(res.text).toBe('ok');

    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(res.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('también están presentes en las respuestas de error', async () => {
    const { app } = appDePrueba();
    const res = await request(app).get('/api/no-existe');

    expect(res.status).toBe(404);
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });
});

describe('verificación de Origin en escrituras (plan.md §4.15)', () => {
  it('rechaza una escritura con Origin ajeno', async () => {
    const { app } = appDePrueba([rutasDeEscritura()]);
    const res = await request(app).post('/api/eco').set('Origin', 'https://sitio-malicioso.example').send({ a: 1 });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: { codigo: 'origen_no_permitido', mensaje: 'La petición no proviene de la aplicación.' },
    });
  });

  it('rechaza una escritura sin Origin', async () => {
    const { app } = appDePrueba([rutasDeEscritura()]);
    const res = await request(app).post('/api/eco').send({ a: 1 });

    expect(res.status).toBe(403);
  });

  it('acepta una escritura desde el origen de la aplicación', async () => {
    const { app } = appDePrueba([rutasDeEscritura()]);
    const res = await request(app).post('/api/eco').set('Origin', ORIGEN_APP).send({ a: 1 });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ recibido: { a: 1 } });
  });

  it('no exige Origin en las lecturas', async () => {
    const { app } = appDePrueba();
    const res = await request(app).get('/api/salud').set('Origin', 'https://sitio-malicioso.example');

    expect(res.status).toBe(200);
  });
});
