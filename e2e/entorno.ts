import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

/**
 * Entorno de la suite E2E (T-33). Puertos propios para no chocar con el desarrollo, y siempre
 * 127.0.0.1: el origen del frontend tiene que coincidir con FRONTEND_ORIGIN o el websocket se rechaza.
 */
export const PUERTO_BACKEND = 3101;
export const PUERTO_FRONTEND = 4301;
export const ORIGEN_FRONTEND = `http://127.0.0.1:${PUERTO_FRONTEND}`;
export const URL_BACKEND = `http://127.0.0.1:${PUERTO_BACKEND}`;

export const DIRECTORIO_BACKEND = fileURLToPath(new URL('../backend', import.meta.url));
export const DIRECTORIO_FRONTEND = fileURLToPath(new URL('../frontend', import.meta.url));
const ARCHIVO_ENV = fileURLToPath(new URL('../.env', import.meta.url));

/** Clave ficticia de 32 bytes, solo para esta suite (RNF-04). */
const CLAVE_CIFRADO_E2E = Buffer.alloc(32, 7).toString('base64');

function conBase(url: string, base: string): string {
  const copia = new URL(url);
  copia.pathname = `/${base}`;
  return copia.toString();
}

/**
 * URLs de la base de E2E. En CI salen de E2E_DATABASE_URL y E2E_DATABASE_URL_MIGRACIONES; en
 * desarrollo se derivan del .env de la raíz, cambiando solo el nombre de la base. La suite vacía la
 * base, así que se exige un nombre terminado en "_pruebas".
 */
export function urlsDeBase(): { app: string; migraciones: string } {
  let app = process.env['E2E_DATABASE_URL'];
  let migraciones = process.env['E2E_DATABASE_URL_MIGRACIONES'];
  if ((!app || !migraciones) && existsSync(ARCHIVO_ENV)) {
    const env = parseEnv(readFileSync(ARCHIVO_ENV, 'utf8'));
    app ??=
      env['DATABASE_URL_PRUEBAS'] && conBase(env['DATABASE_URL_PRUEBAS'], 'scalekine_e2e_pruebas');
    migraciones ??=
      env['DATABASE_URL_MIGRACIONES_PRUEBAS'] &&
      conBase(env['DATABASE_URL_MIGRACIONES_PRUEBAS'], 'scalekine_e2e_pruebas');
  }
  if (!app || !migraciones) {
    throw new Error(
      'Faltan E2E_DATABASE_URL y E2E_DATABASE_URL_MIGRACIONES (o un .env en la raíz).',
    );
  }
  for (const url of [app, migraciones]) {
    if (!new URL(url).pathname.endsWith('_pruebas')) {
      throw new Error(
        'Las URLs de E2E deben apuntar a una base cuyo nombre termine en "_pruebas".',
      );
    }
  }
  return { app, migraciones };
}

/** Variables del backend y de su CLI: nada se hereda del .env de desarrollo. */
export function entornoDelBackend(): Record<string, string> {
  return {
    NODE_ENV: 'development',
    PORT: String(PUERTO_BACKEND),
    DATABASE_URL: urlsDeBase().app,
    ZONA_HORARIA: 'America/Argentina/Buenos_Aires',
    FRONTEND_ORIGIN: ORIGEN_FRONTEND,
    COOKIE_SECURE: 'false',
    CLAVE_CIFRADO: CLAVE_CIFRADO_E2E,
    LOG_LEVEL: 'silent',
  };
}
