import type { BaseDeDatos } from '../../comun/baseDeDatos.js';
import { ErrorNegocio } from '../../comun/errores.js';
import type { Bloque } from '../../generado/prisma/client.js';
import { calcularDisponibilidad, ESTADOS_ACTIVOS, type DisponibilidadDeKinesiologo } from './disponibilidad.js';

/**
 * Lectura de disponibilidad (RF-22). No escribe nada: una consulta de los kinesiólogos del bloque con la cuenta activa y
 * una de los turnos activos de la fecha, y el resto se resuelve en memoria (plan.md §3 M4). Quién
 * puede llamarla lo decide la ruta.
 */
export function crearServicioDisponibilidad({ db }: { db: BaseDeDatos }) {
  return {
    /**
     * `fecha` es un día civil del consultorio ('AAAA-MM-DD'). La columna es `DATE` y la conexión
     * trabaja en UTC (RF-12), así que la medianoche UTC de ese día es exactamente esa fecha.
     */
    async consultar(fecha: string, bloque: Bloque, pacienteId?: number): Promise<DisponibilidadDeKinesiologo[]> {
      if (pacienteId !== undefined) {
        const existe = await db.paciente.findUnique({ where: { id: pacienteId }, select: { id: true } });
        if (!existe) throw new ErrorNegocio('paciente_no_encontrado', 'El paciente no existe.', 404);
      }
      const [kinesiologos, turnos] = await Promise.all([
        db.kinesiologo.findMany({
          where: { bloque, usuario: { activo: true } },
          select: { id: true, nombre: true },
          orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
        }),
        db.turno.findMany({
          where: { fecha: new Date(`${fecha}T00:00:00Z`), estado: { in: [...ESTADOS_ACTIVOS] } },
          select: { kinesiologoId: true, pacienteId: true, horaInicio: true, estado: true },
        }),
      ]);
      return calcularDisponibilidad({ fecha, bloque, kinesiologos, turnos, pacienteId });
    },
  };
}

export type ServicioDisponibilidad = ReturnType<typeof crearServicioDisponibilidad>;
