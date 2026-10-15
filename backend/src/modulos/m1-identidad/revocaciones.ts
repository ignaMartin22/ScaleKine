/**
 * Aviso de sesiones revocadas (RF-09, RF-10, RF-11). M1 es quien revoca; no sabe quién más tiene
 * sesiones "vivas" (M5 mantiene sockets abiertos con la cookie de una sesión) y por eso avisa, tras
 * confirmar la revocación en la base, a quien se haya registrado. Por defecto no avisa a nadie.
 *
 * El aviso es de mejor esfuerzo y nunca hace fallar la operación de M1: la revocación ya está
 * guardada y M5 además revalida periódicamente las sesiones de sus sockets.
 */
export type CriterioRevocacion =
  /** La sesión cuyo token tiene este hash (cierre de sesión, RF-10). */
  | { hashToken: string }
  /** Todas las sesiones de la cuenta, salvo `exceptoSesionId` si se indica (RF-07, RF-08, RF-09). */
  | { usuarioId: number; exceptoSesionId?: number };

export interface AvisoRevocaciones {
  sesionesRevocadas(criterio: CriterioRevocacion): void;
}

export const SIN_AVISO: AvisoRevocaciones = { sesionesRevocadas: () => undefined };

/** Avisa sin dejar que un fallo del receptor afecte la operación que ya se confirmó. */
export function avisarRevocacion(aviso: AvisoRevocaciones, criterio: CriterioRevocacion): void {
  try {
    aviso.sesionesRevocadas(criterio);
  } catch {
    // El receptor registra lo suyo; la revocación ya quedó en la base.
  }
}
