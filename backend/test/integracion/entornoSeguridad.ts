import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { expect } from 'vitest';
import { crearApp } from '../../src/app.js';
import { cargarConfiguracion } from '../../src/comun/configuracion.js';
import { RelojFijo } from '../../src/comun/reloj.js';
import { Prisma } from '../../src/generado/prisma/client.js';
import { hashearContrasena } from '../../src/modulos/m1-identidad/contrasenas.js';
import { crearTiempoReal } from '../../src/modulos/m5-tiempo-real/tiempoReal.js';
import { crearRutas } from '../../src/rutas.js';
import { CLAVE_CIFRADO_PRUEBA, ENTORNO_PRUEBA, loggerCapturado, ORIGEN_APP } from '../ayudantes.js';
import { db } from './base.js';
import { rutasDeLaApp } from './enumerarRutas.js';
import {
  CONTRASENA_ADMINISTRADOR_VERIFICADO,
  crearKinesiologo,
  crearPaciente,
  crearTurno,
  crearUsuario,
  ingresarComo,
  ingresarComoKinesiologo,
} from './fabricas.js';

/**
 * Entorno compartido por las pruebas transversales de seguridad (T-34, RNF-08 y RNF-10): la app
 * completa con tiempo real, un logger que captura cada línea, y un catálogo de entradas válidas por
 * ruta. El catálogo es de mundo cerrado: una prueba exige que cubra todas las rutas reales.
 */

// Miércoles 14/10/2026, 12:00 en Buenos Aires (UTC-3).
export const AHORA_SEGURIDAD = '2026-10-14T15:00:00Z';

type Base = typeof db;

export async function armarEntorno({ base = db }: { base?: Base } = {}) {
  const config = cargarConfiguracion({ ...ENTORNO_PRUEBA, COOKIE_SECURE: 'false', CLAVE_CIFRADO: CLAVE_CIFRADO_PRUEBA });
  const reloj = new RelojFijo(AHORA_SEGURIDAD);
  const capturado = loggerCapturado();
  const tiempoReal = crearTiempoReal({
    logger: capturado.logger,
    reloj,
    origenPermitido: config.origenFrontend,
    cookieSegura: config.cookieSegura,
    intervaloRevalidacionMs: 0,
  });
  const rutas = await crearRutas({ db: base, reloj, config, tiempoReal });
  const app = crearApp({ config, logger: capturado.logger, reloj, rutas });
  const servidor = createServer(app);
  await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
  tiempoReal.adjuntar(servidor);
  const url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  return { app, reloj, config, url, tiempoReal, cerrar: () => tiempoReal.cerrar(), ...capturado };
}
export type Entorno = Awaited<ReturnType<typeof armarEntorno>>;

/** Error que se hace pasar por uno de Prisma, con un mensaje que copia datos personales (RNF-08). */
export function errorDePrismaConDatos(dni: string, nombre: string): Error {
  return new Prisma.PrismaClientKnownRequestError(
    `Invalid \`prisma.paciente.findFirst()\` invocation in C:\\proyecto\\src\\modulos\\m2-maestros\\pacientes.ts:42:7\n  where: { dni: "${dni}", nombre: "${nombre}" }\nUnique constraint failed on the fields: (\`dni\`)`,
    { code: 'P2002', clientVersion: 'prueba' },
  );
}

/**
 * Base cuyas operaciones fallan con `error`, salvo la lectura de la sesión (que la autenticación
 * necesita para llegar al servicio): fuerza un error interno en cualquier ruta que consulte la base.
 */
export function baseQueFalla(error: Error): Base {
  const falla = () => Promise.reject(error);
  const delegadoQueFalla = (delegado: object, permitidos: string[] = []) =>
    new Proxy(delegado, {
      get: (destino, propiedad, receptor) =>
        permitidos.includes(String(propiedad)) ? Reflect.get(destino, propiedad, receptor) : falla,
    });
  return new Proxy(db, {
    get(destino, propiedad, receptor) {
      const valor = Reflect.get(destino, propiedad, receptor) as unknown;
      if (propiedad === 'sesion') return delegadoQueFalla(valor as object, ['findUnique']);
      if (typeof propiedad === 'string' && (propiedad.startsWith('$query') || propiedad === '$transaction')) {
        return falla;
      }
      if (typeof propiedad === 'string' && !propiedad.startsWith('$') && typeof valor === 'object' && valor !== null) {
        return delegadoQueFalla(valor);
      }
      return valor;
    },
  }) as Base;
}

// --- Pedidos ----------------------------------------------------------------------------------

let contadorIp = 0;
/** Cada pedido sale de una dirección distinta, para que el límite de intentos por IP no interfiera. */
const ipNueva = () => {
  contadorIp += 1;
  return `198.18.${contadorIp >> 8}.${contadorIp & 255}`;
};

export type Metodo = 'get' | 'post' | 'put' | 'delete';

export interface OpcionesPedido {
  cookie?: string;
  /** Valor que se envía como JSON. */
  cuerpo?: unknown;
  /** Texto que se envía tal cual como `application/json` (JSON mal formado, cuerpo enorme). */
  crudo?: string;
  origen?: string;
}

export function pedir(entorno: Pick<Entorno, 'url'>, metodo: Metodo, ruta: string, opciones: OpcionesPedido = {}) {
  let pedido = request(entorno.url)[metodo](ruta).set('X-Forwarded-For', ipNueva());
  if (metodo !== 'get') pedido = pedido.set('Origin', opciones.origen ?? ORIGEN_APP);
  if (opciones.cookie) pedido = pedido.set('Cookie', opciones.cookie);
  if (opciones.crudo !== undefined) return pedido.set('Content-Type', 'application/json').send(opciones.crudo);
  if (opciones.cuerpo !== undefined) {
    // Un JSON que no es objeto (`null`, un texto, un número) se manda crudo: superagent no lo serializa solo.
    return pedido.set('Content-Type', 'application/json').send(JSON.stringify(opciones.cuerpo));
  }
  return pedido;
}
export type Respuesta = Awaited<ReturnType<typeof pedir>>;

// --- Escenario ---------------------------------------------------------------------------------

export interface Contexto {
  pacienteId: number;
  kinesiologoId: number;
  turnoId: number;
  cuentaId: number;
}

export interface Sesiones {
  administrador: string;
  secretaria: string;
  kinesiologo: string;
  /** Sesión de una cuenta aparte para las rutas que podrían trabar o cerrar las demás. */
  descartable: string;
}
export type RolDePrueba = 'administrador' | 'secretaria' | 'kinesiologo';

/** Datos ficticios mínimos y tres sesiones, una por rol, más una descartable. */
export async function prepararEscenario(app: Parameters<typeof ingresarComo>[0]) {
  await db.consultorio.create({
    data: { id: 1, nombre: 'Consultorio Ficticio', direccion: 'Calle Falsa 123', telefono: '11 5555 0000' },
  });
  const administrador = await ingresarComo(app, 'administrador');
  const secretaria = await ingresarComo(app, 'secretaria');
  const kine = await ingresarComoKinesiologo(app);

  await crearUsuario({
    rol: 'secretaria',
    nombreUsuario: 'descartable-ficticia',
    hashContrasena: await hashearContrasena(CONTRASENA_ADMINISTRADOR_VERIFICADO),
  });
  const ingreso = await request(app)
    .post('/api/sesion')
    .set('Origin', ORIGEN_APP)
    .send({ nombreUsuario: 'descartable-ficticia', contrasena: CONTRASENA_ADMINISTRADOR_VERIFICADO });
  const token = /^sesion=([^;]*)/.exec((ingreso.headers['set-cookie'] as string[] | undefined)?.[0] ?? '')?.[1];
  if (ingreso.status !== 200 || !token) throw new Error('No se pudo abrir la sesión descartable.');

  const paciente = await crearPaciente({ dni: '90000001', nombre: 'Paciente Base Ficticio' });
  const otroKine = await crearKinesiologo();
  const turno = await crearTurno({ pacienteId: paciente.id, kinesiologoId: kine.kinesiologo.id, fecha: '2026-10-14' });
  const cuenta = await crearUsuario({ rol: 'secretaria' });
  const contexto: Contexto = {
    pacienteId: paciente.id,
    kinesiologoId: otroKine.id,
    turnoId: turno.id,
    cuentaId: cuenta.id,
  };
  const sesiones: Sesiones = {
    administrador: administrador.cookie,
    secretaria: secretaria.cookie,
    kinesiologo: kine.cookie,
    descartable: `sesion=${token}`,
  };
  return { contexto, sesiones };
}

// --- Catálogo de entradas válidas -----------------------------------------------------------------

export interface Entrada {
  url: string;
  cuerpo?: Record<string, unknown>;
  /** El pedido se hace sin cookie (cerrar sesión cerraría la de la prueba). */
  sinCookie?: boolean;
  /** Usa la sesión descartable (cambia contraseña o toca el segundo factor). */
  descartable?: boolean;
}

let n = 0;
const unico = () => ++n;

/**
 * Una entrada sintácticamente válida por ruta real, indexada por `MÉTODO /api/ruta`. Las que tienen
 * efectos laterales sobre las demás sesiones (cambio de contraseña, cierre) son inofensivas: usan una
 * contraseña actual incorrecta o ninguna cookie.
 */
export const CATALOGO: Record<string, (c: Contexto) => Entrada> = {
  'GET /api/salud': () => ({ url: '/api/salud' }),
  'POST /api/sesion': () => ({
    url: '/api/sesion',
    cuerpo: { nombreUsuario: 'ficticio-secretaria', contrasena: CONTRASENA_ADMINISTRADOR_VERIFICADO },
  }),
  'GET /api/sesion': () => ({ url: '/api/sesion' }),
  'DELETE /api/sesion': () => ({ url: '/api/sesion', sinCookie: true }),
  'PUT /api/sesion/contrasena': () => ({
    url: '/api/sesion/contrasena',
    descartable: true,
    cuerpo: { contrasenaActual: 'incorrecta-descartable-1', contrasenaNueva: 'nueva-clave-larga-9921' },
  }),
  'POST /api/sesion/segundo-factor/activacion': () => ({
    url: '/api/sesion/segundo-factor/activacion',
    descartable: true,
    cuerpo: {},
  }),
  'POST /api/sesion/segundo-factor/activacion/confirmar': () => ({
    url: '/api/sesion/segundo-factor/activacion/confirmar',
    descartable: true,
    cuerpo: { codigo: '123456' },
  }),
  'POST /api/sesion/segundo-factor/verificar': () => ({
    url: '/api/sesion/segundo-factor/verificar',
    descartable: true,
    cuerpo: { codigo: '123456' },
  }),
  'GET /api/cuentas': () => ({ url: '/api/cuentas' }),
  'POST /api/cuentas': () => ({
    url: '/api/cuentas',
    cuerpo: { nombreUsuario: `cuenta-nueva-${unico()}`, contrasenaTemporal: 'temporal-larga-8843' },
  }),
  'POST /api/cuentas/:id/desactivacion': (c) => ({ url: `/api/cuentas/${c.cuentaId}/desactivacion`, cuerpo: {} }),
  'POST /api/cuentas/:id/restablecimiento': (c) => ({
    url: `/api/cuentas/${c.cuentaId}/restablecimiento`,
    cuerpo: { contrasenaTemporal: 'temporal-larga-8843' },
  }),
  'GET /api/consultorio': () => ({ url: '/api/consultorio' }),
  'PUT /api/consultorio': () => ({
    url: '/api/consultorio',
    cuerpo: { nombre: 'Consultorio Ficticio', direccion: 'Calle Falsa 123', telefono: '11 5555 0000' },
  }),
  'GET /api/kinesiologos': () => ({ url: '/api/kinesiologos?bloque=manana' }),
  'POST /api/kinesiologos': () => ({
    url: '/api/kinesiologos',
    cuerpo: {
      nombre: 'Kinesiólogo Nuevo Ficticio',
      bloque: 'tarde',
      nombreUsuario: `kine-nuevo-${unico()}`,
      contrasenaTemporal: 'temporal-larga-8843',
    },
  }),
  'PUT /api/kinesiologos/:id/bloque': (c) => ({
    url: `/api/kinesiologos/${c.kinesiologoId}/bloque`,
    cuerpo: { bloque: 'manana' },
  }),
  'GET /api/pacientes': () => ({ url: '/api/pacientes?nombre=Ficticio' }),
  'GET /api/pacientes/:id': (c) => ({ url: `/api/pacientes/${c.pacienteId}` }),
  'POST /api/pacientes': () => ({
    url: '/api/pacientes',
    cuerpo: {
      dni: String(95_000_000 + unico()),
      nombre: 'Paciente Nuevo Ficticio',
      telefono: '11 5555 1111',
      obraSocial: 'Particular',
    },
  }),
  'PUT /api/pacientes/:id': (c) => ({
    url: `/api/pacientes/${c.pacienteId}`,
    cuerpo: { dni: '90000001', nombre: 'Paciente Editado Ficticio', telefono: '11 5555 2222', obraSocial: 'Particular' },
  }),
  'GET /api/obras-sociales': () => ({ url: '/api/obras-sociales' }),
  'GET /api/disponibilidad': (c) => ({
    url: `/api/disponibilidad?fecha=2026-10-14&bloque=manana&pacienteId=${c.pacienteId}`,
  }),
  'GET /api/agenda/pendientes': () => ({ url: '/api/agenda/pendientes' }),
  'GET /api/agenda': () => ({ url: '/api/agenda?fecha=2026-10-14' }),
  'GET /api/mi-agenda': () => ({ url: '/api/mi-agenda?fecha=2026-10-14' }),
  'GET /api/pacientes/:id/turnos': (c) => ({ url: `/api/pacientes/${c.pacienteId}/turnos` }),
  'POST /api/turnos': (c) => ({
    url: '/api/turnos',
    cuerpo: {
      pacienteId: c.pacienteId,
      kinesiologoId: c.kinesiologoId,
      fecha: '2026-10-19',
      horaInicio: '08:00',
      coseguroAbonado: '1500',
    },
  }),
  'POST /api/turnos/:id/transicion': (c) => ({
    url: `/api/turnos/${c.turnoId}/transicion`,
    cuerpo: { hacia: 'en_espera' },
  }),
  'POST /api/turnos/:id/correccion': (c) => ({
    url: `/api/turnos/${c.turnoId}/correccion`,
    cuerpo: { estado: 'reservado' },
  }),
  'PUT /api/turnos/:id/abono': (c) => ({ url: `/api/turnos/${c.turnoId}/abono`, cuerpo: { monto: '2500' } }),
  'PUT /api/turnos/:id/ubicacion': (c) => ({
    url: `/api/turnos/${c.turnoId}/ubicacion`,
    cuerpo: { kinesiologoId: c.kinesiologoId, fecha: '2026-10-20', horaInicio: '08:45' },
  }),
  'GET /api/turnos/:id/ticket': (c) => ({ url: `/api/turnos/${c.turnoId}/ticket` }),
};

export interface RutaReal {
  clave: string;
  metodo: Metodo;
  plantilla: string;
}

/** Las rutas reales de la app, tal como las ve el router (sin lista a mano). */
export function rutasReales(app: unknown): RutaReal[] {
  return rutasDeLaApp(app).map((clave) => {
    const [metodo = '', plantilla = ''] = clave.split(' ');
    return { clave, metodo: metodo.toLowerCase() as Metodo, plantilla };
  });
}

/** Cookie con la que se prueba la entrada, según el rol (`null` = sin sesión). */
export function cookieDe(entrada: Entrada, sesiones: Sesiones, rol: RolDePrueba | null): string | undefined {
  if (entrada.sinCookie || rol === null) return undefined;
  if (entrada.descartable) return sesiones.descartable;
  return sesiones[rol];
}

export function pedirEntrada(
  entorno: Pick<Entorno, 'url'>,
  ruta: RutaReal,
  entrada: Entrada,
  cookie: string | undefined,
  cambios: Partial<OpcionesPedido> = {},
) {
  return pedir(entorno, ruta.metodo, entrada.url, {
    ...(cookie ? { cookie } : {}),
    ...(entrada.cuerpo !== undefined ? { cuerpo: entrada.cuerpo } : {}),
    ...cambios,
  });
}

// --- Forma de las respuestas de error ----------------------------------------------------------

/** Patrones de lo que nunca debe llegar al cliente en un error (RNF-10). */
export const PATRONES_DE_TRAZA: [string, RegExp][] = [
  ['stack', /stack/i],
  ['frame "at"', /\bat [\w$./\\<(]/],
  ['archivo .ts/.js', /\.(ts|js|mjs|cjs)\b/],
  ['node_modules', /node_modules/i],
  ['ruta de Windows', /[A-Za-z]:\\/],
  ['Prisma', /prisma/i],
  ['PostgreSQL', /postgres|pg_|SQLSTATE|relation "|violates|duplicate key/i],
  ['código de Prisma', /\bP[12]\d{3}\b/],
  ['invocation', /invocation/i],
  ['Error de JS', /\b(TypeError|ReferenceError|SyntaxError|RangeError)\b/],
];

/** Verifica que `res` sea un error con el formato del manejador central y sin trazas. */
export function verificarErrorSinTrazas(res: Respuesta, contexto: string, prohibidos: string[] = []): void {
  const texto = res.text ?? '';
  const quien = `${contexto} -> ${res.status} ${texto.slice(0, 200)}`;
  expect(res.status, quien).toBeGreaterThanOrEqual(400);
  expect(res.headers['content-type'], quien).toMatch(/^application\/json/);
  const cuerpo = res.body as { error?: { codigo?: unknown; mensaje?: unknown; campos?: unknown } };
  expect(Object.keys(cuerpo), quien).toEqual(['error']);
  const error = cuerpo.error ?? {};
  expect(
    Object.keys(error).every((k) => ['codigo', 'mensaje', 'campos'].includes(k)),
    quien,
  ).toBe(true);
  expect(typeof error.codigo, quien).toBe('string');
  expect(typeof error.mensaje, quien).toBe('string');
  for (const [nombre, patron] of PATRONES_DE_TRAZA) {
    expect(patron.test(texto), `${quien} (patrón ${nombre})`).toBe(false);
  }
  for (const prohibido of prohibidos) expect(texto.includes(prohibido), `${quien} (eco de ${prohibido})`).toBe(false);
}
