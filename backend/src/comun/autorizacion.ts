/**
 * Autorización por rol (RF-03, plan.md §4.8, D-3, D-18). Es el único lugar del backend que declara
 * qué escribe cada rol; la regla es global y no se repite endpoint por endpoint. Es una función pura:
 * no conoce Express ni la base. El middleware que la aplica está en `autorizarEscritura.ts`.
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
