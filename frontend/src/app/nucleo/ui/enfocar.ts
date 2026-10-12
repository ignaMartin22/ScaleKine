/** Lleva el foco a un elemento una vez que Angular terminó de pintarlo (errores de formulario). */
export function enfocar(id: string): void {
  setTimeout(() => document.getElementById(id)?.focus());
}

/** Mensaje de un error cualquiera, sin exponer detalles técnicos. */
export function mensajeDe(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Ocurrió un error inesperado. Intentá de nuevo.';
}
