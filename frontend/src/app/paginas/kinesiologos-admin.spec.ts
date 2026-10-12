import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { erroresDeApi } from '../nucleo/http/interceptores';
import type { Kinesiologo } from '../nucleo/kinesiologos/kinesiologos';
import { KinesiologosAdmin } from './kinesiologos-admin';

const ana: Kinesiologo = { id: 1, nombre: 'Ana Ficticia', bloque: 'manana', activo: true };
const beto: Kinesiologo = { id: 2, nombre: 'Beto Ficticio', bloque: 'tarde', activo: false };

const TEMPORAL = 'temporal-ficticia-123';

async function montar(lista: Kinesiologo[] = [ana, beto]) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(withInterceptors([erroresDeApi])),
      provideHttpClientTesting(),
    ],
  });
  const fixture = TestBed.createComponent(KinesiologosAdmin);
  const servidor = TestBed.inject(HttpTestingController);
  fixture.detectChanges();
  servidor.expectOne({ method: 'GET', url: '/api/kinesiologos' }).flush({ kinesiologos: lista });
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('table')).not.toBeNull();
  });
  return { fixture, servidor };
}

const raiz = (f: ComponentFixture<unknown>) => f.nativeElement as HTMLElement;
const campo = (f: ComponentFixture<unknown>, id: string) =>
  raiz(f).querySelector('#' + id) as HTMLInputElement & HTMLSelectElement;

function enviar(f: ComponentFixture<unknown>, selector: string): void {
  (raiz(f).querySelector(selector) as HTMLFormElement).dispatchEvent(
    new Event('submit', { cancelable: true }),
  );
}

const FORM_ALTA = 'section[aria-labelledby="titulo-alta"] form';
const FORM_PANEL = 'section[aria-labelledby="titulo-panel"] form';

function llenarAlta(f: ComponentFixture<unknown>, valores: Partial<Record<string, string>> = {}) {
  const todos = {
    nombre: 'Carla Ficticia',
    bloque: 'tarde',
    usuario: 'carla.ficticia',
    temporal: TEMPORAL,
    ...valores,
  };
  for (const [id, valor] of Object.entries(todos)) campo(f, id).value = valor;
}

function error(codigo: string, campos?: string[]) {
  return { error: { codigo, mensaje: 'Mensaje del sistema.', ...(campos ? { campos } : {}) } };
}

async function responderRecarga(
  servidor: HttpTestingController,
  fixture: ComponentFixture<unknown>,
  lista: Kinesiologo[],
  url = '/api/kinesiologos',
): Promise<void> {
  await vi.waitFor(() => servidor.expectOne({ method: 'GET', url }).flush({ kinesiologos: lista }));
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('KinesiologosAdmin (RF-14, RF-16)', () => {
  it('lista nombre, bloque legible y estado de la cuenta', async () => {
    const { fixture } = await montar();

    const filas = raiz(fixture).querySelectorAll('tbody tr');
    expect(filas).toHaveLength(2);
    expect(filas[0]?.textContent).toContain('Ana Ficticia');
    expect(filas[0]?.textContent).toContain('Mañana');
    expect(filas[0]?.textContent).toContain('Activa');
    expect(filas[1]?.textContent).toContain('Tarde');
    expect(filas[1]?.textContent).toContain('Desactivada');
    expect(raiz(fixture).textContent).not.toMatch(/manana/);
  });

  it('el filtro por bloque vuelve a pedir el listado con ?bloque=', async () => {
    const { fixture, servidor } = await montar();

    const filtro = campo(fixture, 'filtro');
    filtro.value = 'tarde';
    filtro.dispatchEvent(new Event('change'));
    await responderRecarga(servidor, fixture, [beto], '/api/kinesiologos?bloque=tarde');

    expect(raiz(fixture).querySelectorAll('tbody tr')).toHaveLength(1);

    filtro.value = '';
    filtro.dispatchEvent(new Event('change'));
    await responderRecarga(servidor, fixture, [ana, beto]);
    expect(raiz(fixture).querySelectorAll('tbody tr')).toHaveLength(2);
  });

  it('muestra la política de contraseñas y explica que la cuenta se gestiona desde Cuentas', async () => {
    const { fixture } = await montar();

    const ayuda = raiz(fixture).querySelector('#ayuda-temporal') as HTMLElement;
    expect(ayuda.textContent).toContain('12 caracteres');
    expect(ayuda.querySelector('a')?.getAttribute('href')).toBe('/admin/cuentas');
    expect(campo(fixture, 'temporal').getAttribute('aria-describedby')).toBe('ayuda-temporal');
  });

  it('da de alta, limpia la temporal y recarga el listado', async () => {
    const { fixture, servidor } = await montar();
    llenarAlta(fixture);

    enviar(fixture, FORM_ALTA);
    const peticion = servidor.expectOne({ method: 'POST', url: '/api/kinesiologos' });
    expect(peticion.request.body).toEqual({
      nombre: 'Carla Ficticia',
      bloque: 'tarde',
      nombreUsuario: 'carla.ficticia',
      contrasenaTemporal: TEMPORAL,
    });
    peticion.flush(
      { kinesiologo: { id: 3, nombre: 'Carla Ficticia', bloque: 'tarde', activo: true } },
      { status: 201, statusText: 'Created' },
    );
    await responderRecarga(servidor, fixture, [
      ana,
      beto,
      { id: 3, nombre: 'Carla Ficticia', bloque: 'tarde', activo: true },
    ]);

    expect(campo(fixture, 'temporal').value).toBe('');
    expect(campo(fixture, 'usuario').value).toBe('');
    expect(raiz(fixture).querySelector('[role="status"]')?.textContent).toContain('Carla Ficticia');
    expect(raiz(fixture).querySelectorAll('tbody tr')).toHaveLength(3);
  });

  it('valida en el cliente, enfoca el primer error y limpia la temporal', async () => {
    const { fixture, servidor } = await montar();
    llenarAlta(fixture, { nombre: ' ', bloque: '', usuario: 'ab', temporal: 'corta' });

    enviar(fixture, FORM_ALTA);
    fixture.detectChanges();

    servidor.expectNone({ method: 'POST', url: '/api/kinesiologos' });
    for (const id of ['nombre', 'bloque', 'usuario', 'temporal']) {
      expect(raiz(fixture).querySelector('#error-' + id)).not.toBeNull();
    }
    expect(campo(fixture, 'temporal').value).toBe('');
    await vi.waitFor(() => expect(document.activeElement).toBe(campo(fixture, 'nombre')));
  });

  it('409 nombre_usuario_en_uso va en el campo de usuario', async () => {
    const { fixture, servidor } = await montar();
    llenarAlta(fixture);

    enviar(fixture, FORM_ALTA);
    servidor
      .expectOne({ method: 'POST', url: '/api/kinesiologos' })
      .flush(error('nombre_usuario_en_uso'), { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(raiz(fixture).querySelector('#error-usuario')?.textContent).toContain('Ya existe');
    expect(campo(fixture, 'usuario').getAttribute('aria-describedby')).toBe('error-usuario');
    expect(campo(fixture, 'temporal').value).toBe('');
    expect(campo(fixture, 'nombre').value).toBe('Carla Ficticia');
  });

  it('un error de política del backend va en la contraseña', async () => {
    const { fixture, servidor } = await montar();
    llenarAlta(fixture);

    enviar(fixture, FORM_ALTA);
    servidor
      .expectOne({ method: 'POST', url: '/api/kinesiologos' })
      .flush(error('contrasena_comun'), { status: 400, statusText: 'Bad' });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(raiz(fixture).querySelector('#error-temporal')?.textContent).toContain('Mensaje');
    expect(campo(fixture, 'temporal').value).toBe('');
  });

  it('un 400 por campo se asocia a cada campo', async () => {
    const { fixture, servidor } = await montar();
    llenarAlta(fixture);

    enviar(fixture, FORM_ALTA);
    servidor
      .expectOne({ method: 'POST', url: '/api/kinesiologos' })
      .flush(error('datos_invalidos', ['body.nombre', 'body.nombreUsuario']), {
        status: 400,
        statusText: 'Bad',
      });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(raiz(fixture).querySelector('#error-nombre')).not.toBeNull();
    expect(raiz(fixture).querySelector('#error-usuario')).not.toBeNull();
    expect(raiz(fixture).querySelector('#error-temporal')).toBeNull();
  });

  it('cambia el bloque avisando que no mueve los turnos, y recarga', async () => {
    const { fixture, servidor } = await montar();

    (raiz(fixture).querySelector('#bloque-1') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(raiz(fixture).querySelector('#ayuda-bloque')?.textContent).toContain('no se mueven');
    // Ana está en la mañana: la propuesta es la tarde.
    expect(campo(fixture, 'nuevo-bloque').value).toBe('tarde');

    enviar(fixture, FORM_PANEL);
    const peticion = servidor.expectOne({ method: 'PUT', url: '/api/kinesiologos/1/bloque' });
    expect(peticion.request.body).toEqual({ bloque: 'tarde' });
    peticion.flush({ kinesiologo: { ...ana, bloque: 'tarde' } });
    await responderRecarga(servidor, fixture, [{ ...ana, bloque: 'tarde' }, beto]);

    expect(raiz(fixture).querySelector(FORM_PANEL)).toBeNull();
    expect(raiz(fixture).querySelector('[role="status"]')?.textContent).toContain('no se movieron');
    expect(raiz(fixture).querySelectorAll('tbody tr')[0]?.textContent).toContain('Tarde');
  });

  it('si el kinesiólogo ya no existe, lo informa y recarga', async () => {
    const { fixture, servidor } = await montar();

    (raiz(fixture).querySelector('#bloque-1') as HTMLButtonElement).click();
    fixture.detectChanges();
    enviar(fixture, FORM_PANEL);
    servidor
      .expectOne({ method: 'PUT', url: '/api/kinesiologos/1/bloque' })
      .flush(error('kinesiologo_no_encontrado'), { status: 404, statusText: 'Not Found' });
    await responderRecarga(servidor, fixture, [beto]);

    expect(raiz(fixture).querySelector('[role="alert"]')?.textContent).toContain('ya no existe');
    expect(raiz(fixture).querySelector(FORM_PANEL)).toBeNull();
  });

  it('cancelar el cambio de bloque cierra el panel y devuelve el foco al botón', async () => {
    const { fixture } = await montar();

    (raiz(fixture).querySelector('#bloque-2') as HTMLButtonElement).click();
    fixture.detectChanges();
    const cancelar = [...raiz(fixture).querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Cancelar'),
    ) as HTMLButtonElement;
    cancelar.click();
    fixture.detectChanges();

    expect(raiz(fixture).querySelector(FORM_PANEL)).toBeNull();
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(raiz(fixture).querySelector('#bloque-2')),
    );
  });
});
