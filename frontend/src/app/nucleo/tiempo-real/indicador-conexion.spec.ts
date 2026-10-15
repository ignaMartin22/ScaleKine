import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { estadoDePrueba } from '../sesion/estados-de-prueba';
import { Sesion } from '../sesion/sesion';
import { IndicadorConexion } from './indicador-conexion';
import { SocketDePrueba } from './socket-de-prueba';
import { FABRICA_SOCKET } from './tiempo-real';

describe('IndicadorConexion (RF-45)', () => {
  it('aparece con la conexión caída o reconectando y se va al volver', () => {
    const socket = new SocketDePrueba();
    TestBed.configureTestingModule({
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: FABRICA_SOCKET, useValue: () => socket },
      ],
    });
    TestBed.inject(Sesion).establecer(estadoDePrueba('secretaria'));
    const fixture = TestBed.createComponent(IndicadorConexion);
    const texto = () => (fixture.nativeElement as HTMLElement).textContent ?? '';
    fixture.detectChanges();

    socket.emitir('connect');
    fixture.detectChanges();
    expect(texto()).not.toContain('Sin conexión');

    socket.emitir('disconnect', 'transport close');
    fixture.detectChanges();
    expect(texto()).toContain('Sin conexión: la agenda puede estar desactualizada');

    socket.emitirManager('reconnect_attempt');
    fixture.detectChanges();
    expect(texto()).toContain('Sin conexión');

    socket.emitir('connect');
    fixture.detectChanges();
    expect(texto()).not.toContain('Sin conexión');
  });
});
