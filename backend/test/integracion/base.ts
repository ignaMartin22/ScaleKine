import pg from 'pg';
import { crearBaseDeDatos, type BaseDeDatos } from '../../src/comun/baseDeDatos.js';
import { urlsDePrueba } from './entorno.js';

const urls = urlsDePrueba();

/** Prisma conectado como scalekine_app: las pruebas operan con los mismos permisos que el backend. */
export const db: BaseDeDatos = crearBaseDeDatos(urls.app);

/** Conexión SQL directa como scalekine_app, para verificar permisos con sentencias crudas. */
export const sqlApp = new pg.Pool({ connectionString: urls.app, max: 2 });

/**
 * Conexión como dueño del esquema. Solo la usa el arnés para vaciar la base entre pruebas: la
 * aplicación no puede borrar, y eso no se cambia para facilitar las pruebas.
 */
const sqlDueno = new pg.Pool({ connectionString: urls.migraciones, max: 1 });

const TABLAS = [
  'TurnoEvento',
  'Turno',
  'Paciente',
  'Kinesiologo',
  'Sesion',
  'Usuario',
  'Consultorio',
  'limite_intentos',
];

export async function vaciarBase(): Promise<void> {
  const lista = TABLAS.map((t) => `"${t}"`).join(', ');
  await sqlDueno.query(`TRUNCATE ${lista} RESTART IDENTITY CASCADE`);
}

export async function cerrarConexiones(): Promise<void> {
  await Promise.all([db.$disconnect(), sqlApp.end(), sqlDueno.end()]);
}
