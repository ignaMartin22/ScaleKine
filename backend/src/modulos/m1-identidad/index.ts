import type { BaseDeDatos } from '../../comun/baseDeDatos.js';
import type { Configuracion } from '../../comun/configuracion.js';
import type { Reloj } from '../../comun/reloj.js';
import { crearExigirSesion } from './middleware.js';
import { crearRutasIdentidad } from './rutas.js';
import { crearServicioIdentidad } from './servicio.js';

/** M1 Identidad: sesiones y contraseñas (plan.md §3 M1). Recibe sus dependencias en la fábrica. */
export function crearModuloIdentidad({
  db,
  reloj,
  config,
}: {
  db: BaseDeDatos;
  reloj: Reloj;
  config: Configuracion;
}) {
  const servicio = crearServicioIdentidad({ db, reloj });
  const exigirSesion = crearExigirSesion(servicio, config);
  return { servicio, exigirSesion, rutas: crearRutasIdentidad({ servicio, exigirSesion, config }) };
}

export { sesionActual } from './middleware.js';
export type { SesionActiva, UsuarioSesion } from './servicio.js';
