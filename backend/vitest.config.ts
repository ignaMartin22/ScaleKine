import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unidad',
          include: ['test/comun/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        // Contra PostgreSQL real, nunca contra un doble (plan.md §4.13).
        test: {
          name: 'integracion',
          include: ['test/integracion/**/*.test.ts'],
          environment: 'node',
          globalSetup: ['test/integracion/preparacion-global.ts'],
          setupFiles: ['test/integracion/preparacion.ts'],
          // Todos los archivos comparten la base de pruebas: se ejecutan de a uno.
          fileParallelism: false,
          testTimeout: 15_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
