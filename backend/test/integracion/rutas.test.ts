import { Router, type RequestHandler } from 'express';
import { describe, expect, it } from 'vitest';
import { autorizarEscritura, esAutorizacionDeEscritura } from '../../src/comun/autorizarEscritura.js';
import { cargarConfiguracion } from '../../src/comun/configuracion.js';
import { RelojFijo } from '../../src/comun/reloj.js';
import { crearRutas } from '../../src/rutas.js';
import { ENTORNO_PRUEBA } from '../ayudantes.js';
import { db } from './base.js';

/** Lo mínimo que se lee de las capas de un router de Express 5. */
interface CapaExpress {
  handle: unknown;
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] };
}
interface RouterInspeccionable {
  stack: CapaExpress[];
}

/** `_all` es como Express 5 marca una ruta de `router.all()`, que también acepta escrituras. */
const METODOS_DE_ESCRITURA = ['post', 'put', 'patch', 'delete', '_all'];

/**
 * Escrituras que hace cualquier persona sobre su propia sesión, sin autorización por módulo:
 * ingreso y cierre. Una escritura sobre la propia cuenta, como el cambio de contraseña de T-11, se
 * agrega acá con su justificación.
 */
const ESCRITURAS_DE_LA_PROPIA_SESION = ['POST /sesion', 'DELETE /sesion'];

const comoInspeccionable = (router: Router) => router as unknown as RouterInspeccionable;

/** Si la capa es un sub-router, sus capas. */
function capasDeSubRouter(capa: CapaExpress): CapaExpress[] | undefined {
  const stack = (capa.handle as Partial<RouterInspeccionable> | undefined)?.stack;
  return Array.isArray(stack) ? stack : undefined;
}

/** Rutas de escritura que ningún handler de su stack autoriza, como `MÉTODO /ruta`. */
function escriturasSinAutorizacion(capas: CapaExpress[]): string[] {
  const sinAutorizar: string[] = [];
  for (const capa of capas) {
    if (capa.route) {
      const { path, methods, stack } = capa.route;
      if (stack.some((c) => esAutorizacionDeEscritura(c.handle))) continue;
      for (const metodo of METODOS_DE_ESCRITURA) {
        if (methods[metodo]) sinAutorizar.push(`${metodo === '_all' ? 'ALL' : metodo.toUpperCase()} ${path}`);
      }
      continue;
    }
    const hijas = capasDeSubRouter(capa);
    if (hijas) sinAutorizar.push(...escriturasSinAutorizacion(hijas));
  }
  return sinAutorizar;
}

const manejadorCualquiera: RequestHandler = (_req, res) => {
  res.end();
};

describe('toda ruta de escritura de la API exige autorización por módulo (plan.md §4.8)', () => {
  it('las rutas reales no tienen escrituras sin autorizar', async () => {
    const rutas = await crearRutas({
      db,
      reloj: new RelojFijo('2026-10-07T12:00:00Z'),
      config: cargarConfiguracion(ENTORNO_PRUEBA),
    });

    const sinAutorizar = rutas
      .flatMap((router) => escriturasSinAutorizacion(comoInspeccionable(router).stack))
      .filter((ruta) => !ESCRITURAS_DE_LA_PROPIA_SESION.includes(ruta));

    expect(sinAutorizar).toEqual([]);
  });

  it('la guardiana detecta una escritura sin autorización y acepta una con autorización', () => {
    const olvidada = Router();
    olvidada.post('/x', manejadorCualquiera);
    const autorizada = Router();
    autorizada.post('/x', autorizarEscritura('pacientes'), manejadorCualquiera);
    const anidada = Router();
    anidada.use('/y', olvidada);

    expect(escriturasSinAutorizacion(comoInspeccionable(olvidada).stack)).toEqual(['POST /x']);
    expect(escriturasSinAutorizacion(comoInspeccionable(autorizada).stack)).toEqual([]);
    expect(escriturasSinAutorizacion(comoInspeccionable(anidada).stack)).toEqual(['POST /x']);
  });

  it('una ruta de router.all() sin autorización también se detecta', () => {
    const todas = Router();
    todas.all('/x', manejadorCualquiera);

    expect(escriturasSinAutorizacion(comoInspeccionable(todas).stack)).toEqual(['ALL /x']);
  });

  it('las lecturas no exigen autorización', () => {
    const lectura = Router();
    lectura.get('/x', manejadorCualquiera);

    expect(escriturasSinAutorizacion(comoInspeccionable(lectura).stack)).toEqual([]);
  });
});
