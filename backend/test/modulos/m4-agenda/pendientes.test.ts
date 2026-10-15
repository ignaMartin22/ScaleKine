import { describe, expect, it } from 'vitest';
import {
  estaPendiente,
  fechaYHoraLocal,
  filtrarPendientes,
  type TurnoParaPendiente,
} from '../../../src/modulos/m4-agenda/pendientes.js';

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';
const turno = (datos: Partial<TurnoParaPendiente> = {}): TurnoParaPendiente => ({
  fecha: '2026-10-12',
  horaInicio: '08:00',
  estado: 'reservado',
  ...datos,
});
// 08:00 en Buenos Aires (UTC-3) es 11:00 UTC; la franja termina a las 08:45 locales, 11:45 UTC.
const pendiente = (ahoraUtc: string, t = turno(), zona = BUENOS_AIRES) => estaPendiente(t, new Date(ahoraUtc), zona);

describe('fechaYHoraLocal (RF-12)', () => {
  it('aplica el desfase de la zona y el cambio de día', () => {
    expect(fechaYHoraLocal(new Date('2026-10-12T02:30:00Z'), BUENOS_AIRES)).toEqual({
      fecha: '2026-10-11',
      hora: '23:30',
    });
  });

  it('la medianoche local es 00:00 y no 24:00', () => {
    expect(fechaYHoraLocal(new Date('2026-10-12T03:00:00Z'), BUENOS_AIRES)).toEqual({
      fecha: '2026-10-12',
      hora: '00:00',
    });
  });

  it('con otra zona (UTC+9, sin horario de verano) el resultado cambia', () => {
    expect(fechaYHoraLocal(new Date('2026-10-12T20:00:00Z'), 'Asia/Tokyo')).toEqual({
      fecha: '2026-10-13',
      hora: '05:00',
    });
  });
});

describe('estaPendiente (RF-42)', () => {
  it('justo en el fin de la franja todavía no está pendiente', () => {
    expect(pendiente('2026-10-12T11:45:00Z')).toBe(false);
  });

  it('un minuto después del fin de la franja está pendiente', () => {
    expect(pendiente('2026-10-12T11:46:00Z')).toBe(true);
  });

  it('con la franja en curso o sin empezar no está pendiente', () => {
    expect(pendiente('2026-10-12T11:00:00Z')).toBe(false);
    expect(pendiente('2026-10-12T11:30:00Z')).toBe(false);
    expect(pendiente('2026-10-12T10:00:00Z')).toBe(false);
  });

  it('los segundos dentro del minuto de fin no lo vuelven pendiente', () => {
    expect(pendiente('2026-10-12T11:45:59Z')).toBe(false);
  });

  it('una fecha pasada está pendiente aunque la hora del día sea anterior', () => {
    expect(pendiente('2026-10-13T11:00:00Z', turno({ horaInicio: '11:45' }))).toBe(true);
    expect(pendiente('2026-10-20T03:00:00Z')).toBe(true);
  });

  it('una fecha futura no está pendiente', () => {
    expect(pendiente('2026-10-11T23:00:00Z')).toBe(false);
    expect(pendiente('2026-10-12T02:00:00Z', turno({ fecha: '2026-10-13' }))).toBe(false);
  });

  it('cambio de día: pasada la medianoche local un turno de la tarde de ayer está pendiente', () => {
    const tarde = turno({ horaInicio: '18:15' });
    // 18:15 + 45 min = 19:00 locales = 22:00 UTC.
    expect(pendiente('2026-10-12T22:00:00Z', tarde)).toBe(false);
    expect(pendiente('2026-10-12T22:01:00Z', tarde)).toBe(true);
    // A las 03:00 UTC del 13 es la medianoche local: ya cambió el día y sigue pendiente.
    expect(pendiente('2026-10-13T03:00:00Z', tarde)).toBe(true);
  });

  it('la hora del turno se interpreta en la zona del consultorio, no en UTC', () => {
    // 11:30 UTC son las 08:30 locales: la franja de las 08:00 sigue en curso. Tratada como UTC ya habría terminado.
    expect(pendiente('2026-10-12T11:30:00Z')).toBe(false);
    // Con una zona al este de UTC, el mismo instante ya es de tarde y la franja terminó.
    expect(pendiente('2026-10-12T11:30:00Z', turno(), 'Asia/Tokyo')).toBe(true);
  });

  it('con una zona al este de UTC el fin se calcula con su propio desfase', () => {
    // 08:00 en Tokio (UTC+9) es 23:00 UTC del día anterior; fin a las 08:45 locales, 23:45 UTC.
    expect(pendiente('2026-10-11T23:45:00Z', turno(), 'Asia/Tokyo')).toBe(false);
    expect(pendiente('2026-10-11T23:46:00Z', turno(), 'Asia/Tokyo')).toBe(true);
  });

  it('solo los estados activos pueden estar pendientes', () => {
    const tarde = '2026-10-20T12:00:00Z';
    expect(pendiente(tarde, turno({ estado: 'reservado' }))).toBe(true);
    expect(pendiente(tarde, turno({ estado: 'en_espera' }))).toBe(true);
    for (const estado of ['asistio', 'no_asistio', 'anulado']) {
      expect(pendiente(tarde, turno({ estado }))).toBe(false);
    }
  });
});

describe('filtrarPendientes', () => {
  it('conserva el orden y descarta lo que no está pendiente', () => {
    const turnos = [
      turno({ fecha: '2026-10-09' }),
      turno({ fecha: '2026-10-10', estado: 'asistio' }),
      turno({ fecha: '2026-10-12' }),
      turno({ fecha: '2026-10-13' }),
    ];

    const r = filtrarPendientes(turnos, new Date('2026-10-12T14:00:00Z'), BUENOS_AIRES);

    expect(r.map((t) => t.fecha)).toEqual(['2026-10-09', '2026-10-12']);
  });
});
