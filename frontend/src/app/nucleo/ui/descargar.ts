/** Entrega un archivo al navegador como descarga (el nombre no debe llevar datos personales). */
export function descargarArchivo(contenido: Blob, nombre: string): void {
  const direccion = URL.createObjectURL(contenido);
  const enlace = document.createElement('a');
  enlace.href = direccion;
  enlace.download = nombre;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(direccion));
}
