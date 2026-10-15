import { DURACION_FRANJA_MINUTOS } from '../m2-maestros/grilla.js';
import { ESTADOS_ACTIVOS } from './disponibilidad.js';

/**
 * Turnos pendientes de marcar (RF-42), cálculo puro: sin base ni reloj propio. Un turno activo
 * (`reservado` o `en_espera`) está pendiente cuando su franja ya terminó: `fecha + horaInicio + 45 min
 * < ahora`, con la fecha y la hora del turno en la zona del consultorio (RF-12). El sistema solo lo
 * informa; nunca cambia el estado (§4.5).
 */

export interface TurnoParaPendiente {
  /** Día civil del consultorio, 'AAAA-MM-DD'. */
  fecha: string;
  /** Hora de inicio de la franja, 'HH:MM', en la zona del consultorio. */
  horaInicio: string;
  estado: string;
}

export interface FechaYHoraLocal {
  /** 'AAAA-MM-DD'. */
  fecha: string;
  /** 'HH:MM'. */
  hora: string;
}

/** Fecha y hora de pared que marca un reloj de la zona IANA `zonaHoraria` en el instante `instante`. */
export function fechaYHoraLocal(instante: Date, zonaHoraria: string): FechaYHoraLocal {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zonaHoraria,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instante);
  const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  return {
    fecha: `${valor('year')}-${valor('month')}-${valor('day')}`,
    hora: `${valor('hour')}:${valor('minute')}`,
  };
}

/**
 * Minutos desde la época de una fecha y hora de pared, tratadas como si fueran UTC. Sirve solo para
 * comparar dos horas de pared de la misma zona (no es un instante real).
 */
function minutosDePared(fecha: string, hora: string): number {
  const [anio = 0, mes = 1, dia = 1] = fecha.split('-').map(Number);
  const [horas = 0, minutos = 0] = hora.split(':').map(Number);
  return Date.UTC(anio, mes - 1, dia, horas, minutos) / 60_000;
}

/**
 * Si el turno es activo y su franja terminó antes de `ahora`. Se compara en hora de pared de la zona
 * del consultorio, al minuto: el instante exacto de fin todavía no cuenta.
 */
export function estaPendiente(turno: TurnoParaPendiente, ahora: Date, zonaHoraria: string): boolean {
  if (!(ESTADOS_ACTIVOS as readonly string[]).includes(turno.estado)) return false;
  const local = fechaYHoraLocal(ahora, zonaHoraria);
  const finDeLaFranja = minutosDePared(turno.fecha, turno.horaInicio) + DURACION_FRANJA_MINUTOS;
  return finDeLaFranja < minutosDePared(local.fecha, local.hora);
}

/** Los pendientes entre `turnos`, en el orden en que vienen. */
export function filtrarPendientes<T extends TurnoParaPendiente>(
  turnos: readonly T[],
  ahora: Date,
  zonaHoraria: string,
): T[] {
  return turnos.filter((t) => estaPendiente(t, ahora, zonaHoraria));
}
