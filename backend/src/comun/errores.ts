import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import type { Logger } from 'pino';

/**
 * Error esperado del dominio: tiene un código estable, un mensaje para la persona usuaria y el
 * estado HTTP con el que se responde.
 */
export class ErrorNegocio extends Error {
  constructor(
    readonly codigo: string,
    mensaje: string,
    readonly estadoHttp = 400,
  ) {
    super(mensaje);
    this.name = 'ErrorNegocio';
  }
}

interface CuerpoError {
  error: {
    codigo: string;
    mensaje: string;
    /** Solo en errores de validación: qué campos fallaron, nunca los valores recibidos. */
    campos?: string[];
  };
}

function cuerpo(codigo: string, mensaje: string, campos?: string[]): CuerpoError {
  return { error: campos ? { codigo, mensaje, campos } : { codigo, mensaje } };
}

export const rutaNoEncontrada: RequestHandler = (_req, res) => {
  res.status(404).json(cuerpo('no_encontrado', 'El recurso pedido no existe.'));
};

/** Errores de `express.json()` (body-parser), que llegan con `type` y `status`. */
function esErrorDeCuerpo(err: unknown): err is { type: string; status: number } {
  return typeof err === 'object' && err !== null && 'type' in err && 'status' in err;
}

/**
 * Manejador central (plan.md §4.15, RNF-10): responde siempre un código y un mensaje de negocio.
 * El detalle técnico, con la traza, va solo al log del servidor.
 */
export function manejadorErrores(logger: Logger): ErrorRequestHandler {
  return (err: unknown, req, res, next) => {
    if (res.headersSent) {
      next(err);
      return;
    }

    if (err instanceof ErrorNegocio) {
      res.status(err.estadoHttp).json(cuerpo(err.codigo, err.message));
      return;
    }

    if (err instanceof ZodError) {
      const campos = [...new Set(err.issues.map((i) => i.path.join('.') || '(cuerpo)'))];
      res.status(400).json(cuerpo('datos_invalidos', 'Los datos enviados no son válidos.', campos));
      return;
    }

    if (esErrorDeCuerpo(err)) {
      if (err.type === 'entity.too.large') {
        res.status(413).json(cuerpo('peticion_demasiado_grande', 'La petición supera el tamaño permitido.'));
        return;
      }
      if (err.type === 'entity.parse.failed') {
        res.status(400).json(cuerpo('json_invalido', 'El cuerpo de la petición no es JSON válido.'));
        return;
      }
    }

    logger.error({ err, metodo: req.method, ruta: req.path }, 'error no controlado');
    res.status(500).json(cuerpo('error_interno', 'Ocurrió un error inesperado. Intentá de nuevo.'));
  };
}
