import { crearApp } from './app.js';
import { crearBaseDeDatos } from './comun/baseDeDatos.js';
import { cargarConfiguracion, ErrorConfiguracion } from './comun/configuracion.js';
import { crearLogger } from './comun/logger.js';
import { relojDelSistema } from './comun/reloj.js';
import { crearModuloIdentidad } from './modulos/m1-identidad/index.js';

async function iniciar(): Promise<void> {
  const config = cargarConfiguracion(process.env);
  const logger = crearLogger(config.nivelLog);
  const reloj = relojDelSistema(config.zonaHoraria);
  const db = crearBaseDeDatos(config.urlBaseDeDatos);

  // Falla al arrancar si la base no responde, en lugar de en la primera petición.
  const [{ usuario }] = await db.$queryRaw<[{ usuario: string }]>`SELECT current_user AS usuario`;
  logger.info({ usuarioBase: usuario }, 'conectado a la base');

  // Cada módulo recibe sus dependencias en su fábrica; crearApp solo monta sus routers. La fábrica
  // de identidad es asíncrona: si argon2 no funciona, el arranque falla acá y no en el primer ingreso.
  const identidad = await crearModuloIdentidad({ db, reloj, config });
  const app = crearApp({ config, logger, reloj, rutas: [identidad.rutas] });
  const servidor = app.listen(config.puerto, () => {
    logger.info({ puerto: config.puerto, entorno: config.entorno }, 'backend escuchando');
  });

  const apagar = (senal: string) => {
    logger.info({ senal }, 'apagando');
    servidor.close(() => {
      void db.$disconnect().finally(() => process.exit(0));
    });
  };
  process.once('SIGTERM', apagar);
  process.once('SIGINT', apagar);
}

iniciar().catch((error: unknown) => {
  if (error instanceof ErrorConfiguracion) {
    // Todavía no hay logger configurado: se informa por stderr sin valores de las variables.
    process.stderr.write(`${error.message}\n`);
  } else {
    // Solo tipo y código: el mensaje de un error de base podría incluir datos de la consulta.
    const tipo = error instanceof Error ? error.name : typeof error;
    const codigo = (error as { code?: unknown } | null)?.code;
    process.stderr.write(`No se pudo iniciar el backend (${tipo}${codigo ? `, ${String(codigo)}` : ''}).\n`);
  }
  process.exit(1);
});
