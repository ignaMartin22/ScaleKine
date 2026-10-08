import { describe, expect, it } from 'vitest';
import { ErrorNegocio } from '../../../src/comun/errores.js';
import {
  LARGO_MINIMO_CONTRASENA,
  validarPoliticaContrasena,
} from '../../../src/modulos/m1-identidad/contrasenas.js';
import { CONTRASENAS_COMUNES } from '../../../src/modulos/m1-identidad/contrasenas-comunes.js';

function codigoDeRechazo(contrasena: string): string | null {
  try {
    validarPoliticaContrasena(contrasena);
    return null;
  } catch (error) {
    expect(error).toBeInstanceOf(ErrorNegocio);
    expect((error as ErrorNegocio).estadoHttp).toBe(400);
    return (error as ErrorNegocio).codigo;
  }
}

describe('política de contraseñas (RNF-03)', () => {
  it('rechaza las de menos de 12 caracteres', () => {
    expect(codigoDeRechazo('')).toBe('contrasena_corta');
    expect(codigoDeRechazo('Corta-1')).toBe('contrasena_corta');
    expect(codigoDeRechazo('a'.repeat(11))).toBe('contrasena_corta');
  });

  it('acepta una de exactamente 12 caracteres que no es común', () => {
    expect(codigoDeRechazo('tz9-Lw4#qv7B')).toBeNull();
  });

  it('cuenta caracteres y no unidades UTF-16', () => {
    // Doce emojis: 12 caracteres, 24 unidades UTF-16.
    expect(codigoDeRechazo('😀'.repeat(12))).toBeNull();
    // Once emojis: 11 caracteres aunque tengan 22 unidades.
    expect(codigoDeRechazo('😀'.repeat(11))).toBe('contrasena_corta');
  });

  it('rechaza las contraseñas comunes, sin distinguir mayúsculas', () => {
    const comun = [...CONTRASENAS_COMUNES][0]!;
    expect(codigoDeRechazo(comun)).toBe('contrasena_comun');
    expect(codigoDeRechazo(comun.toUpperCase())).toBe('contrasena_comun');
  });

  it('rechaza contraseñas comunes conocidas de 12 caracteres o más', () => {
    expect(codigoDeRechazo('password1234')).toBe('contrasena_comun');
    expect(codigoDeRechazo('Password1234')).toBe('contrasena_comun');
  });

  it('la lista embebida solo trae entradas que ya cumplen el largo mínimo', () => {
    expect(CONTRASENAS_COMUNES.size).toBeGreaterThan(10_000);
    for (const entrada of CONTRASENAS_COMUNES) {
      expect([...entrada].length).toBeGreaterThanOrEqual(LARGO_MINIMO_CONTRASENA);
    }
  });

  it('compara con la lista sin los espacios de los extremos', () => {
    expect(codigoDeRechazo(' password1234')).toBe('contrasena_comun');
    expect(codigoDeRechazo('password1234 ')).toBe('contrasena_comun');
    expect(codigoDeRechazo('\tPassword1234\n')).toBe('contrasena_comun');
  });

  it('rechaza las formadas solo por espacios en blanco', () => {
    expect(codigoDeRechazo(' '.repeat(12))).toBe('contrasena_en_blanco');
    expect(codigoDeRechazo(' \t\n'.repeat(6))).toBe('contrasena_en_blanco');
    expect(codigoDeRechazo(' '.repeat(11))).toBe('contrasena_corta');
  });

  it('acepta espacios dentro de la contraseña', () => {
    expect(codigoDeRechazo('una frase larga y rara')).toBeNull();
  });

  it('un mensaje de rechazo nunca repite la contraseña recibida', () => {
    expect(() => validarPoliticaContrasena('password1234')).toThrow(ErrorNegocio);
    expect.assertions(2);
    try {
      validarPoliticaContrasena('password1234');
    } catch (error) {
      expect((error as Error).message).not.toContain('password1234');
    }
  });
});
