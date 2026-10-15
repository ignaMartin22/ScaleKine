import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { cargarConfiguracion } from '../../src/comun/configuracion.js';
import { RelojFijo } from '../../src/comun/reloj.js';
import { crearRutas } from '../../src/rutas.js';
import { ENTORNO_PRUEBA, loggerCapturado, ORIGEN_APP } from '../ayudantes.js';
import { db } from './base.js';
import { AHORA, crearPaciente, ingresarComo } from './fabricas.js';

async function crearAppDePrueba() {
  const config = cargarConfiguracion({ ...ENTORNO_PRUEBA, COOKIE_SECURE: 'false' });
  const reloj = new RelojFijo(AHORA);
  const rutas = await crearRutas({ db, reloj, config });
  return crearApp({ config, logger: loggerCapturado().logger, reloj, rutas });
}

describe('la API no se guarda en caché (RNF-14)', () => {
  it('toda respuesta de /api lleva Cache-Control: no-store, también las de error', async () => {
    const app = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    await crearPaciente({ dni: '90123456', nombre: 'Marta Ficticia Pérez' });
    const conSesion = { Origin: ORIGEN_APP, Cookie: cookie };

    const respuestas = {
      'datos (200)': await request(app).get('/api/pacientes?nombre=Marta').set(conSesion),
      'sesión propia (200)': await request(app).get('/api/sesion').set(conSesion),
      'salud (200)': await request(app).get('/api/salud'),
      'sin sesión (401)': await request(app).get('/api/pacientes?nombre=Marta'),
      'datos inválidos (400)': await request(app).get('/api/pacientes/abc').set(conSesion),
      'ruta inexistente (404)': await request(app).get('/api/no-existe').set(conSesion),
      'origen ajeno (403)': await request(app).post('/api/pacientes').set({ Origin: 'http://otro.example' }).send({}),
    };
    const estados = Object.fromEntries(Object.entries(respuestas).map(([caso, res]) => [caso, res.status]));

    expect(estados).toEqual({
      'datos (200)': 200,
      'sesión propia (200)': 200,
      'salud (200)': 200,
      'sin sesión (401)': 401,
      'datos inválidos (400)': 400,
      'ruta inexistente (404)': 404,
      'origen ajeno (403)': 403,
    });
    const sinNoStore = Object.entries(respuestas)
      .filter(([, res]) => res.headers['cache-control'] !== 'no-store')
      .map(([caso]) => caso);
    expect(sinNoStore).toEqual([]);
  });
});
