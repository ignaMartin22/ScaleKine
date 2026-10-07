import helmet from 'helmet';
import type { RequestHandler } from 'express';
import { ErrorNegocio } from './errores.js';

/**
 * Cabeceras de seguridad (RNF-01, RNF-10, plan.md §4.15). Caddy agrega las mismas en producción
 * (despliegue.md §6.2); la API las pone también para no depender del proxy.
 */
export function cabecerasDeSeguridad(): RequestHandler {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // Angular inyecta estilos de componentes en tiempo de ejecución (despliegue.md §6.2).
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
      },
    },
    strictTransportSecurity: { maxAge: 31_536_000, includeSubDomains: true },
    referrerPolicy: { policy: 'no-referrer' },
    xFrameOptions: { action: 'deny' },
  });
}

const METODOS_DE_LECTURA = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Defensa contra CSRF junto con la cookie `SameSite=Strict` (plan.md §4.15): toda escritura debe
 * venir del origen de la aplicación. Los navegadores envían `Origin` en toda petición que no sea
 * GET o HEAD; una escritura sin `Origin` también se rechaza.
 */
export function verificarOrigen(origenPermitido: string): RequestHandler {
  return (req, _res, next) => {
    if (METODOS_DE_LECTURA.has(req.method) || req.get('origin') === origenPermitido) {
      next();
      return;
    }
    next(new ErrorNegocio('origen_no_permitido', 'La petición no proviene de la aplicación.', 403));
  };
}
