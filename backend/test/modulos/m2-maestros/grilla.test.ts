import { describe, expect, it } from 'vitest';
import {
  DURACION_FRANJA_MINUTOS,
  esFranjaDeLaGrilla,
  finDeFranja,
  franjasDelBloque,
  franjasDelDia,
} from '../../../src/modulos/m2-maestros/grilla.js';

describe('grilla de franjas', () => {
  it('la mañana tiene seis franjas y la última termina a las 12:30', () => {
    const franjas = franjasDelBloque('manana');

    expect(franjas).toHaveLength(6);
    expect(franjas[franjas.length - 1]).toEqual({
      bloque: 'manana',
      inicio: '11:45',
      fin: '12:30',
    });
  });

  it('la tarde tiene cuatro franjas y la última termina a las 19:00', () => {
    const franjas = franjasDelBloque('tarde');

    expect(franjas).toHaveLength(4);
    expect(franjas[franjas.length - 1]).toEqual({
      bloque: 'tarde',
      inicio: '18:15',
      fin: '19:00',
    });
  });

  it('todas las franjas duran 45 minutos', () => {
    for (const bloque of ['manana', 'tarde'] as const) {
      for (const { inicio, fin } of franjasDelBloque(bloque)) {
        const [hi = 0, mi = 0] = inicio.split(':').map(Number);
        const [hf = 0, mf = 0] = fin.split(':').map(Number);

        expect(DURACION_FRANJA_MINUTOS).toBe(45);
        expect(hf * 60 + mf - (hi * 60 + mi)).toBe(45);
      }
    }
  });

  it('finDeFranja calcula el fin de cada inicio', () => {
    expect(finDeFranja('08:00')).toBe('08:45');
    expect(finDeFranja('11:45')).toBe('12:30');
    expect(finDeFranja('18:15')).toBe('19:00');
  });

  it('de lunes a viernes hay franjas en ambos bloques', () => {
    for (const fecha of [
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      '2026-10-09',
    ]) {
      expect(franjasDelDia(fecha, 'manana')).toHaveLength(6);
      expect(franjasDelDia(fecha, 'tarde')).toHaveLength(4);
    }
  });

  it('sábado y domingo no tienen franjas', () => {
    expect(franjasDelDia('2026-10-10', 'manana')).toEqual([]);
    expect(franjasDelDia('2026-10-11', 'tarde')).toEqual([]);
  });

  it('los días hábiles se pueden pasar por parámetro', () => {
    // 2026-10-05 es lunes (1) y 2026-10-10 es sábado (6).
    expect(franjasDelDia('2026-10-10', 'manana', [6])).toHaveLength(6);
    expect(franjasDelDia('2026-10-05', 'manana', [6])).toEqual([]);
  });

  it('esFranjaDeLaGrilla acepta 11:45 en la mañana y rechaza 16:00 en la mañana y 08:10', () => {
    expect(esFranjaDeLaGrilla('manana', '11:45')).toBe(true);
    expect(esFranjaDeLaGrilla('manana', '16:00')).toBe(false);
    expect(esFranjaDeLaGrilla('manana', '08:10')).toBe(false);
  });
});
