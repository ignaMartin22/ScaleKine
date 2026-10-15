import type { SocketTiempoReal } from './tiempo-real';

type Manejador = (...argumentos: unknown[]) => void;

/** Socket simulado para las pruebas: registra manejadores y permite disparar eventos del servidor. */
export class SocketDePrueba implements SocketTiempoReal {
  desconectado = false;
  private readonly manejadores = new Map<string, Manejador[]>();
  private readonly manejadoresManager = new Map<string, Manejador[]>();

  readonly io = {
    on: (evento: string, manejador: Manejador) => {
      this.manejadoresManager.set(evento, [
        ...(this.manejadoresManager.get(evento) ?? []),
        manejador,
      ]);
    },
  };

  on(evento: string, manejador: Manejador): this {
    this.manejadores.set(evento, [...(this.manejadores.get(evento) ?? []), manejador]);
    return this;
  }

  disconnect(): this {
    this.desconectado = true;
    return this;
  }

  /** Dispara un evento del socket (del servidor o de la conexión). */
  emitir(evento: string, ...argumentos: unknown[]): void {
    for (const m of this.manejadores.get(evento) ?? []) m(...argumentos);
  }

  /** Dispara un evento del administrador de conexión (por ejemplo `reconnect_attempt`). */
  emitirManager(evento: string, ...argumentos: unknown[]): void {
    for (const m of this.manejadoresManager.get(evento) ?? []) m(...argumentos);
  }
}
