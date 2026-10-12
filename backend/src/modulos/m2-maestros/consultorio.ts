import type { BaseDeDatos } from '../../comun/baseDeDatos.js';
import { ErrorNegocio } from '../../comun/errores.js';

/** Datos del consultorio que muestra el ticket (RF-13, RF-28). */
export interface DatosConsultorio {
  nombre: string;
  direccion: string;
  telefono: string;
}

const SELECCION = { nombre: true, direccion: true, telefono: true } as const;

/** La fila única la crea el comando de instalación; la API nunca la crea. */
const errorSinInstalar = () =>
  new ErrorNegocio(
    'consultorio_no_instalado',
    'Los datos del consultorio todavía no se cargaron: hay que ejecutar la instalación.',
    409,
  );

/**
 * Datos del consultorio (RF-13). Quién puede leer y escribir lo decide la ruta. La edición es un
 * `updateMany` sobre `id = 1`: si la fila no existe no crea nada y se informa el error.
 */
export function crearServicioConsultorio({ db }: { db: BaseDeDatos }) {
  return {
    async obtener(): Promise<DatosConsultorio> {
      const fila = await db.consultorio.findUnique({
        where: { id: 1 },
        select: SELECCION,
      });
      if (!fila) throw errorSinInstalar();
      return fila;
    },

    async editar(datos: DatosConsultorio): Promise<DatosConsultorio> {
      const { count } = await db.consultorio.updateMany({
        where: { id: 1 },
        data: datos,
      });
      if (count === 0) throw errorSinInstalar();
      return datos;
    },
  };
}

export type ServicioConsultorio = ReturnType<typeof crearServicioConsultorio>;
