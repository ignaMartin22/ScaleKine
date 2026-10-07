import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { Sesion } from '../sesion/sesion';
import { ErrorApi } from './error-api';
import { conCredenciales, erroresDeApi } from './interceptores';

function preparar() {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(withInterceptors([conCredenciales, erroresDeApi])),
      provideHttpClientTesting(),
    ],
  });
  return {
    http: TestBed.inject(HttpClient),
    servidor: TestBed.inject(HttpTestingController),
    sesion: TestBed.inject(Sesion),
    router: TestBed.inject(Router),
  };
}

async function errorDe(promesa: Promise<unknown>): Promise<unknown> {
  try {
    await promesa;
  } catch (e) {
    return e;
  }
  throw new Error('se esperaba un error');
}

describe('cliente HTTP', () => {
  it('envía las peticiones a la API con credenciales', () => {
    const { http, servidor } = preparar();

    http.get('/api/turnos').subscribe();

    expect(servidor.expectOne('/api/turnos').request.withCredentials).toBe(true);
  });

  it('convierte el error de la API en un ErrorApi con su código y mensaje', async () => {
    const { http, servidor } = preparar();

    const resultado = errorDe(firstValueFrom(http.get('/api/turnos')));
    servidor
      .expectOne('/api/turnos')
      .flush(
        { error: { codigo: 'franja_ocupada', mensaje: 'La franja ya está ocupada.' } },
        { status: 409, statusText: 'Conflict' },
      );

    const error = await resultado;
    expect(error).toBeInstanceOf(ErrorApi);
    expect(error).toMatchObject({ estado: 409, codigo: 'franja_ocupada', message: 'La franja ya está ocupada.' });
  });

  it('un error sin el formato de la API da un mensaje genérico', async () => {
    const { http, servidor } = preparar();

    const resultado = errorDe(firstValueFrom(http.get('/api/turnos')));
    servidor.expectOne('/api/turnos').flush('<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' });

    expect(await resultado).toMatchObject({ codigo: 'error_inesperado' });
  });

  it('un 401 olvida la sesión y vuelve al ingreso (RF-11)', async () => {
    const { http, servidor, sesion, router } = preparar();
    sesion.establecer({ nombreUsuario: 'usuario.ficticio', rol: 'secretaria' });
    const navegar = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const resultado = errorDe(firstValueFrom(http.get('/api/turnos')));
    servidor
      .expectOne('/api/turnos')
      .flush({ error: { codigo: 'sesion_vencida', mensaje: 'La sesión venció.' } }, { status: 401, statusText: 'Unauthorized' });
    await resultado;

    expect(sesion.usuario()).toBeNull();
    expect(navegar).toHaveBeenCalledWith('/ingresar');
  });
});
