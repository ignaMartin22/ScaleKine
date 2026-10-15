import type { RequestHandler } from 'express';
import { sesionActual } from '../modulos/m1-identidad/index.js';
import { puedeLeerAgendaPropia } from './autorizacion.js';
import { ErrorNegocio } from './errores.js';

/** Handlers devueltos por `autorizarAgendaPropia`, para que la prueba guardiana los reconozca. */
const autorizaciones = new WeakSet<object>();

/**
 * Autoriza la lectura de la agenda propia (RF-40, D-15, D-16): solo el rol `kinesiologo` de la
 * sesión. Se monta después de `exigirSesion`:
 * `router.get('/mi-agenda', exigirSesion, autorizarAgendaPropia(), …)`.
 *
 * Solo decide el rol. Que la consulta traiga únicamente los turnos de esa persona lo garantiza la
 * ruta, tomando el kinesiólogo de la sesión y nunca de la petición. Si falta `exigirSesion` antes,
 * `sesionActual` lanza y la petición termina en 500: falla cerrada.
 */
export function autorizarAgendaPropia(): RequestHandler {
  const handler: RequestHandler = (_req, res, next) => {
    try {
      const { usuario } = sesionActual(res);
      if (!puedeLeerAgendaPropia(usuario.rol)) {
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

/** Si `handler` fue creado por `autorizarAgendaPropia`. Lo usa la prueba que cubre todas las rutas. */
export function esAutorizacionDeAgendaPropia(handler: unknown): boolean {
  // `WeakSet.has` devuelve false, sin lanzar, ante un valor que no es un objeto.
  return autorizaciones.has(handler as object);
}
