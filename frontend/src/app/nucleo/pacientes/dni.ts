/**
 * Formato del DNI (RF-18). Misma regla que `backend/src/modulos/m2-maestros/dni.ts`: se quitan
 * puntos y espacios y deben quedar 7 u 8 dígitos ASCII. La autoridad sigue siendo el backend; esto
 * solo evita viajes de ida y vuelta por un error de tipeo.
 */
const FORMATO_DNI = /^[0-9]{7,8}$/;

/** DNI normalizado (solo dígitos), o `null` si el formato no es válido. */
export function normalizarDni(entrada: string): string | null {
  const limpio = entrada.replace(/[. ]/g, '');
  return FORMATO_DNI.test(limpio) ? limpio : null;
}

/** DNI para mostrar, con puntos de miles ('30123456' a '30.123.456'). Solo al mostrarlo (DESIGN.md §6.2). */
export function mostrarDni(dni: string): string {
  return dni.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
