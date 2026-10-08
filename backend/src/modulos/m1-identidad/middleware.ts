import type { RequestHandler, Response } from 'express';
import type { Configuracion } from '../../comun/configuracion.js';
import { ErrorNegocio } from '../../comun/errores.js';
import { leerCookieSesion } from './cookie.js';
import type { ServicioIdentidad, SesionActiva } from './servicio.js';

/**
 * Exige una sesión vigente (RF-11). El usuario y el rol salen de la sesión guardada en el
 * servidor, nunca de la petición. Deja la sesión en `res.locals.sesion`.
 *
 * Por defecto también rechaza con 403 `debe_cambiar_contrasena` a la cuenta marcada para cambio de
 * contraseña (RF-06): así rige para toda ruta que exija sesión, incluidas las futuras, sin que
 * cada una tenga que acordarse. Solo las rutas que sirven para salir de ese estado (consultar la
 * sesión y cambiar la contraseña) piden `permitirCuentaMarcada`.
 */
export function crearExigirSesion(
  servicio: Pick<ServicioIdentidad, 'sesionVigente'>,
  config: Pick<Configuracion, 'cookieSegura'>,
  { permitirCuentaMarcada = false }: { permitirCuentaMarcada?: boolean } = {},
): RequestHandler {
  return async (req, res, next) => {
    try {
      const token = leerCookieSesion(req, config);
      const sesion = token === undefined ? null : await servicio.sesionVigente(token);
      if (!sesion) {
        throw new ErrorNegocio('sesion_invalida', 'Tu sesión venció o no es válida. Ingresá de nuevo.', 401);
      }
      if (sesion.usuario.debeCambiarContrasena && !permitirCuentaMarcada) {
        throw new ErrorNegocio(
          'debe_cambiar_contrasena',
          'Tenés que elegir una contraseña nueva antes de continuar.',
          403,
        );
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
