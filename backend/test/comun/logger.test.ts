import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { MARCA_REDACCION } from '../../src/comun/logger.js';
import { appDePrueba, loggerCapturado } from '../ayudantes.js';

// DNI y datos ficticios: nunca se usan datos reales en pruebas.
const DNI_FICTICIO = '30111222';

describe('logger con redacción (RNF-08)', () => {
  it('redacta el campo dni en la raíz y anidado', () => {
    const { logger, texto, registros } = loggerCapturado();

    logger.info({ dni: DNI_FICTICIO, paciente: { dni: DNI_FICTICIO, turno: { dni: DNI_FICTICIO } } }, 'prueba');

    expect(texto()).not.toContain(DNI_FICTICIO);
    const [registro] = registros();
    expect(registro?.dni).toBe(MARCA_REDACCION);
    expect(registro?.paciente).toEqual({ dni: MARCA_REDACCION, turno: { dni: MARCA_REDACCION } });
  });

  it('redacta nombres, teléfonos, obra social, coseguros, contraseñas y tokens', () => {
    const { logger, texto } = loggerCapturado();

    logger.info(
      {
        paciente: {
          nombre: 'Persona Ficticia',
          telefono: '1155550000',
          obraSocial: 'Obra Social Ficticia',
        },
        turno: { coseguroObraSocial: 1234.5, coseguroAdicional: 678.9 },
        credenciales: { contrasena: 'clave-ficticia-123', token: 'token-ficticio-abc' },
      },
      'prueba',
    );

    for (const valor of [
      'Persona Ficticia',
      '1155550000',
      'Obra Social Ficticia',
      '1234.5',
      '678.9',
      'clave-ficticia-123',
      'token-ficticio-abc',
    ]) {
      expect(texto()).not.toContain(valor);
    }
  });

  it('registra las peticiones sin parámetros de consulta', async () => {
    const { app, texto, registros } = appDePrueba();

    await request(app).get(`/api/salud?dni=${DNI_FICTICIO}`);

    expect(texto()).not.toContain(DNI_FICTICIO);
    const peticion = registros().find((r) => r.msg === 'petición');
    expect(peticion).toMatchObject({ metodo: 'GET', ruta: '/api/salud', estado: 200 });
  });

  it('no registra cabeceras ni cookies de la petición', async () => {
    const { app, texto } = appDePrueba();

    await request(app).get('/api/salud').set('Cookie', 'sesion=token-ficticio-de-sesion');

    expect(texto()).not.toContain('token-ficticio-de-sesion');
  });
});
