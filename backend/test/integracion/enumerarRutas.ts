/**
 * Enumeración de las capas reales de una app de Express 5 (compartida por la guardiana de
 * `rutas.test.ts` y por las pruebas transversales de seguridad, T-34): cualquier ruta que se agregue
 * al router queda cubierta sin mantener una lista a mano.
 */

/** Lo mínimo que se lee de las capas de un router de Express 5. */
export interface CapaExpress {
  handle: unknown;
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] };
}
export interface RouterInspeccionable {
  stack: CapaExpress[];
}

/**
 * Capas de la app completa, no solo de sus routers: así también se detecta un `app.use(variante)`.
 * En Express 5 la pila de la app está en `app.router.stack`.
 */
export const pilaDeApp = (app: unknown): CapaExpress[] => (app as { router: RouterInspeccionable }).router.stack;

/** Si la capa es un sub-router, sus capas. */
export function capasDeSubRouter(capa: CapaExpress): CapaExpress[] | undefined {
  const stack = (capa.handle as Partial<RouterInspeccionable> | undefined)?.stack;
  return Array.isArray(stack) ? stack : undefined;
}

/**
 * Todas las rutas de la app como `MÉTODO /api/ruta` (con los parámetros como `:id`). Los routers de
 * los módulos se montan bajo `/api`; `/api/salud` ya se declara con su prefijo. Una ruta de
 * `router.all()` aparece como `ALL`.
 */
export function rutasDeLaApp(app: unknown): string[] {
  const rutas: string[] = [];
  const recorrer = (capas: CapaExpress[]) => {
    for (const capa of capas) {
      if (capa.route) {
        const { path, methods } = capa.route;
        const completa = path.startsWith('/api/') ? path : `/api${path}`;
        for (const metodo of Object.keys(methods).filter((m) => methods[m])) {
          rutas.push(`${metodo === '_all' ? 'ALL' : metodo.toUpperCase()} ${completa}`);
        }
        continue;
      }
      const hijas = capasDeSubRouter(capa);
      if (hijas) recorrer(hijas);
    }
  };
  recorrer(pilaDeApp(app));
  return [...new Set(rutas)].sort();
}
