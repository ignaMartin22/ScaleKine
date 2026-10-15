import type { BaseDeDatos } from '../../comun/baseDeDatos.js';
import { ErrorNegocio } from '../../comun/errores.js';
import type { Reloj } from '../../comun/reloj.js';
import { finDeFranja } from '../m2-maestros/grilla.js';
import { accionesDisponibles, type EstadoTurno, type Rol } from '../m3-turnos/transiciones.js';
import { fechaYHoraLocal, franjaTranscurrida } from './pendientes.js';

/** Lo que se lee de la base por turno; la agenda propia y la de secretaría parten de lo mismo. */
const SELECCION = {
  id: true,
  fecha: true,
  horaInicio: true,
  estado: true,
  llegadaEn: true,
  coseguroObraSocial: true,
  coseguroAdicional: true,
  paciente: { select: { id: true, nombre: true, dni: true, telefono: true, obraSocial: true } },
  kinesiologo: { select: { id: true, nombre: true } },
} as const;

interface Monto {
  toFixed(n: number): string;
}
interface FilaAgenda {
  id: number;
  fecha: Date;
  horaInicio: string;
  estado: EstadoTurno;
  llegadaEn: Date | null;
  coseguroObraSocial: Monto | null;
  coseguroAdicional: Monto | null;
}

/** Proyección común a las dos agendas (D-15: el kinesiólogo ve lo mismo que la secretaría). */
function proyectar(t: FilaAgenda) {
  return {
    id: t.id,
    fecha: t.fecha.toISOString().slice(0, 10),
    horaInicio: t.horaInicio,
    horaFin: finDeFranja(t.horaInicio),
    estado: t.estado,
    llegadaEn: t.llegadaEn?.toISOString() ?? null,
    coseguroObraSocial: t.coseguroObraSocial?.toFixed(2) ?? null,
    coseguroAdicional: t.coseguroAdicional?.toFixed(2) ?? null,
  };
}

/**
 * Lectura de las agendas (M4, RF-40, RF-41). No escribe nada. Quién puede llamar a cada método lo
 * decide la ruta; la agenda propia recibe el id de la cuenta de la sesión, nunca un kinesiólogo.
 */
export function crearServicioAgendas({ db, reloj }: { db: BaseDeDatos; reloj: Reloj }) {
  // La columna es `DATE` y la conexión trabaja en UTC (RF-12): la medianoche UTC es esa fecha.
  const comoFecha = (fecha: string) => new Date(`${fecha}T00:00:00Z`);

  return {
    /** Día civil de hoy en la zona del consultorio, con el reloj inyectable (RF-12). */
    hoy: () => fechaYHoraLocal(reloj.ahora(), reloj.zonaHoraria).fecha,

    /**
     * Agenda de secretaría (RF-41): todos los turnos de `fecha`, en cualquier estado y de cualquier
     * kinesiólogo (también el de una cuenta desactivada), o solo los de `kinesiologoId`. Cada turno
     * trae las acciones que `accionesDisponibles` da para su estado y el `rol` de la sesión.
     */
    async deSecretaria(rol: Rol, fecha: string, kinesiologoId?: number) {
      const filas = await db.turno.findMany({
        where: { fecha: comoFecha(fecha), ...(kinesiologoId === undefined ? {} : { kinesiologoId }) },
        select: SELECCION,
        orderBy: [{ horaInicio: 'asc' }, { kinesiologo: { nombre: 'asc' } }, { id: 'asc' }],
      });
      return filas.map((t) => {
        const acciones = accionesDisponibles(t.estado, rol);
        return {
          ...proyectar(t),
          paciente: t.paciente,
          kinesiologo: t.kinesiologo,
          acciones: {
            transiciones: acciones.transiciones.map(({ hacia, accion }) => ({ hacia, accion })),
            puedeCorregir: acciones.puedeCorregir,
          },
        };
      });
    },

    /**
     * Ficha del paciente (RF-47): todos sus turnos, en cualquier estado y con cualquier
     * kinesiólogo, partidos según `franjaTranscurrida` con el "ahora" del reloj inyectable. Los
     * `proximos` (franja no transcurrida, también la que está en curso) van del más cercano al más
     * lejano; el `historial`, del más reciente al más antiguo. 404 si el paciente no existe.
     */
    async delPaciente(pacienteId: number) {
      const paciente = await db.paciente.findUnique({ where: { id: pacienteId }, select: { id: true } });
      if (!paciente) throw new ErrorNegocio('paciente_no_encontrado', 'El paciente no existe.', 404);
      const filas = await db.turno.findMany({
        where: { pacienteId },
        select: { ...SELECCION, paciente: false },
        orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }, { id: 'asc' }],
      });
      const ahora = reloj.ahora();
      const turnos = filas.map((t) => ({ ...proyectar(t), kinesiologo: t.kinesiologo }));
      const proximos: typeof turnos = [];
      const historial: typeof turnos = [];
      for (const turno of turnos) {
        (franjaTranscurrida(turno.fecha, turno.horaInicio, ahora, reloj.zonaHoraria) ? historial : proximos).push(turno);
      }
      return { proximos, historial: historial.reverse() };
    },

    /**
     * Agenda del kinesiólogo (RF-40, D-15, D-16): solo los turnos de `fecha` del `Kinesiologo` de la
     * cuenta `usuarioId`, que sale de la sesión. En espera por hora de llegada y próximos
     * (`reservado`) por franja; sin acciones. Una cuenta de rol kinesiólogo sin perfil de
     * `Kinesiologo` no tiene agenda: 403.
     */
    async delKinesiologo(usuarioId: number, fecha: string) {
      const kinesiologo = await db.kinesiologo.findUnique({ where: { usuarioId }, select: { id: true } });
      if (!kinesiologo) {
        throw new ErrorNegocio('no_autorizado', 'No estás autorizado para realizar esta acción.', 403);
      }
      const donde = { kinesiologoId: kinesiologo.id, fecha: comoFecha(fecha) };
      const [enEspera, proximos] = await Promise.all([
        db.turno.findMany({
          where: { ...donde, estado: 'en_espera' },
          select: SELECCION,
          orderBy: [{ llegadaEn: 'asc' }, { id: 'asc' }],
        }),
        db.turno.findMany({
          where: { ...donde, estado: 'reservado' },
          select: SELECCION,
          orderBy: [{ horaInicio: 'asc' }, { id: 'asc' }],
        }),
      ]);
      // El kinesiólogo no necesita el id del paciente: no tiene ninguna ruta de pacientes (D-16).
      const aTurno = (t: (typeof enEspera)[number]) => {
        const { dni, nombre, telefono, obraSocial } = t.paciente;
        return { ...proyectar(t), paciente: { nombre, dni, telefono, obraSocial } };
      };
      return { enEspera: enEspera.map(aTurno), proximos: proximos.map(aTurno) };
    },
  };
}

export type ServicioAgendas = ReturnType<typeof crearServicioAgendas>;
