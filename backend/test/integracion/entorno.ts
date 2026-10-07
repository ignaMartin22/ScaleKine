import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ARCHIVO_ENV = fileURLToPath(new URL('../../../.env', import.meta.url));

/**
 * URLs de la base de pruebas. En desarrollo salen del .env de la raíz; en CI, del entorno. Se
 * exige que apunten a una base distinta de la de desarrollo, porque las pruebas la vacían.
 */
export function urlsDePrueba(): { app: string; migraciones: string } {
  if (existsSync(ARCHIVO_ENV)) process.loadEnvFile(ARCHIVO_ENV);

  const app = process.env.DATABASE_URL_PRUEBAS;
  const migraciones = process.env.DATABASE_URL_MIGRACIONES_PRUEBAS;
  if (!app || !migraciones) {
    throw new Error(
      'Faltan DATABASE_URL_PRUEBAS y DATABASE_URL_MIGRACIONES_PRUEBAS (ver .env.example) para las pruebas de integración.',
    );
  }
  for (const url of [app, migraciones]) {
    if (!new URL(url).pathname.endsWith('_pruebas')) {
      throw new Error('Las URLs de prueba deben apuntar a una base cuyo nombre termine en "_pruebas".');
    }
  }
  return { app, migraciones };
}
