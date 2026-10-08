import type { BaseDeDatos } from '../../comun/baseDeDatos.js';
import type { Configuracion } from '../../comun/configuracion.js';
import type { Reloj } from '../../comun/reloj.js';
import { crearExigirSesion, crearExigirSesionAunqueDebaCambiarContrasena } from './middleware.js';
import { crearRutasIdentidad } from './rutas.js';
import { crearServicioIdentidad } from './servicio.js';

/** M1 Identidad: sesiones y contraseñas (plan.md §3 M1). Recibe sus dependencias en la fábrica. */
export async function crearModuloIdentidad({
  db,
  reloj,
  config,
}: {
  db: BaseDeDatos;
  reloj: Reloj;
  config: Configuracion;
}) {
  const servicio = await crearServicioIdentidad({ db, reloj });
  // `exigirSesion` es el que usan todas las rutas de negocio: bloquea a la cuenta marcada (RF-06).
  const exigirSesion = crearExigirSesion(servicio, config);
  const exigirSesionAunqueDebaCambiarContrasena = crearExigirSesionAunqueDebaCambiarContrasena(servicio, config);
  return {
    servicio,
    exigirSesion,
    rutas: crearRutasIdentidad({
      servicio,
      exigirSesion,
      exigirSesionAunqueDebaCambiarContrasena,
      config,
    }),
  };
}

export { sesionActual } from './middleware.js';
export type { SesionActiva, UsuarioSesion } from './servicio.js';
