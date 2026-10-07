import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generado/prisma/client.js';

export type BaseDeDatos = PrismaClient;

/**
 * Cliente de Prisma sobre node-postgres. La aplicación se conecta siempre con scalekine_app, que no
 * puede alterar el esquema ni borrar turnos (despliegue.md §7); un error de permisos no se arregla
 * ampliándolos.
 */
export function crearBaseDeDatos(url: string): BaseDeDatos {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}
