import { finDeFranja, franjasDelDia, type Bloque } from '../m2-maestros/grilla.js';

/**
 * Cálculo de disponibilidad (RF-22, RF-15), puro: sin base, sin reloj, sin Express. Recibe lo que ya
 * se leyó y devuelve, por kinesiólogo, las horas de inicio de la grilla que quedan libres.
 */

/** Estados que ocupan una franja (plan.md §2.3). Los cerrados la liberan (RF-38). */
export const ESTADOS_ACTIVOS = ['reservado', 'en_espera'] as const;
export type EstadoActivo = (typeof ESTADOS_ACTIVOS)[number];

export interface TurnoDeLaFecha {
  kinesiologoId: number;
  pacienteId: number;
  /** Hora de inicio de la franja, 'HH:MM'. */
  horaInicio: string;
  estado: string;
}

export interface KinesiologoDelBloque {
  id: number;
  nombre: string;
}

export interface FranjaLibre {
  inicio: string;
  fin: string;
}

export interface DisponibilidadDeKinesiologo {
  kinesiologoId: number;
  nombre: string;
  franjas: FranjaLibre[];
}

const esActivo = (estado: string) => (ESTADOS_ACTIVOS as readonly string[]).includes(estado);

/**
 * `kinesiologos` ya son los del bloque (los filtra quien consulta). `turnos` son los de la fecha; acá
 * solo cuentan los activos. Con `pacienteId`, también se descartan las horas en que ese paciente ya
 * tiene un turno activo con cualquier kinesiólogo (RF-25). Una fecha que no es día hábil no tiene
 * franjas (RF-15). El orden de los kinesiólogos y el de las franjas se conservan.
 */
export function calcularDisponibilidad({
  fecha,
  bloque,
  kinesiologos,
  turnos,
  pacienteId,
}: {
  fecha: string;
  bloque: Bloque;
  kinesiologos: readonly KinesiologoDelBloque[];
  turnos: readonly TurnoDeLaFecha[];
  pacienteId?: number;
}): DisponibilidadDeKinesiologo[] {
  const activos = turnos.filter((t) => esActivo(t.estado));
  const ocupadasPorElPaciente = new Set(
    pacienteId === undefined ? [] : activos.filter((t) => t.pacienteId === pacienteId).map((t) => t.horaInicio),
  );
  const grilla = franjasDelDia(fecha, bloque);

  return kinesiologos.map((k) => {
    const ocupadasPorElKinesiologo = new Set(activos.filter((t) => t.kinesiologoId === k.id).map((t) => t.horaInicio));
    const franjas = grilla
      .filter((f) => !ocupadasPorElKinesiologo.has(f.inicio) && !ocupadasPorElPaciente.has(f.inicio))
      .map((f) => ({ inicio: f.inicio, fin: finDeFranja(f.inicio) }));
    return { kinesiologoId: k.id, nombre: k.nombre, franjas };
  });
}
