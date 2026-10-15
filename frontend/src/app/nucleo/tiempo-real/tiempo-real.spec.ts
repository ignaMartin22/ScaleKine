import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { estadoDePrueba } from '../sesion/estados-de-prueba';
import { Sesion } from '../sesion/sesion';
import { SocketDePrueba } from './socket-de-prueba';
import type { io } from 'socket.io-client';
import { FABRICA_SOCKET, TiempoReal, crearSocketReal } from './tiempo-real';

function preparar() {
  const sockets: SocketDePrueba[] = [];
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: FABRICA_SOCKET,
        useValue: () => {
          const s = new SocketDePrueba();
          sockets.push(s);
          return s;
        },
      },
    ],
  });
  const sesion = TestBed.inject(Sesion);
  const tiempoReal = TestBed.inject(TiempoReal);
  const router = TestBed.inject(Router);
  const navegar = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  const sincronizar = () => TestBed.tick();
  return { sockets, sesion, tiempoReal, navegar, sincronizar };
}

describe('TiempoReal: conexión (RF-44, RF-45)', () => {
  it('no conecta sin sesión ni con un paso pendiente', () => {
    const { sockets, sesion, sincronizar } = preparar();
    sincronizar();
    expect(sockets).toHaveLength(0);
    sesion.establecer(estadoDePrueba('secretaria', 'cambiar_contrasena'));
    sincronizar();
    expect(sockets).toHaveLength(0);
  });

  it('conecta con la sesión completa y se desconecta al cerrarla', () => {
    const { sockets, sesion, tiempoReal, sincronizar } = preparar();
    sesion.establecer(estadoDePrueba('secretaria'));
    sincronizar();
    expect(sockets).toHaveLength(1);
    expect(tiempoReal.estado()).toBe('conectando');
    sockets[0].emitir('connect');
    expect(tiempoReal.estado()).toBe('conectado');

    sesion.limpiar();
    sincronizar();
    expect(sockets[0].desconectado).toBe(true);
    expect(tiempoReal.estado()).toBe('inactivo');
  });

  it('pasa por caído y reconectando, y al volver avisa que hay que releer la agenda', () => {
    const { sockets, sesion, tiempoReal, sincronizar } = preparar();
    const reconexiones = vi.fn();
    tiempoReal.reconectado$.subscribe(reconexiones);
    sesion.establecer(estadoDePrueba('kinesiologo'));
    sincronizar();
    const socket = sockets[0];
    socket.emitir('connect');
    expect(reconexiones).not.toHaveBeenCalled();

    socket.emitir('disconnect', 'transport close');
    expect(tiempoReal.estado()).toBe('caido');
    socket.emitirManager('reconnect_attempt');
    expect(tiempoReal.estado()).toBe('reconectando');
    socket.emitir('connect');
    expect(tiempoReal.estado()).toBe('conectado');
    expect(reconexiones).toHaveBeenCalledTimes(1);
  });

  it('si la primera conexión falla por la red, al conectar también avisa para releer', () => {
    const { sockets, sesion, tiempoReal, sincronizar } = preparar();
    const reconexiones = vi.fn();
    tiempoReal.reconectado$.subscribe(reconexiones);
    sesion.establecer(estadoDePrueba('kinesiologo'));
    sincronizar();
    sockets[0].emitir('connect_error', new Error('xhr poll error'));
    expect(tiempoReal.estado()).toBe('caido');
    sockets[0].emitir('connect');
    expect(reconexiones).toHaveBeenCalledTimes(1);
  });

  it('expone turno:cambio y turno:quitado e ignora cargas mal formadas', () => {
    const { sockets, sesion, tiempoReal, sincronizar } = preparar();
    const cambios = vi.fn();
    const quitados = vi.fn();
    tiempoReal.cambios().subscribe(cambios);
    tiempoReal.quitado$.subscribe(quitados);
    sesion.establecer(estadoDePrueba('secretaria'));
    sincronizar();
    const socket = sockets[0];
    socket.emitir('turno:cambio', { turno: { id: 5, fecha: '2026-10-15' } });
    socket.emitir('turno:cambio', { turno: 'raro' });
    socket.emitir('turno:cambio', null);
    socket.emitir('turno:quitado', { turnoId: 9 });
    socket.emitir('turno:quitado', { turnoId: 'x' });
    expect(cambios).toHaveBeenCalledTimes(1);
    expect(cambios).toHaveBeenCalledWith({ id: 5, fecha: '2026-10-15' });
    expect(quitados).toHaveBeenCalledExactlyOnceWith(9);
  });
});

describe('TiempoReal: sesión cerrada por el servidor (RF-11)', () => {
  it('sesion:cerrada olvida la sesión, deja el aviso y vuelve al ingreso', () => {
    const { sockets, sesion, navegar, sincronizar } = preparar();
    sesion.establecer(estadoDePrueba('secretaria'));
    sincronizar();
    sockets[0].emitir('sesion:cerrada', { motivo: 'vencida' });
    expect(sesion.estado()).toBeNull();
    expect(sesion.aviso()).not.toBeNull();
    expect(sockets[0].desconectado).toBe(true);
    expect(navegar).toHaveBeenCalledWith('/ingresar');
  });

  it('el cierre del socket por el servidor también vuelve al ingreso', () => {
    const { sockets, sesion, navegar, sincronizar } = preparar();
    sesion.establecer(estadoDePrueba('kinesiologo'));
    sincronizar();
    sockets[0].emitir('disconnect', 'io server disconnect');
    expect(sesion.estado()).toBeNull();
    expect(navegar).toHaveBeenCalledWith('/ingresar');
  });

  it('un handshake rechazado (no_autorizado) vuelve al ingreso', () => {
    const { sockets, sesion, navegar, sincronizar } = preparar();
    sesion.establecer(estadoDePrueba('kinesiologo'));
    sincronizar();
    sockets[0].emitir('connect_error', new Error('no_autorizado'));
    expect(sesion.estado()).toBeNull();
    expect(navegar).toHaveBeenCalledWith('/ingresar');
  });
});

describe('TiempoReal: socket real', () => {
  it('se crea solo con el transporte websocket y con credenciales (el polling no manda Origin)', () => {
    const conectar = vi.fn().mockReturnValue(new SocketDePrueba());
    crearSocketReal(conectar as unknown as typeof io);
    expect(conectar).toHaveBeenCalledExactlyOnceWith({
      withCredentials: true,
      transports: ['websocket'],
    });
  });
});
