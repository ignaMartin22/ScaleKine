import type { BaseDeDatos } from '../../comun/baseDeDatos.js';
import { ErrorNegocio } from '../../comun/errores.js';
import type { Reloj } from '../../comun/reloj.js';
import { franjasDelDia } from '../m2-maestros/grilla.js';
import { EMISOR_NULO, type CambioDeTurno, type EmisorTurnos } from './eventos.js';
import { validarTransicion, type EstadoTurno, type Rol } from './transiciones.js';

/** Datos que la secretaría elige al asignar (RF-23). El autor no viene acá: sale de la sesión. */
export interface DatosAsignacion {
  pacienteId: number;
  kinesiologoId: number;
  /** Fecha calendario 'AAAA-MM-DD' en la zona del consultorio. */
  fecha: string;
  /** Hora de inicio de la franja, 'HH:MM'. */
  horaInicio: string;
  /** Monto decimal en pesos, como texto ('1500.50'); ausente o null = sin abonar (RF-27). */
  coseguroAbonado?: string | null | undefined;
}

/** Nueva ubicación que la secretaría elige al reprogramar (RF-36). El autor sale de la sesión. */
export interface DatosReprogramacion {
  kinesiologoId: number;
  /** Fecha calendario 'AAAA-MM-DD' en la zona del consultorio. */
  fecha: string;
  /** Hora de inicio de la franja, 'HH:MM'. */
  horaInicio: string;
}

/** Turno recién asignado. Los montos van como texto decimal con dos decimales. */
export interface TurnoAsignado {
  id: number;
  pacienteId: number;
  kinesiologoId: number;
  fecha: string;
  horaInicio: string;
  estado: 'reservado';
  coseguroAbonado: string | null;
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
  coseguroAbonado: string | null;
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
  new ErrorNegocio('kinesiologo_no_encontrado', 'El kinesiólogo no existe o tiene la cuenta desactivada.', 404);
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
const errorAbonoEnAnulado = () =>
  new ErrorNegocio('turno_anulado', 'Un turno anulado no admite registrar el coseguro abonado.', 409);
const errorTurnoModificado = () =>
  new ErrorNegocio(
    'turno_modificado',
    'El turno cambió de estado mientras se procesaba la acción. Actualizá la pantalla y volvé a intentar.',
    409,
  );
const errorNoReservado = () =>
  new ErrorNegocio('turno_no_reservado', 'Solo se puede reprogramar un turno reservado.', 409);
const errorMismaUbicacion = () =>
  new ErrorNegocio(
    'reprogramacion_sin_cambio',
    'El turno ya está en esa fecha, franja y kinesiólogo: no hay nada que reprogramar.',
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
  coseguroAbonado: { toFixed(n: number): string } | null;
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
    coseguroAbonado: t.coseguroAbonado?.toFixed(2) ?? null,
  };
}

/**
 * Ciclo de vida del turno (M3). Es el único módulo que escribe turnos, y cada escritura registra su
 * `TurnoEvento` en la misma transacción (RF-46). Quién puede llamar lo decide la ruta.
 */
export function crearServicioTurnos({
  db,
  reloj,
  emisor = EMISOR_NULO,
}: {
  db: BaseDeDatos;
  reloj: Reloj;
  /** Recibe un aviso por operación confirmada (nunca dentro de la transacción ni si falló). */
  emisor?: EmisorTurnos;
}) {
  /** Avisa tras el commit. Un fallo del receptor no cambia el resultado de una operación ya confirmada. */
  const avisar = (cambio: CambioDeTurno): void => {
    try {
      emisor.turnoCambiado(cambio);
    } catch {
      // La difusión es de mejor esfuerzo; el que difunde registra sus propios fallos.
    }
  };

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
              coseguroAbonado: datos.coseguroAbonado ?? null,
              creadoPorId: autorId,
              creadoEn: ahora,
            },
          });
          await tx.turnoEvento.create({
            data: { turnoId: creado.id, tipo: 'asignacion', autorId, ocurridoEn: ahora },
          });
          return creado;
        });
        avisar({ turnoId: turno.id, kinesiologoId: turno.kinesiologoId });
        return {
          id: turno.id,
          pacienteId: turno.pacienteId,
          kinesiologoId: turno.kinesiologoId,
          fecha: datos.fecha,
          horaInicio: turno.horaInicio,
          estado: 'reservado',
          coseguroAbonado: turno.coseguroAbonado?.toFixed(2) ?? null,
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
      const turno = await db.$transaction(async (tx) => {
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
      avisar({ turnoId, kinesiologoId: turno.kinesiologoId });
      return turno;
    },

    /**
     * Reprograma (RF-36): mueve el mismo turno `reservado` a otra fecha, franja o kinesiólogo; conserva
     * estado, paciente y abono, y no guarda la ubicación anterior (D-9): el evento `reprogramacion`
     * no lleva datos de ella (RF-46). Con un kinesiólogo inexistente o de cuenta desactivada, 404 (como
     * al asignar); la franja se valida contra la grilla del bloque del kinesiólogo de destino (RF-15).
     * Reprogramar a la misma ubicación exacta se rechaza (409), sin evento. La actualización está
     * condicionada al estado y a la ubicación leídos: si otro pedido los cambió en el medio, 409 sin
     * evento. La ocupación de la franja la deciden los índices únicos parciales (RF-24, RF-25, RF-37).
     * `autorId` es el de la sesión.
     */
    async reprogramar(turnoId: number, destino: DatosReprogramacion, autorId: number): Promise<TurnoActualizado> {
      const ahora = reloj.ahora();
      let resultado: { turno: TurnoActualizado; anteriorId: number };
      try {
        resultado = await db.$transaction(async (tx) => {
          const actual = await tx.turno.findUnique({
            where: { id: turnoId },
            select: { estado: true, kinesiologoId: true, fecha: true, horaInicio: true },
          });
          if (!actual) throw errorTurnoNoEncontrado();
          if (actual.estado !== 'reservado') throw errorNoReservado();
          const kinesiologo = await tx.kinesiologo.findUnique({
            where: { id: destino.kinesiologoId },
            select: { bloque: true, usuario: { select: { activo: true } } },
          });
          if (!kinesiologo || !kinesiologo.usuario.activo) throw errorKinesiologoNoEncontrado();
          if (!franjasDelDia(destino.fecha, kinesiologo.bloque).some((f) => f.inicio === destino.horaInicio)) {
            throw errorFranjaInvalida();
          }
          const nuevaFecha = new Date(`${destino.fecha}T00:00:00Z`);
          if (
            actual.kinesiologoId === destino.kinesiologoId &&
            actual.fecha.getTime() === nuevaFecha.getTime() &&
            actual.horaInicio === destino.horaInicio
          ) {
            throw errorMismaUbicacion();
          }
          const { count } = await tx.turno.updateMany({
            where: {
              id: turnoId,
              estado: actual.estado,
              kinesiologoId: actual.kinesiologoId,
              fecha: actual.fecha,
              horaInicio: actual.horaInicio,
            },
            data: { kinesiologoId: destino.kinesiologoId, fecha: nuevaFecha, horaInicio: destino.horaInicio },
          });
          if (count !== 1) throw errorTurnoModificado();
          await tx.turnoEvento.create({
            data: { turnoId, tipo: 'reprogramacion', autorId, ocurridoEn: ahora },
          });
          const turno = aActualizado(await tx.turno.findUniqueOrThrow({ where: { id: turnoId } }));
          return { turno, anteriorId: actual.kinesiologoId };
        });
      } catch (err) {
        return traducirOcupacion(err);
      }
      const { turno, anteriorId } = resultado;
      avisar({
        turnoId,
        kinesiologoId: turno.kinesiologoId,
        ...(anteriorId === turno.kinesiologoId ? {} : { kinesiologoAnteriorId: anteriorId }),
      });
      return turno;
    },

    /**
     * Registra, corrige o quita el coseguro abonado (RF-27) sin tocar estado ni franja. `null` deja
     * el turno sin abonar. Un turno `anulado` no admite abono (409, sin evento). La condición de
     * estado va en la misma escritura, así una anulación concurrente no deja pasar el abono. Registra
     * un evento `modificacion_abono` en la misma transacción (RF-46), sin el monto anterior.
     */
    async registrarAbono(turnoId: number, monto: string | null, autorId: number): Promise<TurnoActualizado> {
      const ahora = reloj.ahora();
      const turno = await db.$transaction(async (tx) => {
        const { count } = await tx.turno.updateMany({
          where: { id: turnoId, estado: { not: 'anulado' } },
          data: { coseguroAbonado: monto },
        });
        if (count !== 1) {
          const existe = await tx.turno.findUnique({ where: { id: turnoId }, select: { id: true } });
          throw existe ? errorAbonoEnAnulado() : errorTurnoNoEncontrado();
        }
        await tx.turnoEvento.create({
          data: { turnoId, tipo: 'modificacion_abono', autorId, ocurridoEn: ahora },
        });
        return aActualizado(await tx.turno.findUniqueOrThrow({ where: { id: turnoId } }));
      });
      avisar({ turnoId, kinesiologoId: turno.kinesiologoId });
      return turno;
    },

    /**
     * Corrección (RF-35): lleva el turno a cualquier otro de los cinco estados, con evento
     * `correccion`. `llegadaEn` se limpia al volver a `reservado`; hacia `en_espera` se conserva la
     * que tenía o, si no tenía, se registra la hora de la corrección; en los demás casos se conserva.
     * Hacia un estado activo sobre una franja ocupada la base rechaza (RF-37) y no queda nada.
     */
    async corregir(turnoId: number, hacia: EstadoTurno, autorId: number): Promise<TurnoActualizado> {
      const ahora = reloj.ahora();
      let turno: TurnoActualizado;
      try {
        turno = await db.$transaction(async (tx) => {
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
      avisar({ turnoId, kinesiologoId: turno.kinesiologoId });
      return turno;
    },
  };
}

export type ServicioTurnos = ReturnType<typeof crearServicioTurnos>;
