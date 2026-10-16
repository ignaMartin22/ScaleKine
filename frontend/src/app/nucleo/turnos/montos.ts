/**
 * Montos de coseguro (RF-27, RF-48). Llegan como texto con dos decimales ('1500.50') y se suman
 * siempre en centavos enteros, nunca con coma flotante: 0,10 + 0,20 tiene que dar 0,30.
 */

/** Centavos enteros de un monto en texto ('1500.50' y '1500' son válidos). */
export function aCentavos(monto: string): number {
  const [enteros = '0', decimales = ''] = monto.trim().split('.');
  return Number(enteros) * 100 + Number(decimales.padEnd(2, '0').slice(0, 2));
}

/** Monto en texto con dos decimales a partir de centavos enteros. */
export function deCentavos(centavos: number): string {
  const enteros = Math.floor(centavos / 100);
  const resto = centavos % 100;
  return `${enteros}.${String(resto).padStart(2, '0')}`;
}

/** Suma de montos en texto; los `null` (sin abonar) no suman. */
export function sumarMontos(montos: readonly (string | null)[]): string {
  let total = 0;
  for (const monto of montos) {
    if (monto !== null) total += aCentavos(monto);
  }
  return deCentavos(total);
}

/** Lo mínimo de un turno que hace falta para recaudar. */
export interface TurnoRecaudable {
  estado: string;
  coseguroAbonado: string | null;
}

/** Recaudado de los turnos listados, sin los anulados (RF-48). */
export function recaudadoDe(turnos: readonly TurnoRecaudable[]): string {
  return sumarMontos(turnos.filter((t) => t.estado !== 'anulado').map((t) => t.coseguroAbonado));
}

/** Monto en pesos para mostrar, con puntos de miles y coma decimal ('$ 1.500,50'). */
export function formatearPesos(monto: string): string {
  const [enteros = '0', decimales = '00'] = monto.split('.');
  const miles = enteros.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `$ ${miles},${decimales.padEnd(2, '0')}`;
}

/** Monto abonado para mostrar en una fila: «Sin abonar» si no hay monto. */
export function montoAbonado(monto: string | null): string {
  return monto === null ? 'Sin abonar' : formatearPesos(monto);
}
