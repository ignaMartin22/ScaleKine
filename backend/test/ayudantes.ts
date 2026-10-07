import type { Router } from 'express';
import { crearApp } from '../src/app.js';
import { cargarConfiguracion } from '../src/comun/configuracion.js';
import { crearLogger } from '../src/comun/logger.js';
import { RelojFijo } from '../src/comun/reloj.js';

export const ORIGEN_APP = 'http://localhost:4200';

export const ENTORNO_PRUEBA = {
  NODE_ENV: 'test',
  // La app de prueba no se conecta: las pruebas de integración usan su propia conexión.
  DATABASE_URL: 'postgresql://scalekine_app:clave-ficticia@localhost:5432/scalekine_pruebas',
  ZONA_HORARIA: 'America/Argentina/Buenos_Aires',
  FRONTEND_ORIGIN: ORIGEN_APP,
  LOG_LEVEL: 'info',
} as const;

/** Logger que acumula cada línea JSON emitida, para inspeccionar qué se registró. */
export function loggerCapturado() {
  const lineas: string[] = [];
  const logger = crearLogger('info', { write: (linea: string) => void lineas.push(linea) });
  return {
    logger,
    lineas,
    texto: () => lineas.join(''),
    registros: () => lineas.map((l) => JSON.parse(l) as Record<string, unknown>),
  };
}

export function appDePrueba(rutas: Router[] = []) {
  const capturado = loggerCapturado();
  const app = crearApp({
    config: cargarConfiguracion(ENTORNO_PRUEBA),
    logger: capturado.logger,
    reloj: new RelojFijo('2026-10-07T12:00:00Z'),
    rutas,
  });
  return { app, ...capturado };
}
