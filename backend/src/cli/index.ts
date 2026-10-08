import { crearBaseDeDatos } from '../comun/baseDeDatos.js';
import { cargarConfiguracion, ErrorConfiguracion } from '../comun/configuracion.js';
import { ErrorNegocio } from '../comun/errores.js';
import { crearLogger } from '../comun/logger.js';
import { relojDelSistema } from '../comun/reloj.js';
import { ErrorUso, interpretarArgumentos, USO } from './argumentos.js';
import {
  instalar,
  restablecer2faAdmin,
  restablecerAdmin,
  revocarSesiones,
  type DependenciasCli,
} from './comandos.js';
import { imprimirContrasenaTemporal, informar } from './salida.js';

/**
 * Punto de entrada de la CLI de instalación y operación (T-10). No arranca el servidor: usa la misma
 * configuración, la misma conexión (`scalekine_app`) y el mismo reloj que el backend. Toda la lógica
 * está en `comandos.ts`; acá solo se leen argumentos y configuración y se muestra el resultado.
 */
async function ejecutar(argv: readonly string[]): Promise<void> {
  const orden = interpretarArgumentos(argv);
  const config = cargarConfiguracion(process.env);
  const logger = crearLogger(config.nivelLog);
  const db = crearBaseDeDatos(config.urlBaseDeDatos);
  const dependencias: DependenciasCli = { db, reloj: relojDelSistema(config.zonaHoraria) };

  try {
    switch (orden.comando) {
      case 'instalar': {
        const { contrasenaTemporal } = await instalar(dependencias, orden.datos);
        logger.info({ comando: orden.comando }, 'sistema instalado');
        informar('Sistema instalado. El administrador debe elegir su contraseña en el primer ingreso.');
        imprimirContrasenaTemporal(contrasenaTemporal);
        break;
      }
      case 'restablecer-admin': {
        const { contrasenaTemporal } = await restablecerAdmin(dependencias, orden.datos);
        logger.info({ comando: orden.comando }, 'contraseña del administrador restablecida');
        informar('Contraseña restablecida y sesiones del administrador cerradas.');
        imprimirContrasenaTemporal(contrasenaTemporal);
        break;
      }
      case 'restablecer-2fa-admin': {
        await restablecer2faAdmin(dependencias, orden.datos);
        logger.info({ comando: orden.comando }, 'segundo factor del administrador restablecido');
        informar('Segundo factor desactivado: el administrador lo activará en su próximo ingreso.');
        break;
      }
      case 'revocar-sesiones': {
        const { revocadas } = await revocarSesiones(dependencias);
        logger.info({ comando: orden.comando, revocadas }, 'sesiones revocadas');
        informar(`Sesiones revocadas: ${revocadas}.`);
        break;
      }
    }
  } finally {
    await db.$disconnect();
  }
}

ejecutar(process.argv.slice(2)).catch((error: unknown) => {
  if (error instanceof ErrorUso) {
    informar(`${error.message}\n\n${USO}`);
  } else if (error instanceof ErrorConfiguracion || error instanceof ErrorNegocio) {
    // Mensajes pensados para quien opera: nombran variables u operaciones, nunca valores.
    informar(error.message);
  } else {
    // Solo tipo y código: el mensaje de un error de base podría incluir datos de la consulta.
    const tipo = error instanceof Error ? error.name : typeof error;
    const codigo = (error as { code?: unknown } | null)?.code;
    informar(`No se pudo completar el comando (${tipo}${codigo ? `, ${String(codigo)}` : ''}).`);
  }
  process.exit(1);
});
