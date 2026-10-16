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
  const capturado = loggerCapturado();
  const rutas = await crearRutas({ db, reloj, config });
  return { app: crearApp({ config, logger: capturado.logger, reloj, rutas }), ...capturado };
}
type App = Awaited<ReturnType<typeof crearAppDePrueba>>['app'];

const sugerencias = (app: App, cookie?: string) =>
  request(app).get('/api/obras-sociales').set(cookie ? { Origin: ORIGEN_APP, Cookie: cookie } : { Origin: ORIGEN_APP });

describe('GET /api/obras-sociales (RF-49)', () => {
  it('sin pacientes sugiere solo "Particular"', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');

    const res = await sugerencias(app, cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ obrasSociales: ['Particular'] });
  });

  it('devuelve las distintas, sin repetidas, ordenadas e incluyendo "Particular"', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    await crearPaciente({ obraSocial: 'Osde' });
    await crearPaciente({ obraSocial: 'Galeno' });
    await crearPaciente({ obraSocial: 'Osde' });
    await crearPaciente({ obraSocial: 'Particular' });
    await crearPaciente({ obraSocial: 'Swiss Medical' });
    await crearPaciente({ obraSocial: 'Galeno' });

    const res = await sugerencias(app, cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ obrasSociales: ['Galeno', 'Osde', 'Particular', 'Swiss Medical'] });
  });

  it('el administrador también la lee', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'administrador');
    await crearPaciente({ obraSocial: 'Osde' });

    const res = await sugerencias(app, cookie);

    expect(res.status).toBe(200);
    expect(res.body.obrasSociales).toEqual(['Osde', 'Particular']);
  });

  it('el kinesiólogo recibe 403 y sin sesión 401', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'kinesiologo');
    await crearPaciente({ obraSocial: 'Osde' });

    const prohibido = await sugerencias(app, cookie);
    const sinSesion = await sugerencias(app);

    expect(prohibido.status).toBe(403);
    expect(prohibido.body.error.codigo).toBe('no_autorizado');
    expect(JSON.stringify(prohibido.body)).not.toContain('Osde');
    expect(sinSesion.status).toBe(401);
  });

  it('responde con Cache-Control: no-store y solo nombres de obras sociales', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const paciente = await crearPaciente({ dni: '90444555', nombre: 'Paciente Ficticio Sugerencia', obraSocial: 'Osde' });

    const res = await sugerencias(app, cookie);

    expect(res.headers['cache-control']).toBe('no-store');
    expect(Object.keys(res.body)).toEqual(['obrasSociales']);
    const cuerpo = JSON.stringify(res.body);
    for (const dato of [paciente.dni, paciente.nombre, paciente.telefono]) expect(cuerpo).not.toContain(dato);
  });
});
