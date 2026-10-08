import { Router, type RequestHandler } from 'express';
import { describe, expect, it } from 'vitest';
import { autorizarEscritura, esAutorizacionDeEscritura } from '../../src/comun/autorizarEscritura.js';
import { cargarConfiguracion } from '../../src/comun/configuracion.js';
import { RelojFijo } from '../../src/comun/reloj.js';
import { crearExigirSesionConPasos, pasosAdmitidosPor } from '../../src/modulos/m1-identidad/middleware.js';
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
 * Escrituras que hace cualquier persona sobre su propia sesión o cuenta, sin autorización por
 * módulo. Toda excepción nueva se agrega acá con su justificación.
 */
const ESCRITURAS_DE_LA_PROPIA_SESION = [
  // Ingreso y cierre (RF-01, RF-10).
  'POST /sesion',
  'DELETE /sesion',
  // Cambio de la contraseña propia con la actual, que puede hacer cualquier rol (RF-07, T-11).
  'PUT /sesion/contrasena',
  // Activación y verificación del segundo factor sobre la propia sesión del administrador (RNF-04):
  // el rol lo decide el paso pendiente de la sesión, no un módulo de escritura.
  'POST /sesion/segundo-factor/activacion',
  'POST /sesion/segundo-factor/activacion/confirmar',
  'POST /sesion/segundo-factor/verificar',
];

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

/** Identifica una variante de `exigirSesion` por los pasos pendientes que admite. */
const claveDeVariante = (pasos: readonly string[]) => [...pasos].sort().join('+');

const VARIANTE_SIN_PASOS = claveDeVariante(['ninguno']);
const VARIANTE_CUALQUIER_PASO = claveDeVariante([
  'ninguno',
  'verificar_segundo_factor',
  'cambiar_contrasena',
  'activar_segundo_factor',
]);
const VARIANTE_CAMBIO_CONTRASENA = claveDeVariante(['ninguno', 'cambiar_contrasena']);
const VARIANTE_ACTIVACION = claveDeVariante(['activar_segundo_factor']);
const VARIANTE_VERIFICACION = claveDeVariante(['verificar_segundo_factor']);

const nombreDeRuta = (metodo: string, path: string) => `${metodo === '_all' ? 'ALL' : metodo.toUpperCase()} ${path}`;

/** Por variante de `exigirSesion`, las rutas cuyo stack la incluye (en cualquier nivel de anidamiento). */
function rutasPorVariante(capas: CapaExpress[], encontradas: Record<string, string[]> = {}): Record<string, string[]> {
  for (const capa of capas) {
    if (capa.route) {
      const { path, methods, stack } = capa.route;
      for (const c of stack) {
        const pasos = pasosAdmitidosPor(c.handle);
        if (!pasos) continue;
        const lista = (encontradas[claveDeVariante(pasos)] ??= []);
        for (const metodo of Object.keys(methods).filter((m) => methods[m])) lista.push(nombreDeRuta(metodo, path));
      }
      continue;
    }
    const hijas = capasDeSubRouter(capa);
    if (hijas) rutasPorVariante(hijas, encontradas);
  }
  return encontradas;
}

/**
 * Variantes de `exigirSesion` que admiten algún paso pendiente montadas con `router.use(...)`, a
 * nivel de router o anidadas: abrirían a todo lo que se registre después. Solo se admiten dentro de
 * una ruta concreta. La variante que solo admite `ninguno` sí puede montarse con `use`.
 */
function variantesPermisivasMontadasConUse(capas: CapaExpress[]): string[] {
  const encontradas: string[] = [];
  for (const capa of capas) {
    if (capa.route) continue;
    const pasos = pasosAdmitidosPor(capa.handle);
    if (pasos?.some((paso) => paso !== 'ninguno')) encontradas.push(claveDeVariante(pasos));
    const hijas = capasDeSubRouter(capa);
    if (hijas) encontradas.push(...variantesPermisivasMontadasConUse(hijas));
  }
  return encontradas;
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

const sesionFicticia = { sesionVigente: () => Promise.resolve(null) };
const configCookie = { cookieSegura: false };

describe('cada variante de exigirSesion aparece solo donde corresponde (RF-06, RNF-04)', () => {
  it('fija en qué rutas aparece cada variante', async () => {
    const rutas = await crearRutas({
      db,
      reloj: new RelojFijo('2026-10-07T12:00:00Z'),
      config: cargarConfiguracion(ENTORNO_PRUEBA),
    });
    const encontradas: Record<string, string[]> = {};
    for (const router of rutas) rutasPorVariante(comoInspeccionable(router).stack, encontradas);
    for (const lista of Object.values(encontradas)) lista.sort();

    // Las rutas de negocio (T-13 en adelante) usarán la variante que solo admite `ninguno`: al
    // agregar una, se suma acá. Que otra variante aparezca en una ruta nueva exige cambiar esta prueba.
    expect(encontradas).toEqual({
      [VARIANTE_CUALQUIER_PASO]: ['GET /sesion'],
      [VARIANTE_CAMBIO_CONTRASENA]: ['PUT /sesion/contrasena'],
      [VARIANTE_ACTIVACION]: [
        'POST /sesion/segundo-factor/activacion',
        'POST /sesion/segundo-factor/activacion/confirmar',
      ],
      [VARIANTE_VERIFICACION]: ['POST /sesion/segundo-factor/verificar'],
    });
    expect(VARIANTE_SIN_PASOS).toBe('ninguno');
  });

  it('ninguna variante que admita un paso pendiente se monta con router.use en las rutas reales', async () => {
    const rutas = await crearRutas({
      db,
      reloj: new RelojFijo('2026-10-07T12:00:00Z'),
      config: cargarConfiguracion(ENTORNO_PRUEBA),
    });

    const montadas = rutas.flatMap((router) => variantesPermisivasMontadasConUse(comoInspeccionable(router).stack));

    expect(montadas).toEqual([]);
  });

  it('la detección reconoce una variante en una ruta y no a un handler cualquiera', () => {
    const router = Router();
    router.get('/x', manejadorCualquiera);
    router.get('/y', crearExigirSesionConPasos(sesionFicticia, configCookie, ['ninguno']), manejadorCualquiera);

    expect(rutasPorVariante(comoInspeccionable(router).stack)).toEqual({ ninguno: ['GET /y'] });
  });

  it('la guardiana detecta un router.use(variante permisiva) mal puesto, a nivel de router o anidado', () => {
    const permisiva = crearExigirSesionConPasos(sesionFicticia, configCookie, ['ninguno', 'cambiar_contrasena']);
    const soloVerificar = crearExigirSesionConPasos(sesionFicticia, configCookie, ['verificar_segundo_factor']);
    const sinPasos = crearExigirSesionConPasos(sesionFicticia, configCookie, ['ninguno']);

    const mal = Router();
    mal.use(permisiva);
    mal.get('/negocio', manejadorCualquiera);
    const anidado = Router();
    const hijo = Router();
    hijo.use('/hijo', soloVerificar);
    anidado.use('/api', hijo);
    const bien = Router();
    bien.use(sinPasos);
    bien.get('/negocio', permisiva, manejadorCualquiera);

    expect(variantesPermisivasMontadasConUse(comoInspeccionable(mal).stack)).toEqual([
      claveDeVariante(['ninguno', 'cambiar_contrasena']),
    ]);
    expect(variantesPermisivasMontadasConUse(comoInspeccionable(anidado).stack)).toEqual([
      claveDeVariante(['verificar_segundo_factor']),
    ]);
    expect(variantesPermisivasMontadasConUse(comoInspeccionable(bien).stack)).toEqual([]);
  });
});
