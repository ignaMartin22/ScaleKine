import type { Router } from 'express';
import type { BaseDeDatos } from './comun/baseDeDatos.js';
import type { Configuracion } from './comun/configuracion.js';
import type { Reloj } from './comun/reloj.js';
import { crearModuloIdentidad } from './modulos/m1-identidad/index.js';

/**
 * Lista única de los routers de la API: la usan el servidor y la prueba que exige autorización en
 * toda ruta de escritura (plan.md §4.8). Cada módulo nuevo se agrega acá, y así queda cubierto
 * automáticamente por esa prueba.
 */
export async function crearRutas({
  db,
  reloj,
  config,
}: {
  db: BaseDeDatos;
  reloj: Reloj;
  config: Configuracion;
}): Promise<Router[]> {
  // La fábrica de identidad es asíncrona: si argon2 no funciona, falla acá y no en el primer ingreso.
  const identidad = await crearModuloIdentidad({ db, reloj, config });
  return [identidad.rutas];
}
