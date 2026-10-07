import { describe, expect, it } from 'vitest';
import { RelojFijo } from '../../src/comun/reloj.js';

describe('RelojFijo', () => {
  it('devuelve siempre el mismo instante hasta que se lo avanza', () => {
    const reloj = new RelojFijo('2026-10-07T11:00:00Z');

    expect(reloj.ahora().toISOString()).toBe('2026-10-07T11:00:00.000Z');
    expect(reloj.ahora().toISOString()).toBe('2026-10-07T11:00:00.000Z');

    reloj.avanzar(45 * 60 * 1000);
    expect(reloj.ahora().toISOString()).toBe('2026-10-07T11:45:00.000Z');
  });

  it('lleva la zona horaria configurada', () => {
    expect(new RelojFijo('2026-10-07T11:00:00Z', 'America/Argentina/Cordoba').zonaHoraria).toBe(
      'America/Argentina/Cordoba',
    );
  });

  it('no comparte estado con la fecha devuelta', () => {
    const reloj = new RelojFijo('2026-10-07T11:00:00Z');
    reloj.ahora().setFullYear(2000);

    expect(reloj.ahora().getUTCFullYear()).toBe(2026);
  });
});
