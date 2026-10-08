import type { RequestHandler } from 'express';
import { sesionActual } from '../modulos/m1-identidad/index.js';
import { puedeEscribir, type ModuloEscritura } from './autorizacion.js';
import { ErrorNegocio } from './errores.js';

/** Handlers devueltos por `autorizarEscritura`, para que la prueba guardiana los reconozca. */
const autorizaciones = new WeakSet<object>();

/**
 * Autoriza la escritura en `modulo` según el rol de la sesión (RF-03, plan.md §4.8). Se monta
 * después de `exigirSesion` en cada ruta que escribe:
 * `router.post('/pacientes', exigirSesion, autorizarEscritura('pacientes'), …)`.
 *
 * El rol sale de la sesión, nunca de la petición. Si falta `exigirSesion` antes, `sesionActual`
 * lanza y la petición termina en 500 sin llegar al manejador: falla cerrada.
 */
export function autorizarEscritura(modulo: ModuloEscritura): RequestHandler {
  const handler: RequestHandler = (_req, res, next) => {
    try {
      const { usuario } = sesionActual(res);
      if (!puedeEscribir(usuario.rol, modulo)) {
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

/** Si `handler` fue creado por `autorizarEscritura`. Lo usa la prueba que cubre todas las rutas. */
export function esAutorizacionDeEscritura(handler: unknown): boolean {
  // `WeakSet.has` devuelve false, sin lanzar, ante un valor que no es un objeto.
  return autorizaciones.has(handler as object);
}
