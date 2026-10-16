import type { BaseDeDatos } from '../../comun/baseDeDatos.js';
import { ErrorNegocio } from '../../comun/errores.js';
import type { Reloj } from '../../comun/reloj.js';
import { finDeFranja } from '../m2-maestros/grilla.js';
import { accionesDisponibles, type EstadoTurno, type Rol } from '../m3-turnos/transiciones.js';
import { fechaYHoraLocal, franjaTranscurrida } from './pendientes.js';

/**
 * Lo que se lee de la base por turno en toda agenda. NO incluye el coseguro abonado: la agenda del
 * kinesiólogo se arma solo con esta selección, así el monto nunca llega a su proyección (RF-40).
 */
const SELECCION = {
  id: true,
  fecha: true,
  horaInicio: true,
  estado: true,
  llegadaEn: true,
  paciente: { select: { id: true, nombre: true, dni: true, telefono: true, obraSocial: true } },
  kinesiologo: { select: { id: true, nombre: true } },
} as const;

/** Lo que leen la secretaría y la ficha del paciente: lo anterior más el coseguro abonado (RF-41, RF-47). */
const SELECCION_CON_ABONO = { ...SELECCION, coseguroAbonado: true } as const;

interface Monto {
  toFixed(n: number): string;
}
interface FilaAgenda {
  id: number;
  fecha: Date;
  horaInicio: string;
  estado: EstadoTurno;
  llegadaEn: Date | null;
}
type FilaConAbono = FilaAgenda & { coseguroAbonado: Monto | null };

/**
 * Proyección común a las dos agendas (D-15: el kinesiólogo ve lo mismo que la secretaría), sin el
 * coseguro abonado. El monto lo agrega `conAbono`, que usan solo las proyecciones de secretaría y
 * ficha; la del kinesiólogo no lo tiene (RF-40).
 */
function proyectar(t: FilaAgenda, zonaHoraria: string) {
  return {
    id: t.id,
    fecha: t.fecha.toISOString().slice(0, 10),
    horaInicio: t.horaInicio,
    horaFin: finDeFranja(t.horaInicio),
    estado: t.estado,
    llegadaEn: t.llegadaEn?.toISOString() ?? null,
    // La misma llegada en hora de pared de la zona del consultorio, para que el cliente no deba conocerla.
    horaLlegada: t.llegadaEn ? fechaYHoraLocal(t.llegadaEn, zonaHoraria).hora : null,
  };
}

/** Proyección de secretaría y ficha (RF-41, RF-47): la común más el coseguro abonado, o null si no abonó. */
function conAbono(t: FilaConAbono, zonaHoraria: string) {
  return { ...proyectar(t, zonaHoraria), coseguroAbonado: t.coseguroAbonado?.toFixed(2) ?? null };
}

/**
 * Suma de montos en centavos enteros (BigInt), sin coma flotante (RF-48, plan.md §4.9). Cada monto
 * llega como texto con dos decimales ('1500.50').
 */
export function sumarMontos(montos: readonly (string | null)[]): string {
  let centavos = 0n;
  for (const m of montos) {
    if (m !== null) centavos += BigInt(m.replace('.', ''));
  }
  const texto = centavos.toString().padStart(3, '0');
  return `${texto.slice(0, -2)}.${texto.slice(-2)}`;
}

type FilaSeleccionada = FilaAgenda & {
  paciente: { id: number; nombre: string; dni: string; telefono: string; obraSocial: string | null };
  kinesiologo: { id: number; nombre: string };
};

/** Turno de la agenda de secretaría (RF-41): proyección común, paciente, kinesiólogo y acciones. */
function aTurnoDeSecretaria(t: FilaSeleccionada & FilaConAbono, rol: Rol, zonaHoraria: string) {
  const acciones = accionesDisponibles(t.estado, rol);
  return {
    ...conAbono(t, zonaHoraria),
    paciente: t.paciente,
    kinesiologo: t.kinesiologo,
    acciones: {
      transiciones: acciones.transiciones.map(({ hacia, accion }) => ({ hacia, accion })),
      puedeCorregir: acciones.puedeCorregir,
    },
  };
}

/** Turno de la agenda propia del kinesiólogo (RF-40): sin id de paciente (D-16) y sin acciones (D-15). */
function aTurnoDeKinesiologo(t: FilaSeleccionada, zonaHoraria: string) {
  const { dni, nombre, telefono, obraSocial } = t.paciente;
  return { ...proyectar(t, zonaHoraria), paciente: { nombre, dni, telefono, obraSocial } };
}

/** El mismo turno sin el campo del abono. */
function sinAbono<T extends { coseguroAbonado?: unknown }>(t: T): Omit<T, 'coseguroAbonado'> {
  const { coseguroAbonado: _abono, ...resto } = t;
  return resto;
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
     * `recaudado` (RF-48) es la suma de los coseguros abonados de los turnos devueltos, sin los
     * `anulado`, como texto con dos decimales.
     */
    async deSecretaria(rol: Rol, fecha: string, kinesiologoId?: number) {
      const filas = await db.turno.findMany({
        where: { fecha: comoFecha(fecha), ...(kinesiologoId === undefined ? {} : { kinesiologoId }) },
        select: SELECCION_CON_ABONO,
        orderBy: [{ horaInicio: 'asc' }, { kinesiologo: { nombre: 'asc' } }, { id: 'asc' }],
      });
      const turnos = filas.map((t) => aTurnoDeSecretaria(t, rol, reloj.zonaHoraria));
      const recaudado = sumarMontos(turnos.filter((t) => t.estado !== 'anulado').map((t) => t.coseguroAbonado));
      return { turnos, recaudado };
    },

    /**
     * Turno para difundir en tiempo real (RF-44, M5): el mismo turno con la forma de cada agenda, o
     * `null` si no existe. `secretaria` es la de la agenda de secretaría, con las acciones (las
     * mismas para secretaría y administrador); `kinesiologo` es la de la agenda propia, sin acciones
     * (D-15). Es una lectura: el que llama decide a qué sala va cada una.
     */
    async paraDifusion(turnoId: number) {
      const t = await db.turno.findUnique({ where: { id: turnoId }, select: SELECCION_CON_ABONO });
      if (!t) return null;
      return {
        // El kinesiólogo actual del turno según esta lectura: de ahí sale a qué sala va el cambio.
        kinesiologoId: t.kinesiologo.id,
        secretaria: aTurnoDeSecretaria(t, 'secretaria', reloj.zonaHoraria),
        // Se proyecta desde una copia sin el abono: la del kinesiólogo no puede incluirlo (RF-40).
        kinesiologo: aTurnoDeKinesiologo(sinAbono(t), reloj.zonaHoraria),
      };
    },

    /** El `Kinesiologo` de la cuenta `usuarioId`, o `null` si la cuenta no tiene perfil de kinesiólogo. */
    async kinesiologoIdDeCuenta(usuarioId: number): Promise<number | null> {
      const k = await db.kinesiologo.findUnique({ where: { usuarioId }, select: { id: true } });
      return k?.id ?? null;
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
        select: { ...SELECCION_CON_ABONO, paciente: false },
        orderBy: [{ fecha: 'asc' }, { horaInicio: 'asc' }, { id: 'asc' }],
      });
      const ahora = reloj.ahora();
      const turnos = filas.map((t) => ({ ...conAbono(t, reloj.zonaHoraria), kinesiologo: t.kinesiologo }));
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
      const aTurno = (t: (typeof enEspera)[number]) => aTurnoDeKinesiologo(t, reloj.zonaHoraria);
      return { enEspera: enEspera.map(aTurno), proximos: proximos.map(aTurno) };
    },
  };
}

export type ServicioAgendas = ReturnType<typeof crearServicioAgendas>;
