import { Injectable, InjectionToken, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, Subject } from 'rxjs';
import { io } from 'socket.io-client';
import { Sesion } from '../sesion/sesion';

/** Estado de la conexión de tiempo real (RF-45). `inactivo`: no hay sesión completa, no se conecta. */
export type EstadoConexion = 'inactivo' | 'conectando' | 'conectado' | 'caido' | 'reconectando';

/** Lo mínimo que el servicio usa de un socket de `socket.io-client`; permite simularlo en las pruebas. */
export interface SocketTiempoReal {
  on(evento: string, manejador: (...argumentos: unknown[]) => void): unknown;
  disconnect(): unknown;
  io: { on(evento: string, manejador: (...argumentos: unknown[]) => void): unknown };
}

/**
 * Crea el socket. Sin URL, `socket.io-client` usa el mismo origen que la página; la cookie de sesión
 * `HttpOnly` viaja sola y el cliente no manda sala ni identificador alguno (plan.md §3 M5).
 */
export const FABRICA_SOCKET = new InjectionToken<() => SocketTiempoReal>('FABRICA_SOCKET', {
  providedIn: 'root',
  factory: () => () => io({ withCredentials: true }) as unknown as SocketTiempoReal,
});

/**
 * Cliente de tiempo real (RF-43, RF-44, RF-45, RF-11). Conecta solo con sesión completa (sin paso
 * pendiente) y se desconecta al cerrarla. Reexpone los eventos del servidor; no calcula
 * transiciones ni guarda nada: los datos de los turnos pasan por memoria hacia las agendas y
 * nunca por la consola ni por el almacenamiento del navegador.
 *
 * Un evento perdido no se reenvía: al reconectar emite `reconectado$` y cada agenda vuelve a pedir
 * su lectura completa a la API (RF-45). Si el servidor cierra la sesión (`sesion:cerrada`, cierre
 * del socket por el servidor o rechazo del handshake) se vuelve al ingreso, igual que ante un 401.
 */
@Injectable({ providedIn: 'root' })
export class TiempoReal {
  private readonly sesion = inject(Sesion);
  private readonly router = inject(Router);
  private readonly fabrica = inject(FABRICA_SOCKET);

  private socket: SocketTiempoReal | null = null;
  private huboCorte = false;
  private readonly cambio = new Subject<unknown>();
  private readonly quitado = new Subject<number>();
  private readonly reconexion = new Subject<void>();

  private readonly estadoActual = signal<EstadoConexion>('inactivo');
  readonly estado = this.estadoActual.asReadonly();

  /** Se emite al volver la conexión tras un corte: hay que releer la agenda completa. */
  readonly reconectado$: Observable<void> = this.reconexion.asObservable();
  /** Id de un turno que dejó de corresponder a la agenda de este usuario (`turno:quitado`). */
  readonly quitado$: Observable<number> = this.quitado.asObservable();

  constructor() {
    effect(() => {
      const estado = this.sesion.estado();
      if (estado && estado.pasoPendiente === null) this.conectar();
      else this.desconectar();
    });
  }

  /** Turnos completos y actuales (`turno:cambio`), con la proyección de la agenda de este rol. */
  cambios<T>(): Observable<T> {
    return this.cambio.asObservable() as Observable<T>;
  }

  private conectar(): void {
    if (this.socket) return;
    this.huboCorte = false;
    this.estadoActual.set('conectando');
    const socket = this.fabrica();
    this.socket = socket;

    socket.on('connect', () => {
      if (this.socket !== socket) return;
      const reconexion = this.huboCorte;
      this.huboCorte = false;
      this.estadoActual.set('conectado');
      if (reconexion) this.reconexion.next();
    });
    socket.on('disconnect', (motivo) => {
      if (this.socket !== socket) return;
      // El servidor cerró el socket: venció o se revocó la sesión (RF-11); no se reintenta.
      if (motivo === 'io server disconnect') return this.sesionCerrada();
      this.huboCorte = true;
      this.estadoActual.set('caido');
    });
    socket.on('connect_error', (error) => {
      if (this.socket !== socket) return;
      if ((error as { message?: string } | null)?.message === 'no_autorizado') {
        return this.sesionCerrada();
      }
      this.huboCorte = true;
      this.estadoActual.set('caido');
    });
    socket.io.on('reconnect_attempt', () => {
      if (this.socket !== socket) return;
      this.estadoActual.set('reconectando');
    });

    socket.on('turno:cambio', (carga) => {
      if (this.socket !== socket) return;
      const turno = (carga as { turno?: unknown } | null)?.turno;
      if (esTurnoConId(turno)) this.cambio.next(turno);
    });
    socket.on('turno:quitado', (carga) => {
      if (this.socket !== socket) return;
      const id = (carga as { turnoId?: unknown } | null)?.turnoId;
      if (typeof id === 'number') this.quitado.next(id);
    });
    socket.on('sesion:cerrada', () => {
      if (this.socket !== socket) return;
      this.sesionCerrada();
    });
  }

  private desconectar(): void {
    const socket = this.socket;
    this.socket = null;
    this.huboCorte = false;
    this.estadoActual.set('inactivo');
    socket?.disconnect();
  }

  private sesionCerrada(): void {
    this.desconectar();
    this.sesion.vencer();
    void this.router.navigateByUrl('/ingresar');
  }
}

function esTurnoConId(valor: unknown): boolean {
  return (
    typeof valor === 'object' &&
    valor !== null &&
    typeof (valor as { id?: unknown }).id === 'number' &&
    typeof (valor as { fecha?: unknown }).fecha === 'string'
  );
}
