import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { estadoDePrueba } from '../sesion/estados-de-prueba';
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
    expect(error).toMatchObject({
      estado: 409,
      codigo: 'franja_ocupada',
      message: 'La franja ya está ocupada.',
    });
  });

  it('un error sin el formato de la API da un mensaje genérico', async () => {
    const { http, servidor } = preparar();

    const resultado = errorDe(firstValueFrom(http.get('/api/turnos')));
    servidor
      .expectOne('/api/turnos')
      .flush('<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' });

    expect(await resultado).toMatchObject({ codigo: 'error_inesperado' });
  });

  it('un 401 olvida la sesión y vuelve al ingreso (RF-11)', async () => {
    const { http, servidor, sesion, router } = preparar();
    sesion.establecer(estadoDePrueba('secretaria'));
    const navegar = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const resultado = errorDe(firstValueFrom(http.get('/api/turnos')));
    servidor
      .expectOne('/api/turnos')
      .flush(
        { error: { codigo: 'sesion_vencida', mensaje: 'La sesión venció.' } },
        { status: 401, statusText: 'Unauthorized' },
      );
    await resultado;

    expect(sesion.usuario()).toBeNull();
    expect(navegar).toHaveBeenCalledWith('/ingresar');
    expect(sesion.aviso()).toContain('venció');
  });

  it('un 401 del ingreso (credenciales inválidas) no vuelve al ingreso ni avisa vencimiento', async () => {
    const { http, servidor, sesion, router } = preparar();
    const navegar = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const resultado = errorDe(firstValueFrom(http.post('/api/sesion', {})));
    servidor
      .expectOne('/api/sesion')
      .flush(
        { error: { codigo: 'credenciales_invalidas', mensaje: 'No.' } },
        { status: 401, statusText: 'Unauthorized' },
      );

    expect(await resultado).toMatchObject({ codigo: 'credenciales_invalidas' });
    expect(navegar).not.toHaveBeenCalled();
    expect(sesion.aviso()).toBeNull();
  });

  it.each([
    ['debe_verificar_segundo_factor', 'verificar_segundo_factor', '/verificar-segundo-factor'],
    ['debe_cambiar_contrasena', 'cambiar_contrasena', '/cambiar-contrasena'],
    ['debe_activar_segundo_factor', 'activar_segundo_factor', '/activar-segundo-factor'],
  ] as const)('un 403 %s lleva a la pantalla del paso', async (codigo, paso, ruta) => {
    const { http, servidor, sesion, router } = preparar();
    sesion.establecer(estadoDePrueba('administrador'));
    const navegar = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);

    const resultado = errorDe(firstValueFrom(http.get('/api/turnos')));
    servidor
      .expectOne('/api/turnos')
      .flush(
        { error: { codigo, mensaje: 'Falta un paso.' } },
        { status: 403, statusText: 'Forbidden' },
      );
    await resultado;
    await vi.waitFor(() =>
      servidor.expectOne('/api/sesion').flush(estadoDePrueba('administrador', paso)),
    );
    await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith(ruta));

    expect(sesion.pasoPendiente()).toBe(paso);
  });
});
