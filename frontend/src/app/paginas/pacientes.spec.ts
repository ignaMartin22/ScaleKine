import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { erroresDeApi } from '../nucleo/http/interceptores';
import type { TurnoDePaciente } from '../nucleo/agenda/agenda';
import type { Paciente } from '../nucleo/pacientes/pacientes';
import { PacienteFicha } from './paciente-ficha';
import { PacientesPagina } from './pacientes';

const ana: Paciente = {
  id: 7,
  dni: '30123456',
  nombre: 'Ana Ficticia',
  telefono: '1100000000',
  obraSocial: 'Particular',
};

function configurar() {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(withInterceptors([erroresDeApi])),
      provideHttpClientTesting(),
    ],
  });
  return TestBed.inject(HttpTestingController);
}

const raiz = (f: ComponentFixture<unknown>) => f.nativeElement as HTMLElement;
const campo = (f: ComponentFixture<unknown>, id: string) =>
  raiz(f).querySelector('#' + id) as HTMLInputElement;

function enviar(f: ComponentFixture<unknown>, selector: string): void {
  (raiz(f).querySelector(selector) as HTMLFormElement).dispatchEvent(
    new Event('submit', { cancelable: true }),
  );
}

function error(codigo: string, campos?: string[]) {
  return { error: { codigo, mensaje: 'Mensaje del sistema.', ...(campos ? { campos } : {}) } };
}

const hayPeticionesDeBusqueda = (servidor: HttpTestingController) =>
  servidor.match((p) => p.url === '/api/pacientes').length;

async function aparece(f: ComponentFixture<unknown>, selector: string): Promise<void> {
  await vi.waitFor(() => {
    f.detectChanges();
    expect(raiz(f).querySelector(selector)).not.toBeNull();
  });
}

async function estable(f: ComponentFixture<unknown>): Promise<void> {
  await f.whenStable();
  f.detectChanges();
}

function llenarAlta(f: ComponentFixture<unknown>, valores: Record<string, string> = {}) {
  const todos = {
    'paciente-dni': '30.123.456',
    'paciente-nombre': 'Ana Ficticia',
    'paciente-telefono': '1100000000',
    'paciente-obra-social': 'Particular',
    ...valores,
  };
  for (const [id, valor] of Object.entries(todos)) campo(f, id).value = valor;
}

const FORM_ALTA = 'section[aria-labelledby="titulo-alta"] form';

describe('PacientesPagina: buscador (RF-19, RF-21)', () => {
  function montar() {
    const servidor = configurar();
    const fixture = TestBed.createComponent(PacientesPagina);
    fixture.detectChanges();
    return { fixture, servidor };
  }

  function elegirNombre(fixture: ComponentFixture<unknown>) {
    const radio = raiz(fixture).querySelector('input[value="nombre"]') as HTMLInputElement;
    radio.dispatchEvent(new Event('change'));
    fixture.detectChanges();
  }

  it('por DNI normaliza y manda solo dni', async () => {
    const { fixture, servidor } = montar();
    campo(fixture, 'buscar-texto').value = '30.123.456';

    enviar(fixture, 'section[aria-labelledby="titulo-buscar"] form');
    const peticion = servidor.expectOne((p) => p.url === '/api/pacientes');
    expect(peticion.request.params.keys()).toEqual(['dni']);
    expect(peticion.request.params.get('dni')).toBe('30123456');
    peticion.flush({ pacientes: [ana] });
    await estable(fixture);

    const enlace = raiz(fixture).querySelector('#resultados a') as HTMLAnchorElement;
    expect(enlace.textContent).toContain('Ana Ficticia');
    expect(enlace.textContent).toContain('30123456');
    expect(enlace.getAttribute('href')).toBe('/secretaria/pacientes/7');
  });

  it('un DNI con formato inválido es un error del campo y no pega a la API', () => {
    const { fixture, servidor } = montar();
    campo(fixture, 'buscar-texto').value = '12-345';

    enviar(fixture, 'section[aria-labelledby="titulo-buscar"] form');
    fixture.detectChanges();

    expect(hayPeticionesDeBusqueda(servidor)).toBe(0);
    expect(raiz(fixture).querySelector('#error-buscar-texto')?.textContent).toContain('7 u 8');
    expect(campo(fixture, 'buscar-texto').getAttribute('aria-invalid')).toBe('true');
    expect(raiz(fixture).querySelector('#resultados')).toBeNull();
  });

  it('por nombre manda solo nombre', async () => {
    const { fixture, servidor } = montar();
    elegirNombre(fixture);
    campo(fixture, 'buscar-texto').value = '  Fictic ';

    enviar(fixture, 'section[aria-labelledby="titulo-buscar"] form');
    const peticion = servidor.expectOne((p) => p.url === '/api/pacientes');
    expect(peticion.request.params.keys()).toEqual(['nombre']);
    expect(peticion.request.params.get('nombre')).toBe('Fictic');
    peticion.flush({ pacientes: [ana] });
    await estable(fixture);
    expect(raiz(fixture).querySelectorAll('#resultados li')).toHaveLength(1);
  });

  it('por nombre no llama a la API con menos de 3 caracteres', () => {
    const { fixture, servidor } = montar();
    elegirNombre(fixture);
    campo(fixture, 'buscar-texto').value = ' An ';

    enviar(fixture, 'section[aria-labelledby="titulo-buscar"] form');
    fixture.detectChanges();

    expect(hayPeticionesDeBusqueda(servidor)).toBe(0);
    expect(raiz(fixture).querySelector('#error-buscar-texto')?.textContent).toContain('3');
  });

  it('por nombre con exactamente 3 caracteres sí busca', () => {
    const { fixture, servidor } = montar();
    elegirNombre(fixture);
    campo(fixture, 'buscar-texto').value = 'Ana';

    enviar(fixture, 'section[aria-labelledby="titulo-buscar"] form');

    servidor.expectOne((p) => p.url === '/api/pacientes').flush({ pacientes: [] });
  });

  it('un DNI sin resultados ofrece el alta con ese DNI precargado', async () => {
    const { fixture, servidor } = montar();
    campo(fixture, 'buscar-texto').value = '30.123.456';
    enviar(fixture, 'section[aria-labelledby="titulo-buscar"] form');
    servidor.expectOne((p) => p.url === '/api/pacientes').flush({ pacientes: [] });
    await estable(fixture);

    expect(raiz(fixture).textContent).toContain('No hay ningún paciente con el DNI 30123456');
    (raiz(fixture).querySelector('#ofrecer-alta') as HTMLButtonElement).click();
    fixture.detectChanges();

    expect(campo(fixture, 'paciente-dni').value).toBe('30123456');
    expect(campo(fixture, 'paciente-nombre').value).toBe('');
  });

  it('una búsqueda por nombre sin resultados no ofrece el alta', async () => {
    const { fixture, servidor } = montar();
    elegirNombre(fixture);
    campo(fixture, 'buscar-texto').value = 'Zzz';
    enviar(fixture, 'section[aria-labelledby="titulo-buscar"] form');
    servidor.expectOne((p) => p.url === '/api/pacientes').flush({ pacientes: [] });
    await estable(fixture);

    expect(raiz(fixture).querySelector('#ofrecer-alta')).toBeNull();
    expect(raiz(fixture).textContent).toContain('No hay pacientes que coincidan');
  });

  it('un error de la API se muestra como alerta', async () => {
    const { fixture, servidor } = montar();
    campo(fixture, 'buscar-texto').value = '30123456';
    enviar(fixture, 'section[aria-labelledby="titulo-buscar"] form');
    servidor
      .expectOne((p) => p.url === '/api/pacientes')
      .flush(error('error_inesperado'), { status: 500, statusText: 'x' });
    await estable(fixture);

    expect(raiz(fixture).querySelector('#error-pacientes')?.textContent).toContain(
      'Mensaje del sistema.',
    );
  });
});

describe('PacientesPagina: alta (RF-17, RF-18)', () => {
  async function montarConAlta() {
    const servidor = configurar();
    const fixture = TestBed.createComponent(PacientesPagina);
    fixture.detectChanges();
    (raiz(fixture).querySelector('#nuevo-paciente') as HTMLButtonElement).click();
    fixture.detectChanges();
    return { fixture, servidor };
  }

  it('exige los cuatro campos y no manda nada si falta alguno', async () => {
    const { fixture, servidor } = await montarConAlta();
    llenarAlta(fixture, { 'paciente-obra-social': '  ' });

    enviar(fixture, FORM_ALTA);
    fixture.detectChanges();

    servidor.expectNone('/api/pacientes');
    const mensaje = raiz(fixture).querySelector('#error-paciente-obra-social');
    expect(mensaje?.textContent).toContain('Particular');
    expect(campo(fixture, 'paciente-obra-social').getAttribute('aria-invalid')).toBe('true');
  });

  it('la obra social no se completa sola con Particular', async () => {
    const { fixture } = await montarConAlta();
    expect(campo(fixture, 'paciente-obra-social').value).toBe('');
  });

  it('un DNI inválido es error del campo DNI', async () => {
    const { fixture, servidor } = await montarConAlta();
    llenarAlta(fixture, { 'paciente-dni': '123' });

    enviar(fixture, FORM_ALTA);
    fixture.detectChanges();

    servidor.expectNone('/api/pacientes');
    expect(raiz(fixture).querySelector('#error-paciente-dni')?.textContent).toContain('7 u 8');
  });

  it('crea con el DNI normalizado y abre la ficha', async () => {
    const { fixture, servidor } = await montarConAlta();
    const router = TestBed.inject(Router);
    const navegar = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    llenarAlta(fixture, { 'paciente-nombre': '  Ana Ficticia ' });

    enviar(fixture, FORM_ALTA);
    const peticion = servidor.expectOne({ method: 'POST', url: '/api/pacientes' });
    expect(peticion.request.body).toEqual({
      dni: '30123456',
      nombre: 'Ana Ficticia',
      telefono: '1100000000',
      obraSocial: 'Particular',
    });
    peticion.flush({ paciente: ana }, { status: 201, statusText: 'Created' });

    await vi.waitFor(() => expect(navegar).toHaveBeenCalled());
    expect(navegar.mock.calls[0]?.[0]).toEqual(['/secretaria/pacientes', 7]);
  });

  it('409 dni_en_uso es error del campo DNI', async () => {
    const { fixture, servidor } = await montarConAlta();
    llenarAlta(fixture);

    enviar(fixture, FORM_ALTA);
    servidor
      .expectOne({ method: 'POST', url: '/api/pacientes' })
      .flush(error('dni_en_uso'), { status: 409, statusText: 'Conflict' });
    await estable(fixture);

    const mensaje = raiz(fixture).querySelector('#error-paciente-dni');
    expect(mensaje?.textContent).toContain('Ya existe un paciente con ese DNI');
    expect(campo(fixture, 'paciente-dni').getAttribute('aria-describedby')).toBe(
      'error-paciente-dni',
    );
    expect(raiz(fixture).querySelector('#error-pacientes')).toBeNull();
  });
});

describe('PacienteFicha (RF-20, RF-21)', () => {
  function montar(id = '7') {
    const servidor = configurar();
    const fixture = TestBed.createComponent(PacienteFicha);
    fixture.componentRef.setInput('id', id);
    fixture.detectChanges();
    return { fixture, servidor };
  }

  async function conFicha() {
    const { fixture, servidor } = montar();
    servidor.expectOne({ method: 'GET', url: '/api/pacientes/7' }).flush({ paciente: ana });
    await aparece(fixture, '#editar');
    return { fixture, servidor };
  }

  it('muestra los cuatro datos', async () => {
    const { fixture } = await conFicha();

    expect(raiz(fixture).querySelector('#ficha-nombre')?.textContent).toBe('Ana Ficticia');
    expect(raiz(fixture).querySelector('#ficha-dni')?.textContent).toBe('30123456');
    expect(raiz(fixture).querySelector('#ficha-telefono')?.textContent).toBe('1100000000');
    expect(raiz(fixture).querySelector('#ficha-obra-social')?.textContent).toBe('Particular');
  });

  it('404 muestra un mensaje claro', async () => {
    const { fixture, servidor } = montar();
    servidor
      .expectOne({ method: 'GET', url: '/api/pacientes/7' })
      .flush(error('paciente_no_encontrado'), { status: 404, statusText: 'Not Found' });
    await aparece(fixture, '#error-ficha');

    expect(raiz(fixture).querySelector('#error-ficha')?.textContent).toContain('no existe');
    expect(raiz(fixture).querySelector('#editar')).toBeNull();
  });

  it('un id que no es número no consulta la API', async () => {
    const { fixture, servidor } = montar('abc');
    await aparece(fixture, '#error-ficha');

    servidor.expectNone((p) => p.url.startsWith('/api/pacientes'));
    expect(raiz(fixture).querySelector('#error-ficha')?.textContent).toContain('no existe');
  });

  it('edita con PUT reemplazando los cuatro datos y muestra lo que devolvió el backend', async () => {
    const { fixture, servidor } = await conFicha();
    (raiz(fixture).querySelector('#editar') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(campo(fixture, 'paciente-nombre').value).toBe('Ana Ficticia');
    campo(fixture, 'paciente-telefono').value = '1100000001';

    enviar(fixture, 'section[aria-labelledby="titulo-editar"] form');
    const peticion = servidor.expectOne({ method: 'PUT', url: '/api/pacientes/7' });
    expect(peticion.request.body).toEqual({
      dni: '30123456',
      nombre: 'Ana Ficticia',
      telefono: '1100000001',
      obraSocial: 'Particular',
    });
    peticion.flush({ paciente: { ...ana, telefono: '1100000001' } });
    await aparece(fixture, '#ficha-telefono');

    expect(raiz(fixture).querySelector('#ficha-telefono')?.textContent).toBe('1100000001');
    expect(raiz(fixture).textContent).toContain('Se guardaron los datos');
  });

  it('409 dni_en_uso al editar es error del campo DNI y se sigue editando', async () => {
    const { fixture, servidor } = await conFicha();
    (raiz(fixture).querySelector('#editar') as HTMLButtonElement).click();
    fixture.detectChanges();

    enviar(fixture, 'section[aria-labelledby="titulo-editar"] form');
    servidor
      .expectOne({ method: 'PUT', url: '/api/pacientes/7' })
      .flush(error('dni_en_uso'), { status: 409, statusText: 'Conflict' });
    await estable(fixture);

    expect(raiz(fixture).querySelector('#error-paciente-dni')?.textContent).toContain(
      'Ya existe un paciente con ese DNI',
    );
    expect(raiz(fixture).querySelector('form')).not.toBeNull();
  });

  it('no deja guardar con un campo vacío', async () => {
    const { fixture, servidor } = await conFicha();
    (raiz(fixture).querySelector('#editar') as HTMLButtonElement).click();
    fixture.detectChanges();
    campo(fixture, 'paciente-nombre').value = '';

    enviar(fixture, 'section[aria-labelledby="titulo-editar"] form');
    fixture.detectChanges();

    servidor.expectNone({ method: 'PUT', url: '/api/pacientes/7' });
    expect(raiz(fixture).querySelector('#error-paciente-nombre')).not.toBeNull();
  });
});

describe('PacienteFicha: próximos e historial (RF-47)', () => {
  const turnoDe = (id: number, cambios: Partial<TurnoDePaciente> = {}): TurnoDePaciente => ({
    id,
    fecha: '2026-10-20',
    horaInicio: '08:00',
    horaFin: '08:45',
    estado: 'reservado',
    coseguroAbonado: null,
    kinesiologo: { id: 3, nombre: 'Kine Ficticio' },
    ...cambios,
  });

  async function conTurnos(proximos: TurnoDePaciente[], historial: TurnoDePaciente[]) {
    const servidor = configurar();
    const fixture = TestBed.createComponent(PacienteFicha);
    fixture.componentRef.setInput('id', '7');
    fixture.detectChanges();
    servidor.expectOne({ method: 'GET', url: '/api/pacientes/7' }).flush({ paciente: ana });
    const t = servidor.expectOne({ method: 'GET', url: '/api/pacientes/7/turnos' });
    expect(t.request.params.keys()).toEqual([]);
    t.flush({ proximos, historial });
    await aparece(fixture, '#editar');
    await aparece(fixture, '#titulo-historial span');
    return { fixture, servidor };
  }

  /** Fechas (DD/MM/AAAA) de las filas de una tabla, en el orden en que se ven. */
  const fechas = (f: ComponentFixture<unknown>, tabla: string) =>
    Array.from(raiz(f).querySelectorAll(`${tabla} tbody tr td:first-child`)).map((e) =>
      e.textContent?.trim(),
    );

  it('muestra fecha, franja, kinesiólogo, estado y coseguro abonado', async () => {
    const { fixture } = await conTurnos(
      [turnoDe(1, { coseguroAbonado: '1500.50' })],
      [
        turnoDe(2, {
          fecha: '2026-10-01',
          estado: 'asistio',
          horaInicio: '09:00',
          horaFin: '09:45',
        }),
      ],
    );
    const proximos = raiz(fixture).querySelector('#tabla-proximos')?.textContent ?? '';
    for (const dato of ['20/10/2026', '08:00 a 08:45', 'Kine Ficticio', 'Reservado', '$ 1500.50']) {
      expect(proximos).toContain(dato);
    }
    const historial = raiz(fixture).querySelector('#tabla-historial')?.textContent ?? '';
    for (const dato of ['01/10/2026', '09:00 a 09:45', 'Asistió', 'Sin abonar']) {
      expect(historial).toContain(dato);
    }
  });

  it('próximos del más cercano al más lejano; historial del más reciente al más antiguo', async () => {
    const { fixture } = await conTurnos(
      [
        turnoDe(1, { fecha: '2026-11-03' }),
        turnoDe(2, { fecha: '2026-10-16' }),
        turnoDe(3, { fecha: '2026-10-20' }),
      ],
      [
        turnoDe(4, { fecha: '2026-09-01' }),
        turnoDe(5, { fecha: '2026-10-10' }),
        turnoDe(6, { fecha: '2026-09-15' }),
      ],
    );
    expect(fechas(fixture, '#tabla-proximos')).toEqual(['16/10/2026', '20/10/2026', '03/11/2026']);
    expect(fechas(fixture, '#tabla-historial')).toEqual(['10/10/2026', '15/09/2026', '01/09/2026']);
  });

  it('sin turnos, dice que no hay en cada lista', async () => {
    const { fixture } = await conTurnos([], []);
    expect(raiz(fixture).querySelector('#sin-proximos')?.textContent).toContain('no tiene');
    expect(raiz(fixture).querySelector('#sin-historial')?.textContent).toContain('no tiene');
  });

  it('las listas no ofrecen acciones nuevas', async () => {
    const { fixture } = await conTurnos([turnoDe(1)], [turnoDe(2)]);
    const tablas = Array.from(raiz(fixture).querySelectorAll('table'));
    expect(tablas.length).toBe(2);
    for (const t of tablas) expect(t.querySelectorAll('button, a').length).toBe(0);
  });

  it('si fallan los turnos, avisa y mantiene los datos del paciente', async () => {
    const servidor = configurar();
    const fixture = TestBed.createComponent(PacienteFicha);
    fixture.componentRef.setInput('id', '7');
    fixture.detectChanges();
    servidor.expectOne({ method: 'GET', url: '/api/pacientes/7' }).flush({ paciente: ana });
    servidor
      .expectOne({ method: 'GET', url: '/api/pacientes/7/turnos' })
      .flush(error('error_interno'), { status: 500, statusText: 'Error' });
    await aparece(fixture, '#error-turnos');
    expect(raiz(fixture).querySelector('#error-turnos')?.getAttribute('role')).toBe('alert');
    expect(raiz(fixture).querySelector('#ficha-nombre')?.textContent).toBe('Ana Ficticia');
  });
});
