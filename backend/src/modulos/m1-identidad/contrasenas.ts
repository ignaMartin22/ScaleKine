import argon2 from 'argon2';
import { ErrorNegocio } from '../../comun/errores.js';
import { CONTRASENAS_COMUNES } from './contrasenas-comunes.js';

/**
 * Hash de contraseñas (RNF-03). Argon2id con los parámetros mínimos de la hoja de OWASP "Password
 * Storage Cheat Sheet": 19 MiB de memoria, 2 iteraciones y 1 hilo.
 */
export const PARAMETROS_ARGON2 = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export function hashearContrasena(contrasena: string): Promise<string> {
  return argon2.hash(contrasena, PARAMETROS_ARGON2);
}

/** Un hash mal formado cuenta como contraseña incorrecta: no se propaga el error de argon2. */
export async function verificarContrasena(hash: string, contrasena: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, contrasena);
  } catch {
    return false;
  }
}

/** Largo mínimo en caracteres (RNF-03). */
export const LARGO_MINIMO_CONTRASENA = 12;

/**
 * Política de contraseñas (RNF-03): al menos 12 caracteres y fuera de la lista de contraseñas
 * comunes. Es la única validación: la usan la instalación, el alta y el restablecimiento de
 * cuentas y el cambio de la propia contraseña, para que la regla sea la misma en los tres casos.
 * Lanza un error 400 con un código estable y un mensaje para la persona usuaria.
 */
export function validarPoliticaContrasena(contrasena: string): void {
  // Se cuentan caracteres, no unidades UTF-16: un emoji cuenta como uno.
  if ([...contrasena].length < LARGO_MINIMO_CONTRASENA) {
    throw new ErrorNegocio(
      'contrasena_corta',
      `La contraseña debe tener al menos ${LARGO_MINIMO_CONTRASENA} caracteres.`,
      400,
    );
  }
  // Una contraseña de solo espacios no tiene contenido, y los espacios de los extremos no la
  // alejan de la lista de comunes.
  const sinEspacios = contrasena.trim();
  if (sinEspacios === '') {
    throw new ErrorNegocio('contrasena_en_blanco', 'La contraseña no puede ser solo espacios.', 400);
  }
  if (CONTRASENAS_COMUNES.has(sinEspacios.toLowerCase())) {
    throw new ErrorNegocio(
      'contrasena_comun',
      'Esa contraseña es muy común. Elegí otra más difícil de adivinar.',
      400,
    );
  }
}
