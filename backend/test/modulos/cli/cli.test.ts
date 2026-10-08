import { describe, expect, it } from 'vitest';
import { ErrorUso, interpretarArgumentos } from '../../../src/cli/argumentos.js';
import { generarContrasenaTemporal } from '../../../src/cli/contrasenaTemporal.js';
import { validarPoliticaContrasena } from '../../../src/modulos/m1-identidad/contrasenas.js';

const INSTALAR = [
  'instalar',
  '--nombre',
  'Consultorio Ficticio',
  '--direccion',
  'Calle Falsa 123',
  '--telefono',
  '11 5555 0000',
];

describe('contraseña temporal (RF-05)', () => {
  it('cumple la política de contraseñas y tiene el formato esperado', () => {
    for (let i = 0; i < 50; i++) {
      const contrasena = generarContrasenaTemporal();
      expect(contrasena).toMatch(/^([a-z2-9]{5}-){3}[a-z2-9]{5}$/);
      expect(() => validarPoliticaContrasena(contrasena)).not.toThrow();
    }
  });

  it('es distinta en cada llamada', () => {
    const contrasenas = new Set(Array.from({ length: 100 }, () => generarContrasenaTemporal()));
    expect(contrasenas.size).toBe(100);
  });
});

describe('argumentos de la CLI', () => {
  it('instalar toma el consultorio y usa un nombre de usuario por defecto', () => {
    expect(interpretarArgumentos(INSTALAR)).toEqual({
      comando: 'instalar',
      datos: {
        usuario: 'administrador',
        nombre: 'Consultorio Ficticio',
        direccion: 'Calle Falsa 123',
        telefono: '11 5555 0000',
      },
    });
  });

  it('instalar acepta un nombre de usuario propio y recorta espacios', () => {
    const orden = interpretarArgumentos([...INSTALAR, '--usuario', '  jefe  ']);
    expect(orden).toMatchObject({ comando: 'instalar', datos: { usuario: 'jefe' } });
  });

  it('instalar exige los tres datos del consultorio', () => {
    expect(() => interpretarArgumentos(['instalar', '--nombre', 'X'])).toThrow(ErrorUso);
    expect(() => interpretarArgumentos([...INSTALAR, '--nombre', ''])).toThrow(ErrorUso);
    expect(() =>
      interpretarArgumentos(['instalar', '--nombre', ' ', '--direccion', 'a', '--telefono', 'b']),
    ).toThrow(ErrorUso);
  });

  it('rechaza el carácter NUL, que PostgreSQL no admite', () => {
    expect(() => interpretarArgumentos([...INSTALAR.slice(0, 2), 'a\u0000b', ...INSTALAR.slice(3)])).toThrow(
      ErrorUso,
    );
  });

  it('los demás subcomandos aceptan solo lo que les corresponde', () => {
    expect(interpretarArgumentos(['restablecer-admin'])).toEqual({ comando: 'restablecer-admin', datos: {} });
    expect(interpretarArgumentos(['restablecer-2fa-admin', '--usuario', 'jefe'])).toEqual({
      comando: 'restablecer-2fa-admin',
      datos: { usuario: 'jefe' },
    });
    expect(interpretarArgumentos(['revocar-sesiones'])).toEqual({ comando: 'revocar-sesiones', datos: {} });
    expect(() => interpretarArgumentos(['revocar-sesiones', '--usuario', 'jefe'])).toThrow(ErrorUso);
    expect(() => interpretarArgumentos(['restablecer-admin', '--nombre', 'X'])).toThrow(ErrorUso);
  });

  it('rechaza subcomandos desconocidos, ausentes, opciones inexistentes y argumentos sueltos', () => {
    expect(() => interpretarArgumentos([])).toThrow(ErrorUso);
    expect(() => interpretarArgumentos(['borrar-todo'])).toThrow(ErrorUso);
    expect(() => interpretarArgumentos(['constructor'])).toThrow(ErrorUso);
    expect(() => interpretarArgumentos(['revocar-sesiones', '--otra'])).toThrow(ErrorUso);
    expect(() => interpretarArgumentos(['revocar-sesiones', 'sobrante'])).toThrow(ErrorUso);
    expect(() => interpretarArgumentos(['restablecer-admin', '--usuario'])).toThrow(ErrorUso);
  });

  it('los mensajes de error no repiten los valores recibidos', () => {
    try {
      interpretarArgumentos(['instalar', '--nombre', 'valor-secreto-123', '--bogus', 'valor-secreto-456']);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorUso);
      expect((error as Error).message).not.toContain('valor-secreto');
    }
  });
});
