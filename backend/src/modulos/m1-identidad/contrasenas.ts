import argon2 from 'argon2';

/**
 * Hash de contraseñas (RNF-03). Argon2id con los parámetros mínimos de la hoja de OWASP "Password
 * Storage Cheat Sheet": 19 MiB de memoria, 2 iteraciones y 1 hilo. La política de largo mínimo y de
 * contraseñas comunes es de T-11.
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
