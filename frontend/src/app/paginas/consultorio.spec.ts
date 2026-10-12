import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { DatosConsultorio } from '../nucleo/consultorio/consultorio';
import { erroresDeApi } from '../nucleo/http/interceptores';
import { ConsultorioPagina } from './consultorio';

const datos: DatosConsultorio = {
  nombre: 'Consultorio Ficticio',
  direccion: 'Calle Falsa 123',
  telefono: '0000-0000',
};

async function montar(respuesta?: { cuerpo: object; estado: number }) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(withInterceptors([erroresDeApi])),
      provideHttpClientTesting(),
    ],
  });
  const fixture = TestBed.createComponent(ConsultorioPagina);
  const servidor = TestBed.inject(HttpTestingController);
  fixture.detectChanges();
  const lectura = servidor.expectOne({ method: 'GET', url: '/api/consultorio' });
  if (respuesta) {
    lectura.flush(respuesta.cuerpo, { status: respuesta.estado, statusText: 'Error' });
  } else {
    lectura.flush({ consultorio: datos });
  }
  await vi.waitFor(() => {
    fixture.detectChanges();
    expect(raiz(fixture).textContent).not.toContain('Cargando');
  });
  return { fixture, servidor };
}

const raiz = (f: ComponentFixture<unknown>) => f.nativeElement as HTMLElement;
const entrada = (f: ComponentFixture<unknown>, id: string) =>
  raiz(f).querySelector('#' + id) as HTMLInputElement;
const enviar = (f: ComponentFixture<unknown>) =>
  (raiz(f).querySelector('form') as HTMLFormElement).dispatchEvent(
    new Event('submit', { cancelable: true }),
  );
const error = (codigo: string, campos?: string[]) => ({
  cuerpo: { error: { codigo, mensaje: 'Mensaje del sistema.', ...(campos ? { campos } : {}) } },
});

describe('ConsultorioPagina (RF-13)', () => {
  it('muestra los datos vigentes y los carga en el formulario', async () => {
    const { fixture } = await montar();

    expect(raiz(fixture).querySelector('#vigente-nombre')?.textContent).toBe(datos.nombre);
    expect(raiz(fixture).querySelector('#vigente-direccion')?.textContent).toBe(datos.direccion);
    expect(entrada(fixture, 'telefono').value).toBe(datos.telefono);
  });

  it('guarda y muestra lo que devolvió el backend, no lo que se escribió', async () => {
    const { fixture, servidor } = await montar();
    entrada(fixture, 'nombre').value = '  Consultorio Nuevo  ';

    enviar(fixture);
    const peticion = servidor.expectOne({ method: 'PUT', url: '/api/consultorio' });
    expect(peticion.request.body).toEqual({ ...datos, nombre: 'Consultorio Nuevo' });
    peticion.flush({ consultorio: { ...datos, nombre: 'Lo guardado' } });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(raiz(fixture).querySelector('#vigente-nombre')?.textContent).toBe('Lo guardado');
    expect(raiz(fixture).querySelector('[role="status"]')?.textContent).toContain('Se guardaron');
  });

  it('un campo vacío se marca sin llamar al backend y recibe el foco', async () => {
    const { fixture, servidor } = await montar();
    entrada(fixture, 'direccion').value = '   ';

    enviar(fixture);
    fixture.detectChanges();

    servidor.expectNone({ method: 'PUT', url: '/api/consultorio' });
    expect(raiz(fixture).querySelector('#error-direccion')?.textContent).toContain('obligatorio');
    expect(entrada(fixture, 'direccion').getAttribute('aria-describedby')).toBe('error-direccion');
    expect(entrada(fixture, 'direccion').getAttribute('aria-invalid')).toBe('true');
    await vi.waitFor(() => expect(document.activeElement).toBe(entrada(fixture, 'direccion')));
  });

  it('asocia un 400 por campo al campo', async () => {
    const { fixture, servidor } = await montar();

    enviar(fixture);
    servidor
      .expectOne({ method: 'PUT', url: '/api/consultorio' })
      .flush(error('datos_invalidos', ['body.telefono']).cuerpo, {
        status: 400,
        statusText: 'Bad',
      });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(raiz(fixture).querySelector('#error-telefono')).not.toBeNull();
    expect(raiz(fixture).querySelector('#error-nombre')).toBeNull();
  });

  it('409 consultorio_no_instalado muestra un mensaje claro', async () => {
    const { fixture } = await montar({ ...error('consultorio_no_instalado'), estado: 409 });

    expect(raiz(fixture).querySelector('[role="alert"]')?.textContent).toContain(
      'todavía no está instalado',
    );
  });

  it('otro error de la API se muestra como mensaje general', async () => {
    const { fixture } = await montar({ ...error('no_autorizado'), estado: 403 });

    expect(raiz(fixture).querySelector('[role="alert"]')?.textContent).toContain(
      'Mensaje del sistema.',
    );
  });
});
