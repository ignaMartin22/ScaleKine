import { spawnSync } from 'node:child_process';
import { urlsDePrueba } from './entorno.js';

/** Aplica las migraciones a la base de pruebas una vez, antes de todos los archivos. */
export default function prepararBaseDePruebas(): void {
  const { migraciones } = urlsDePrueba();
  const resultado = spawnSync('npx prisma migrate deploy', {
    shell: true,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL_MIGRACIONES: migraciones },
  });
  if (resultado.status !== 0) {
    throw new Error(`No se pudieron aplicar las migraciones a la base de pruebas:\n${resultado.stdout}${resultado.stderr}`);
  }
}
