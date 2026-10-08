import request from 'supertest';
import type { Bloque, EstadoTurno, Rol } from '../../src/generado/prisma/client.js';
import { hashearContrasena } from '../../src/modulos/m1-identidad/contrasenas.js';
import { hashDeToken } from '../../src/modulos/m1-identidad/servicio.js';
import { cifrarSecreto, generarSecretoTotp } from '../../src/modulos/m1-identidad/segundoFactor.js';
import { CLAVE_CIFRADO_PRUEBA, ORIGEN_APP } from '../ayudantes.js';
import { db } from './base.js';

/**
 * Fábricas de datos ficticios para las pruebas de integración. Nunca se usan datos reales de
 * pacientes: los DNI empiezan en 90.000.000 y los nombres son genéricos.
 */

/** Instante fijo para las marcas de tiempo, como haría el reloj inyectable. */
export const AHORA = new Date('2026-10-07T12:00:00Z');

let secuencia = 0;
const siguiente = () => ++secuencia;

export function reiniciarFabricas(): void {
  secuencia = 0;
}

export async function crearUsuario(
  datos: {
    rol?: Rol;
    nombreUsuario?: string;
    hashContrasena?: string;
    activo?: boolean;
    debeCambiarContrasena?: boolean;
    totpActivo?: boolean;
  } = {},
) {
  const n = siguiente();
  return db.usuario.create({
    data: {
      nombreUsuario: datos.nombreUsuario ?? `usuario${n}`,
      hashContrasena: datos.hashContrasena ?? 'hash-ficticio',
      rol: datos.rol ?? 'secretaria',
      activo: datos.activo ?? true,
      // Por defecto la cuenta ficticia ya eligió su contraseña: la marca (RF-06) bloquea toda ruta.
      debeCambiarContrasena: datos.debeCambiarContrasena ?? false,
      totpActivo: datos.totpActivo ?? false,
      creadoEn: AHORA,
    },
  });
}

/** Contraseña de las cuentas que crea `ingresarComoAdministradorVerificado`. */
export const CONTRASENA_ADMINISTRADOR_VERIFICADO = 'clave-de-prueba-larga';

// Argon2 es lento a propósito: se calcula una vez y se reutiliza.
let hashAdministrador: Promise<string> | undefined;

/**
 * Deja una sesión de administrador lista para usar rutas de negocio (RNF-04): crea la cuenta con el
 * segundo factor activo (secreto cifrado con la clave de prueba), ingresa por la API real y marca la
 * sesión como verificada en la base. Desde que el administrador exige el segundo factor, toda prueba
 * que necesite una sesión de administrador completa debe usar esta función y no debilitar el
 * middleware. No hace falta que `app` tenga `CLAVE_CIFRADO`.
 */
export async function ingresarComoAdministradorVerificado(
  app: Parameters<typeof request>[0],
  datos: { nombreUsuario?: string } = {},
) {
  hashAdministrador ??= hashearContrasena(CONTRASENA_ADMINISTRADOR_VERIFICADO);
  const base = await crearUsuario({
    rol: 'administrador',
    nombreUsuario: datos.nombreUsuario,
    hashContrasena: await hashAdministrador,
    totpActivo: true,
  });
  const clave = Buffer.from(CLAVE_CIFRADO_PRUEBA, 'base64');
  const usuario = await db.usuario.update({
    where: { id: base.id },
    data: { secretoTotpCifrado: cifrarSecreto(generarSecretoTotp(), clave, base.id) },
  });
  const res = await request(app)
    .post('/api/sesion')
    .set('Origin', ORIGEN_APP)
    .send({ nombreUsuario: usuario.nombreUsuario, contrasena: CONTRASENA_ADMINISTRADOR_VERIFICADO });
  if (res.status !== 200) throw new Error(`El ingreso del administrador de prueba dio ${res.status}.`);
  // Se exige el paso real antes de marcar la sesión: si el ingreso ya no pide el segundo factor, esta
  // función no debe tapar el cambio.
  if (res.body?.pasoPendiente !== 'verificar_segundo_factor') {
    throw new Error('El ingreso del administrador de prueba no pidió verificar el segundo factor.');
  }
  const token = /^sesion=([^;]*)/.exec((res.headers['set-cookie'] as string[] | undefined)?.[0] ?? '')?.[1];
  if (!token) throw new Error('El ingreso no trajo cookie.');
  await db.sesion.update({ where: { hashToken: hashDeToken(token) }, data: { segundoFactorVerificado: true } });
  return { usuario, token, cookie: `sesion=${token}` };
}

export async function crearKinesiologo(datos: { bloque?: Bloque } = {}) {
  const usuario = await crearUsuario({ rol: 'kinesiologo' });
  return db.kinesiologo.create({
    data: {
      usuarioId: usuario.id,
      nombre: `Kinesiólogo Ficticio ${usuario.id}`,
      bloque: datos.bloque ?? 'manana',
    },
  });
}

export async function crearPaciente(datos: { dni?: string } = {}) {
  const n = siguiente();
  return db.paciente.create({
    data: {
      dni: datos.dni ?? String(90_000_000 + n),
      nombre: `Paciente Ficticio ${n}`,
      telefono: `11 5555 ${String(n).padStart(4, '0')}`,
      obraSocial: 'Particular',
    },
  });
}

export interface DatosTurno {
  pacienteId?: number;
  kinesiologoId?: number;
  creadoPorId?: number;
  /** "AAAA-MM-DD". Por defecto, un lunes. */
  fecha?: string;
  horaInicio?: string;
  estado?: EstadoTurno;
}

export async function crearTurno(datos: DatosTurno = {}) {
  const pacienteId = datos.pacienteId ?? (await crearPaciente()).id;
  const kinesiologoId = datos.kinesiologoId ?? (await crearKinesiologo()).id;
  const creadoPorId = datos.creadoPorId ?? (await crearUsuario()).id;
  return db.turno.create({
    data: {
      pacienteId,
      kinesiologoId,
      creadoPorId,
      fecha: new Date(datos.fecha ?? '2026-10-12'),
      horaInicio: datos.horaInicio ?? '08:00',
      estado: datos.estado ?? 'reservado',
      creadoEn: AHORA,
    },
  });
}
