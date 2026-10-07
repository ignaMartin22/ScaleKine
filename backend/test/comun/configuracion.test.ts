import { describe, expect, it } from 'vitest';
import { cargarConfiguracion, ErrorConfiguracion } from '../../src/comun/configuracion.js';
import { ENTORNO_PRUEBA } from '../ayudantes.js';

const CLAVE_VALIDA = Buffer.alloc(32, 7).toString('base64');

function errorDe(entorno: Record<string, string | undefined>): ErrorConfiguracion {
  try {
    cargarConfiguracion(entorno);
  } catch (e) {
    if (e instanceof ErrorConfiguracion) return e;
    throw e;
  }
  throw new Error('se esperaba un ErrorConfiguracion');
}

describe('cargarConfiguracion', () => {
  it('acepta una configuración válida y aplica los valores por defecto', () => {
    const config = cargarConfiguracion(ENTORNO_PRUEBA);
    expect(config.zonaHoraria).toBe('America/Argentina/Buenos_Aires');
    expect(config.puerto).toBe(3000);
    expect(config.cookieSegura).toBe(false);
    expect(config.claveCifrado).toBeUndefined();
  });

  it('falla si falta ZONA_HORARIA (RF-12)', () => {
    const { ZONA_HORARIA: _, ...sinZona } = ENTORNO_PRUEBA;
    expect(errorDe(sinZona).message).toMatch(/ZONA_HORARIA/);
  });

  it('trata una ZONA_HORARIA vacía como faltante', () => {
    expect(errorDe({ ...ENTORNO_PRUEBA, ZONA_HORARIA: '  ' }).message).toMatch(/Falta ZONA_HORARIA/);
  });

  it('falla si ZONA_HORARIA no es una zona IANA', () => {
    expect(errorDe({ ...ENTORNO_PRUEBA, ZONA_HORARIA: 'Marte/Olympus' }).message).toMatch(/ZONA_HORARIA/);
  });

  it('en producción falla si falta CLAVE_CIFRADO', () => {
    const error = errorDe({ ...ENTORNO_PRUEBA, NODE_ENV: 'production', COOKIE_SECURE: 'true' });
    expect(error.message).toMatch(/CLAVE_CIFRADO/);
  });

  it('en producción exige COOKIE_SECURE=true', () => {
    const error = errorDe({ ...ENTORNO_PRUEBA, NODE_ENV: 'production', CLAVE_CIFRADO: CLAVE_VALIDA });
    expect(error.message).toMatch(/COOKIE_SECURE/);
  });

  it('en producción arranca con CLAVE_CIFRADO de 32 bytes y cookie segura', () => {
    const config = cargarConfiguracion({
      ...ENTORNO_PRUEBA,
      NODE_ENV: 'production',
      COOKIE_SECURE: 'true',
      CLAVE_CIFRADO: CLAVE_VALIDA,
    });
    expect(config.claveCifrado?.length).toBe(32);
  });

  it('rechaza una CLAVE_CIFRADO de largo incorrecto sin mostrar su valor', () => {
    const claveCorta = Buffer.from('clave-demasiado-corta').toString('base64');
    const error = errorDe({ ...ENTORNO_PRUEBA, CLAVE_CIFRADO: claveCorta });
    expect(error.message).toMatch(/CLAVE_CIFRADO/);
    expect(error.message).not.toContain(claveCorta);
  });

  it('rechaza un FRONTEND_ORIGIN que no es un origen', () => {
    expect(errorDe({ ...ENTORNO_PRUEBA, FRONTEND_ORIGIN: 'http://localhost:4200/app' }).message).toMatch(
      /FRONTEND_ORIGIN/,
    );
  });
});
