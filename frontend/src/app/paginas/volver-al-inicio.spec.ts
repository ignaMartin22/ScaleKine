import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { estadoDePrueba } from '../nucleo/sesion/estados-de-prueba';
import type { Rol } from '../nucleo/sesion/modelo';
import { Sesion } from '../nucleo/sesion/sesion';
import { AsignarTurno } from './asignar-turno';
import { ConsultorioPagina } from './consultorio';
import { PacientesPagina } from './pacientes';

function enlaceDeVolver(pantalla: new () => unknown, rol: Rol): HTMLAnchorElement {
  TestBed.configureTestingModule({
    providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
  });
  TestBed.inject(Sesion).establecer(estadoDePrueba(rol));
  const fixture = TestBed.createComponent(pantalla);
  fixture.detectChanges();
  const enlace = (fixture.nativeElement as HTMLElement).querySelector('app-volver-al-inicio a');
  return enlace as HTMLAnchorElement;
}

const PANTALLAS = [
  ['asignar turno', AsignarTurno],
  ['consultorio', ConsultorioPagina],
  ['pacientes', PacientesPagina],
] as const;

describe.each(PANTALLAS)('enlace de volver en %s (RF-01)', (_nombre, pantalla) => {
  it('el administrador vuelve a la agenda', () => {
    const enlace = enlaceDeVolver(pantalla, 'administrador');
    expect(enlace.getAttribute('href')).toBe('/secretaria/agenda');
    expect(enlace.textContent).toContain('Volver al inicio');
  });

  it('la secretaria vuelve a la agenda', () => {
    expect(enlaceDeVolver(pantalla, 'secretaria').getAttribute('href')).toBe('/secretaria/agenda');
  });
});
