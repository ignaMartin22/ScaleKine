import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generado/prisma/client.js';

export type BaseDeDatos = PrismaClient;

/**
 * Cliente de Prisma sobre node-postgres. La aplicación se conecta siempre con scalekine_app, que no
 * puede alterar el esquema ni borrar turnos (despliegue.md §7); un error de permisos no se arregla
 * ampliándolos.
 */
export function crearBaseDeDatos(url: string): BaseDeDatos {
  // La sesión se fija en UTC para no depender del servidor ni de DATABASE_URL: los instantes se
  // guardan y se leen en UTC y la zona del consultorio se aplica solo en el código (RF-12).
  const adapter = new PrismaPg({ connectionString: url, options: '-c timezone=UTC' });
  return new PrismaClient({ adapter });
}
