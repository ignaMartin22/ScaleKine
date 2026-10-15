import { crearApp } from './app.js';
import { crearBaseDeDatos } from './comun/baseDeDatos.js';
import { cargarConfiguracion, ErrorConfiguracion } from './comun/configuracion.js';
import { crearLogger } from './comun/logger.js';
import { relojDelSistema } from './comun/reloj.js';
import { crearTiempoReal } from './modulos/m5-tiempo-real/tiempoReal.js';
import { crearRutas } from './rutas.js';

async function iniciar(): Promise<void> {
  const config = cargarConfiguracion(process.env);
  const logger = crearLogger(config.nivelLog);
  const reloj = relojDelSistema(config.zonaHoraria);
  const db = crearBaseDeDatos(config.urlBaseDeDatos);

  // Falla al arrancar si la base no responde, en lugar de en la primera petición.
  const [{ usuario }] = await db.$queryRaw<[{ usuario: string }]>`SELECT current_user AS usuario`;
  logger.info({ usuarioBase: usuario }, 'conectado a la base');

  // Cada módulo recibe sus dependencias en su fábrica; crearApp solo monta sus routers. Las fábricas
  // pueden ser asíncronas: si argon2 no funciona, el arranque falla acá y no en el primer ingreso.
  const tiempoReal = crearTiempoReal({
    logger,
    reloj,
    origenPermitido: config.origenFrontend,
    cookieSegura: config.cookieSegura,
  });
  const rutas = await crearRutas({ db, reloj, config, tiempoReal });
  const app = crearApp({ config, logger, reloj, rutas });
  const servidor = app.listen(config.puerto, () => {
    logger.info({ puerto: config.puerto, entorno: config.entorno }, 'backend escuchando');
  });
  // Socket.io comparte el servidor HTTP de la API (un solo origen, despliegue.md §1).
  tiempoReal.adjuntar(servidor);

  const apagar = (senal: string) => {
    logger.info({ senal }, 'apagando');
    // Cierra los sockets y también el servidor HTTP al que está adjunto.
    void tiempoReal.cerrar().finally(() => {
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
