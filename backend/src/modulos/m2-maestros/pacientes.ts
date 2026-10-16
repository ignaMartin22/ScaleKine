import type { BaseDeDatos } from '../../comun/baseDeDatos.js';
import { ErrorNegocio } from '../../comun/errores.js';

/** Paciente con los datos fijos de M2 (RF-17). Los turnos los agrega M3 en la ficha (T-29). */
export interface Paciente {
  id: number;
  dni: string;
  nombre: string;
  telefono: string;
  obraSocial: string;
}

/** Datos de alta y edición. El DNI ya llega normalizado (`normalizarDni`). */
export type DatosPaciente = Omit<Paciente, 'id'>;

/** Largo mínimo de una búsqueda por nombre (RF-21): con menos caracteres casi todo coincide. */
export const MINIMO_BUSQUEDA_NOMBRE = 3;
/** Obra social de quien no tiene (RF-17); siempre se sugiere (RF-49). */
export const OBRA_SOCIAL_PARTICULAR = 'Particular';
/** Tope de resultados de una búsqueda por nombre: la pantalla pide afinar si hay más. */
export const TOPE_BUSQUEDA_NOMBRE = 20;

const SELECCION = {
  id: true,
  dni: true,
  nombre: true,
  telefono: true,
  obraSocial: true,
} as const;

function esViolacionDeUnicidad(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}

const errorNoEncontrado = () => new ErrorNegocio('paciente_no_encontrado', 'El paciente no existe.', 404);
const errorDniEnUso = () => new ErrorNegocio('dni_en_uso', 'Ya existe un paciente con ese DNI.', 409);

/** Prisma no escapa los comodines de LIKE: `%` y `_` del texto buscado se escapan para tomarlos literalmente. */
function escaparComodines(texto: string): string {
  return texto.replace(/[\\%_]/g, '\\$&');
}

/**
 * Pacientes (RF-17 a RF-21). Quién puede leer y escribir lo decide la ruta. La unicidad del DNI la
 * garantiza el esquema: se atrapa la violación (P2002) en vez de consultar antes, así también se
 * cubre la carrera entre dos altas del mismo DNI.
 */
export function crearServicioPacientes({ db }: { db: BaseDeDatos }) {
  return {
    async crear(datos: DatosPaciente): Promise<Paciente> {
      try {
        return await db.paciente.create({ data: datos, select: SELECCION });
      } catch (err) {
        if (esViolacionDeUnicidad(err)) throw errorDniEnUso();
        throw err;
      }
    },

    /** Edición (RF-20). Guardar el DNI propio no es conflicto: la unicidad ignora la fila misma. */
    async editar(id: number, datos: DatosPaciente): Promise<Paciente> {
      try {
        const { count } = await db.paciente.updateMany({
          where: { id },
          data: datos,
        });
        if (count === 0) throw errorNoEncontrado();
      } catch (err) {
        if (esViolacionDeUnicidad(err)) throw errorDniEnUso();
        throw err;
      }
      return this.obtener(id);
    },

    async obtener(id: number): Promise<Paciente> {
      const fila = await db.paciente.findUnique({
        where: { id },
        select: SELECCION,
      });
      if (!fila) throw errorNoEncontrado();
      return fila;
    },

    /**
     * Obras sociales para sugerir al cargar un paciente (RF-49): las distintas ya guardadas en
     * `Paciente` más "Particular", sin repetidas y ordenadas. Solo nombres, ningún dato de paciente.
     */
    async obrasSociales(): Promise<string[]> {
      const filas = await db.paciente.findMany({ distinct: ['obraSocial'], select: { obraSocial: true } });
      const nombres = new Set([OBRA_SOCIAL_PARTICULAR, ...filas.map((f) => f.obraSocial)]);
      return [...nombres].sort((a, b) => a.localeCompare(b, 'es') || (a < b ? -1 : 1));
    },

    /** Búsqueda exacta (RF-19): cero o un paciente. El DNI ya llega normalizado. */
    async buscarPorDni(dni: string): Promise<Paciente[]> {
      const fila = await db.paciente.findUnique({
        where: { dni },
        select: SELECCION,
      });
      return fila ? [fila] : [];
    },

    /** Búsqueda parcial sin distinguir mayúsculas (RF-21), ordenada por nombre y topada. */
    async buscarPorNombre(nombre: string): Promise<Paciente[]> {
      return db.paciente.findMany({
        where: { nombre: { contains: escaparComodines(nombre), mode: 'insensitive' } },
        select: SELECCION,
        orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
        take: TOPE_BUSQUEDA_NOMBRE,
      });
    },
  };
}

export type ServicioPacientes = ReturnType<typeof crearServicioPacientes>;
