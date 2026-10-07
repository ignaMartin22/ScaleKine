import { pino, type DestinationStream, type Logger } from 'pino';
import type { RequestHandler } from 'express';
import type { Reloj } from './reloj.js';

/**
 * Logger con redacción de datos personales (RNF-08, plan.md §4.15). Todo log del backend pasa por
 * acá: nunca se usa `console`.
 */

/** Campos que nunca se escriben en un log, en cualquier nivel de anidamiento de hasta tres. */
const CAMPOS_SENSIBLES = [
  // Datos personales del paciente
  'dni',
  'nombre',
  'apellido',
  'nombreCompleto',
  'telefono',
  'obraSocial',
  // Coseguros
  'coseguro',
  'coseguroObraSocial',
  'coseguroAdicional',
  // Credenciales y secretos
  'nombreUsuario',
  'contrasena',
  'contrasenaActual',
  'contrasenaNueva',
  'contrasenaTemporal',
  'password',
  'token',
  'secretoTotp',
  'codigoTotp',
  'codigosRecuperacion',
  'cookie',
  'authorization',
  'set-cookie',
];

function rutasDeRedaccion(): string[] {
  return CAMPOS_SENSIBLES.flatMap((campo) => {
    const clave = /^[A-Za-z_$][\w$]*$/.test(campo) ? campo : `["${campo}"]`;
    const unir = (prefijo: string) => (clave.startsWith('[') ? `${prefijo}${clave}` : `${prefijo}.${clave}`);
    return [clave, unir('*'), unir('*.*'), unir('*.*.*')];
  });
}

export const MARCA_REDACCION = '[REDACTADO]';

export function crearLogger(nivel: string, destino?: DestinationStream): Logger {
  const opciones = {
    level: nivel,
    base: undefined,
    redact: { paths: rutasDeRedaccion(), censor: MARCA_REDACCION },
  };
  return destino ? pino(opciones, destino) : pino(opciones);
}

/**
 * Registro de cada petición: método, ruta sin parámetros de consulta (una búsqueda por DNI no
 * queda en el log), estado y duración. No registra cabeceras ni cuerpos.
 */
export function registroDePeticiones(logger: Logger, reloj: Reloj): RequestHandler {
  return (req, res, next) => {
    const inicio = reloj.ahora().getTime();
    res.on('finish', () => {
      logger.info(
        {
          metodo: req.method,
          ruta: req.originalUrl.split('?')[0],
          estado: res.statusCode,
          duracionMs: reloj.ahora().getTime() - inicio,
        },
        'petición',
      );
    });
    next();
  };
}
