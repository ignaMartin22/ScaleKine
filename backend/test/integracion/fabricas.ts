import type { Bloque, EstadoTurno, Rol } from '../../src/generado/prisma/client.js';
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
  datos: { rol?: Rol; nombreUsuario?: string; hashContrasena?: string; activo?: boolean } = {},
) {
  const n = siguiente();
  return db.usuario.create({
    data: {
      nombreUsuario: datos.nombreUsuario ?? `usuario${n}`,
      hashContrasena: datos.hashContrasena ?? 'hash-ficticio',
      rol: datos.rol ?? 'secretaria',
      activo: datos.activo ?? true,
      creadoEn: AHORA,
    },
  });
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
