import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { CuentaListada } from '../nucleo/cuentas/cuentas';
import { erroresDeApi } from '../nucleo/http/interceptores';
import { CuentasAdmin } from './cuentas-admin';

const admin: CuentaListada = {
  id: 1,
  nombreUsuario: 'admin.ficticio',
  rol: 'administrador',
  activo: true,
  debeCambiarContrasena: false,
};
const secretaria: CuentaListada = {
  id: 2,
  nombreUsuario: 'secretaria.ficticia',
  rol: 'secretaria',
  activo: true,
  debeCambiarContrasena: false,
};
const inactiva: CuentaListada = {
  id: 3,
  nombreUsuario: 'baja.ficticia',
  rol: 'secretaria',
  activo: false,
  debeCambiarContrasena: false,
};

const TEMPORAL = 'temporal-ficticia-123';
const FORMULARIO_DEL_PANEL = 'section[aria-labelledby="titulo-panel"] form';

async function montar(cuentas: CuentaListada[] = [admin, secretaria, inactiva]) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(withInterceptors([erroresDeApi])),
      provideHttpClientTesting(),
    ],
  });
  const fixture = TestBed.createComponent(CuentasAdmin);
  const servidor = TestBed.inject(HttpTestingController);
  fixture.detectChanges();
  servidor.expectOne({ method: 'GET', url: '/api/cuentas' }).flush({ cuentas });
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('table')).not.toBeNull();
  });
  return { fixture, servidor };
}

const raiz = (f: ComponentFixture<unknown>) => f.nativeElement as HTMLElement;
const texto = (f: ComponentFixture<unknown>) => raiz(f).textContent ?? '';
const entrada = (f: ComponentFixture<unknown>, id: string) =>
  raiz(f).querySelector('#' + id) as HTMLInputElement;

function escribir(f: ComponentFixture<unknown>, id: string, valor: string): void {
  entrada(f, id).value = valor;
}

function enviar(f: ComponentFixture<unknown>, selector = 'form'): void {
  (raiz(f).querySelector(selector) as HTMLFormElement).dispatchEvent(
    new Event('submit', { cancelable: true }),
  );
}

function boton(f: ComponentFixture<unknown>, contiene: string): HTMLButtonElement {
  const encontrado = [...raiz(f).querySelectorAll('button')].find((b) =>
    b.textContent?.includes(contiene),
  );
  if (!encontrado) throw new Error('no hay botón con "' + contiene + '"');
  return encontrado;
}

function error(codigo: string, estado: number, campos?: string[]) {
  return {
    cuerpo: { error: { codigo, mensaje: 'Mensaje del sistema.', ...(campos ? { campos } : {}) } },
    opciones: { status: estado, statusText: 'Error' },
  };
}

/** Responde el listado que el componente vuelve a pedir después de una operación. */
async function responderRecarga(
  servidor: HttpTestingController,
  fixture: ComponentFixture<unknown>,
  cuentas: CuentaListada[],
): Promise<void> {
  await vi.waitFor(() =>
    servidor.expectOne({ method: 'GET', url: '/api/cuentas' }).flush({ cuentas }),
  );
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('CuentasAdmin (RF-04, RF-08, RF-09)', () => {
  it('lista usuario, rol, estado y si debe cambiar la contraseña', async () => {
    const { fixture } = await montar([
      admin,
      { ...secretaria, debeCambiarContrasena: true },
      inactiva,
    ]);

    const filas = raiz(fixture).querySelectorAll('tbody tr');
    expect(filas).toHaveLength(3);
    expect(filas[1]?.textContent).toContain('secretaria.ficticia');
    expect(filas[1]?.textContent).toContain('Secretaría');
    expect(filas[1]?.textContent).toContain('Activa');
    expect(filas[1]?.textContent).toContain('Debe cambiarla');
    expect(filas[2]?.textContent).toContain('Desactivada');
  });

  it('la cuenta del administrador y las desactivadas no tienen acciones', async () => {
    const { fixture } = await montar();

    const filas = raiz(fixture).querySelectorAll('tbody tr');
    expect(filas[0]?.querySelectorAll('button')).toHaveLength(0);
    expect(filas[0]?.textContent).toContain('línea de comandos');
    expect(filas[1]?.querySelectorAll('button')).toHaveLength(2);
    expect(filas[2]?.querySelectorAll('button')).toHaveLength(0);
  });

  it('muestra la política de contraseñas y no ofrece elegir el rol', async () => {
    const { fixture } = await montar();

    expect(texto(fixture)).toContain('al menos 12 caracteres');
    expect(entrada(fixture, 'rol')).toBeNull();
  });

  it('valida el alta en el cliente, con el error asociado al campo y el foco en el primero', async () => {
    vi.useFakeTimers();
    try {
      const { fixture, servidor } = await montar();
      escribir(fixture, 'usuario', 'ab');
      escribir(fixture, 'temporal', 'corta');

      enviar(fixture);
      fixture.detectChanges();
      vi.runAllTimers();

      expect(entrada(fixture, 'usuario').getAttribute('aria-invalid')).toBe('true');
      expect(entrada(fixture, 'usuario').getAttribute('aria-describedby')).toBe('error-usuario');
      expect(entrada(fixture, 'temporal').getAttribute('aria-describedby')).toContain(
        'error-temporal',
      );
      expect(document.activeElement).toBe(entrada(fixture, 'usuario'));
      servidor.expectNone({ method: 'POST', url: '/api/cuentas' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('da de alta una secretaría, limpia la temporal y recarga el listado', async () => {
    const { fixture, servidor } = await montar();
    escribir(fixture, 'usuario', ' nueva.ficticia ');
    escribir(fixture, 'temporal', TEMPORAL);

    enviar(fixture);
    const alta = servidor.expectOne({ method: 'POST', url: '/api/cuentas' });
    expect(alta.request.body).toEqual({
      nombreUsuario: 'nueva.ficticia',
      contrasenaTemporal: TEMPORAL,
    });
    alta.flush(
      { cuenta: { ...secretaria, id: 4, nombreUsuario: 'nueva.ficticia' } },
      { status: 201, statusText: 'Created' },
    );
    await responderRecarga(servidor, fixture, [admin]);

    expect(entrada(fixture, 'temporal').value).toBe('');
    expect(entrada(fixture, 'usuario').value).toBe('');
    expect(texto(fixture)).toContain('Se creó la cuenta nueva.ficticia');
    expect(texto(fixture)).not.toContain(TEMPORAL);
  });

  it('el 409 nombre_usuario_en_uso queda en el campo de usuario y limpia la temporal', async () => {
    const { fixture, servidor } = await montar();
    escribir(fixture, 'usuario', 'secretaria.ficticia');
    escribir(fixture, 'temporal', TEMPORAL);

    enviar(fixture);
    const { cuerpo, opciones } = error('nombre_usuario_en_uso', 409);
    servidor.expectOne({ method: 'POST', url: '/api/cuentas' }).flush(cuerpo, opciones);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(raiz(fixture).querySelector('#error-usuario')?.textContent).toContain('Ya existe');
    expect(entrada(fixture, 'usuario').getAttribute('aria-invalid')).toBe('true');
    expect(entrada(fixture, 'temporal').value).toBe('');
  });

  it.each(['contrasena_comun', 'contrasena_corta', 'contrasena_en_blanco'])(
    'el 400 %s de política queda en el campo de la temporal',
    async (codigo) => {
      const { fixture, servidor } = await montar();
      escribir(fixture, 'usuario', 'nueva.ficticia');
      escribir(fixture, 'temporal', TEMPORAL);

      enviar(fixture);
      const { cuerpo, opciones } = error(codigo, 400);
      servidor.expectOne({ method: 'POST', url: '/api/cuentas' }).flush(cuerpo, opciones);
      await fixture.whenStable();
      fixture.detectChanges();

      expect(raiz(fixture).querySelector('#error-temporal')?.textContent).toContain(
        'Mensaje del sistema.',
      );
      expect(entrada(fixture, 'temporal').getAttribute('aria-invalid')).toBe('true');
    },
  );

  it('un 400 de validación del nombre de usuario queda en ese campo', async () => {
    const { fixture, servidor } = await montar();
    escribir(fixture, 'usuario', 'nueva.ficticia');
    escribir(fixture, 'temporal', TEMPORAL);

    enviar(fixture);
    const { cuerpo, opciones } = error('datos_invalidos', 400, ['body.nombreUsuario']);
    servidor.expectOne({ method: 'POST', url: '/api/cuentas' }).flush(cuerpo, opciones);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(raiz(fixture).querySelector('#error-usuario')).not.toBeNull();
    expect(raiz(fixture).querySelector('#error-temporal')).toBeNull();
  });

  it('restablece con una temporal nueva, avisa el efecto, limpia el campo y recarga', async () => {
    const { fixture, servidor } = await montar();
    boton(fixture, 'Restablecer contraseña').click();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('Se cierran todas sus sesiones');
    expect(texto(fixture)).toContain('se levanta el bloqueo');
    escribir(fixture, 'nueva-temporal', TEMPORAL);
    enviar(fixture, FORMULARIO_DEL_PANEL);

    const peticion = servidor.expectOne({
      method: 'POST',
      url: '/api/cuentas/2/restablecimiento',
    });
    expect(peticion.request.body).toEqual({ contrasenaTemporal: TEMPORAL });
    peticion.flush(null, { status: 204, statusText: 'No Content' });
    await responderRecarga(servidor, fixture, [admin, secretaria]);

    expect(texto(fixture)).toContain('Se restableció la contraseña de secretaria.ficticia');
    expect(raiz(fixture).querySelector('#nueva-temporal')).toBeNull();
    expect(texto(fixture)).not.toContain(TEMPORAL);
  });

  it('una temporal que no cumple la política se muestra en el campo del panel', async () => {
    const { fixture, servidor } = await montar();
    boton(fixture, 'Restablecer contraseña').click();
    fixture.detectChanges();
    escribir(fixture, 'nueva-temporal', TEMPORAL);

    enviar(fixture, FORMULARIO_DEL_PANEL);
    const { cuerpo, opciones } = error('contrasena_comun', 400);
    servidor
      .expectOne({ method: 'POST', url: '/api/cuentas/2/restablecimiento' })
      .flush(cuerpo, opciones);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(raiz(fixture).querySelector('#error-nueva-temporal')?.textContent).toContain(
      'Mensaje del sistema.',
    );
    expect(entrada(fixture, 'nueva-temporal').value).toBe('');
  });

  it.each([
    ['cuenta_inactiva', 'está desactivada'],
    ['cuenta_de_administrador', 'línea de comandos'],
  ])('el 409 %s al restablecer da un mensaje claro y recarga', async (codigo, fragmento) => {
    const { fixture, servidor } = await montar();
    boton(fixture, 'Restablecer contraseña').click();
    fixture.detectChanges();
    escribir(fixture, 'nueva-temporal', TEMPORAL);

    enviar(fixture, FORMULARIO_DEL_PANEL);
    const { cuerpo, opciones } = error(codigo, 409);
    servidor
      .expectOne({ method: 'POST', url: '/api/cuentas/2/restablecimiento' })
      .flush(cuerpo, opciones);
    await responderRecarga(servidor, fixture, [admin]);

    expect(raiz(fixture).querySelector('#error-cuentas')?.textContent).toContain(fragmento);
  });

  it('desactivar pide confirmación explícita y no llama a la API hasta confirmar', async () => {
    const { fixture, servidor } = await montar();
    boton(fixture, 'Desactivar').click();
    fixture.detectChanges();

    expect(texto(fixture)).toContain('no se reactivan ni se borran');
    servidor.expectNone({ method: 'POST', url: '/api/cuentas/2/desactivacion' });

    boton(fixture, 'Sí, desactivar la cuenta').click();
    servidor
      .expectOne({ method: 'POST', url: '/api/cuentas/2/desactivacion' })
      .flush(null, { status: 204, statusText: 'No Content' });
    await responderRecarga(servidor, fixture, [admin, { ...secretaria, activo: false }]);

    expect(texto(fixture)).toContain('Se desactivó la cuenta secretaria.ficticia');
    expect(raiz(fixture).querySelectorAll('tbody tr')[1]?.querySelectorAll('button')).toHaveLength(
      0,
    );
  });

  it('cancelar la confirmación no desactiva nada', async () => {
    const { fixture, servidor } = await montar();
    boton(fixture, 'Desactivar').click();
    fixture.detectChanges();

    boton(fixture, 'No, cancelar').click();
    fixture.detectChanges();

    servidor.expectNone({ method: 'POST', url: '/api/cuentas/2/desactivacion' });
    expect(texto(fixture)).not.toContain('no se reactivan ni se borran');
  });
});
