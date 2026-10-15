/**
 * Autorización por rol (RF-03, plan.md §4.8, D-3, D-16, D-18). Es el único lugar del backend que
 * declara qué escribe y qué lee cada rol; la regla es global y no se repite endpoint por endpoint.
 * Son funciones puras: no conocen Express ni la base. Los middlewares que las aplican están en
 * `autorizarEscritura.ts`, `autorizarLectura.ts` y `autorizarAgendaPropia.ts`.
 */
import type { Rol } from '../generado/prisma/client.js';

/** Módulos de escritura del sistema. Cada ruta que escribe pertenece a exactamente uno. */
export const MODULOS_DE_ESCRITURA = ['cuentas', 'kinesiologos', 'consultorio', 'pacientes', 'turnos'] as const;
export type ModuloEscritura = (typeof MODULOS_DE_ESCRITURA)[number];

/**
 * Qué módulos escribe cada rol. `Record<Rol, …>` obliga a declarar todo rol nuevo.
 *
 * - `cuentas` (RF-04, RF-08, RF-09) y `kinesiologos` (RF-14, RF-16) son exclusivos del
 *   administrador (spec.md §2).
 * - `consultorio` (RF-13), `pacientes` (RF-17 a RF-20) y `turnos` (M3) también los escribe la secretaría.
 * - El kinesiólogo no escribe nada (D-3).
 */
export const ESCRITURA_POR_ROL: Readonly<Record<Rol, readonly ModuloEscritura[]>> = {
  administrador: MODULOS_DE_ESCRITURA, // control total (D-18)
  secretaria: ['consultorio', 'pacientes', 'turnos'],
  kinesiologo: [], // solo lectura (D-3)
};

export function puedeEscribir(rol: Rol, modulo: ModuloEscritura): boolean {
  return ESCRITURA_POR_ROL[rol].includes(modulo);
}

/**
 * Módulos de lectura de los datos maestros de M2 (consultorio, kinesiólogos, pacientes). Las
 * lecturas de turnos no pasan por acá: las de agenda ajena usan `puedeEscribir(rol, 'turnos')` y las
 * del kinesiólogo, filtradas por su sesión, `puedeLeerAgendaPropia` (M4, al final de este archivo).
 */
export const MODULOS_DE_LECTURA = ['consultorio', 'kinesiologos', 'pacientes'] as const;
export type ModuloLectura = (typeof MODULOS_DE_LECTURA)[number];

/**
 * Qué datos maestros lee cada rol. `Record<Rol, …>` obliga a declarar todo rol nuevo.
 *
 * - `secretaria` y `administrador` leen todos (RF-13, RF-14, RF-17 a RF-21).
 * - El kinesiólogo no lee ninguno: no los necesita para monitorear su agenda (D-16).
 */
export const LECTURA_POR_ROL: Readonly<Record<Rol, readonly ModuloLectura[]>> = {
  administrador: MODULOS_DE_LECTURA,
  secretaria: MODULOS_DE_LECTURA,
  kinesiologo: [], // D-16
};

export function puedeLeer(rol: Rol, modulo: ModuloLectura): boolean {
  return LECTURA_POR_ROL[rol].includes(modulo);
}

/**
 * Quién usa la agenda propia (RF-40, D-15, D-16): el monitor del kinesiólogo, que lee únicamente
 * sus turnos. Es una regla aparte de `LECTURA_POR_ROL` porque no es un dato maestro: la ruta
 * filtra por el kinesiólogo de la sesión. Secretaría y administrador tienen la agenda de todos
 * (`autorizarEscritura('turnos')`), no esta.
 */
export function puedeLeerAgendaPropia(rol: Rol): boolean {
  return rol === 'kinesiologo';
}
