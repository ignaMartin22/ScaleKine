import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { estadoDePrueba } from './estados-de-prueba';
import { Sesion } from './sesion';

function preparar() {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  return { sesion: TestBed.inject(Sesion), servidor: TestBed.inject(HttpTestingController) };
}

describe('Sesion', () => {
  it('pregunta al backend por la sesión una sola vez', async () => {
    const { sesion, servidor } = preparar();
    const estado = estadoDePrueba('secretaria');

    const primera = sesion.asegurarCargada();
    servidor.expectOne('/api/sesion').flush(estado);

    expect(await primera).toEqual(estado);
    expect(await sesion.asegurarCargada()).toEqual(estado);
    servidor.expectNone('/api/sesion');
    expect(sesion.rol()).toBe('secretaria');
    expect(sesion.pasoPendiente()).toBeNull();
  });

  it('guarda el paso pendiente que informa el backend', async () => {
    const { sesion, servidor } = preparar();

    const carga = sesion.asegurarCargada();
    servidor
      .expectOne('/api/sesion')
      .flush(estadoDePrueba('administrador', 'activar_segundo_factor'));
    await carga;

    expect(sesion.pasoPendiente()).toBe('activar_segundo_factor');
    expect(sesion.estado()?.segundoFactor).toBe('sin_activar');
  });

  it('sin sesión válida, el estado queda vacío', async () => {
    const { sesion, servidor } = preparar();

    const resultado = sesion.asegurarCargada();
    servidor
      .expectOne('/api/sesion')
      .flush(
        { error: { codigo: 'sesion_invalida', mensaje: 'Sin sesión.' } },
        { status: 401, statusText: 'Unauthorized' },
      );

    expect(await resultado).toBeNull();
    expect(sesion.rol()).toBeNull();
  });

  it('ingresar envía las credenciales y guarda el estado (RF-01)', async () => {
    const { sesion, servidor } = preparar();

    const resultado = sesion.ingresar('usuario.ficticio', 'clave-ficticia');
    const peticion = servidor.expectOne('/api/sesion');
    expect(peticion.request.method).toBe('POST');
    expect(peticion.request.body).toEqual({
      nombreUsuario: 'usuario.ficticio',
      contrasena: 'clave-ficticia',
    });
    peticion.flush(estadoDePrueba('administrador', 'cambiar_contrasena'));

    expect((await resultado).pasoPendiente).toBe('cambiar_contrasena');
    expect(sesion.usuario()?.debeCambiarContrasena).toBe(true);
    servidor.expectNone('/api/sesion');
  });

  it('cambiar la contraseña vuelve a pedir la sesión (RF-06, RF-07)', async () => {
    const { sesion, servidor } = preparar();
    sesion.establecer(estadoDePrueba('administrador', 'cambiar_contrasena'));

    const resultado = sesion.cambiarContrasena('actual-ficticia', 'nueva-ficticia-larga');
    const cambio = servidor.expectOne('/api/sesion/contrasena');
    expect(cambio.request.method).toBe('PUT');
    expect(cambio.request.body).toEqual({
      contrasenaActual: 'actual-ficticia',
      contrasenaNueva: 'nueva-ficticia-larga',
    });
    cambio.flush(null, { status: 204, statusText: 'No Content' });
    await vi.waitFor(() =>
      servidor
        .expectOne('/api/sesion')
        .flush(estadoDePrueba('administrador', 'activar_segundo_factor')),
    );

    expect((await resultado)?.pasoPendiente).toBe('activar_segundo_factor');
    expect(sesion.pasoPendiente()).toBe('activar_segundo_factor');
  });

  it('la activación devuelve el QR y los códigos de recuperación sin guardarlos (RNF-04)', async () => {
    const { sesion, servidor } = preparar();

    const qr = sesion.iniciarActivacion();
    servidor
      .expectOne('/api/sesion/segundo-factor/activacion')
      .flush({ qr: 'data:image/png;base64,AAAA' });
    expect(await qr).toBe('data:image/png;base64,AAAA');

    const codigos = sesion.confirmarActivacion('123456');
    const confirmacion = servidor.expectOne('/api/sesion/segundo-factor/activacion/confirmar');
    expect(confirmacion.request.body).toEqual({ codigo: '123456' });
    confirmacion.flush({ codigosRecuperacion: ['a', 'b'] });
    expect(await codigos).toEqual(['a', 'b']);
    expect(JSON.stringify(sesion.estado())).not.toContain('"a"');
  });

  it('verificar el segundo factor vuelve a pedir la sesión', async () => {
    const { sesion, servidor } = preparar();

    const resultado = sesion.verificarSegundoFactor('abcd-efgh');
    const verificacion = servidor.expectOne('/api/sesion/segundo-factor/verificar');
    expect(verificacion.request.body).toEqual({ codigo: 'abcd-efgh' });
    verificacion.flush(null, { status: 204, statusText: 'No Content' });
    await vi.waitFor(() =>
      servidor.expectOne('/api/sesion').flush(estadoDePrueba('administrador')),
    );

    expect((await resultado)?.pasoPendiente).toBeNull();
  });

  it('cerrar revoca la sesión y la olvida, aunque falle la petición (RF-10)', async () => {
    const { sesion, servidor } = preparar();
    sesion.establecer(estadoDePrueba('kinesiologo'));

    const resultado = sesion.cerrar();
    const cierre = servidor.expectOne('/api/sesion');
    expect(cierre.request.method).toBe('DELETE');
    cierre.flush(null, { status: 500, statusText: 'Error' });

    await expect(resultado).rejects.toBeDefined();
    expect(sesion.usuario()).toBeNull();
  });

  it('limpiar olvida al usuario sin dejar aviso', () => {
    const { sesion } = preparar();
    sesion.establecer(estadoDePrueba('kinesiologo'));

    sesion.limpiar();

    expect(sesion.usuario()).toBeNull();
    expect(sesion.aviso()).toBeNull();
  });

  it('vencer olvida la sesión y deja un aviso solo si había una (RF-11)', () => {
    const { sesion } = preparar();
    sesion.vencer();
    expect(sesion.aviso()).toBeNull();

    sesion.establecer(estadoDePrueba('kinesiologo'));
    sesion.vencer();

    expect(sesion.usuario()).toBeNull();
    expect(sesion.aviso()).toContain('venció');
  });
});
