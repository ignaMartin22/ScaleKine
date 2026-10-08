import { describe, expect, it } from 'vitest';
import {
  ESCRITURA_POR_ROL,
  puedeEscribir,
  type ModuloEscritura,
} from '../../src/comun/autorizacion.js';
import type { Rol } from '../../src/generado/prisma/client.js';

describe('tabla de escritura por rol (RF-03, plan.md §4.8)', () => {
  it('es exactamente la que declara la spec', () => {
    expect(ESCRITURA_POR_ROL).toEqual({
      administrador: ['cuentas', 'kinesiologos', 'consultorio', 'pacientes', 'turnos'],
      secretaria: ['consultorio', 'pacientes', 'turnos'],
      kinesiologo: [],
    });
  });
});

describe('puedeEscribir (RF-03)', () => {
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

  it.each(casos)('%s en %s: %s', (rol, modulo, esperado) => {
    expect(puedeEscribir(rol, modulo)).toBe(esperado);
  });
});
