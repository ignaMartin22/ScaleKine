import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { type Type } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { erroresDeApi } from '../nucleo/http/interceptores';
import { estadoDePrueba } from '../nucleo/sesion/estados-de-prueba';
import { Sesion } from '../nucleo/sesion/sesion';
import { ActivarSegundoFactor } from './activar-segundo-factor';
import { CambiarContrasena } from './cambiar-contrasena';
import { Ingresar } from './ingresar';
import { VerificarSegundoFactor } from './verificar-segundo-factor';

function montar<T>(componente: Type<T>) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(withInterceptors([erroresDeApi])),
      provideHttpClientTesting(),
    ],
  });
  const fixture = TestBed.createComponent(componente);
  fixture.detectChanges();
  return {
    fixture,
    servidor: TestBed.inject(HttpTestingController),
    sesion: TestBed.inject(Sesion),
    navegar: vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true),
  };
}

function escribir(fixture: ComponentFixture<unknown>, id: string, valor: string): void {
  const entrada = fixture.nativeElement.querySelector(`#${id}`) as HTMLInputElement;
  entrada.value = valor;
}

function enviar(fixture: ComponentFixture<unknown>): void {
  (fixture.nativeElement.querySelector('form') as HTMLFormElement).dispatchEvent(
    new Event('submit', { cancelable: true }),
  );
}

const texto = (fixture: ComponentFixture<unknown>) =>
  (fixture.nativeElement as HTMLElement).textContent ?? '';

describe('Ingresar (RF-01, RF-02)', () => {
  it('ante credenciales inválidas muestra un mensaje genérico', async () => {
    const { fixture, servidor } = montar(Ingresar);
    escribir(fixture, 'usuario', 'usuario.ficticio');
    escribir(fixture, 'contrasena', 'clave-ficticia');

    enviar(fixture);
    servidor
      .expectOne('/api/sesion')
      .flush(
        { error: { codigo: 'credenciales_invalidas', mensaje: 'x' } },
        { status: 401, statusText: 'Unauthorized' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Usuario o contraseña incorrectos.');
  });

  it('ante el límite por dirección muestra el mensaje del sistema (RNF-02)', async () => {
    const { fixture, servidor } = montar(Ingresar);
    escribir(fixture, 'usuario', 'usuario.ficticio');
    escribir(fixture, 'contrasena', 'clave-ficticia');

    enviar(fixture);
    servidor.expectOne('/api/sesion').flush(
      {
        error: {
          codigo: 'demasiados_intentos',
          mensaje: 'Hubo demasiados intentos fallidos desde esta conexión.',
        },
      },
      { status: 429, statusText: 'Too Many Requests' },
    );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('demasiados intentos fallidos');
    expect(texto(fixture)).not.toContain('Usuario o contraseña incorrectos.');
  });

  it('sin completar los campos no llama al backend y asocia el error al campo', () => {
    const { fixture, servidor } = montar(Ingresar);

    enviar(fixture);
    fixture.detectChanges();

    servidor.expectNone('/api/sesion');
    const usuario = fixture.nativeElement.querySelector('#usuario') as HTMLInputElement;
    expect(usuario.getAttribute('aria-describedby')).toBe('error-usuario');
    expect(fixture.nativeElement.querySelector('#error-usuario')).not.toBeNull();
  });

  it.each([
    ['secretaria', null, '/secretaria/agenda'],
    ['kinesiologo', null, '/kinesiologo'],
    ['administrador', 'verificar_segundo_factor', '/verificar-segundo-factor'],
    ['administrador', 'cambiar_contrasena', '/cambiar-contrasena'],
    ['administrador', 'activar_segundo_factor', '/activar-segundo-factor'],
  ] as const)('redirige a %s con paso %s a %s', async (rol, paso, destino) => {
    const { fixture, servidor, navegar } = montar(Ingresar);
    escribir(fixture, 'usuario', 'usuario.ficticio');
    escribir(fixture, 'contrasena', 'clave-ficticia');

    enviar(fixture);
    servidor.expectOne('/api/sesion').flush(estadoDePrueba(rol, paso));
    await fixture.whenStable();

    expect(navegar).toHaveBeenCalledWith(destino);
  });

  it('muestra el aviso de sesión vencida (RF-11)', () => {
    const { fixture, sesion } = montar(Ingresar);
    sesion.establecer(estadoDePrueba('secretaria'));
    sesion.vencer();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Tu sesión venció');
  });
});

describe('CambiarContrasena (RF-06, RF-07, RNF-03)', () => {
  it('muestra la política y rechaza una contraseña corta sin llamar al backend', () => {
    const { fixture, servidor } = montar(CambiarContrasena);
    escribir(fixture, 'actual', 'actual-ficticia');
    escribir(fixture, 'nueva', 'corta');
    escribir(fixture, 'repetida', 'corta');

    enviar(fixture);
    fixture.detectChanges();

    servidor.expectNone('/api/sesion/contrasena');
    expect(texto(fixture)).toContain('al menos 12 caracteres');
    expect(fixture.nativeElement.querySelector('#error-nueva')).not.toBeNull();
  });

  it('muestra el error del backend junto al campo de la contraseña nueva', async () => {
    const { fixture, servidor } = montar(CambiarContrasena);
    escribir(fixture, 'actual', 'actual-ficticia');
    escribir(fixture, 'nueva', 'contrasena-ficticia-larga');
    escribir(fixture, 'repetida', 'contrasena-ficticia-larga');

    enviar(fixture);
    servidor
      .expectOne('/api/sesion/contrasena')
      .flush(
        { error: { codigo: 'contrasena_comun', mensaje: 'Esa contraseña es muy común.' } },
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#error-nueva')?.textContent).toContain('muy común');
  });

  it('desde el menú avisa que cierra las demás sesiones y no navega al terminar', async () => {
    const { fixture, servidor, sesion, navegar } = montar(CambiarContrasena);
    sesion.establecer(estadoDePrueba('secretaria'));
    fixture.detectChanges();
    expect(texto(fixture)).toContain('se cierran tus sesiones abiertas en otros dispositivos');
    escribir(fixture, 'actual', 'actual-ficticia');
    escribir(fixture, 'nueva', 'contrasena-ficticia-larga');
    escribir(fixture, 'repetida', 'contrasena-ficticia-larga');

    enviar(fixture);
    servidor
      .expectOne('/api/sesion/contrasena')
      .flush(null, { status: 204, statusText: 'No Content' });
    await vi.waitFor(() => servidor.expectOne('/api/sesion').flush(estadoDePrueba('secretaria')));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(navegar).not.toHaveBeenCalled();
    expect(texto(fixture)).toContain('Tu contraseña se cambió');
  });

  it('en el cambio obligatorio sigue el paso siguiente que indica el backend', async () => {
    const { fixture, servidor, sesion, navegar } = montar(CambiarContrasena);
    sesion.establecer(estadoDePrueba('administrador', 'cambiar_contrasena'));
    fixture.detectChanges();
    expect(texto(fixture)).toContain('Tenés que elegir una contraseña nueva');
    escribir(fixture, 'actual', 'actual-ficticia');
    escribir(fixture, 'nueva', 'contrasena-ficticia-larga');
    escribir(fixture, 'repetida', 'contrasena-ficticia-larga');

    enviar(fixture);
    servidor
      .expectOne('/api/sesion/contrasena')
      .flush(null, { status: 204, statusText: 'No Content' });
    await vi.waitFor(() =>
      servidor
        .expectOne('/api/sesion')
        .flush(estadoDePrueba('administrador', 'activar_segundo_factor')),
    );
    await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith('/activar-segundo-factor'));
  });
});

describe('ActivarSegundoFactor (RNF-04)', () => {
  it('muestra el QR, los códigos una sola vez y exige confirmar que se guardaron', async () => {
    const { fixture, servidor, navegar } = montar(ActivarSegundoFactor);
    servidor
      .expectOne('/api/sesion/segundo-factor/activacion')
      .flush({ qr: 'data:image/png;base64,AAAA' });
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('#codigo')).not.toBeNull();
    });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img.qr')).not.toBeNull();

    escribir(fixture, 'codigo', '123456');
    enviar(fixture);
    servidor
      .expectOne('/api/sesion/segundo-factor/activacion/confirmar')
      .flush({ codigosRecuperacion: ['AAAA-0001', 'AAAA-0002'] });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('AAAA-0001');
    expect(texto(fixture)).toContain('única vez');
    const continuar = [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find(
      (b) => b.textContent?.includes('Continuar'),
    )!;
    expect(continuar.disabled).toBe(true);

    const casilla = fixture.nativeElement.querySelector('#guardados') as HTMLInputElement;
    casilla.click();
    fixture.detectChanges();
    expect(continuar.disabled).toBe(false);
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0);

    continuar.click();
    await vi.waitFor(() =>
      servidor.expectOne('/api/sesion').flush(estadoDePrueba('administrador')),
    );
    await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith('/secretaria/agenda'));
  });

  it('un código inválido se informa junto al campo y no muestra códigos de recuperación', async () => {
    const { fixture, servidor } = montar(ActivarSegundoFactor);
    servidor
      .expectOne('/api/sesion/segundo-factor/activacion')
      .flush({ qr: 'data:image/png;base64,AAAA' });
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('#codigo')).not.toBeNull();
    });
    fixture.detectChanges();

    escribir(fixture, 'codigo', '000000');
    enviar(fixture);
    servidor
      .expectOne('/api/sesion/segundo-factor/activacion/confirmar')
      .flush(
        { error: { codigo: 'codigo_invalido', mensaje: 'El código no es válido.' } },
        { status: 400, statusText: 'Bad Request' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#error-codigo')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.codigos')).toBeNull();
  });
});

describe('VerificarSegundoFactor (RNF-04)', () => {
  it('envía el código tal cual y sigue al inicio del rol', async () => {
    const { fixture, servidor, navegar } = montar(VerificarSegundoFactor);
    escribir(fixture, 'codigo', ' ABCD-1234 ');

    enviar(fixture);
    const verificacion = servidor.expectOne('/api/sesion/segundo-factor/verificar');
    expect(verificacion.request.body).toEqual({ codigo: 'ABCD-1234' });
    verificacion.flush(null, { status: 204, statusText: 'No Content' });
    await vi.waitFor(() =>
      servidor.expectOne('/api/sesion').flush(estadoDePrueba('administrador')),
    );
    await vi.waitFor(() => expect(navegar).toHaveBeenCalledWith('/secretaria/agenda'));
  });

  it('un código rechazado se informa junto al campo', async () => {
    const { fixture, servidor } = montar(VerificarSegundoFactor);
    escribir(fixture, 'codigo', '000000');

    enviar(fixture);
    servidor
      .expectOne('/api/sesion/segundo-factor/verificar')
      .flush(
        { error: { codigo: 'segundo_factor_invalido', mensaje: 'El código no es válido.' } },
        { status: 403, statusText: 'Forbidden' },
      );
    await fixture.whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('#error-codigo')?.textContent).toContain(
      'no es válido',
    );
  });
});
