import type { BaseDeDatos } from '../../comun/baseDeDatos.js';
import { ErrorNegocio } from '../../comun/errores.js';
import type { Reloj } from '../../comun/reloj.js';
import { franjasDelDia } from '../m2-maestros/grilla.js';

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
        db.kinesiologo.findUnique({ where: { id: datos.kinesiologoId }, select: { id: true, bloque: true } }),
      ]);
      if (!paciente) throw errorPacienteNoEncontrado();
      if (!kinesiologo) throw errorKinesiologoNoEncontrado();
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
        const indice = indiceViolado(err);
        if (indice === INDICE_FRANJA_DEL_KINESIOLOGO) throw errorFranjaOcupada();
        if (indice === INDICE_FRANJA_DEL_PACIENTE) throw errorPacienteOcupado();
        throw err;
      }
    },
  };
}

export type ServicioTurnos = ReturnType<typeof crearServicioTurnos>;
