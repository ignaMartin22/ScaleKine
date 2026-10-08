/**
 * Tabla del flujo normal de un turno (spec.md §3.5, plan.md §3 y §4.6). Es el único lugar del
 * backend donde viven las transiciones: `transicionar` solo acepta lo que está acá y la misma tabla
 * responde qué acciones mostrar (RF-34). La corrección (RF-35) es una operación aparte, no una fila.
 */
import { puedeEscribir } from '../../comun/autorizacion.js';
import { ErrorNegocio } from '../../comun/errores.js';

export type EstadoTurno = 'reservado' | 'en_espera' | 'asistio' | 'no_asistio' | 'anulado';
export type Rol = 'administrador' | 'secretaria' | 'kinesiologo';

/** Los cinco estados que reconoce el sistema, y ninguno más (RF-29). */
export const ESTADOS: readonly EstadoTurno[] = [
  'reservado',
  'en_espera',
  'asistio',
  'no_asistio',
  'anulado',
];

export interface Transicion {
  readonly desde: EstadoTurno;
  readonly hacia: EstadoTurno;
  /** Rótulo de la acción para la persona usuaria. */
  readonly accion: string;
}

/** Las cuatro filas del flujo normal (RF-30 a RF-33). */
export const TRANSICIONES: readonly Transicion[] = [
  { desde: 'reservado', hacia: 'en_espera', accion: 'Llegó' },
  { desde: 'en_espera', hacia: 'asistio', accion: 'Asistió' },
  { desde: 'reservado', hacia: 'no_asistio', accion: 'No asistió' },
  { desde: 'reservado', hacia: 'anulado', accion: 'Anular' },
];

export interface AccionesDisponibles {
  /** Acciones de la tabla que salen del estado actual. */
  readonly transiciones: readonly Transicion[];
  /** Si se ofrece la corrección de estado (RF-34, RF-35). */
  readonly puedeCorregir: boolean;
}

export function buscarTransicion(desde: EstadoTurno, hacia: EstadoTurno): Transicion | undefined {
  return TRANSICIONES.find((t) => t.desde === desde && t.hacia === hacia);
}

/**
 * Acciones que ofrece la interfaz para un turno en `estado` (RF-34): las de la tabla que salen de
 * ese estado más la corrección para secretaría y administrador; ninguna para el kinesiólogo.
 */
export function accionesDisponibles(estado: EstadoTurno, rol: Rol): AccionesDisponibles {
  if (!puedeEscribir(rol, 'turnos')) return { transiciones: [], puedeCorregir: false };
  return {
    transiciones: TRANSICIONES.filter((t) => t.desde === estado),
    puedeCorregir: true,
  };
}

/**
 * Motivo por el que `rol` no puede llevar un turno de `desde` a `hacia` por el flujo normal, o
 * `null` si puede.
 */
export function motivoDeRechazo(rol: Rol, desde: EstadoTurno, hacia: EstadoTurno): string | null {
  if (!puedeEscribir(rol, 'turnos')) return 'Tu rol no permite modificar turnos.';
  if (buscarTransicion(desde, hacia)) return null;
  if (desde === hacia) return 'El turno ya está en ese estado.';
  return 'Ese cambio de estado no está permitido; si fue un error, usá la corrección.';
}

/** Lanza un error de negocio si el cambio no está permitido para el rol (plan.md §4.15). */
export function validarTransicion(rol: Rol, desde: EstadoTurno, hacia: EstadoTurno): Transicion {
  const motivo = motivoDeRechazo(rol, desde, hacia);
  if (motivo !== null) {
    const escribe = puedeEscribir(rol, 'turnos');
    throw new ErrorNegocio(
      escribe ? 'transicion_no_permitida' : 'rol_sin_permiso',
      motivo,
      escribe ? 409 : 403,
    );
  }
  return buscarTransicion(desde, hacia) as Transicion;
}
