import { describe, expect, it } from 'vitest';
import {
  calcularDisponibilidad,
  ESTADOS_ACTIVOS,
  type TurnoDeLaFecha,
} from '../../../src/modulos/m4-agenda/disponibilidad.js';

const LUNES = '2026-10-12';
const MANANA = ['08:00', '08:45', '09:30', '10:15', '11:00', '11:45'];
const TARDE = ['16:00', '16:45', '17:30', '18:15'];
const K1 = { id: 1, nombre: 'Kinesiólogo Ficticio A' };
const K2 = { id: 2, nombre: 'Kinesiólogo Ficticio B' };

const turno = (datos: Partial<TurnoDeLaFecha> & { horaInicio: string }): TurnoDeLaFecha => ({
  kinesiologoId: 1,
  pacienteId: 100,
  estado: 'reservado',
  ...datos,
});
const inicios = (r: ReturnType<typeof calcularDisponibilidad>, kinesiologoId: number) =>
  r.find((d) => d.kinesiologoId === kinesiologoId)?.franjas.map((f) => f.inicio);

describe('calcularDisponibilidad (RF-22, RF-15)', () => {
  it('sin turnos devuelve toda la grilla del bloque para cada kinesiólogo', () => {
    const r = calcularDisponibilidad({ fecha: LUNES, bloque: 'manana', kinesiologos: [K1, K2], turnos: [] });

    expect(r.map((d) => d.kinesiologoId)).toEqual([1, 2]);
    expect(inicios(r, 1)).toEqual(MANANA);
    expect(inicios(r, 2)).toEqual(MANANA);
  });

  it('la tarde tiene cuatro franjas y cada una trae su hora de fin', () => {
    const r = calcularDisponibilidad({ fecha: LUNES, bloque: 'tarde', kinesiologos: [K1], turnos: [] });

    expect(inicios(r, 1)).toEqual(TARDE);
    expect(r[0]?.franjas[0]).toEqual({ inicio: '16:00', fin: '16:45' });
    expect(r[0]?.nombre).toBe(K1.nombre);
  });

  it('sin kinesiólogos devuelve una lista vacía', () => {
    expect(calcularDisponibilidad({ fecha: LUNES, bloque: 'manana', kinesiologos: [], turnos: [] })).toEqual([]);
  });

  it.each(ESTADOS_ACTIVOS)('un turno %s ocupa la franja del kinesiólogo', (estado) => {
    const r = calcularDisponibilidad({
      fecha: LUNES,
      bloque: 'manana',
      kinesiologos: [K1],
      turnos: [turno({ horaInicio: '09:30', estado })],
    });

    expect(inicios(r, 1)).toEqual(MANANA.filter((h) => h !== '09:30'));
  });

  it.each(['anulado', 'asistio', 'no_asistio'])('un turno %s no ocupa la franja', (estado) => {
    const r = calcularDisponibilidad({
      fecha: LUNES,
      bloque: 'manana',
      kinesiologos: [K1],
      turnos: [turno({ horaInicio: '09:30', estado })],
      pacienteId: 100,
    });

    expect(inicios(r, 1)).toEqual(MANANA);
  });

  it('un turno de otro kinesiólogo no ocupa la franja de este si no se pide paciente', () => {
    const r = calcularDisponibilidad({
      fecha: LUNES,
      bloque: 'manana',
      kinesiologos: [K1, K2],
      turnos: [turno({ kinesiologoId: 2, horaInicio: '08:00' })],
    });

    expect(inicios(r, 1)).toEqual(MANANA);
    expect(inicios(r, 2)).toEqual(MANANA.slice(1));
  });

  it('un turno del paciente pedido con otro kinesiólogo ocupa esa hora para todos', () => {
    const r = calcularDisponibilidad({
      fecha: LUNES,
      bloque: 'manana',
      kinesiologos: [K1, K2],
      turnos: [turno({ kinesiologoId: 2, pacienteId: 100, horaInicio: '08:00' })],
      pacienteId: 100,
    });

    expect(inicios(r, 1)).toEqual(MANANA.slice(1));
    expect(inicios(r, 2)).toEqual(MANANA.slice(1));
  });

  it('el turno de otro paciente con otro kinesiólogo no afecta aunque se pida paciente', () => {
    const r = calcularDisponibilidad({
      fecha: LUNES,
      bloque: 'manana',
      kinesiologos: [K1, K2],
      turnos: [turno({ kinesiologoId: 2, pacienteId: 200, horaInicio: '08:00' })],
      pacienteId: 100,
    });

    expect(inicios(r, 1)).toEqual(MANANA);
  });

  it('el turno cerrado del paciente pedido no ocupa su hora', () => {
    const r = calcularDisponibilidad({
      fecha: LUNES,
      bloque: 'manana',
      kinesiologos: [K1],
      turnos: [turno({ kinesiologoId: 2, pacienteId: 100, horaInicio: '08:00', estado: 'anulado' })],
      pacienteId: 100,
    });

    expect(inicios(r, 1)).toEqual(MANANA);
  });

  it('un turno del paciente en una hora de la tarde no afecta a la mañana', () => {
    const r = calcularDisponibilidad({
      fecha: LUNES,
      bloque: 'manana',
      kinesiologos: [K1],
      turnos: [turno({ kinesiologoId: 2, pacienteId: 100, horaInicio: '16:00' })],
      pacienteId: 100,
    });

    expect(inicios(r, 1)).toEqual(MANANA);
  });

  it('combina las horas del kinesiólogo y las del paciente sin repetir ni perder ninguna', () => {
    const r = calcularDisponibilidad({
      fecha: LUNES,
      bloque: 'manana',
      kinesiologos: [K1],
      turnos: [
        turno({ kinesiologoId: 1, pacienteId: 200, horaInicio: '08:00' }),
        turno({ kinesiologoId: 2, pacienteId: 100, horaInicio: '08:45' }),
        turno({ kinesiologoId: 1, pacienteId: 100, horaInicio: '11:45', estado: 'en_espera' }),
      ],
      pacienteId: 100,
    });

    expect(inicios(r, 1)).toEqual(['09:30', '10:15', '11:00']);
  });

  it('un kinesiólogo con todas las franjas ocupadas aparece con la lista vacía', () => {
    const r = calcularDisponibilidad({
      fecha: LUNES,
      bloque: 'tarde',
      kinesiologos: [K1, K2],
      turnos: TARDE.map((horaInicio) => turno({ horaInicio })),
    });

    expect(inicios(r, 1)).toEqual([]);
    expect(inicios(r, 2)).toEqual(TARDE);
  });

  it('sábado y domingo no tienen franjas, pero los kinesiólogos aparecen (RF-15)', () => {
    for (const fecha of ['2026-10-10', '2026-10-11']) {
      const r = calcularDisponibilidad({ fecha, bloque: 'manana', kinesiologos: [K1], turnos: [] });

      expect(r).toEqual([{ kinesiologoId: 1, nombre: K1.nombre, franjas: [] }]);
    }
  });
});
