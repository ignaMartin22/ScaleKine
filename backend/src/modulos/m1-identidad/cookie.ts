import type { Request, Response } from 'express';
import type { Configuracion } from '../../comun/configuracion.js';

type ConfigCookie = Pick<Configuracion, 'cookieSegura'>;

/**
 * Cookie de sesión (RNF-01, plan.md §4.15). El prefijo `__Host-` obliga al navegador a exigir
 * `Secure`, `Path=/` y ausencia de `Domain`, así ningún subdominio puede plantarla. Sin HTTPS
 * (desarrollo) el navegador la rechazaría, por eso el prefijo va solo con `Secure`.
 */
export function nombreCookie(config: ConfigCookie): string {
  return config.cookieSegura ? '__Host-sesion' : 'sesion';
}

export function opcionesCookie(config: ConfigCookie) {
  return { httpOnly: true, sameSite: 'strict', secure: config.cookieSegura, path: '/' } as const;
}

export function escribirCookieSesion(res: Response, config: ConfigCookie, token: string, venceEn: Date): void {
  res.cookie(nombreCookie(config), token, { ...opcionesCookie(config), expires: venceEn });
}

export function borrarCookieSesion(res: Response, config: ConfigCookie): void {
  res.clearCookie(nombreCookie(config), opcionesCookie(config));
}

const FORMA_DE_TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** El token de la cookie, solo si tiene la forma de uno emitido por el sistema. */
export function leerCookieSesion(req: Request, config: ConfigCookie): string | undefined {
  const nombre = nombreCookie(config);
  for (const par of (req.headers.cookie ?? '').split(';')) {
    const corte = par.indexOf('=');
    if (corte === -1) continue;
    if (par.slice(0, corte).trim() !== nombre) continue;
    const valor = par.slice(corte + 1).trim();
    return FORMA_DE_TOKEN.test(valor) ? valor : undefined;
  }
  return undefined;
}
