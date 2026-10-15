import { defineConfig, devices } from '@playwright/test';
import {
  DIRECTORIO_BACKEND,
  DIRECTORIO_FRONTEND,
  ORIGEN_FRONTEND,
  PUERTO_FRONTEND,
  URL_BACKEND,
  entornoDelBackend,
} from './entorno.js';

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  globalSetup: './globalSetup.ts',
  // El flujo es una sola historia con estado compartido: un solo worker y sin reintentos.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: ORIGEN_FRONTEND,
    locale: 'es-AR',
    timezoneId: 'America/Argentina/Buenos_Aires',
    trace: 'off',
    screenshot: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      // Sin npx: Node directo, con tsx como cargador.
      command: 'node --import tsx src/servidor.ts',
      cwd: DIRECTORIO_BACKEND,
      env: entornoDelBackend(),
      url: `${URL_BACKEND}/api/salud`,
      reuseExistingServer: false,
      timeout: 60_000,
      stdout: 'ignore',
      stderr: 'ignore',
    },
    {
      command: `node node_modules/@angular/cli/bin/ng.js serve --host 127.0.0.1 --port ${PUERTO_FRONTEND} --proxy-config ../e2e/proxy.e2e.json`,
      cwd: DIRECTORIO_FRONTEND,
      env: { NG_CLI_ANALYTICS: 'false' },
      url: ORIGEN_FRONTEND,
      reuseExistingServer: false,
      timeout: 240_000,
      stdout: 'ignore',
      stderr: 'ignore',
    },
  ],
});
