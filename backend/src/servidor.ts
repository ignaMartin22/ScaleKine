import { crearApp } from './app.js';
import { cargarConfiguracion, ErrorConfiguracion } from './comun/configuracion.js';
import { crearLogger } from './comun/logger.js';
import { relojDelSistema } from './comun/reloj.js';

function iniciar(): void {
  const config = cargarConfiguracion(process.env);
  const logger = crearLogger(config.nivelLog);
  const reloj = relojDelSistema(config.zonaHoraria);

  const app = crearApp({ config, logger, reloj });
  app.listen(config.puerto, () => {
    logger.info({ puerto: config.puerto, entorno: config.entorno }, 'backend escuchando');
  });
}

try {
  iniciar();
} catch (error) {
  if (error instanceof ErrorConfiguracion) {
    // Todavía no hay logger configurado: se informa por stderr sin valores de las variables.
    process.stderr.write(`${error.message}\n`);
    process.exit(1);
  }
  throw error;
}
