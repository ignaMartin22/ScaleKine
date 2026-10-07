import { HttpErrorResponse } from '@angular/common/http';

/** Error de la API con el formato del manejador central del backend: código y mensaje de negocio. */
export class ErrorApi extends Error {
  constructor(
    readonly estado: number,
    readonly codigo: string,
    mensaje: string,
    readonly campos: string[] = [],
  ) {
    super(mensaje);
    this.name = 'ErrorApi';
  }
}

interface CuerpoError {
  error?: { codigo?: unknown; mensaje?: unknown; campos?: unknown };
}

export function aErrorApi(respuesta: HttpErrorResponse): ErrorApi {
  if (respuesta.status === 0) {
    return new ErrorApi(0, 'sin_conexion', 'No hay conexión con el sistema. Revisá la red e intentá de nuevo.');
  }
  const error = (respuesta.error as CuerpoError | null)?.error;
  if (typeof error?.codigo === 'string' && typeof error.mensaje === 'string') {
    const campos = Array.isArray(error.campos) ? error.campos.filter((c) => typeof c === 'string') : [];
    return new ErrorApi(respuesta.status, error.codigo, error.mensaje, campos);
  }
  return new ErrorApi(respuesta.status, 'error_inesperado', 'Ocurrió un error inesperado. Intentá de nuevo.');
}
