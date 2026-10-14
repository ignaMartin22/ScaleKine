import type { BaseDeDatos } from '../../comun/baseDeDatos.js';
import { ErrorNegocio } from '../../comun/errores.js';
import type { Reloj } from '../../comun/reloj.js';
import { franjasDelDia } from '../m2-maestros/grilla.js';
import { validarTransicion, type EstadoTurno, type Rol } from './transiciones.js';

/** Datos que la secretaría elige al asignar (RF-23). El autor no viene acá: sale de la sesión. */
export interface DatosAsignacion {
  pacienteId: number;
  kinesiologoId: number;
  /** Fecha calendario 'AAAA-MM-DD' en la zona del consultorio. */
  fecha: string;
  /** Hora de inicio de la franja, 'HH:MM'. */
  horaInicio: string;
  /** Montos decimales en pesos, como texto ('1500.50'); ausente o null = sin cargar (RF-27). */
  coseguroObraSocial?: string | null | undefined;
  coseguroAdicional?: string | null | undefined;
}

/** Turno recién asignado. Los montos van como texto decimal con dos decimales. */
export interface TurnoAsignado {
  id: number;
  pacienteId: number;
  kinesiologoId: number;
  fecha: string;
  horaInicio: string;
  estado: 'reservado';
  coseguroObraSocial: string | null;
  coseguroAdicional: string | null;
}

/** Turno tras una transición o una corrección. `llegadaEn` es ISO 8601 en UTC, o null (RF-30). */
export interface TurnoActualizado {
  id: number;
  pacienteId: number;
  kinesiologoId: number;
  fecha: string;
  horaInicio: string;
  estado: EstadoTurno;
  llegadaEn: string | null;
  coseguroObraSocial: string | null;
  coseguroAdicional: string | null;
}

/** Índices únicos parciales de la migración `restricciones_manuales` (plan.md §2.3). */
export const INDICE_FRANJA_DEL_KINESIOLOGO = 'Turno_kinesiologo_franja_activa_key';
export const INDICE_FRANJA_DEL_PACIENTE = 'Turno_paciente_franja_activa_key';

interface ErrorConIndice {
  code?: unknown;
  meta?: { driverAdapterError?: { cause?: { constraint?: { index?: unknown } } } };
}

/**
 * Nombre del índice único que violó `err`, o `null` si no es una violación de unicidad (P2002).
 * Con el adaptador de node-postgres, Prisma informa el índice en `meta.driverAdapterError`.
 */
function indiceViolado(err: unknown): string | null {
  if (typeof err !== 'object' || err === null || (err as ErrorConIndice).code !== 'P2002') return null;
  const indice = (err as ErrorConIndice).meta?.driverAdapterError?.cause?.constraint?.index;
  return typeof indice === 'string' ? indice : '';
}

const errorPacienteNoEncontrado = () => new ErrorNegocio('paciente_no_encontrado', 'El paciente no existe.', 404);
const errorKinesiologoNoEncontrado = () =>
  new ErrorNegocio('kinesiologo_no_encontrado', 'El kinesiólogo no existe.', 404);
const errorFranjaInvalida = () =>
  new ErrorNegocio(
    'franja_invalida',
    'La franja no es una de la grilla del bloque del kinesiólogo para esa fecha.',
    400,
  );
const errorFranjaOcupada = () =>
  new ErrorNegocio('franja_ocupada', 'La franja ya tiene un turno activo de ese kinesiólogo.', 409);
const errorPacienteOcupado = () =>
  new ErrorNegocio('paciente_con_turno_en_franja', 'El paciente ya tiene un turno activo en esa franja.', 409);

const errorTurnoNoEncontrado = () => new ErrorNegocio('turno_no_encontrado', 'El turno no existe.', 404);
const errorTurnoModificado = () =>
  new ErrorNegocio(
    'turno_modificado',
    'El turno cambió de estado mientras se procesaba la acción. Actualizá la pantalla y volvé a intentar.',
    409,
  );
const errorMismoEstado = () =>
  new ErrorNegocio('correccion_sin_cambio', 'El turno ya está en ese estado: no hay nada que corregir.', 409);

/** Traduce la violación de un índice de franja activa al rechazo de negocio (RF-24, RF-25, RF-37). */
function traducirOcupacion(err: unknown): never {
  const indice = indiceViolado(err);
  if (indice === INDICE_FRANJA_DEL_KINESIOLOGO) throw errorFranjaOcupada();
  if (indice === INDICE_FRANJA_DEL_PACIENTE) throw errorPacienteOcupado();
  throw err;
}

interface FilaTurno {
  id: number;
  pacienteId: number;
  kinesiologoId: number;
  fecha: Date;
  horaInicio: string;
  estado: EstadoTurno;
  llegadaEn: Date | null;
  coseguroObraSocial: { toFixed(n: number): string } | null;
  coseguroAdicional: { toFixed(n: number): string } | null;
}

function aActualizado(t: FilaTurno): TurnoActualizado {
  return {
    id: t.id,
    pacienteId: t.pacienteId,
    kinesiologoId: t.kinesiologoId,
    fecha: t.fecha.toISOString().slice(0, 10),
    horaInicio: t.horaInicio,
    estado: t.estado,
    llegadaEn: t.llegadaEn?.toISOString() ?? null,
    coseguroObraSocial: t.coseguroObraSocial?.toFixed(2) ?? null,
    coseguroAdicional: t.coseguroAdicional?.toFixed(2) ?? null,
  };
}

/**
 * Ciclo de vida del turno (M3). Es el único módulo que escribe turnos, y cada escritura registra su
 * `TurnoEvento` en la misma transacción (RF-46). Quién puede llamar lo decide la ruta.
 */
export function crearServicioTurnos({ db, reloj }: { db: BaseDeDatos; reloj: Reloj }) {
  return {
    /**
     * Asigna un turno en `reservado` (RF-23). Admite fechas vencidas. La ocupación de la franja la
     * decide la base, con los índices únicos parciales: se atrapa la violación y se traduce según el
     * índice (RF-24, RF-25), sin una consulta previa que una carrera pueda dejar desactualizada.
     * `autorId` es el de la sesión.
     */
    async asignar(datos: DatosAsignacion, autorId: number): Promise<TurnoAsignado> {
      const [paciente, kinesiologo] = await Promise.all([
        db.paciente.findUnique({ where: { id: datos.pacienteId }, select: { id: true } }),
        db.kinesiologo.findUnique({ where: { id: datos.kinesiologoId }, select: { id: true, bloque: true, usuario: { select: { activo: true } } } }),
      ]);
      if (!paciente) throw errorPacienteNoEncontrado();
      // Con la cuenta desactivada (RF-09), para asignar es como si no existiera (RF-23).
      if (!kinesiologo || !kinesiologo.usuario.activo) throw errorKinesiologoNoEncontrado();
      // Solo franjas de la grilla del bloque del kinesiólogo, de lunes a viernes (RF-15).
      if (!franjasDelDia(datos.fecha, kinesiologo.bloque).some((f) => f.inicio === datos.horaInicio)) {
        throw errorFranjaInvalida();
      }

      const ahora = reloj.ahora();
      try {
        const turno = await db.$transaction(async (tx) => {
          const creado = await tx.turno.create({
            data: {
              pacienteId: datos.pacienteId,
              kinesiologoId: datos.kinesiologoId,
              fecha: new Date(`${datos.fecha}T00:00:00Z`),
              horaInicio: datos.horaInicio,
              estado: 'reservado',
              coseguroObraSocial: datos.coseguroObraSocial ?? null,
              coseguroAdicional: datos.coseguroAdicional ?? null,
              creadoPorId: autorId,
              creadoEn: ahora,
            },
          });
          await tx.turnoEvento.create({
            data: { turnoId: creado.id, tipo: 'asignacion', autorId, ocurridoEn: ahora },
          });
          return creado;
        });
        return {
          id: turno.id,
          pacienteId: turno.pacienteId,
          kinesiologoId: turno.kinesiologoId,
          fecha: datos.fecha,
          horaInicio: turno.horaInicio,
          estado: 'reservado',
          coseguroObraSocial: turno.coseguroObraSocial?.toFixed(2) ?? null,
          coseguroAdicional: turno.coseguroAdicional?.toFixed(2) ?? null,
        };
      } catch (err) {
        return traducirOcupacion(err);
      }
    },

    /**
     * Flujo normal (RF-30 a RF-33): solo acepta las filas de `TRANSICIONES`. Al pasar a `en_espera`
     * registra `llegadaEn` con el reloj inyectable. La actualización está condicionada al estado
     * leído: si otro pedido lo cambió en el medio no afecta filas y se rechaza (409) sin evento, de
     * modo que `estadoAnterior` es siempre el verdadero. `autorId` y `rol` son los de la sesión.
     */
    async transicionar(turnoId: number, hacia: EstadoTurno, autorId: number, rol: Rol): Promise<TurnoActualizado> {
      const ahora = reloj.ahora();
      return db.$transaction(async (tx) => {
        const actual = await tx.turno.findUnique({ where: { id: turnoId }, select: { estado: true } });
        if (!actual) throw errorTurnoNoEncontrado();
        validarTransicion(rol, actual.estado, hacia);
        const { count } = await tx.turno.updateMany({
          where: { id: turnoId, estado: actual.estado },
          data: { estado: hacia, ...(hacia === 'en_espera' ? { llegadaEn: ahora } : {}) },
        });
        if (count !== 1) throw errorTurnoModificado();
        await tx.turnoEvento.create({
          data: {
            turnoId,
            tipo: 'cambio_estado',
            estadoAnterior: actual.estado,
            estadoNuevo: hacia,
            autorId,
            ocurridoEn: ahora,
          },
        });
        return aActualizado(await tx.turno.findUniqueOrThrow({ where: { id: turnoId } }));
      });
    },

    /**
     * Cambia los coseguros (RF-27) sin tocar estado ni franja. `null` deja el monto sin cargar. Registra
     * un evento `modificacion_coseguros` en la misma transacción (RF-46), sin estados ni montos
     * anteriores.
     */
    async modificarCoseguros(
      turnoId: number,
      coseguros: { coseguroObraSocial: string | null; coseguroAdicional: string | null },
      autorId: number,
    ): Promise<TurnoActualizado> {
      const ahora = reloj.ahora();
      return db.$transaction(async (tx) => {
        const { count } = await tx.turno.updateMany({ where: { id: turnoId }, data: coseguros });
        if (count !== 1) throw errorTurnoNoEncontrado();
        await tx.turnoEvento.create({
          data: { turnoId, tipo: 'modificacion_coseguros', autorId, ocurridoEn: ahora },
        });
        return aActualizado(await tx.turno.findUniqueOrThrow({ where: { id: turnoId } }));
      });
    },

    /**
     * Corrección (RF-35): lleva el turno a cualquier otro de los cinco estados, con evento
     * `correccion`. `llegadaEn` se limpia al volver a `reservado`; hacia `en_espera` se conserva la
     * que tenía o, si no tenía, se registra la hora de la corrección; en los demás casos se conserva.
     * Hacia un estado activo sobre una franja ocupada la base rechaza (RF-37) y no queda nada.
     */
    async corregir(turnoId: number, hacia: EstadoTurno, autorId: number): Promise<TurnoActualizado> {
      const ahora = reloj.ahora();
      try {
        return await db.$transaction(async (tx) => {
          const actual = await tx.turno.findUnique({
            where: { id: turnoId },
            select: { estado: true, llegadaEn: true },
          });
          if (!actual) throw errorTurnoNoEncontrado();
          if (actual.estado === hacia) throw errorMismoEstado();
          // Solo se escribe `llegadaEn` al limpiarla o al fijarla por primera vez: si se conserva, no
          // va en `data`, así no se pisa con un valor leído que otro pedido pudo haber cambiado.
          const llegadaEn =
            hacia === 'reservado' ? { llegadaEn: null } : hacia === 'en_espera' && !actual.llegadaEn ? { llegadaEn: ahora } : {};
          const { count } = await tx.turno.updateMany({
            where: { id: turnoId, estado: actual.estado },
            data: { estado: hacia, ...llegadaEn },
          });
          if (count !== 1) throw errorTurnoModificado();
          await tx.turnoEvento.create({
            data: {
              turnoId,
              tipo: 'correccion',
              estadoAnterior: actual.estado,
              estadoNuevo: hacia,
              autorId,
              ocurridoEn: ahora,
            },
          });
          return aActualizado(await tx.turno.findUniqueOrThrow({ where: { id: turnoId } }));
        });
      } catch (err) {
        return traducirOcupacion(err);
      }
    },
  };
}

export type ServicioTurnos = ReturnType<typeof crearServicioTurnos>;
