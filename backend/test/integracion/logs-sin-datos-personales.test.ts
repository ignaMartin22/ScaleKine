import { generateSync } from 'otplib';
import { io as conectar, type Socket } from 'socket.io-client';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hashDeToken } from '../../src/modulos/m1-identidad/servicio.js';
import { descifrarSecreto, uriOtpauth } from '../../src/modulos/m1-identidad/segundoFactor.js';
import { hashearContrasena } from '../../src/modulos/m1-identidad/contrasenas.js';
import { CLAVE_CIFRADO_PRUEBA, ORIGEN_APP } from '../ayudantes.js';
import { db } from './base.js';
import {
  armarEntorno,
  baseQueFalla,
  errorDePrismaConDatos,
  pedir,
  type Entorno,
  type Metodo,
  type OpcionesPedido,
  type Respuesta,
} from './entornoSeguridad.js';
import { crearUsuario } from './fabricas.js';

/**
 * T-34 · Ningún dato personal ni secreto aparece en los logs (RNF-08). Se recorre el flujo completo
 * de la aplicación con valores ficticios y distintivos, se captura toda línea que emite el logger
 * (pino) y se busca cada valor, también codificado como URL y en minúsculas. Cubre los caminos
 * felices, los de error (400, 403, 404, 409) y un error interno con un mensaje que copia datos.
 */

// Datos distintivos: ninguno puede aparecer en una línea de log.
const DNI = '91827364';
const DNI_CON_PUNTOS = '91.827.364';
const NOMBRE = 'Zacarías Quillfeather Bonaventura';
const NOMBRE_EDITADO = 'Zacarías Quillfeather Editadísimo';
const TELEFONO = '11 4829 7316';
const TELEFONO_EDITADO = '11 6173 9055';
const OBRA_SOCIAL = 'Mutual Zafiro Austral';
const OBRA_SOCIAL_EDITADA = 'Sindicato Ámbar del Plata';
const MONTO = '7654.32';
const MONTO_EDITADO = '8765.43';
const KINESIOLOGO = 'Eulalia Bonaventura Pardal';
const ADMIN = 'admin-quimera';
const SECRETARIA = 'secre-quimera';
const KINE = 'kine-quimera';
const CLAVE_ADMIN = 'clave-de-prueba-larga';
const TEMPORAL_SECRETARIA = 'temporal-secre-4410';
const TEMPORAL_KINE = 'temporal-quimera-5521';
const NUEVA_SECRETARIA = 'nueva-secre-quimera-9034';
const NUEVA_KINE = 'nueva-kine-quimera-7788';
const CLAVE_EQUIVOCADA = 'contrasena-equivocada-zx81';

const FECHA = '2026-10-15';

/** Valores que nunca pueden aparecer en un log, con su descripción para el mensaje de falla. */
type Sensibles = Map<string, string>;

function variantes(valor: string): string[] {
  return [...new Set([valor, encodeURIComponent(valor), valor.toLowerCase(), valor.replaceAll(' ', '+')])];
}

/** Líneas de log (sin la marca de tiempo, que son dígitos al azar) donde aparece algún valor. */
function filtraciones(lineas: string[], sensibles: Sensibles): string[] {
  const filtradas: string[] = [];
  for (const linea of lineas) {
    const registro = JSON.parse(linea) as Record<string, unknown>;
    delete registro.time;
    const texto = JSON.stringify(registro).toLowerCase();
    for (const [valor, descripcion] of sensibles) {
      for (const forma of variantes(valor)) {
        if (texto.includes(forma.toLowerCase())) filtradas.push(`${descripcion} en: ${linea.slice(0, 240)}`);
      }
    }
  }
  return filtradas;
}

const abiertos: Socket[] = [];
afterEach(() => {
  for (const socket of abiertos.splice(0)) socket.disconnect();
});

let entorno: Entorno;
beforeAll(async () => {
  entorno = await armarEntorno();
});
afterAll(async () => {
  await entorno.cerrar();
});

/** Acumula lo que el flujo hizo conocer: tokens de sesión, secretos y códigos. */
function recolector() {
  const sensibles: Sensibles = new Map();
  const agregar = (valor: unknown, descripcion: string) => {
    if (typeof valor === 'string' && valor.length >= 5) sensibles.set(valor, descripcion);
  };
  const datos: [string, string][] = [
    [DNI, 'DNI'],
    [DNI_CON_PUNTOS, 'DNI con puntos'],
    [NOMBRE, 'nombre'],
    ['Quillfeather', 'apellido'],
    [NOMBRE_EDITADO, 'nombre editado'],
    [TELEFONO, 'teléfono'],
    ['4829 7316', 'teléfono (parte)'],
    [TELEFONO_EDITADO, 'teléfono editado'],
    [OBRA_SOCIAL, 'obra social'],
    [OBRA_SOCIAL_EDITADA, 'obra social editada'],
    [MONTO, 'monto'],
    ['7654', 'monto (parte)'],
    [MONTO_EDITADO, 'monto editado'],
    ['8765', 'monto editado (parte)'],
    [KINESIOLOGO, 'nombre del kinesiólogo'],
    [ADMIN, 'usuario administrador'],
    [SECRETARIA, 'usuario secretaría'],
    [KINE, 'usuario kinesiólogo'],
    [CLAVE_ADMIN, 'contraseña del administrador'],
    [TEMPORAL_SECRETARIA, 'contraseña temporal'],
    [TEMPORAL_KINE, 'contraseña temporal'],
    [NUEVA_SECRETARIA, 'contraseña nueva'],
    [NUEVA_KINE, 'contraseña nueva'],
    [CLAVE_EQUIVOCADA, 'contraseña equivocada'],
    [CLAVE_CIFRADO_PRUEBA, 'clave de cifrado'],
  ];
  for (const [valor, descripcion] of datos) agregar(valor, descripcion);

  return {
    sensibles,
    agregar,
    /** Pide, y registra cada token de sesión que el servidor entrega. */
    async llamar(metodo: Metodo, ruta: string, opciones: OpcionesPedido = {}): Promise<Respuesta> {
      const res = await pedir(entorno, metodo, ruta, opciones);
      for (const cookie of (res.headers['set-cookie'] as string[] | undefined) ?? []) {
        const token = /^sesion=([^;]+)/.exec(cookie)?.[1];
        if (token) {
          agregar(token, 'token de sesión');
          agregar(hashDeToken(token), 'hash del token');
          agregar(`sesion=${token}`, 'cookie de sesión');
        }
      }
      for (const cookie of [opciones.cookie]) if (cookie) agregar(cookie, 'cookie enviada');
      return res;
    },
  };
}

function codigoTotp(secreto: string, instante: Date): string {
  return generateSync({
    secret: secreto,
    strategy: 'totp',
    algorithm: 'sha1',
    digits: 6,
    period: 30,
    epoch: Math.floor(instante.getTime() / 1000),
  });
}

const cookieDe = (res: Respuesta) => ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []).at(0)?.split(';')[0] ?? '';

function conectarSocket(url: string, cookie?: string): Promise<{ socket: Socket; eventos: [string, unknown][]; conectado: boolean }> {
  const headers: Record<string, string> = { origin: ORIGEN_APP };
  if (cookie) headers.cookie = cookie;
  const socket = conectar(url, { transports: ['websocket'], reconnection: false, extraHeaders: headers });
  abiertos.push(socket);
  const eventos: [string, unknown][] = [];
  socket.onAny((nombre: string, carga: unknown) => eventos.push([nombre, carga]));
  return new Promise((resolver) => {
    socket.on('connect', () => resolver({ socket, eventos, conectado: true }));
    socket.on('connect_error', () => resolver({ socket, eventos, conectado: false }));
  });
}

async function esperar(condicion: () => boolean, ms = 4000): Promise<void> {
  const limite = Date.now() + ms;
  while (!condicion()) {
    if (Date.now() > limite) throw new Error('Se agotó la espera de la condición.');
    await new Promise((r) => setTimeout(r, 10));
  }
}

beforeEach(() => {
  entorno.lineas.length = 0;
});

describe('los logs no contienen datos personales ni secretos (RNF-08)', () => {
  it('el flujo completo de la aplicación no deja ningún dato sensible en el log', async () => {
    const { llamar, sensibles, agregar } = recolector();
    const estados: Record<string, number> = {};
    const anotar = (etiqueta: string, res: Respuesta, esperado: number) => {
      estados[etiqueta] = res.status;
      expect(res.status, `${etiqueta}: ${(res.text ?? "").slice(0, 200)}`).toBe(esperado);
      return res;
    };

    await db.consultorio.create({
      data: { id: 1, nombre: 'Consultorio Ficticio', direccion: 'Calle Falsa 123', telefono: '11 5555 0000' },
    });
    const admin = await crearUsuario({
      rol: 'administrador',
      nombreUsuario: ADMIN,
      hashContrasena: await hashearContrasena(CLAVE_ADMIN),
    });

    // --- Administrador: ingreso fallido, ingreso, activación del segundo factor ---------------------
    anotar('ingreso fallido', await llamar('post', '/api/sesion', { cuerpo: { nombreUsuario: ADMIN, contrasena: CLAVE_EQUIVOCADA } }), 401);
    anotar('ingreso de usuario inexistente', await llamar('post', '/api/sesion', { cuerpo: { nombreUsuario: 'no-existe-quimera', contrasena: CLAVE_EQUIVOCADA } }), 401);
    const ingresoAdmin = anotar('ingreso admin', await llamar('post', '/api/sesion', { cuerpo: { nombreUsuario: ADMIN, contrasena: CLAVE_ADMIN } }), 200);
    expect(ingresoAdmin.body.pasoPendiente).toBe('activar_segundo_factor');
    const cookieAdmin = cookieDe(ingresoAdmin);
    anotar('sesión', await llamar('get', '/api/sesion', { cookie: cookieAdmin }), 200);
    const activacion = anotar('activación', await llamar('post', '/api/sesion/segundo-factor/activacion', { cookie: cookieAdmin, cuerpo: {} }), 200);
    const pendiente = await db.usuario.findUniqueOrThrow({ where: { id: admin.id } });
    const secreto = descifrarSecreto(pendiente.secretoTotpCifrado ?? '', Buffer.from(CLAVE_CIFRADO_PRUEBA, 'base64'), admin.id);
    agregar(secreto, 'secreto TOTP');
    agregar(uriOtpauth(secreto, ADMIN), 'URI otpauth');
    agregar(activacion.body.qr, 'QR del segundo factor');
    agregar(pendiente.secretoTotpCifrado, 'secreto TOTP cifrado');
    anotar('confirmación con código malo', await llamar('post', '/api/sesion/segundo-factor/activacion/confirmar', { cookie: cookieAdmin, cuerpo: { codigo: '000000' } }), 400);
    const codigoActivacion = codigoTotp(secreto, entorno.reloj.ahora());
    agregar(codigoActivacion, 'código TOTP');
    const confirmacion = anotar('confirmación', await llamar('post', '/api/sesion/segundo-factor/activacion/confirmar', { cookie: cookieAdmin, cuerpo: { codigo: codigoActivacion } }), 200);
    for (const codigo of confirmacion.body.codigosRecuperacion as string[]) agregar(codigo, 'código de recuperación');

    // --- Administrador: datos del consultorio, kinesiólogo y cuentas -------------------------------
    anotar('consultorio (GET)', await llamar('get', '/api/consultorio', { cookie: cookieAdmin }), 200);
    anotar('consultorio (PUT)', await llamar('put', '/api/consultorio', { cookie: cookieAdmin, cuerpo: { nombre: 'Consultorio Ficticio', direccion: 'Calle Falsa 123', telefono: '11 5555 0000' } }), 200);
    const kine = anotar('alta de kinesiólogo', await llamar('post', '/api/kinesiologos', {
      cookie: cookieAdmin,
      cuerpo: { nombre: KINESIOLOGO, bloque: 'manana', nombreUsuario: KINE, contrasenaTemporal: TEMPORAL_KINE },
    }), 201);
    const kinesiologoId = (kine.body.kinesiologo as { id: number }).id;
    anotar('kinesiólogos (GET)', await llamar('get', '/api/kinesiologos', { cookie: cookieAdmin }), 200);
    anotar('bloque del kinesiólogo', await llamar('put', `/api/kinesiologos/${kinesiologoId}/bloque`, { cookie: cookieAdmin, cuerpo: { bloque: 'manana' } }), 200);
    const cuenta = anotar('alta de cuenta', await llamar('post', '/api/cuentas', {
      cookie: cookieAdmin,
      cuerpo: { nombreUsuario: SECRETARIA, contrasenaTemporal: TEMPORAL_SECRETARIA },
    }), 201);
    const cuentaId = (cuenta.body.cuenta as { id: number }).id;
    anotar('alta de cuenta repetida', await llamar('post', '/api/cuentas', { cookie: cookieAdmin, cuerpo: { nombreUsuario: SECRETARIA, contrasenaTemporal: TEMPORAL_SECRETARIA } }), 409);
    anotar('cuentas (GET)', await llamar('get', '/api/cuentas', { cookie: cookieAdmin }), 200);
    anotar('restablecimiento', await llamar('post', `/api/cuentas/${cuentaId}/restablecimiento`, { cookie: cookieAdmin, cuerpo: { contrasenaTemporal: TEMPORAL_SECRETARIA } }), 204);

    // --- Administrador: cierra y vuelve a ingresar con el segundo factor -------------------------
    anotar('cierre de sesión', await llamar('delete', '/api/sesion', { cookie: cookieAdmin }), 204);
    const reingreso = anotar('reingreso admin', await llamar('post', '/api/sesion', { cuerpo: { nombreUsuario: ADMIN, contrasena: CLAVE_ADMIN } }), 200);
    expect(reingreso.body.pasoPendiente).toBe('verificar_segundo_factor');
    const cookieAdmin2 = cookieDe(reingreso);
    anotar('verificación con código malo', await llamar('post', '/api/sesion/segundo-factor/verificar', { cookie: cookieAdmin2, cuerpo: { codigo: '000000' } }), 403);
    entorno.reloj.avanzar(60_000);
    const codigoVerificar = codigoTotp(secreto, entorno.reloj.ahora());
    agregar(codigoVerificar, 'código TOTP');
    anotar('verificación', await llamar('post', '/api/sesion/segundo-factor/verificar', { cookie: cookieAdmin2, cuerpo: { codigo: codigoVerificar } }), 204);
    anotar('desactivación', await llamar('post', `/api/cuentas/${cuentaId}/desactivacion`, { cookie: cookieAdmin2, cuerpo: {} }), 204);
    // La cuenta de la secretaría se reactiva a mano: la API no reactiva (RF-09), la prueba la necesita.
    await db.usuario.update({ where: { id: cuentaId }, data: { activo: true } });

    // --- Secretaría: ingreso con la clave temporal y cambio de contraseña --------------------------
    const ingresoSecretaria = anotar('ingreso secretaría', await llamar('post', '/api/sesion', { cuerpo: { nombreUsuario: SECRETARIA, contrasena: TEMPORAL_SECRETARIA } }), 200);
    expect(ingresoSecretaria.body.pasoPendiente).toBe('cambiar_contrasena');
    const cookieTemporal = cookieDe(ingresoSecretaria);
    anotar('cambio con clave actual equivocada', await llamar('put', '/api/sesion/contrasena', { cookie: cookieTemporal, cuerpo: { contrasenaActual: CLAVE_EQUIVOCADA, contrasenaNueva: NUEVA_SECRETARIA } }), 403);
    anotar('cambio de contraseña', await llamar('put', '/api/sesion/contrasena', { cookie: cookieTemporal, cuerpo: { contrasenaActual: TEMPORAL_SECRETARIA, contrasenaNueva: NUEVA_SECRETARIA } }), 204);
    const sesionSecretaria = anotar('reingreso secretaría', await llamar('post', '/api/sesion', { cuerpo: { nombreUsuario: SECRETARIA, contrasena: NUEVA_SECRETARIA } }), 200);
    const cookieSecretaria = cookieDe(sesionSecretaria);

    // --- Secretaría: pacientes ------------------------------------------------------------------
    const datosPaciente = { dni: DNI_CON_PUNTOS, nombre: NOMBRE, telefono: TELEFONO, obraSocial: OBRA_SOCIAL };
    const alta = anotar('alta de paciente', await llamar('post', '/api/pacientes', { cookie: cookieSecretaria, cuerpo: datosPaciente }), 201);
    const pacienteId = (alta.body.paciente as { id: number }).id;
    expect(alta.body.paciente.dni).toBe(DNI);
    anotar('alta repetida (409)', await llamar('post', '/api/pacientes', { cookie: cookieSecretaria, cuerpo: datosPaciente }), 409);
    anotar('alta con DNI inválido (400)', await llamar('post', '/api/pacientes', { cookie: cookieSecretaria, cuerpo: { ...datosPaciente, dni: `${DNI}0000`, nombre: '' } }), 400);
    anotar('alta con NUL (400)', await llamar('post', '/api/pacientes', { cookie: cookieSecretaria, cuerpo: { ...datosPaciente, nombre: `${NOMBRE}\u0000` } }), 400);
    const porDni = anotar('búsqueda por DNI', await llamar('get', `/api/pacientes?dni=${encodeURIComponent(DNI_CON_PUNTOS)}`, { cookie: cookieSecretaria }), 200);
    expect(porDni.body.pacientes).toHaveLength(1);
    anotar('búsqueda por DNI inválido', await llamar('get', `/api/pacientes?dni=${DNI}x`, { cookie: cookieSecretaria }), 400);
    const porNombre = anotar('búsqueda por nombre', await llamar('get', '/api/pacientes?nombre=Quillfeather', { cookie: cookieSecretaria }), 200);
    expect(porNombre.body.pacientes).toHaveLength(1);
    anotar('ficha', await llamar('get', `/api/pacientes/${pacienteId}`, { cookie: cookieSecretaria }), 200);
    anotar('paciente inexistente (404)', await llamar('get', '/api/pacientes/99999', { cookie: cookieSecretaria }), 404);
    anotar('edición', await llamar('put', `/api/pacientes/${pacienteId}`, { cookie: cookieSecretaria, cuerpo: { dni: DNI, nombre: NOMBRE_EDITADO, telefono: TELEFONO_EDITADO, obraSocial: OBRA_SOCIAL_EDITADA } }), 200);
    anotar('edición de inexistente (404)', await llamar('put', '/api/pacientes/99999', { cookie: cookieSecretaria, cuerpo: { dni: DNI, nombre: NOMBRE, telefono: TELEFONO, obraSocial: OBRA_SOCIAL } }), 404);
    const obras = anotar('obras sociales', await llamar('get', '/api/obras-sociales', { cookie: cookieSecretaria }), 200);
    expect(obras.body.obrasSociales).toContain(OBRA_SOCIAL_EDITADA);

    // --- Secretaría: turnos ---------------------------------------------------------------------
    anotar('disponibilidad', await llamar('get', `/api/disponibilidad?fecha=${FECHA}&bloque=manana&pacienteId=${pacienteId}`, { cookie: cookieSecretaria }), 200);
    const turno = anotar('asignar con coseguro abonado', await llamar('post', '/api/turnos', {
      cookie: cookieSecretaria,
      cuerpo: { pacienteId, kinesiologoId, fecha: FECHA, horaInicio: '08:00', coseguroAbonado: MONTO },
    }), 201);
    const turnoId = (turno.body.turno as { id: number }).id;
    expect(turno.body.turno.coseguroAbonado).toBe(MONTO);
    anotar('asignar en franja ocupada (409)', await llamar('post', '/api/turnos', { cookie: cookieSecretaria, cuerpo: { pacienteId, kinesiologoId, fecha: FECHA, horaInicio: '08:00' } }), 409);
    anotar('asignar sin paciente (400)', await llamar('post', '/api/turnos', { cookie: cookieSecretaria, cuerpo: { kinesiologoId, fecha: FECHA, horaInicio: '08:00' } }), 400);
    const agenda = anotar('agenda de la secretaría', await llamar('get', `/api/agenda?fecha=${FECHA}`, { cookie: cookieSecretaria }), 200);
    expect(agenda.body.recaudado).toBe(MONTO);
    anotar('pendientes', await llamar('get', '/api/agenda/pendientes', { cookie: cookieSecretaria }), 200);

    // --- Tiempo real: la secretaría y el kinesiólogo escuchan y reciben el cambio ------------------
    const ingresoKine = anotar('ingreso kinesiólogo', await llamar('post', '/api/sesion', { cuerpo: { nombreUsuario: KINE, contrasena: TEMPORAL_KINE } }), 200);
    expect(ingresoKine.body.pasoPendiente).toBe('cambiar_contrasena');
    anotar('cambio de contraseña del kinesiólogo', await llamar('put', '/api/sesion/contrasena', { cookie: cookieDe(ingresoKine), cuerpo: { contrasenaActual: TEMPORAL_KINE, contrasenaNueva: NUEVA_KINE } }), 204);
    const sesionKine = anotar('reingreso kinesiólogo', await llamar('post', '/api/sesion', { cuerpo: { nombreUsuario: KINE, contrasena: NUEVA_KINE } }), 200);
    const cookieKine = cookieDe(sesionKine);

    const rechazado = await conectarSocket(entorno.url);
    expect(rechazado.conectado).toBe(false);
    const deSecretaria = await conectarSocket(entorno.url, cookieSecretaria);
    const deKine = await conectarSocket(entorno.url, cookieKine);
    expect(deSecretaria.conectado && deKine.conectado).toBe(true);

    anotar('en espera', await llamar('post', `/api/turnos/${turnoId}/transicion`, { cookie: cookieSecretaria, cuerpo: { hacia: 'en_espera' } }), 200);
    anotar('transición no permitida (409)', await llamar('post', `/api/turnos/${turnoId}/transicion`, { cookie: cookieSecretaria, cuerpo: { hacia: 'en_espera' } }), 409);
    anotar('corrección', await llamar('post', `/api/turnos/${turnoId}/correccion`, { cookie: cookieSecretaria, cuerpo: { estado: 'reservado' } }), 200);
    anotar('reprogramar', await llamar('put', `/api/turnos/${turnoId}/ubicacion`, { cookie: cookieSecretaria, cuerpo: { kinesiologoId, fecha: FECHA, horaInicio: '08:45' } }), 200);
    anotar('registrar abono', await llamar('put', `/api/turnos/${turnoId}/abono`, { cookie: cookieSecretaria, cuerpo: { monto: MONTO_EDITADO } }), 200);
    anotar('abono de turno inexistente (404)', await llamar('put', '/api/turnos/99999/abono', { cookie: cookieSecretaria, cuerpo: { monto: MONTO } }), 404);
    await esperar(() => deSecretaria.eventos.filter(([n]) => n === 'turno:cambio').length >= 4 && deKine.eventos.filter(([n]) => n === 'turno:cambio').length >= 4);
    // La difusión sí lleva los datos al cliente (la secretaría ve el monto y el kinesiólogo no).
    expect(JSON.stringify(deSecretaria.eventos)).toContain(MONTO_EDITADO);
    expect(JSON.stringify(deKine.eventos)).not.toContain(MONTO_EDITADO);

    const ticket = await llamar('get', `/api/turnos/${turnoId}/ticket`, { cookie: cookieSecretaria });
    anotar('ticket PDF', ticket, 200);
    expect(ticket.headers['content-type']).toBe('application/pdf');
    anotar('ficha con turnos', await llamar('get', `/api/pacientes/${pacienteId}/turnos`, { cookie: cookieSecretaria }), 200);

    // --- Kinesiólogo: su agenda, y lo que no puede ver --------------------------------------------
    const miAgenda = anotar('agenda del kinesiólogo', await llamar('get', `/api/mi-agenda?fecha=${FECHA}`, { cookie: cookieKine }), 200);
    expect(JSON.stringify(miAgenda.body)).toContain('Quillfeather');
    anotar('agenda ajena (403)', await llamar('get', `/api/agenda?fecha=${FECHA}`, { cookie: cookieKine }), 403);
    anotar('pacientes (403)', await llamar('get', `/api/pacientes?dni=${DNI}`, { cookie: cookieKine }), 403);
    anotar('sin sesión (401)', await llamar('get', `/api/pacientes?dni=${DNI}`), 401);
    anotar('origen ajeno (403)', await llamar('post', '/api/pacientes', { cookie: cookieSecretaria, cuerpo: datosPaciente, origen: 'http://otro.example' }), 403);
    anotar('JSON inválido (400)', await llamar('post', '/api/pacientes', { cookie: cookieSecretaria, crudo: `{"dni":"${DNI}","nombre":"${NOMBRE}"` }), 400);
    anotar('cuerpo enorme (413)', await llamar('post', '/api/pacientes', { cookie: cookieSecretaria, crudo: JSON.stringify({ dni: DNI, nombre: 'x'.repeat(150_000) }) }), 413);
    anotar('ruta inexistente (404)', await llamar('get', '/api/no-existe', { cookie: cookieSecretaria }), 404);

    // --- Cierre de sesión con el socket abierto -----------------------------------------------------
    anotar('cierre de la secretaría', await llamar('delete', '/api/sesion', { cookie: cookieSecretaria }), 204);
    await esperar(() => deSecretaria.eventos.some(([n]) => n === 'sesion:cerrada'));

    // --- Comprobaciones sobre el log --------------------------------------------------------------
    const registros = entorno.registros();
    const mensajes = new Set(registros.map((r) => r.msg));
    // La prueba no pasa en vacío: el log tiene las peticiones del flujo y los eventos de tiempo real.
    expect(registros.filter((r) => r.msg === 'petición').length).toBeGreaterThanOrEqual(Object.keys(estados).length);
    expect([...mensajes]).toEqual(expect.arrayContaining(['petición', 'socket conectado', 'conexión de socket rechazada', 'socket cerrado por la sesión']));
    for (const registro of registros.filter((r) => r.msg === 'petición')) {
      expect(String(registro.ruta), 'ruta registrada sin parámetros de consulta').not.toContain('?');
      expect(Object.keys(registro).sort()).toEqual(['duracionMs', 'estado', 'level', 'metodo', 'msg', 'ruta', 'time']);
    }
    expect(sensibles.size).toBeGreaterThan(40);
    expect(filtraciones(entorno.lineas, sensibles)).toEqual([]);
  }, 180_000);

  it('un error interno cuyo mensaje copia datos personales no los deja en el log', async () => {
    const { llamar, sensibles } = recolector();
    await db.consultorio.create({
      data: { id: 1, nombre: 'Consultorio Ficticio', direccion: 'Calle Falsa 123', telefono: '11 5555 0000' },
    });
    await crearUsuario({
      rol: 'secretaria',
      nombreUsuario: SECRETARIA,
      hashContrasena: await hashearContrasena(NUEVA_SECRETARIA),
    });
    const ingreso = await llamar('post', '/api/sesion', { cuerpo: { nombreUsuario: SECRETARIA, contrasena: NUEVA_SECRETARIA } });
    expect(ingreso.status).toBe(200);
    const cookie = cookieDe(ingreso);

    const errores: Record<string, Error> = {
      'Prisma con el DNI y el nombre en el mensaje': errorDePrismaConDatos(DNI, NOMBRE),
      'error común sin datos': new Error('fallo interno sin datos personales'),
    };
    for (const [tipo, error] of Object.entries(errores)) {
      const roto = await armarEntorno({ base: baseQueFalla(error) });
      try {
        const pedidos = [
          await pedir(roto, 'get', `/api/pacientes?dni=${DNI}`, { cookie }),
          await pedir(roto, 'get', `/api/pacientes?nombre=Quillfeather`, { cookie }),
          await pedir(roto, 'post', '/api/pacientes', { cookie, cuerpo: { dni: DNI, nombre: NOMBRE, telefono: TELEFONO, obraSocial: OBRA_SOCIAL } }),
          await pedir(roto, 'post', '/api/turnos', { cookie, cuerpo: { pacienteId: 1, kinesiologoId: 1, fecha: FECHA, horaInicio: '08:00', coseguroAbonado: MONTO } }),
          await pedir(roto, 'put', '/api/turnos/1/abono', { cookie, cuerpo: { monto: MONTO } }),
        ];
        for (const res of pedidos) expect(res.status, tipo).toBe(500);
        const errores500 = roto.registros().filter((r) => r.msg === 'error no controlado');
        expect(errores500, tipo).toHaveLength(pedidos.length);
        // Del error de Prisma queda el tipo y el código, no el mensaje.
        if (tipo.startsWith('Prisma')) {
          expect(errores500[0]?.err).toMatchObject({ type: 'PrismaClientKnownRequestError', code: 'P1008' });
        }
        expect(filtraciones(roto.lineas, sensibles), tipo).toEqual([]);
      } finally {
        await roto.cerrar();
      }
    }
    expect(filtraciones(entorno.lineas, sensibles)).toEqual([]);
  }, 120_000);

  it('autoprueba: la búsqueda detecta un valor sensible, también en minúsculas, codificado y en un objeto', () => {
    const sensibles: Sensibles = new Map([
      [DNI, 'DNI'],
      [NOMBRE, 'nombre'],
      ['token-secreto-123', 'token'],
    ]);
    const linea = (o: object) => JSON.stringify({ time: 1760000000000, ...o });

    expect(filtraciones([linea({ msg: 'petición', ruta: '/api/pacientes', estado: 200 })], sensibles)).toEqual([]);
    expect(filtraciones([linea({ msg: `buscando ${DNI}` })], sensibles)).toHaveLength(1);
    expect(filtraciones([linea({ msg: 'x', cuerpo: { paciente: { dni: DNI } } })], sensibles)).toHaveLength(1);
    expect(filtraciones([linea({ msg: encodeURIComponent(NOMBRE) })], sensibles)).not.toEqual([]);
    expect(filtraciones([linea({ msg: NOMBRE.toLowerCase() })], sensibles)).not.toEqual([]);
    expect(filtraciones([linea({ msg: 'sesion=token-secreto-123' })], sensibles)).toHaveLength(1);
    // La marca de tiempo no cuenta: son dígitos que pueden coincidir con un código por casualidad.
    expect(filtraciones([JSON.stringify({ time: Number(`1${DNI}`), msg: 'x' })], sensibles)).toEqual([]);
  });
});
