import { describe, expect, it } from 'vitest';
import { SIN_BLOQUEO } from '../../../src/modulos/m1-identidad/limiteIntentos.js';

describe('SIN_BLOQUEO (RNF-02)', () => {
  it('son exactamente los tres campos y valores que repite el SQL de servicioSegundoFactor.ts', () => {
    // Si cambia, hay que actualizar el UPDATE de `verificar` con un código de recuperación (RNF-04).
    expect(SIN_BLOQUEO).toEqual({ ingresosFallidos: 0, bloqueadoHasta: null, bloqueosConsecutivos: 0 });
    expect(Object.keys(SIN_BLOQUEO).sort()).toEqual(['bloqueadoHasta', 'bloqueosConsecutivos', 'ingresosFallidos']);
  });
});
