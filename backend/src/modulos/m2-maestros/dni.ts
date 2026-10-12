/**
 * Formato del DNI (RF-18). Módulo puro, sin acceso a datos.
 *
 * Un DNI válido tiene 7 u 8 dígitos ASCII (`0-9`). Antes de validar solo se quitan los puntos y los
 * espacios (U+0020), que son como la gente lo escribe (`30.123.456`, `30 123 456`). Nada más se
 * "limpia": cualquier otro carácter (letras, guiones, signos, tabulaciones, NUL, dígitos de ancho
 * completo o arábigos) vuelve inválido el DNI. Ese mismo resultado es el que se guarda y el que se
 * usa para buscar (RF-19, RF-21), así que alta, edición y búsqueda no pueden discrepar.
 *
 * Decisión: los ceros a la izquierda cuentan como dígitos. `0123456` tiene 7 dígitos y es válido, y
 * se guarda tal cual; no se interpreta como número, porque `0123456` y `123456` serían dos DNI
 * distintos y `123456` (6 dígitos) es inválido.
 */
const FORMATO_DNI = /^[0-9]{7,8}$/;

/** DNI normalizado (solo dígitos), o `null` si el formato no es válido. */
export function normalizarDni(entrada: string): string | null {
  const limpio = entrada.replace(/[. ]/g, '');
  return FORMATO_DNI.test(limpio) ? limpio : null;
}

export function esDniValido(entrada: string): boolean {
  return normalizarDni(entrada) !== null;
}
