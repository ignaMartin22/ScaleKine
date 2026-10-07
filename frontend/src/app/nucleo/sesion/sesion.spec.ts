import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Sesion } from './sesion';

function preparar() {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  return { sesion: TestBed.inject(Sesion), servidor: TestBed.inject(HttpTestingController) };
}

describe('Sesion', () => {
  it('pregunta al backend por la sesión una sola vez', async () => {
    const { sesion, servidor } = preparar();

    const primera = sesion.asegurarCargada();
    servidor.expectOne('/api/sesion').flush({ usuario: { nombreUsuario: 'usuario.ficticio', rol: 'secretaria' } });

    expect(await primera).toEqual({ nombreUsuario: 'usuario.ficticio', rol: 'secretaria' });
    expect(await sesion.asegurarCargada()).toEqual({ nombreUsuario: 'usuario.ficticio', rol: 'secretaria' });
    servidor.expectNone('/api/sesion');
    expect(sesion.rol()).toBe('secretaria');
  });

  it('sin sesión válida, el usuario queda vacío', async () => {
    const { sesion, servidor } = preparar();

    const resultado = sesion.asegurarCargada();
    servidor
      .expectOne('/api/sesion')
      .flush({ error: { codigo: 'sin_sesion', mensaje: 'Sin sesión.' } }, { status: 401, statusText: 'Unauthorized' });

    expect(await resultado).toBeNull();
    expect(sesion.rol()).toBeNull();
  });

  it('limpiar olvida al usuario (RF-10)', () => {
    const { sesion } = preparar();
    sesion.establecer({ nombreUsuario: 'usuario.ficticio', rol: 'kinesiologo' });

    sesion.limpiar();

    expect(sesion.usuario()).toBeNull();
  });
});
