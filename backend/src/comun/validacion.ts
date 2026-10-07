import type { RequestHandler } from 'express';
import { z } from 'zod';

/**
 * Validación de entrada con zod, reutilizable por cualquier ruta (RNF-10). Si algo no valida, el
 * error llega al manejador central, que responde 400 con los campos que fallaron.
 *
 * Los datos ya validados quedan en `res.locals.datos`, tipados por `datosValidados()`. `req.query`
 * es de solo lectura en Express 5, así que no se reescribe la petición.
 */
export interface Esquemas {
  body?: z.ZodType;
  params?: z.ZodType;
  query?: z.ZodType;
}

type Validados<E extends Esquemas> = {
  [K in keyof E]: E[K] extends z.ZodType ? z.infer<E[K]> : never;
};

export function validar<E extends Esquemas>(esquemas: E): RequestHandler {
  return (req, res, next) => {
    const datos: Record<string, unknown> = {};
    for (const parte of ['body', 'params', 'query'] as const) {
      const esquema = esquemas[parte];
      if (esquema) {
        const resultado = esquema.safeParse(req[parte]);
        if (!resultado.success) {
          // Se antepone la parte de la petición para que el campo informado sea inequívoco.
          resultado.error.issues.forEach((i) => i.path.unshift(parte));
          next(resultado.error);
          return;
        }
        datos[parte] = resultado.data;
      }
    }
    res.locals.datos = datos;
    next();
  };
}

export function datosValidados<E extends Esquemas>(
  locals: Record<string, unknown>,
  _esquemas: E,
): Validados<E> {
  return locals.datos as Validados<E>;
}
