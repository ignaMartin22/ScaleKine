/**
 * Grilla fija de franjas del consultorio (spec.md §2, RF-15). Es configuración, no datos: no se
 * persiste, y las franjas de un día se derivan de estas constantes (plan.md §2.2 y §4.2).
 */

export type Bloque = 'manana' | 'tarde';

/** Duración de cada franja, en minutos. */
export const DURACION_FRANJA_MINUTOS = 45;

/** Horas de inicio de las franjas de cada bloque, en formato 'HH:MM'. */
export const HORAS_INICIO: Record<Bloque, readonly string[]> = {
  manana: ['08:00', '08:45', '09:30', '10:15', '11:00', '11:45'],
  tarde: ['16:00', '16:45', '17:30', '18:15'],
};

/** Días de la semana con atención (0 = domingo … 6 = sábado, como `getUTCDay`). */
export const DIAS_HABILES_POR_DEFECTO: readonly number[] = [1, 2, 3, 4, 5];

export interface Franja {
  bloque: Bloque;
  /** Hora de inicio, 'HH:MM'. */
  inicio: string;
  /** Hora de fin, 'HH:MM'. */
  fin: string;
}

/** Hora de fin de una franja que empieza en `inicio` ('HH:MM'). */
export function finDeFranja(inicio: string): string {
  const [horas = 0, minutos = 0] = inicio.split(':').map(Number);
  const total = horas * 60 + minutos + DURACION_FRANJA_MINUTOS;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Todas las franjas de un bloque, sin importar el día. */
export function franjasDelBloque(bloque: Bloque): Franja[] {
  return HORAS_INICIO[bloque].map((inicio) => ({
    bloque,
    inicio,
    fin: finDeFranja(inicio),
  }));
}

/**
 * Franjas de un bloque para una fecha calendario ('YYYY-MM-DD'). Si el día de la semana de esa
 * fecha no está en `diasHabiles`, no hay franjas. La fecha se interpreta sin zona horaria.
 */
export function franjasDelDia(
  fecha: string,
  bloque: Bloque,
  diasHabiles: readonly number[] = DIAS_HABILES_POR_DEFECTO,
): Franja[] {
  const diaDeLaSemana = new Date(`${fecha}T00:00:00Z`).getUTCDay();
  if (!diasHabiles.includes(diaDeLaSemana)) {
    return [];
  }
  return franjasDelBloque(bloque);
}

/** Indica si `inicio` es una hora de inicio válida en la grilla del bloque. */
export function esFranjaDeLaGrilla(bloque: Bloque, inicio: string): boolean {
  return HORAS_INICIO[bloque].includes(inicio);
}
