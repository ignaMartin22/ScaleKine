import type { RequestHandler } from 'express';
import { sesionActual } from '../modulos/m1-identidad/index.js';
import { puedeLeer, type ModuloLectura } from './autorizacion.js';
import { ErrorNegocio } from './errores.js';

/** Handlers devueltos por `autorizarLectura`, para que la prueba guardiana los reconozca. */
const autorizaciones = new WeakSet<object>();

/**
 * Autoriza la lectura de datos maestros de `modulo` según el rol de la sesión (D-16, plan.md §4.8).
 * Se monta después de `exigirSesion` en cada GET de M2:
 * `router.get('/pacientes', exigirSesion, autorizarLectura('pacientes'), …)`.
 *
 * El rol sale de la sesión, nunca de la petición. Si falta `exigirSesion` antes, `sesionActual`
 * lanza y la petición termina en 500 sin llegar al manejador: falla cerrada.
 */
export function autorizarLectura(modulo: ModuloLectura): RequestHandler {
  const handler: RequestHandler = (_req, res, next) => {
    try {
      const { usuario } = sesionActual(res);
      if (!puedeLeer(usuario.rol, modulo)) {
        throw new ErrorNegocio('no_autorizado', 'No estás autorizado para realizar esta acción.', 403);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
  autorizaciones.add(handler);
  return handler;
}

/** Si `handler` fue creado por `autorizarLectura`. Lo usa la prueba que cubre todas las rutas. */
export function esAutorizacionDeLectura(handler: unknown): boolean {
  // `WeakSet.has` devuelve false, sin lanzar, ante un valor que no es un objeto.
  return autorizaciones.has(handler as object);
}
