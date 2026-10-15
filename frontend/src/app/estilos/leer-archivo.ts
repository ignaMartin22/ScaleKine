/**
 * Lee un archivo del proyecto desde una prueba de unidad. Las pruebas corren en Node (Vitest), pero
 * el proyecto no incluye los tipos de Node: `process.getBuiltinModule` (Node 22 o posterior) da
 * acceso a `node:fs` sin importarlo, y así el compilador de Angular no intenta empaquetarlo.
 * La ruta es relativa a la raíz de `frontend/`, que es el directorio de trabajo de `npm test`.
 */
interface ModuloFs {
  readFileSync(ruta: string, codificacion: 'utf8'): string;
}

export function leerArchivo(ruta: string): string {
  const proceso = (globalThis as unknown as { process: { getBuiltinModule(id: string): unknown } })
    .process;
  return (proceso.getBuiltinModule('node:fs') as ModuloFs).readFileSync(ruta, 'utf8');
}
