import { randomInt } from 'node:crypto';
import { validarPoliticaContrasena } from '../modulos/m1-identidad/contrasenas.js';

/** Sin caracteres que se confunden al copiarlos a mano (0/o, 1/l/i). */
const ALFABETO = 'abcdefghjkmnpqrstuvwxyz23456789';
const LARGO = 20;
const GRUPO = 5;

/**
 * Contraseña temporal al azar (RF-05, RF-08): 20 caracteres de un alfabeto de 31 (unos 99 bits) en
 * grupos de cinco separados por guiones, para dictarla o copiarla sin errores. Pasa siempre la
 * política de contraseñas (RNF-03); se vuelve a sortear en el caso, casi imposible, de que no.
 */
export function generarContrasenaTemporal(): string {
  for (let intento = 0; intento < 10; intento++) {
    const caracteres = Array.from({ length: LARGO }, () => ALFABETO[randomInt(ALFABETO.length)]);
    const grupos: string[] = [];
    for (let i = 0; i < LARGO; i += GRUPO) grupos.push(caracteres.slice(i, i + GRUPO).join(''));
    const contrasena = grupos.join('-');
    try {
      validarPoliticaContrasena(contrasena);
      return contrasena;
    } catch {
      // Se sortea otra.
    }
  }
  throw new Error('No se pudo generar una contraseña temporal que cumpla la política.');
}
