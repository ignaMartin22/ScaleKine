import { z } from 'zod';

/**
 * Esquemas de entrada compartidos por las rutas (RNF-10). Un solo lugar para el formato de un día
 * civil y de un identificador que viaja como texto (query o parámetro de ruta).
 */

/**
 * Día civil 'AAAA-MM-DD' que existe en el calendario. Se exige desde 0001-01-01 porque el año 0000
 * no existe para Postgres (`date`) y Prisma falla con P2039. Una fecha ilegible no debe lanzar.
 */
export const fechaCivil = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((valor) => {
    const fecha = new Date(`${valor}T00:00:00Z`);
    return !Number.isNaN(fecha.getTime()) && fecha.toISOString().startsWith(valor) && valor >= '0001-01-01';
  }, 'La fecha no existe en el calendario.');

/** Identificador entero positivo de Postgres (`integer`) que llega como texto; se convierte a número. */
export const idDeTexto = z
  .string()
  .regex(/^\d{1,10}$/)
  .transform(Number)
  .pipe(z.number().int().positive().max(2_147_483_647));
