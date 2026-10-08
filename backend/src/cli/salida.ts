/**
 * Salida de la CLI. Nada de lo que muestra pasa por `console` ni por el logger con redacción, salvo
 * lo que sigue la regla de este archivo: solo mensajes sin datos personales, y la contraseña
 * temporal en un único lugar.
 */

/** Mensaje para quien opera, sin datos personales (se escribe por stderr, como `servidor.ts`). */
export function informar(mensaje: string): void {
  process.stderr.write(`${mensaje}\n`);
}

/**
 * Único lugar donde se escribe una contraseña temporal. Se muestra una sola vez, por la salida
 * estándar y solo a quien ejecutó el comando (RF-05, RF-08); no se guarda, no se registra y nunca
 * viaja en un mensaje de error.
 */
export function imprimirContrasenaTemporal(contrasena: string): void {
  process.stdout.write(`Contraseña temporal (se muestra una sola vez): ${contrasena}\n`);
}
