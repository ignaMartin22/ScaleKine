import type { BaseDeDatos } from '../../comun/baseDeDatos.js';
import type { Reloj } from '../../comun/reloj.js';
import { ESTADOS_ACTIVOS } from './disponibilidad.js';
import { fechaYHoraLocal, filtrarPendientes } from './pendientes.js';

export interface TurnoPendiente {
  id: number;
  /** 'AAAA-MM-DD'. */
  fecha: string;
  horaInicio: string;
  estado: string;
  kinesiologoId: number;
  kinesiologoNombre: string;
  pacienteId: number;
  pacienteNombre: string;
}

export interface Pendientes {
  cantidad: number;
  turnos: TurnoPendiente[];
}

/**
 * Lectura de los turnos pendientes de marcar (RF-42). No escribe nada. La base trae solo los turnos
 * activos con fecha hasta hoy en la zona del consultorio (uno de fecha futura no puede estar
 * pendiente, y el índice por fecha acota la lectura); el filtro fino por hora de fin de franja es el
 * cálculo puro, que es lo que se prueba con reloj controlado. Quién puede llamarla lo decide la ruta.
 */
export function crearServicioPendientes({ db, reloj }: { db: BaseDeDatos; reloj: Reloj }) {
  return {
    async consultar(): Promise<Pendientes> {
      const ahora = reloj.ahora();
      const hoy = fechaYHoraLocal(ahora, reloj.zonaHoraria).fecha;
      // La columna es `DATE` y la conexión trabaja en UTC (RF-12): la medianoche UTC es esa fecha.
      const filas = await db.turno.findMany({
        where: { fecha: { lte: new Date(`${hoy}T00:00:00Z`) }, estado: { in: [...ESTADOS_ACTIVOS] } },
        select: {
          id: true,
          fecha: true,
          horaInicio: true,
          estado: true,
          kinesiologo: { select: { id: true, nombre: true } },
          paciente: { select: { id: true, nombre: true } },
        },
        orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }, { id: 'asc' }],
      });
      const turnos = filtrarPendientes(
        filas.map((t) => ({
          id: t.id,
          fecha: t.fecha.toISOString().slice(0, 10),
          horaInicio: t.horaInicio,
          estado: t.estado,
          kinesiologoId: t.kinesiologo.id,
          kinesiologoNombre: t.kinesiologo.nombre,
          pacienteId: t.paciente.id,
          pacienteNombre: t.paciente.nombre,
        })),
        ahora,
        reloj.zonaHoraria,
      );
      return { cantidad: turnos.length, turnos };
    },
  };
}

export type ServicioPendientes = ReturnType<typeof crearServicioPendientes>;
