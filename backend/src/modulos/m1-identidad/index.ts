import type { BaseDeDatos } from '../../comun/baseDeDatos.js';
import type { Configuracion } from '../../comun/configuracion.js';
import type { Reloj } from '../../comun/reloj.js';
import { crearExigirSesionConPasos, TODOS_LOS_PASOS } from './middleware.js';
import type { PasoAdmitido } from './pasos.js';
import { crearRutasIdentidad } from './rutas.js';
import { crearServicioIdentidad } from './servicio.js';
import { crearServicioSegundoFactor } from './servicioSegundoFactor.js';

/** M1 Identidad: sesiones, contraseñas y segundo factor (plan.md §3 M1). Recibe sus dependencias en la fábrica. */
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
  const servicioSegundoFactor = crearServicioSegundoFactor({ db, reloj, claveCifrado: config.claveCifrado });
  const variante = (...pasos: PasoAdmitido[]) => crearExigirSesionConPasos(servicio, config, pasos);
  // `exigirSesion` es el que usan todas las rutas de negocio: solo admite una sesión sin pasos
  // pendientes (cambio de contraseña, RF-06; segundo factor, RNF-04). Las demás variantes son para
  // las rutas que son la salida de un paso y no se exportan.
  const exigirSesion = variante('ninguno');
  return {
    servicio,
    exigirSesion,
    rutas: crearRutasIdentidad({
      servicio,
      servicioSegundoFactor,
      exigir: {
        sesion: exigirSesion,
        cualquierPaso: variante(...TODOS_LOS_PASOS),
        cambioContrasena: variante('ninguno', 'cambiar_contrasena'),
        activacion: variante('activar_segundo_factor'),
        verificacion: variante('verificar_segundo_factor'),
      },
      config,
    }),
  };
}

export { SIN_BLOQUEO } from './limiteIntentos.js';
export { sesionActual } from './middleware.js';
export type { SesionActiva, UsuarioSesion } from './servicio.js';
