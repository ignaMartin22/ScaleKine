import type { RequestHandler, Response } from 'express';
import type { Configuracion } from '../../comun/configuracion.js';
import { ErrorNegocio } from '../../comun/errores.js';
import { leerCookieSesion } from './cookie.js';
import type { ServicioIdentidad, SesionActiva } from './servicio.js';

/**
 * Exige una sesión vigente (RF-11). El usuario y el rol salen de la sesión guardada en el
 * servidor, nunca de la petición. Deja la sesión en `res.locals.sesion`.
 */
export function crearExigirSesion(
  servicio: Pick<ServicioIdentidad, 'sesionVigente'>,
  config: Pick<Configuracion, 'cookieSegura'>,
): RequestHandler {
  return async (req, res, next) => {
    try {
      const token = leerCookieSesion(req, config);
      const sesion = token === undefined ? null : await servicio.sesionVigente(token);
      if (!sesion) {
        throw new ErrorNegocio('sesion_invalida', 'Tu sesión venció o no es válida. Ingresá de nuevo.', 401);
      }
      res.locals.sesion = sesion;
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** La sesión de la petición. Si falta, la ruta no montó `exigirSesion`: es un error de programación. */
export function sesionActual(res: Response): SesionActiva {
  const sesion = res.locals.sesion as SesionActiva | undefined;
  if (!sesion) throw new Error('La ruta no exige sesión: falta montar exigirSesion.');
  return sesion;
}
