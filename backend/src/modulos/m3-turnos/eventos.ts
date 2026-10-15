/**
 * Punto de emisión de M3 hacia M5 (plan.md §3 M3 y M5). M3 no conoce Socket.io: tras confirmar cada
 * operación avisa a un `EmisorTurnos` inyectado, que por defecto no hace nada.
 *
 * El aviso lleva solo identificadores, nunca datos del paciente: quien difunde vuelve a leer el turno
 * (con la proyección de M4) para armar lo que manda a cada sala.
 */
export interface CambioDeTurno {
  turnoId: number;
  /** Kinesiólogo del turno después de la operación. */
  kinesiologoId: number;
  /**
   * Solo en una reprogramación que cambió de kinesiólogo: el que lo tenía antes, para que su agenda
   * lo quite (plan.md §3 M5).
   */
  kinesiologoAnteriorId?: number;
}

export interface EmisorTurnos {
  /**
   * Se llama una sola vez por operación, DESPUÉS de confirmar la transacción y nunca si falló. No
   * debe lanzar ni demorar la respuesta: el que difunde resuelve sus propios errores.
   */
  turnoCambiado(cambio: CambioDeTurno): void;
}

export const EMISOR_NULO: EmisorTurnos = { turnoCambiado: () => undefined };
