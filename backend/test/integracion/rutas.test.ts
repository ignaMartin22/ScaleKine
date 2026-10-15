import express, { Router, type RequestHandler } from 'express';
import { describe, expect, it } from 'vitest';
import { autorizarAgendaPropia, esAutorizacionDeAgendaPropia } from '../../src/comun/autorizarAgendaPropia.js';
import { autorizarEscritura, esAutorizacionDeEscritura } from '../../src/comun/autorizarEscritura.js';
import { autorizarLectura, esAutorizacionDeLectura } from '../../src/comun/autorizarLectura.js';
import { cargarConfiguracion } from '../../src/comun/configuracion.js';
import { RelojFijo } from '../../src/comun/reloj.js';
import { crearExigirSesionConPasos, pasosAdmitidosPor } from '../../src/modulos/m1-identidad/middleware.js';
import { crearRutas } from '../../src/rutas.js';
import { appDePrueba, ENTORNO_PRUEBA } from '../ayudantes.js';
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

/**
 * Capas de la app completa, no solo de sus routers: así también se detecta un `app.use(variante)`.
 * En Express 5 la pila de la app está en `app.router.stack`. Limitación: una variante envuelta en un
 * closure propio (otro handler que la llama por dentro) no se reconoce, porque la guardiana
 * identifica los handlers por referencia.
 */
const pilaDeApp = (app: unknown): CapaExpress[] => (app as { router: RouterInspeccionable }).router.stack;
const pilaDeLaApi = (rutas: Router[]): CapaExpress[] => pilaDeApp(appDePrueba(rutas).app);

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

/**
 * Rutas de M2 (consultorio, kinesiólogos, pacientes): sus GET exigen `autorizarLectura` (D-16). Se
 * reconocen por el primer segmento de la ruta; un módulo nuevo de M2 agrega su prefijo acá.
 */
const PREFIJOS_DE_M2 = ['/consultorio', '/kinesiologos', '/pacientes'];
const esRutaDeM2 = (path: string) => PREFIJOS_DE_M2.some((p) => path === p || path.startsWith(`${p}/`));

/** GET de M2 que ningún handler de su stack autoriza como lectura, como `GET /ruta`. */
function lecturasDeM2SinAutorizacion(capas: CapaExpress[]): string[] {
  const sinAutorizar: string[] = [];
  for (const capa of capas) {
    if (capa.route) {
      const { path, methods, stack } = capa.route;
      if (!esRutaDeM2(path) || !(methods.get || methods._all)) continue;
      if (!stack.some((c) => esAutorizacionDeLectura(c.handle))) sinAutorizar.push(`GET ${path}`);
      continue;
    }
    const hijas = capasDeSubRouter(capa);
    if (hijas) sinAutorizar.push(...lecturasDeM2SinAutorizacion(hijas));
  }
  return sinAutorizar;
}

/**
 * Lecturas de agenda ajena (D-16): la disponibilidad (RF-22), el aviso de pendientes (RF-42) y la
 * agenda de la secretaría (RF-41), que se autorizan con `autorizarEscritura('turnos')` porque
 * existen para asignar y coordinar. Cada lectura nueva de este tipo agrega su prefijo acá. Las
 * lecturas propias del kinesiólogo (M4, RF-40) van en `PREFIJOS_DE_AGENDA_PROPIA`, no en esta lista.
 */
const PREFIJOS_DE_AGENDA_AJENA = ['/disponibilidad', '/agenda'];
const esRutaDeAgendaAjena = (path: string) =>
  PREFIJOS_DE_AGENDA_AJENA.some((p) => path === p || path.startsWith(`${p}/`));

/** GET de agenda ajena que ningún handler de su stack autoriza (ni como escritura ni como lectura). */
function lecturasDeAgendaAjenaSinAutorizacion(capas: CapaExpress[]): string[] {
  const sinAutorizar: string[] = [];
  for (const capa of capas) {
    if (capa.route) {
      const { path, methods, stack } = capa.route;
      if (!esRutaDeAgendaAjena(path) || !(methods.get || methods._all)) continue;
      if (!stack.some((c) => esAutorizacionDeEscritura(c.handle) || esAutorizacionDeLectura(c.handle))) {
        sinAutorizar.push(`GET ${path}`);
      }
      continue;
    }
    const hijas = capasDeSubRouter(capa);
    if (hijas) sinAutorizar.push(...lecturasDeAgendaAjenaSinAutorizacion(hijas));
  }
  return sinAutorizar;
}

/**
 * Lecturas propias del kinesiólogo (RF-40, D-15): exigen `autorizarAgendaPropia`, que solo admite el
 * rol kinesiólogo. Una ruta de agenda ajena no puede cumplir con ésta (ni al revés): el kinesiólogo
 * nunca llega a una agenda ajena y la secretaría no usa la propia.
 */
const PREFIJOS_DE_AGENDA_PROPIA = ['/mi-agenda'];
const esRutaDeAgendaPropia = (path: string) =>
  PREFIJOS_DE_AGENDA_PROPIA.some((p) => path === p || path.startsWith(`${p}/`));

/** GET de agenda propia que ningún handler de su stack autoriza como agenda propia. */
function lecturasDeAgendaPropiaSinAutorizacion(capas: CapaExpress[]): string[] {
  const sinAutorizar: string[] = [];
  for (const capa of capas) {
    if (capa.route) {
      const { path, methods, stack } = capa.route;
      if (!esRutaDeAgendaPropia(path) || !(methods.get || methods._all)) continue;
      if (!stack.some((c) => esAutorizacionDeAgendaPropia(c.handle))) sinAutorizar.push(`GET ${path}`);
      continue;
    }
    const hijas = capasDeSubRouter(capa);
    if (hijas) sinAutorizar.push(...lecturasDeAgendaPropiaSinAutorizacion(hijas));
  }
  return sinAutorizar;
}

/**
 * Inversa de la anterior: una ruta cuyo stack lleva `autorizarAgendaPropia` tiene que estar bajo
 * `PREFIJOS_DE_AGENDA_PROPIA`; si no, la guardiana directa no la vería y quedaría fuera de la regla.
 * Límite: se compara el path declarado en la ruta. Una ruta `get('/')` dentro de un sub-router
 * montado con `router.use('/mi-agenda', sub)` no muestra el prefijo montado y se reportaría como
 * fuera del prefijo; el proyecto no monta sub-routers así y, si alguna vez lo hiciera, la guardiana
 * falla cerrada (avisa) en lugar de pasar en silencio.
 */
function agendaPropiaFueraDelPrefijo(capas: CapaExpress[]): string[] {
  const fuera: string[] = [];
  for (const capa of capas) {
    if (capa.route) {
      const { path, methods, stack } = capa.route;
      if (esRutaDeAgendaPropia(path) || !stack.some((c) => esAutorizacionDeAgendaPropia(c.handle))) continue;
      for (const metodo of Object.keys(methods).filter((m) => methods[m])) fuera.push(nombreDeRuta(metodo, path));
      continue;
    }
    const hijas = capasDeSubRouter(capa);
    if (hijas) fuera.push(...agendaPropiaFueraDelPrefijo(hijas));
  }
  return fuera;
}

/**
 * De mundo cerrado: todo GET con la variante de negocio de `exigirSesion` lleva alguna autorización
 * reconocida (escritura, lectura o agenda propia) o figura en la lista blanca, con su justificación.
 * Así una lectura nueva, de un prefijo que nadie declaró, no queda abierta a cualquier rol.
 */
const GET_DE_NEGOCIO_SIN_AUTORIZACION_POR_ROL: string[] = [
  // Ninguno hoy. Toda excepción nueva se agrega acá con su justificación.
];
function getDeNegocioSinAutorizacion(capas: CapaExpress[]): string[] {
  const sin: string[] = [];
  for (const capa of capas) {
    if (capa.route) {
      const { path, methods, stack } = capa.route;
      if (!(methods.get || methods._all)) continue;
      if (!stack.some((c) => pasosAdmitidosPor(c.handle)?.join() === 'ninguno')) continue;
      const autorizada = stack.some(
        (c) =>
          esAutorizacionDeEscritura(c.handle) ||
          esAutorizacionDeLectura(c.handle) ||
          esAutorizacionDeAgendaPropia(c.handle),
      );
      const ruta = `GET ${path}`;
      if (!autorizada && !GET_DE_NEGOCIO_SIN_AUTORIZACION_POR_ROL.includes(ruta)) sin.push(ruta);
      continue;
    }
    const hijas = capasDeSubRouter(capa);
    if (hijas) sin.push(...getDeNegocioSinAutorizacion(hijas));
  }
  return sin;
}

/** Identifica una variante de `exigirSesion` por los pasos pendientes que admite. */
const claveDeVariante = (pasos: readonly string[]) => [...pasos].sort().join('+');

const VARIANTE_CUALQUIER_PASO = claveDeVariante([
  'ninguno',
  'verificar_segundo_factor',
  'cambiar_contrasena',
  'activar_segundo_factor',
]);
const VARIANTE_CAMBIO_CONTRASENA = claveDeVariante(['ninguno', 'cambiar_contrasena']);
const VARIANTE_ACTIVACION = claveDeVariante(['activar_segundo_factor']);
const VARIANTE_VERIFICACION = claveDeVariante(['verificar_segundo_factor']);
const VARIANTE_NEGOCIO = claveDeVariante(['ninguno']);

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

/** Rutas cuyo stack no tiene ninguna variante de `exigirSesion`, como `MÉTODO /ruta`. */
function rutasSinVariante(capas: CapaExpress[]): string[] {
  const encontradas: string[] = [];
  for (const capa of capas) {
    if (capa.route) {
      const { path, methods, stack } = capa.route;
      if (stack.some((c) => pasosAdmitidosPor(c.handle))) continue;
      for (const metodo of Object.keys(methods).filter((m) => methods[m])) {
        encontradas.push(nombreDeRuta(metodo, path));
      }
      continue;
    }
    const hijas = capasDeSubRouter(capa);
    if (hijas) encontradas.push(...rutasSinVariante(hijas));
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

    const sinAutorizar = escriturasSinAutorizacion(pilaDeLaApi(rutas));

    // Multiconjunto exacto: la lista blanca no puede tener entradas de más ni de menos.
    expect(sinAutorizar.sort()).toEqual([...ESCRITURAS_DE_LA_PROPIA_SESION].sort());
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

  it('las lecturas fuera de M2 no exigen autorización de escritura', () => {
    const lectura = Router();
    lectura.get('/x', manejadorCualquiera);

    expect(escriturasSinAutorizacion(comoInspeccionable(lectura).stack)).toEqual([]);
  });
});

describe('todo GET de M2 exige autorización de lectura (D-16, plan.md §4.8)', () => {
  it('los GET reales de M2 están autorizados', async () => {
    const rutas = await crearRutas({
      db,
      reloj: new RelojFijo('2026-10-07T12:00:00Z'),
      config: cargarConfiguracion(ENTORNO_PRUEBA),
    });
    const pila = pilaDeLaApi(rutas);

    expect(lecturasDeM2SinAutorizacion(pila)).toEqual([]);
    // Que la prueba no pase en vacío: el GET del consultorio existe y se inspecciona.
    expect(rutasPorVariante(pila)[VARIANTE_NEGOCIO]).toContain('GET /consultorio');
    // La ficha con turnos (T-29) vive en M4 pero cuelga de /pacientes: la guardiana de M2 la alcanza.
    expect(rutasPorVariante(pila)[VARIANTE_NEGOCIO]).toContain('GET /pacientes/:id/turnos');
  });

  it('la guardiana detecta un GET de M2 sin autorización, también anidado, y acepta uno autorizado', () => {
    const olvidada = Router();
    olvidada.get('/pacientes/:id', manejadorCualquiera);
    const autorizada = Router();
    autorizada.get('/kinesiologos', autorizarLectura('kinesiologos'), manejadorCualquiera);
    const anidada = Router();
    anidada.use('/api', olvidada);
    const ajena = Router();
    ajena.get('/cuentas', manejadorCualquiera);

    expect(lecturasDeM2SinAutorizacion(comoInspeccionable(olvidada).stack)).toEqual(['GET /pacientes/:id']);
    expect(lecturasDeM2SinAutorizacion(comoInspeccionable(autorizada).stack)).toEqual([]);
    expect(lecturasDeM2SinAutorizacion(comoInspeccionable(anidada).stack)).toEqual(['GET /pacientes/:id']);
    expect(lecturasDeM2SinAutorizacion(comoInspeccionable(ajena).stack)).toEqual([]);
  });
});

describe('toda lectura de agenda ajena exige autorización (D-16, RF-22)', () => {
  it('GET /disponibilidad está autorizada y la prueba no pasa en vacío', async () => {
    const rutas = await crearRutas({
      db,
      reloj: new RelojFijo('2026-10-07T12:00:00Z'),
      config: cargarConfiguracion(ENTORNO_PRUEBA),
    });
    const pila = pilaDeLaApi(rutas);

    expect(lecturasDeAgendaAjenaSinAutorizacion(pila)).toEqual([]);
    expect(rutasPorVariante(pila)[VARIANTE_NEGOCIO]).toContain('GET /disponibilidad');
  });

  it('la guardiana detecta un GET de agenda ajena sin autorización, también anidado', () => {
    const olvidada = Router();
    olvidada.get('/disponibilidad', manejadorCualquiera);
    const autorizada = Router();
    autorizada.get('/disponibilidad', autorizarEscritura('turnos'), manejadorCualquiera);
    const anidada = Router();
    anidada.use('/api', olvidada);

    expect(lecturasDeAgendaAjenaSinAutorizacion(comoInspeccionable(olvidada).stack)).toEqual(['GET /disponibilidad']);
    expect(lecturasDeAgendaAjenaSinAutorizacion(comoInspeccionable(autorizada).stack)).toEqual([]);
    expect(lecturasDeAgendaAjenaSinAutorizacion(comoInspeccionable(anidada).stack)).toEqual(['GET /disponibilidad']);
  });
});

describe('toda lectura de agenda propia exige autorización de agenda propia (RF-40, D-15, D-16)', () => {
  it('las lecturas reales de agenda propia y ajena están autorizadas, y la prueba no pasa en vacío', async () => {
    const rutas = await crearRutas({
      db,
      reloj: new RelojFijo('2026-10-07T12:00:00Z'),
      config: cargarConfiguracion(ENTORNO_PRUEBA),
    });
    const pila = pilaDeLaApi(rutas);

    expect(lecturasDeAgendaPropiaSinAutorizacion(pila)).toEqual([]);
    expect(lecturasDeAgendaAjenaSinAutorizacion(pila)).toEqual([]);
    // Que no pasen en vacío: las dos rutas existen y se inspeccionan.
    expect(rutasPorVariante(pila)[VARIANTE_NEGOCIO]).toEqual(expect.arrayContaining(['GET /mi-agenda', 'GET /agenda']));
  });

  it('la guardiana detecta un GET de agenda propia sin autorización o con la de otro tipo, también anidado', () => {
    const olvidada = Router();
    olvidada.get('/mi-agenda', manejadorCualquiera);
    const deSecretaria = Router();
    deSecretaria.get('/mi-agenda', autorizarEscritura('turnos'), manejadorCualquiera);
    const autorizada = Router();
    autorizada.get('/mi-agenda', autorizarAgendaPropia(), manejadorCualquiera);
    const anidada = Router();
    anidada.use('/api', olvidada);

    expect(lecturasDeAgendaPropiaSinAutorizacion(comoInspeccionable(olvidada).stack)).toEqual(['GET /mi-agenda']);
    expect(lecturasDeAgendaPropiaSinAutorizacion(comoInspeccionable(deSecretaria).stack)).toEqual(['GET /mi-agenda']);
    expect(lecturasDeAgendaPropiaSinAutorizacion(comoInspeccionable(autorizada).stack)).toEqual([]);
    expect(lecturasDeAgendaPropiaSinAutorizacion(comoInspeccionable(anidada).stack)).toEqual(['GET /mi-agenda']);
  });

  it('las rutas reales con autorización de agenda propia están todas bajo su prefijo', async () => {
    const rutas = await crearRutas({
      db,
      reloj: new RelojFijo('2026-10-07T12:00:00Z'),
      config: cargarConfiguracion(ENTORNO_PRUEBA),
    });

    expect(agendaPropiaFueraDelPrefijo(pilaDeLaApi(rutas))).toEqual([]);
  });

  it('la guardiana inversa detecta autorizarAgendaPropia en una ruta fuera del prefijo, también anidada', () => {
    const mal = Router();
    mal.get('/turnos/:id', autorizarAgendaPropia(), manejadorCualquiera);
    const bien = Router();
    bien.get('/mi-agenda', autorizarAgendaPropia(), manejadorCualquiera);
    const anidada = Router();
    anidada.use('/api', mal);

    expect(agendaPropiaFueraDelPrefijo(comoInspeccionable(mal).stack)).toEqual(['GET /turnos/:id']);
    expect(agendaPropiaFueraDelPrefijo(comoInspeccionable(bien).stack)).toEqual([]);
    expect(agendaPropiaFueraDelPrefijo(comoInspeccionable(anidada).stack)).toEqual(['GET /turnos/:id']);
  });

  it('la agenda propia no sirve como autorización de una agenda ajena', () => {
    const mal = Router();
    mal.get('/agenda', autorizarAgendaPropia(), manejadorCualquiera);

    expect(lecturasDeAgendaAjenaSinAutorizacion(comoInspeccionable(mal).stack)).toEqual(['GET /agenda']);
  });
});

const sesionFicticia = { sesionVigente: () => Promise.resolve(null) };
const configCookie = { cookieSegura: false };

describe('todo GET de negocio tiene una autorización reconocida (mundo cerrado)', () => {
  it('las rutas reales no tienen GET de negocio sin autorizar', async () => {
    const rutas = await crearRutas({
      db,
      reloj: new RelojFijo('2026-10-07T12:00:00Z'),
      config: cargarConfiguracion(ENTORNO_PRUEBA),
    });

    expect(getDeNegocioSinAutorizacion(pilaDeLaApi(rutas))).toEqual([]);
  });

  it('la guardiana detecta un GET de negocio sin autorización, también anidado, y acepta los autorizados', () => {
    const exigir = crearExigirSesionConPasos(sesionFicticia, configCookie, ['ninguno']);
    const abierta = Router();
    abierta.get('/turnos/:id', exigir, manejadorCualquiera);
    const autorizadas = Router();
    autorizadas.get('/a', exigir, autorizarEscritura('turnos'), manejadorCualquiera);
    autorizadas.get('/b', exigir, autorizarLectura('pacientes'), manejadorCualquiera);
    autorizadas.get('/c', exigir, autorizarAgendaPropia(), manejadorCualquiera);
    const anidada = Router();
    anidada.use('/api', abierta);
    const sinVarianteDeNegocio = Router();
    sinVarianteDeNegocio.get('/salud', manejadorCualquiera);

    expect(getDeNegocioSinAutorizacion(comoInspeccionable(abierta).stack)).toEqual(['GET /turnos/:id']);
    expect(getDeNegocioSinAutorizacion(comoInspeccionable(autorizadas).stack)).toEqual([]);
    expect(getDeNegocioSinAutorizacion(comoInspeccionable(anidada).stack)).toEqual(['GET /turnos/:id']);
    // Las rutas sin la variante de negocio las cubre otra guardiana (rutasSinVariante).
    expect(getDeNegocioSinAutorizacion(comoInspeccionable(sinVarianteDeNegocio).stack)).toEqual([]);
  });
});

describe('cada variante de exigirSesion aparece solo donde corresponde (RF-06, RNF-04)', () => {
  it('fija en qué rutas aparece cada variante', async () => {
    const rutas = await crearRutas({
      db,
      reloj: new RelojFijo('2026-10-07T12:00:00Z'),
      config: cargarConfiguracion(ENTORNO_PRUEBA),
    });
    const pila = pilaDeLaApi(rutas);
    const encontradas = rutasPorVariante(pila);
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
      // Gestión de cuentas (T-13, RF-04, RF-08, RF-09) datos del consultorio (T-16, RF-13) y kinesiólogos (T-17, RF-14, RF-16)
      // pacientes (T-18, RF-17 a RF-21), turnos (T-22, RF-23 a RF-26; T-23, RF-27, RF-30 a RF-35) y ticket (T-25, RF-28) agendas (T-27, RF-40, RF-41) y ficha del paciente (T-29, RF-47).
      [VARIANTE_NEGOCIO]: [
        'GET /agenda',
        'GET /agenda/pendientes',
        'GET /consultorio',
        'GET /cuentas',
        'GET /disponibilidad',
        'GET /kinesiologos',
        'GET /mi-agenda',
        'GET /pacientes',
        'GET /pacientes/:id',
        'GET /pacientes/:id/turnos',
        'GET /turnos/:id/ticket',
        'POST /cuentas',
        'POST /cuentas/:id/desactivacion',
        'POST /cuentas/:id/restablecimiento',
        'POST /kinesiologos',
        'POST /pacientes',
        'POST /turnos',
        'POST /turnos/:id/correccion',
        'POST /turnos/:id/transicion',
        'PUT /consultorio',
        'PUT /kinesiologos/:id/bloque',
        'PUT /pacientes/:id',
        'PUT /turnos/:id/coseguros',
        'PUT /turnos/:id/ubicacion',
      ],
    });
  });

  it('las rutas sin ninguna variante son solo las que no necesitan sesión previa', async () => {
    const rutas = await crearRutas({
      db,
      reloj: new RelojFijo('2026-10-07T12:00:00Z'),
      config: cargarConfiguracion(ENTORNO_PRUEBA),
    });

    // Ingreso (todavía no hay sesión), cierre (idempotente: sin sesión también da 204, RF-10) y el
    // chequeo de disponibilidad del monitor (sin datos). Toda ruta nueva usa una variante o se suma
    // acá con su justificación.
    expect(rutasSinVariante(pilaDeLaApi(rutas)).sort()).toEqual(['DELETE /sesion', 'GET /api/salud', 'POST /sesion']);
  });

  it('autoprueba: una ruta GET sin exigirSesion aparece en el grupo sin variante', () => {
    const router = Router();
    router.get('/olvidada', manejadorCualquiera);
    router.get('/ok', crearExigirSesionConPasos(sesionFicticia, configCookie, ['ninguno']), manejadorCualquiera);

    expect(rutasSinVariante(comoInspeccionable(router).stack)).toEqual(['GET /olvidada']);
  });

  it('la guardiana detecta un app.use(variante permisiva) en la app', () => {
    const app = express();
    app.use(crearExigirSesionConPasos(sesionFicticia, configCookie, ['verificar_segundo_factor']));

    expect(variantesPermisivasMontadasConUse(pilaDeApp(app))).toEqual([claveDeVariante(['verificar_segundo_factor'])]);
  });

  it('ninguna variante que admita un paso pendiente se monta con router.use en las rutas reales', async () => {
    const rutas = await crearRutas({
      db,
      reloj: new RelojFijo('2026-10-07T12:00:00Z'),
      config: cargarConfiguracion(ENTORNO_PRUEBA),
    });

    const montadas = variantesPermisivasMontadasConUse(pilaDeLaApi(rutas));

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
