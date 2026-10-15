import { createRequire } from 'node:module';
import { urlsDeBase } from './entorno.js';

// `pg` es dependencia del backend: la suite no suma dependencias propias para esto.
const requerir = createRequire(new URL('../backend/package.json', import.meta.url));
const pg = requerir('pg') as typeof import('pg');

/**
 * Deja la base vacía: el primer paso del flujo es "Instalar". Usa el usuario dueño del esquema
 * porque la aplicación no puede borrar, y eso no se cambia para facilitar las pruebas.
 */
export default async function globalSetup(): Promise<void> {
  const cliente = new pg.Client({ connectionString: urlsDeBase().migraciones });
  await cliente.connect();
  try {
    const { rows } = await cliente.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
    );
    if (rows.length === 0)
      throw new Error('La base de E2E no tiene tablas: faltan las migraciones.');
    const lista = rows.map((fila) => `"${fila.tablename}"`).join(', ');
    await cliente.query(`TRUNCATE ${lista} RESTART IDENTITY CASCADE`);
  } finally {
    await cliente.end();
  }
}
