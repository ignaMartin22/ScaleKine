import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { io as conectar, type Socket } from 'socket.io-client';
import { afterEach, describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { cargarConfiguracion } from '../../src/comun/configuracion.js';
import { RelojFijo } from '../../src/comun/reloj.js';
import { hashDeToken } from '../../src/modulos/m1-identidad/servicio.js';
import { crearServicioTurnos } from '../../src/modulos/m3-turnos/turnos.js';
import { crearTiempoReal, type Programador } from '../../src/modulos/m5-tiempo-real/tiempoReal.js';
import { crearRutas } from '../../src/rutas.js';
import { ENTORNO_PRUEBA, loggerCapturado, ORIGEN_APP } from '../ayudantes.js';
import { baseConEventoRoto } from './ayudantesTurnos.js';
import { db } from './base.js';
import { hashearContrasena } from '../../src/modulos/m1-identidad/contrasenas.js';
import {
  CONTRASENA_ADMINISTRADOR_VERIFICADO,
  crearKinesiologo,
  crearPaciente,
  crearTurno,
  crearUsuario,
  ingresarComo,
} from './fabricas.js';

// Miércoles 14/10/2026, 12:00 en Buenos Aires (UTC-3).
const AHORA_PRUEBA = '2026-10-14T15:00:00Z';
const FECHA = '2026-10-15';
const DOCE_HORAS_MS = 12 * 60 * 60 * 1000;

interface Programado {
  ms: number;
  accion: () => void;
  cancelado: boolean;
}

/** Programador manual: guarda lo que se pide y lo dispara la prueba, con el reloj controlado. */
function programadorManual() {
  const pedidos: Programado[] = [];
  const programar: Programador = (ms, accion) => {
    const pedido: Programado = { ms, accion, cancelado: false };
    pedidos.push(pedido);
    return () => {
      pedido.cancelado = true;
    };
  };
  return { pedidos, programar };
}

const abiertos: { clientes: Socket[]; servidores: Server[]; cerrar: (() => Promise<void>)[] } = {
  clientes: [],
  servidores: [],
  cerrar: [],
};

afterEach(async () => {
  for (const cliente of abiertos.clientes) cliente.disconnect();
  for (const cerrar of abiertos.cerrar) await cerrar();
  abiertos.clientes = [];
  abiertos.cerrar = [];
});

async function armar(opciones: { programar?: Programador; intervaloRevalidacionMs?: number } = {}) {
  const config = cargarConfiguracion({ ...ENTORNO_PRUEBA, COOKIE_SECURE: 'false' });
  const reloj = new RelojFijo(AHORA_PRUEBA);
  const capturado = loggerCapturado();
  const tiempoReal = crearTiempoReal({
    logger: capturado.logger,
    reloj,
    origenPermitido: config.origenFrontend,
    cookieSegura: config.cookieSegura,
    intervaloRevalidacionMs: opciones.intervaloRevalidacionMs ?? 0,
    ...(opciones.programar ? { programar: opciones.programar } : {}),
  });
  const rutas = await crearRutas({ db, reloj, config, tiempoReal });
  const app = crearApp({ config, logger: capturado.logger, reloj, rutas });
  const servidor = createServer(app);
  await new Promise<void>((listo) => servidor.listen(0, '127.0.0.1', listo));
  tiempoReal.adjuntar(servidor);
  abiertos.cerrar.push(() => tiempoReal.cerrar());
  const url = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  return { app, reloj, tiempoReal, url, ...capturado };
}
type Entorno = Awaited<ReturnType<typeof armar>>;

/** Carga de un evento: las pruebas la inspeccionan por propiedades. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Carga = any;

interface Cliente {
  socket: Socket;
  /** Eventos recibidos, en orden, como `[nombre, carga]`. */
  eventos: [string, Carga][];
}

/** Conecta un cliente y espera el resultado del handshake. */
function conectarCliente(
  url: string,
  { cookie, origen = ORIGEN_APP, extra = {} }: { cookie?: string; origen?: string | null; extra?: object } = {},
): Promise<Cliente & { conectado: boolean; error?: string }> {
  const headers: Record<string, string> = {};
  if (cookie) headers.cookie = cookie;
  if (origen !== null) headers.origin = origen;
  const socket = conectar(url, { transports: ['websocket'], reconnection: false, extraHeaders: headers, ...extra });
  abiertos.clientes.push(socket);
  const eventos: [string, Carga][] = [];
  socket.onAny((nombre: string, carga: unknown) => eventos.push([nombre, carga]));
  return new Promise((resolver) => {
    socket.on('connect', () => resolver({ socket, eventos, conectado: true }));
    socket.on('connect_error', (e: Error) => resolver({ socket, eventos, conectado: false, error: e.message }));
  });
}

async function conectado(url: string, cookie: string, extra: object = {}): Promise<Cliente> {
  const cliente = await conectarCliente(url, { cookie, extra });
  expect(cliente.conectado).toBe(true);
  return cliente;
}

async function esperar(condicion: () => boolean, ms = 3000): Promise<void> {
  const limite = Date.now() + ms;
  while (!condicion()) {
    if (Date.now() > limite) throw new Error('Se agotó la espera de la condición.');
    await new Promise((r) => setTimeout(r, 10));
  }
}
const pausa = (ms = 200) => new Promise((r) => setTimeout(r, ms));

const escribir = (e: Entorno, metodo: 'post' | 'put', ruta: string, cookie: string, cuerpo: object) =>
  request(e.app)[metodo](ruta).set({ Origin: ORIGEN_APP, Cookie: cookie }).send(cuerpo);

let hashClave: Promise<string> | undefined;

/** Otra cuenta ficticia del rol con su propia sesión (`ingresarComo` crea siempre la misma cuenta). */
async function ingresarOtra(app: Parameters<typeof request>[0], rol: 'secretaria' | 'kinesiologo', nombreUsuario: string) {
  hashClave ??= hashearContrasena(CONTRASENA_ADMINISTRADOR_VERIFICADO);
  const usuario = await crearUsuario({ rol, nombreUsuario, hashContrasena: await hashClave });
  const res = await request(app)
    .post('/api/sesion')
    .set('Origin', ORIGEN_APP)
    .send({ nombreUsuario, contrasena: CONTRASENA_ADMINISTRADOR_VERIFICADO });
  if (res.status !== 200) throw new Error(`El ingreso de prueba dio ${res.status}.`);
  const token = /^sesion=([^;]*)/.exec((res.headers['set-cookie'] as string[] | undefined)?.[0] ?? '')?.[1] ?? '';
  return { cookie: `sesion=${token}`, token, usuarioId: usuario.id };
}

/** Kinesiólogo con perfil y sesión; el nombre distingue a un kinesiólogo de otro. */
async function kinesiologoConSesion(app: Parameters<typeof request>[0], nombreUsuario: string) {
  const sesion = await ingresarOtra(app, 'kinesiologo', nombreUsuario);
  const kinesiologo = await db.kinesiologo.create({
    data: { usuarioId: sesion.usuarioId, nombre: `Kinesiólogo Propio ${sesion.usuarioId}`, bloque: 'manana' },
  });
  return { ...sesion, kinesiologo };
}

const nombres = (c: Cliente) => c.eventos.map(([n]) => n);

describe('handshake de Socket.io (RF-11, plan.md §4.15)', () => {
  it('acepta una sesión vigente de secretaría', async () => {
    const e = await armar();
    const { cookie } = await ingresarComo(e.app, 'secretaria');
    const cliente = await conectarCliente(e.url, { cookie });
    expect(cliente.conectado).toBe(true);
  });

  it('rechaza sin cookie, con cookie inválida y con una sesión que no existe', async () => {
    const e = await armar();
    const sinCookie = await conectarCliente(e.url, {});
    const basura = await conectarCliente(e.url, { cookie: 'sesion=xyz' });
    const inexistente = await conectarCliente(e.url, { cookie: `sesion=${'A'.repeat(43)}` });
    for (const c of [sinCookie, basura, inexistente]) {
      expect(c.conectado).toBe(false);
      expect(c.error).toBe('no_autorizado');
    }
  });

  it('rechaza una sesión vencida, una cerrada y una de cuenta desactivada', async () => {
    const e = await armar();
    const vencida = await ingresarComo(e.app, 'secretaria');
    e.reloj.avanzar(DOCE_HORAS_MS);
    expect((await conectarCliente(e.url, { cookie: vencida.cookie })).conectado).toBe(false);
    e.reloj.fijar(AHORA_PRUEBA);

    const cerrada = await ingresarOtra(e.app, 'secretaria', 'secretaria-dos');
    await db.sesion.updateMany({ where: { hashToken: hashDeToken(cerrada.token) }, data: { revocadaEn: new Date() } });
    expect((await conectarCliente(e.url, { cookie: cerrada.cookie })).conectado).toBe(false);

    const inactiva = await ingresarOtra(e.app, 'secretaria', 'secretaria-tres');
    await db.usuario.update({ where: { id: inactiva.usuarioId }, data: { activo: false } });
    expect((await conectarCliente(e.url, { cookie: inactiva.cookie })).conectado).toBe(false);
  });

  it('rechaza una sesión con paso pendiente: cambio de contraseña y segundo factor', async () => {
    const e = await armar();
    const debeCambiar = await ingresarComo(e.app, 'secretaria');
    await db.usuario.update({ where: { id: debeCambiar.usuarioId }, data: { debeCambiarContrasena: true } });
    expect((await conectarCliente(e.url, { cookie: debeCambiar.cookie })).conectado).toBe(false);

    const admin = await ingresarComo(e.app, 'administrador');
    expect((await conectarCliente(e.url, { cookie: admin.cookie })).conectado).toBe(true);
    await db.sesion.update({ where: { hashToken: hashDeToken(admin.token) }, data: { segundoFactorVerificado: false } });
    const sinVerificar = await conectarCliente(e.url, { cookie: admin.cookie });
    expect(sinVerificar.conectado).toBe(false);
    expect(sinVerificar.error).toBeDefined();
  });

  it('rechaza un Origin ajeno y la falta de Origin, aunque la sesión sea válida', async () => {
    const e = await armar();
    const { cookie } = await ingresarComo(e.app, 'secretaria');
    const ajeno = await conectarCliente(e.url, { cookie, origen: 'http://sitio-ajeno.example' });
    const sinOrigen = await conectarCliente(e.url, { cookie, origen: null });
    expect(ajeno.conectado).toBe(false);
    expect(sinOrigen.conectado).toBe(false);
  });

  it('rechaza un kinesiólogo sin perfil de Kinesiologo', async () => {
    const e = await armar();
    const { cookie } = await ingresarComo(e.app, 'kinesiologo');
    expect((await conectarCliente(e.url, { cookie })).conectado).toBe(false);
  });
});

describe('difusión por salas (RF-43, RF-44, D-15, D-16)', () => {
  async function escenario() {
    const e = await armar();
    const secretaria = await ingresarComo(e.app, 'secretaria');
    const a = await kinesiologoConSesion(e.app, 'kin-a');
    const b = await kinesiologoConSesion(e.app, 'kin-b');
    const paciente = await crearPaciente({ dni: '90222333', nombre: 'Paciente Ficticio Difusion' });
    const cs = await conectado(e.url, secretaria.cookie);
    const ca = await conectado(e.url, a.cookie);
    const cb = await conectado(e.url, b.cookie);
    return { e, secretaria, a, b, paciente, cs, ca, cb };
  }

  it('un turno que pasa a en_espera llega al kinesiólogo del turno y a secretaría, y no a otro kinesiólogo', async () => {
    const { e, secretaria, a, paciente, cs, ca, cb } = await escenario();
    const turno = await crearTurno({ fecha: FECHA, kinesiologoId: a.kinesiologo.id, pacienteId: paciente.id });

    const res = await escribir(e, 'post', `/api/turnos/${turno.id}/transicion`, secretaria.cookie, { hacia: 'en_espera' });
    expect(res.status).toBe(200);
    await esperar(() => nombres(cs).length > 0 && nombres(ca).length > 0);
    await pausa();

    expect(nombres(cs)).toEqual(['turno:cambio']);
    expect(nombres(ca)).toEqual(['turno:cambio']);
    expect(cb.eventos).toEqual([]);
    expect(cs.eventos[0]![1].turno).toMatchObject({ id: turno.id, estado: 'en_espera', fecha: FECHA });
    expect(ca.eventos[0]![1].turno).toMatchObject({ id: turno.id, estado: 'en_espera' });
  });

  it('las acciones disponibles viajan solo a secretaría; el kinesiólogo recibe la proyección de su agenda, sin acciones', async () => {
    const { e, secretaria, a, paciente, cs, ca } = await escenario();
    const turno = await crearTurno({ fecha: FECHA, kinesiologoId: a.kinesiologo.id, pacienteId: paciente.id });

    await escribir(e, 'post', `/api/turnos/${turno.id}/transicion`, secretaria.cookie, { hacia: 'en_espera' });
    await esperar(() => nombres(cs).length > 0 && nombres(ca).length > 0);

    const paraSecretaria = cs.eventos[0]![1].turno;
    expect(paraSecretaria.acciones).toEqual({
      transiciones: [{ hacia: 'asistio', accion: 'Asistió' }],
      puedeCorregir: true,
    });
    expect(paraSecretaria.paciente.id).toBe(paciente.id);
    const paraKinesiologo = ca.eventos[0]![1].turno;
    expect(paraKinesiologo).not.toHaveProperty('acciones');
    expect(JSON.stringify(ca.eventos)).not.toContain('acciones');
    // Misma proyección que la agenda propia (D-15): datos del paciente en solo lectura, sin su id (D-16).
    expect(paraKinesiologo.paciente).toEqual({
      nombre: 'Paciente Ficticio Difusion',
      dni: '90222333',
      telefono: paciente.telefono,
      obraSocial: 'Particular',
    });
    const { acciones: _acciones, ...sinAcciones } = paraSecretaria;
    expect(sinAcciones).toMatchObject({
      id: paraKinesiologo.id,
      estado: paraKinesiologo.estado,
      horaInicio: paraKinesiologo.horaInicio,
      horaLlegada: paraKinesiologo.horaLlegada,
    });
  });

  it('el administrador entra a la sala de secretaría y recibe las acciones', async () => {
    const { e, secretaria, a } = await escenario();
    const admin = await ingresarComo(e.app, 'administrador');
    const ca = await conectado(e.url, admin.cookie);
    const turno = await crearTurno({ fecha: FECHA, kinesiologoId: a.kinesiologo.id });
    await escribir(e, 'post', `/api/turnos/${turno.id}/transicion`, secretaria.cookie, { hacia: 'en_espera' });
    await esperar(() => nombres(ca).length > 0);
    expect(ca.eventos[0]![1].turno.acciones.puedeCorregir).toBe(true);
  });

  it('asignar, corregir y modificar coseguros también se difunden', async () => {
    const { e, secretaria, a, paciente, cs, ca, cb } = await escenario();

    const asignado = await escribir(e, 'post', '/api/turnos', secretaria.cookie, {
      pacienteId: paciente.id,
      kinesiologoId: a.kinesiologo.id,
      fecha: FECHA,
      horaInicio: '08:00',
    });
    expect(asignado.status).toBe(201);
    const id = asignado.body.turno.id as number;
    await esperar(() => nombres(cs).length === 1 && nombres(ca).length === 1);
    expect(ca.eventos[0]![1].turno).toMatchObject({ id, estado: 'reservado' });

    const coseguros = await escribir(e, 'put', `/api/turnos/${id}/coseguros`, secretaria.cookie, {
      coseguroObraSocial: '1500.50',
      coseguroAdicional: null,
    });
    expect(coseguros.status).toBe(200);
    await esperar(() => nombres(ca).length === 2);
    expect(ca.eventos[1]![1].turno.coseguroObraSocial).toBe('1500.50');

    const corregido = await escribir(e, 'post', `/api/turnos/${id}/correccion`, secretaria.cookie, { estado: 'anulado' });
    expect(corregido.status).toBe(200);
    await esperar(() => nombres(ca).length === 3 && nombres(cs).length === 3);
    expect(cs.eventos[2]![1].turno.estado).toBe('anulado');
    await pausa();
    expect(cb.eventos).toEqual([]);
  });

  it('una reprogramación entre kinesiólogos llega a ambos: al nuevo el turno y al anterior que lo quite', async () => {
    const { e, secretaria, a, b, paciente, cs, ca, cb } = await escenario();
    const turno = await crearTurno({ fecha: FECHA, kinesiologoId: a.kinesiologo.id, pacienteId: paciente.id });

    const res = await escribir(e, 'put', `/api/turnos/${turno.id}/ubicacion`, secretaria.cookie, {
      kinesiologoId: b.kinesiologo.id,
      fecha: FECHA,
      horaInicio: '08:45',
    });
    expect(res.status).toBe(200);
    await esperar(() => nombres(cs).length > 0 && nombres(ca).length > 0 && nombres(cb).length > 0);
    await pausa();

    expect(cs.eventos).toHaveLength(1);
    expect(cb.eventos).toHaveLength(1);
    expect(cb.eventos[0]![0]).toBe('turno:cambio');
    expect(cb.eventos[0]![1].turno).toMatchObject({ id: turno.id, horaInicio: '08:45' });
    // El anterior solo recibe el id para quitarlo: ningún dato del paciente que ya no es suyo (D-16).
    expect(ca.eventos).toEqual([['turno:quitado', { turnoId: turno.id }]]);
  });

  it('una reprogramación del mismo kinesiólogo no manda turno:quitado', async () => {
    const { e, secretaria, a, paciente, ca } = await escenario();
    const turno = await crearTurno({ fecha: FECHA, kinesiologoId: a.kinesiologo.id, pacienteId: paciente.id });
    await escribir(e, 'put', `/api/turnos/${turno.id}/ubicacion`, secretaria.cookie, {
      kinesiologoId: a.kinesiologo.id,
      fecha: FECHA,
      horaInicio: '08:45',
    });
    await esperar(() => nombres(ca).length > 0);
    await pausa();
    expect(nombres(ca)).toEqual(['turno:cambio']);
  });

  it('el kinesiólogo no puede elegir sala: ni por la query, ni por auth, ni emitiendo un evento', async () => {
    const e = await armar();
    const secretaria = await ingresarComo(e.app, 'secretaria');
    const a = await kinesiologoConSesion(e.app, 'kin-a');
    const b = await kinesiologoConSesion(e.app, 'kin-b');
    const turnoDeB = await crearTurno({ fecha: FECHA, kinesiologoId: b.kinesiologo.id });
    const ca = await conectado(e.url, a.cookie, {
      query: { sala: 'secretaria', kinesiologoId: String(b.kinesiologo.id), room: `kinesiologo:${b.kinesiologo.id}` },
      auth: { sala: 'secretaria', kinesiologoId: b.kinesiologo.id },
    });
    for (const sala of ['secretaria', `kinesiologo:${b.kinesiologo.id}`]) {
      ca.socket.emit('join', sala);
      ca.socket.emit('unirse', { sala });
      ca.socket.emit('sala', sala);
    }
    await pausa();

    await escribir(e, 'post', `/api/turnos/${turnoDeB.id}/transicion`, secretaria.cookie, { hacia: 'en_espera' });
    await e.tiempoReal.vaciar();
    await pausa(300);
    expect(ca.eventos).toEqual([]);
  });
});

describe('emisión después del commit (plan.md §3 M3)', () => {
  /** Servicio de turnos real que avisa a un emisor de prueba. */
  function servicioConEmisor(base: typeof db = db) {
    const avisos: { turnoId: number; kinesiologoId: number; kinesiologoAnteriorId?: number }[] = [];
    // Lo que veía OTRA conexión en el instante del aviso: solo ve lo ya confirmado.
    const vistos: Promise<{ estado: string; kinesiologoId: number; horaInicio: string; coseguro: string | null } | null>[] = [];
    const servicio = crearServicioTurnos({
      db: base,
      reloj: new RelojFijo(AHORA_PRUEBA),
      emisor: {
        turnoCambiado: (cambio) => {
          avisos.push(cambio);
          vistos.push(
            db.turno.findUnique({ where: { id: cambio.turnoId } }).then((t) =>
              t ? { estado: t.estado, kinesiologoId: t.kinesiologoId, horaInicio: t.horaInicio, coseguro: t.coseguroObraSocial?.toFixed(2) ?? null } : null,
            ),
          );
        },
      },
    });
    return { servicio, avisos, vistos };
  }

  it('cada operación avisa una sola vez y cuando su cambio ya es visible para otra conexión (commit hecho)', async () => {
    const { servicio, avisos, vistos } = servicioConEmisor();
    const autor = await ingresarComo(await armarApp(), 'secretaria');
    const kin = await crearKinesiologo();
    const otroKin = await crearKinesiologo();
    const paciente = await crearPaciente();

    const asignado = await servicio.asignar(
      { pacienteId: paciente.id, kinesiologoId: kin.id, fecha: FECHA, horaInicio: '08:00' },
      autor.usuarioId,
    );
    await servicio.transicionar(asignado.id, 'en_espera', autor.usuarioId, 'secretaria');
    await servicio.corregir(asignado.id, 'reservado', autor.usuarioId);
    await servicio.modificarCoseguros(asignado.id, { coseguroObraSocial: '1500.50', coseguroAdicional: null }, autor.usuarioId);
    await servicio.reprogramar(asignado.id, { kinesiologoId: otroKin.id, fecha: FECHA, horaInicio: '08:45' }, autor.usuarioId);

    expect(avisos).toEqual([
      { turnoId: asignado.id, kinesiologoId: kin.id },
      { turnoId: asignado.id, kinesiologoId: kin.id },
      { turnoId: asignado.id, kinesiologoId: kin.id },
      { turnoId: asignado.id, kinesiologoId: kin.id },
      { turnoId: asignado.id, kinesiologoId: otroKin.id, kinesiologoAnteriorId: kin.id },
    ]);
    expect(await Promise.all(vistos)).toEqual([
      { estado: 'reservado', kinesiologoId: kin.id, horaInicio: '08:00', coseguro: null },
      { estado: 'en_espera', kinesiologoId: kin.id, horaInicio: '08:00', coseguro: null },
      { estado: 'reservado', kinesiologoId: kin.id, horaInicio: '08:00', coseguro: null },
      { estado: 'reservado', kinesiologoId: kin.id, horaInicio: '08:00', coseguro: '1500.50' },
      { estado: 'reservado', kinesiologoId: otroKin.id, horaInicio: '08:45', coseguro: '1500.50' },
    ]);
  });

  it('un rechazo (409) no emite', async () => {
    const { servicio, avisos } = servicioConEmisor();
    const turno = await crearTurno({ fecha: FECHA, estado: 'asistio' });
    const otro = await crearTurno({ fecha: FECHA, horaInicio: '08:45' });

    await expect(servicio.transicionar(turno.id, 'en_espera', 1, 'secretaria')).rejects.toMatchObject({ estadoHttp: 409 });
    await expect(servicio.reprogramar(otro.id, { kinesiologoId: otro.kinesiologoId, fecha: FECHA, horaInicio: '08:45' }, 1)).rejects.toMatchObject({ estadoHttp: 409 });
    await expect(servicio.corregir(turno.id, 'asistio', 1)).rejects.toMatchObject({ estadoHttp: 409 });
    await expect(servicio.transicionar(999_999, 'en_espera', 1, 'secretaria')).rejects.toMatchObject({ estadoHttp: 404 });
    await expect(servicio.modificarCoseguros(999_999, { coseguroObraSocial: null, coseguroAdicional: null }, 1)).rejects.toMatchObject({ estadoHttp: 404 });

    expect(avisos).toEqual([]);
  });

  it('una transacción que falla (el evento de auditoría no se puede escribir) no emite', async () => {
    const { servicio, avisos } = servicioConEmisor(baseConEventoRoto());
    const autor = await ingresarComo(await armarApp(), 'secretaria');
    const kin = await crearKinesiologo();
    const paciente = await crearPaciente();
    const turno = await crearTurno({ fecha: FECHA });

    await expect(
      servicio.asignar({ pacienteId: paciente.id, kinesiologoId: kin.id, fecha: FECHA, horaInicio: '08:00' }, autor.usuarioId),
    ).rejects.toThrow();
    await expect(servicio.transicionar(turno.id, 'en_espera', autor.usuarioId, 'secretaria')).rejects.toThrow();
    await expect(servicio.corregir(turno.id, 'anulado', autor.usuarioId)).rejects.toThrow();
    await expect(
      servicio.reprogramar(turno.id, { kinesiologoId: turno.kinesiologoId, fecha: FECHA, horaInicio: '08:45' }, autor.usuarioId),
    ).rejects.toThrow();
    await expect(
      servicio.modificarCoseguros(turno.id, { coseguroObraSocial: '1', coseguroAdicional: null }, autor.usuarioId),
    ).rejects.toThrow();

    expect(avisos).toEqual([]);
  });

  it('un receptor que falla no cambia el resultado de la operación ya confirmada', async () => {
    const servicio = crearServicioTurnos({
      db,
      reloj: new RelojFijo(AHORA_PRUEBA),
      emisor: {
        turnoCambiado: () => {
          throw new Error('fallo del receptor');
        },
      },
    });
    const turno = await crearTurno({ fecha: FECHA });
    const res = await servicio.transicionar(turno.id, 'en_espera', 1, 'secretaria');
    expect(res.estado).toBe('en_espera');
  });

  it('la API no difunde cuando la operación se rechaza con 409', async () => {
    const e = await armar();
    const secretaria = await ingresarComo(e.app, 'secretaria');
    const a = await kinesiologoConSesion(e.app, 'kin-a');
    const turno = await crearTurno({ fecha: FECHA, kinesiologoId: a.kinesiologo.id, estado: 'asistio' });
    const cs = await conectado(e.url, secretaria.cookie);
    const ca = await conectado(e.url, a.cookie);

    const res = await escribir(e, 'post', `/api/turnos/${turno.id}/transicion`, secretaria.cookie, { hacia: 'en_espera' });
    expect(res.status).toBe(409);
    await e.tiempoReal.vaciar();
    await pausa();
    expect(cs.eventos).toEqual([]);
    expect(ca.eventos).toEqual([]);
  });

  it('el log de la difusión no contiene datos del paciente', async () => {
    const e = await armar();
    const secretaria = await ingresarComo(e.app, 'secretaria');
    const a = await kinesiologoConSesion(e.app, 'kin-a');
    const paciente = await crearPaciente({ dni: '90555666', nombre: 'Nombre Reservado Ficticio' });
    const turno = await crearTurno({ fecha: FECHA, kinesiologoId: a.kinesiologo.id, pacienteId: paciente.id });
    const ca = await conectado(e.url, a.cookie);
    await escribir(e, 'post', `/api/turnos/${turno.id}/transicion`, secretaria.cookie, { hacia: 'en_espera' });
    await esperar(() => nombres(ca).length > 0);
    const log = e.texto();
    expect(log).not.toContain('Nombre Reservado');
    expect(log).not.toContain('90555666');
    expect(log).not.toContain(a.cookie.split('=')[1]);
  });
});

/** App sola, para tener una sesión de autor sin montar sockets. */
async function armarApp() {
  const config = cargarConfiguracion({ ...ENTORNO_PRUEBA, COOKIE_SECURE: 'false' });
  const reloj = new RelojFijo(AHORA_PRUEBA);
  const capturado = loggerCapturado();
  const rutas = await crearRutas({ db, reloj, config });
  return crearApp({ config, logger: capturado.logger, reloj, rutas });
}

describe('desconexión al vencer la sesión (RF-11)', () => {
  it('programa la desconexión para el vencimiento y, al llegar, cierra el socket avisando el motivo', async () => {
    const { pedidos, programar } = programadorManual();
    const e = await armar({ programar });
    const { cookie } = await ingresarComo(e.app, 'secretaria');

    const cliente = await conectado(e.url, cookie);

    expect(pedidos).toHaveLength(1);
    expect(pedidos[0]!.ms).toBe(DOCE_HORAS_MS);

    const cerrado = new Promise<string>((r) => cliente.socket.on('disconnect', r));
    e.reloj.avanzar(DOCE_HORAS_MS);
    pedidos[0]!.accion();

    expect(await cerrado).toBe('io server disconnect');
    expect(cliente.eventos).toEqual([['sesion:cerrada', { motivo: 'vencida' }]]);
  });

  it('si el temporizador salta antes del vencimiento, no corta y se reprograma por lo que falta', async () => {
    const { pedidos, programar } = programadorManual();
    const e = await armar({ programar });
    const { cookie } = await ingresarComo(e.app, 'secretaria');
    const cliente = await conectado(e.url, cookie);

    e.reloj.avanzar(DOCE_HORAS_MS - 5000);
    pedidos[0]!.accion();
    await pausa();

    expect(cliente.socket.connected).toBe(true);
    expect(pedidos).toHaveLength(2);
    expect(pedidos[1]!.ms).toBe(5000);
  });

  it('un socket con sesión vencida se desconecta con el temporizador real y el reloj controlado', async () => {
    const e = await armar();
    const { cookie, token } = await ingresarComo(e.app, 'secretaria');
    // Vence en 300 ms según el reloj de la prueba.
    await db.sesion.update({
      where: { hashToken: hashDeToken(token) },
      data: { venceEn: new Date(e.reloj.ahora().getTime() + 300) },
    });
    const cliente = await conectado(e.url, cookie);
    const cerrado = new Promise<string>((r) => cliente.socket.on('disconnect', r));
    e.reloj.avanzar(300);
    expect(await cerrado).toBe('io server disconnect');
    expect(nombres(cliente)).toEqual(['sesion:cerrada']);
  });

  it('cerrar la desconexión programada al desconectarse el cliente (no queda temporizador vivo)', async () => {
    const { pedidos, programar } = programadorManual();
    const e = await armar({ programar });
    const { cookie } = await ingresarComo(e.app, 'secretaria');
    const cliente = await conectado(e.url, cookie);
    cliente.socket.disconnect();
    await esperar(() => pedidos[0]!.cancelado);
  });
});

describe('sesión cerrada o cuenta desactivada con el socket abierto', () => {
  it('cerrar sesión (RF-10) desconecta los sockets de esa sesión y no los de otra', async () => {
    const e = await armar();
    const s1 = await ingresarComo(e.app, 'secretaria');
    const s2 = await ingresarOtra(e.app, 'secretaria', 'secretaria-dos');
    const c1 = await conectado(e.url, s1.cookie);
    const c2 = await conectado(e.url, s2.cookie);
    const cerrado = new Promise<string>((r) => c1.socket.on('disconnect', r));

    const res = await request(e.app).delete('/api/sesion').set({ Origin: ORIGEN_APP, Cookie: s1.cookie });
    expect(res.status).toBeLessThan(300);

    expect(await cerrado).toBe('io server disconnect');
    expect(c1.eventos).toEqual([['sesion:cerrada', { motivo: 'revocada' }]]);
    await pausa();
    expect(c2.socket.connected).toBe(true);
  });

  it('desactivar la cuenta (RF-09) desconecta sus sockets', async () => {
    const e = await armar();
    const admin = await ingresarComo(e.app, 'administrador');
    const k = await kinesiologoConSesion(e.app, 'kin-a');
    const ck = await conectado(e.url, k.cookie);
    const cerrado = new Promise<string>((r) => ck.socket.on('disconnect', r));

    const res = await request(e.app)
      .post(`/api/cuentas/${k.usuarioId}/desactivacion`)
      .set({ Origin: ORIGEN_APP, Cookie: admin.cookie });
    expect(res.status).toBeLessThan(300);

    expect(await cerrado).toBe('io server disconnect');
  });

  it('una revocación hecha fuera de este proceso (línea de comandos) se detecta al revalidar', async () => {
    const e = await armar({ intervaloRevalidacionMs: 50 });
    const { cookie } = await ingresarComo(e.app, 'secretaria');
    const otra = await ingresarOtra(e.app, 'secretaria', 'secretaria-dos');
    const cliente = await conectado(e.url, cookie);
    const cerrado = new Promise<string>((r) => cliente.socket.on('disconnect', r));
    const queSigue = await conectado(e.url, otra.cookie);

    await db.sesion.updateMany({ where: { revocadaEn: null, usuarioId: { not: otra.usuarioId } }, data: { revocadaEn: new Date() } });

    expect(await cerrado).toBe('io server disconnect');
    expect(cliente.eventos).toEqual([['sesion:cerrada', { motivo: 'revocada' }]]);
    expect(queSigue.socket.connected).toBe(true);
  });
});
