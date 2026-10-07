import { existsSync } from 'node:fs';
import { defineConfig } from 'prisma/config';

// En desarrollo las variables vienen del .env de la raíz; en CI y producción, del entorno.
if (existsSync('../.env')) process.loadEnvFile('../.env');

// Prisma CLI usa siempre el usuario de migraciones, dueño del esquema (despliegue.md §7). La
// aplicación se conecta con scalekine_app (DATABASE_URL).
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: process.env.DATABASE_URL_MIGRACIONES,
  },
});
