import { execSync } from 'node:child_process';
import { urlsDePrueba } from './entorno.js';

/** Aplica las migraciones a la base de pruebas una vez, antes de todos los archivos. */
export default function prepararBaseDePruebas(): void {
  const { migraciones } = urlsDePrueba();
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL_MIGRACIONES: migraciones },
    stdio: 'pipe',
  });
}
