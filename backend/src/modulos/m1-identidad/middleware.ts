import type { RequestHandler, Response } from 'express';
import type { Configuracion } from '../../comun/configuracion.js';
import { ErrorNegocio } from '../../comun/errores.js';
import { leerCookieSesion } from './cookie.js';
import { pasoPendiente, type PasoAdmitido, type PasoPendiente } from './pasos.js';
import type { ServicioIdentidad, SesionActiva } from './servicio.js';

const ERRORES_DE_PASO: Record<PasoPendiente, { codigo: string; mensaje: string }> = {
  verificar_segundo_factor: {
    codigo: 'debe_verificar_segundo_factor',
    mensaje: 'Tenés que verificar tu segundo factor antes de continuar.',
  },
  cambiar_contrasena: {
    codigo: 'debe_cambiar_contrasena',
    mensaje: 'Tenés que elegir una contraseña nueva antes de continuar.',
  },
  activar_segundo_factor: {
    codigo: 'debe_activar_segundo_factor',
    mensaje: 'Tenés que activar tu segundo factor antes de continuar.',
  },
};

const ERROR_SIN_PASO = {
  codigo: 'paso_no_pendiente',
  mensaje: 'Esta acción no corresponde en este momento.',
};

/** Todos los pasos posibles, para la variante que deja pasar a cualquier sesión. */
export const TODOS_LOS_PASOS: readonly PasoAdmitido[] = [
  'ninguno',
  'verificar_segundo_factor',
  'cambiar_contrasena',
  'activar_segundo_factor',
];

/** Pasos que admite cada handler creado, para la prueba guardiana de rutas. */
const pasosPorHandler = new WeakMap<object, readonly PasoAdmitido[]>();

/**
 * Pasos que admite un handler creado por `crearExigirSesionConPasos`, o `undefined` si no lo es.
 * Lo usa la prueba guardiana para fijar en qué rutas aparece cada variante.
 */
export function pasosAdmitidosPor(handler: unknown): readonly PasoAdmitido[] | undefined {
  return pasosPorHandler.get(handler as object);
}

/**
 * Exige una sesión vigente (RF-11). El usuario y el rol salen de la sesión guardada en el
 * servidor, nunca de la petición. Deja la sesión en `res.locals.sesion`.
 *
 * La sesión tiene a lo sumo un paso pendiente (ver `pasoPendiente`): verificar el segundo factor,
 * cambiar la contraseña (RF-06) o activar el segundo factor (RNF-04). Cada variante declara qué
 * pasos admite y rechaza con 403 el resto, con el código del paso pendiente. `exigirSesion`, la que
 * usa toda ruta de negocio, solo admite `ninguno`: así rige también para las rutas futuras, sin
 * que cada una tenga que acordarse. Las demás variantes no se exportan desde el índice del módulo
 * y una prueba guardiana fija en qué rutas aparece cada una.
 */
export function crearExigirSesionConPasos(
  servicio: Pick<ServicioIdentidad, 'sesionVigente'>,
  config: Pick<Configuracion, 'cookieSegura'>,
  admitidos: readonly PasoAdmitido[],
): RequestHandler {
  const handler: RequestHandler = async (req, res, next) => {
    try {
      const token = leerCookieSesion(req, config);
      const sesion = token === undefined ? null : await servicio.sesionVigente(token);
      if (!sesion) {
        throw new ErrorNegocio('sesion_invalida', 'Tu sesión venció o no es válida. Ingresá de nuevo.', 401);
      }
      const paso = pasoPendiente(sesion.usuario, sesion.segundoFactorVerificado);
      if (!admitidos.includes(paso ?? 'ninguno')) {
        // Sin paso pendiente en una ruta que solo sirve en un paso (activar o verificar): ya no corresponde.
        const { codigo, mensaje } = paso === null ? ERROR_SIN_PASO : ERRORES_DE_PASO[paso];
        throw new ErrorNegocio(codigo, mensaje, 403);
      }
      res.locals.sesion = sesion;
      next();
    } catch (err) {
      next(err);
    }
  };
  pasosPorHandler.set(handler, admitidos);
  return handler;
}

/** La variante estándar: solo admite una sesión sin pasos pendientes. */
export function crearExigirSesion(
  servicio: Pick<ServicioIdentidad, 'sesionVigente'>,
  config: Pick<Configuracion, 'cookieSegura'>,
): RequestHandler {
  return crearExigirSesionConPasos(servicio, config, ['ninguno']);
}

/** La sesión de la petición. Si falta, la ruta no montó `exigirSesion`: es un error de programación. */
export function sesionActual(res: Response): SesionActiva {
  const sesion = res.locals.sesion as SesionActiva | undefined;
  if (!sesion) throw new Error('La ruta no exige sesión: falta montar exigirSesion.');
  return sesion;
}
