import express, { type Express, type Router } from 'express';
import type { Logger } from 'pino';
import type { Configuracion } from './comun/configuracion.js';
import type { Reloj } from './comun/reloj.js';
import { manejadorErrores, rutaNoEncontrada } from './comun/errores.js';
import { registroDePeticiones } from './comun/logger.js';
import { cabecerasDeSeguridad, verificarOrigen } from './comun/seguridad.js';

export interface Dependencias {
  config: Configuracion;
  logger: Logger;
  reloj: Reloj;
  /** Rutas de los módulos, montadas bajo `/api`. */
  rutas?: Router[];
}

export function crearApp({ config, logger, reloj, rutas = [] }: Dependencias): Express {
  const app = express();

  app.disable('x-powered-by');
  // Solo se confía en la IP que informa el proxy local (Caddy), plan.md §3 M1.
  app.set('trust proxy', 1);

  app.use(registroDePeticiones(logger, reloj));
  app.use(cabecerasDeSeguridad());
  app.use(verificarOrigen(config.origenFrontend));
  app.use(express.json({ limit: '100kb' }));

  // Chequeo de disponibilidad del monitor externo (despliegue.md §11): no devuelve datos.
  app.get('/api/salud', (_req, res) => {
    res.type('text/plain').send('ok');
  });

  for (const router of rutas) {
    app.use('/api', router);
  }

  app.use(rutaNoEncontrada);
  app.use(manejadorErrores(logger));

  return app;
}
