import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { erroresDeApi } from '../nucleo/http/interceptores';
import type { Paciente } from '../nucleo/pacientes/pacientes';
import type { KinesiologoDisponible } from '../nucleo/turnos/disponibilidad';
import { AsignarTurno } from './asignar-turno';

const ana: Paciente = {
  id: 7,
  dni: '30123456',
  nombre: 'Ana Ficticia',
  telefono: '1100000000',
  obraSocial: 'Particular',
};

const disponibles = (horas: string[]): KinesiologoDisponible[] => [
  {
    kinesiologoId: 3,
    nombre: 'Kine Ficticio',
    franjas: horas.map((h) => ({ inicio: h, fin: h.replace(/^(\d\d):\d\d$/, '$1:45') })),
  },
  { kinesiologoId: 4, nombre: 'Otra Ficticia', franjas: [{ inicio: '08:00', fin: '08:45' }] },
];

function montar() {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(withInterceptors([erroresDeApi])),
      provideHttpClientTesting(),
    ],
  });
  const servidor = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(AsignarTurno);
  fixture.detectChanges();
  return { fixture, servidor };
}

const raiz = (f: ComponentFixture<unknown>) => f.nativeElement as HTMLElement;
const q = <T extends HTMLElement = HTMLElement>(f: ComponentFixture<unknown>, s: string) =>
  raiz(f).querySelector(s) as T;
const texto = (f: ComponentFixture<unknown>) => raiz(f).textContent ?? '';

function enviar(f: ComponentFixture<unknown>, dentroDe: string): void {
  q<HTMLFormElement>(f, dentroDe + ' form').dispatchEvent(
    new Event('submit', { cancelable: true }),
  );
}

const seccion = (titulo: string) => `section[aria-labelledby="${titulo}"]`;

async function peticion(servidor: HttpTestingController, url: string, metodo = 'GET') {
  return vi.waitFor(() =>
    servidor.expectOne((p) => p.url === url && p.method === metodo),
  ) as Promise<TestRequest>;
}

async function aparece(f: ComponentFixture<unknown>, selector: string): Promise<void> {
  await vi.waitFor(() => {
    f.detectChanges();
    expect(q(f, selector)).not.toBeNull();
  });
}

function error(codigo: string, estado = 409, campos?: string[]) {
  return [
    { error: { codigo, mensaje: 'Mensaje del sistema.', ...(campos ? { campos } : {}) } },
    { status: estado, statusText: 'Error' },
  ] as const;
}

/** Elige fecha y bloque y responde la primera disponibilidad (sin paciente). */
async function conDisponibilidad(
  f: ComponentFixture<unknown>,
  s: HttpTestingController,
  { fecha = '2026-10-14', horas = ['08:00', '09:00'] } = {},
) {
  q<HTMLInputElement>(f, '#fecha-turno').value = fecha;
  enviar(f, seccion('titulo-fecha'));
  const p = s.expectOne((r) => r.url === '/api/disponibilidad');
  p.flush({ fecha, bloque: 'manana', kinesiologos: disponibles(horas) });
  await aparece(f, 'input[name="franja"]');
  return p;
}

/** Busca el DNI de Ana y responde la disponibilidad que se vuelve a pedir con su `pacienteId`. */
async function conPacienteAna(
  f: ComponentFixture<unknown>,
  s: HttpTestingController,
  horas = ['08:00', '09:00'],
) {
  q<HTMLInputElement>(f, '#dni-turno').value = '30.123.456';
  enviar(f, seccion('titulo-paciente'));
  (await peticion(s, '/api/pacientes')).flush({ pacientes: [ana] });
  const d = await peticion(s, '/api/disponibilidad');
  d.flush({ fecha: '2026-10-14', bloque: 'manana', kinesiologos: disponibles(horas) });
  await aparece(f, '#paciente-elegido');
  await vi.waitFor(() => {
    f.detectChanges();
    expect(q<HTMLInputElement>(f, 'input[name="franja"]').disabled).toBe(false);
  });
  return d;
}

function elegir(f: ComponentFixture<unknown>, id: string): void {
  const radio = q<HTMLInputElement>(f, '#' + id);
  radio.checked = true;
  radio.dispatchEvent(new Event('change'));
  f.detectChanges();
}

describe('AsignarTurno: fecha, bloque y disponibilidad (RF-22, RF-15)', () => {
  it('sin fecha avisa y no consulta', () => {
    const { fixture, servidor } = montar();
    enviar(fixture, seccion('titulo-fecha'));
    fixture.detectChanges();
    expect(q(fixture, '#error-fecha-turno').textContent).toContain('Elegí la fecha');
    expect(q(fixture, '#fecha-turno').getAttribute('aria-invalid')).toBe('true');
    servidor.expectNone('/api/disponibilidad');
  });

  it('pide fecha y bloque, y muestra los kinesiólogos con sus franjas', async () => {
    const { fixture, servidor } = montar();
    q<HTMLInputElement>(fixture, '#fecha-turno').value = '2026-10-14';
    q(fixture, 'input[value="tarde"]').dispatchEvent(new Event('change'));
    enviar(fixture, seccion('titulo-fecha'));
    const p = servidor.expectOne((r) => r.url === '/api/disponibilidad');
    expect(p.request.params.get('fecha')).toBe('2026-10-14');
    expect(p.request.params.get('bloque')).toBe('tarde');
    expect(p.request.params.has('pacienteId')).toBe(false);
    p.flush({ fecha: '2026-10-14', bloque: 'tarde', kinesiologos: disponibles(['15:00']) });
    await aparece(fixture, 'input[name="franja"]');
    expect(texto(fixture)).toContain('Kine Ficticio');
    expect(texto(fixture)).toContain('Otra Ficticia');
    expect(raiz(fixture).querySelectorAll('input[name="franja"]').length).toBe(2);
  });

  it('un sábado explica que no hay turnos', async () => {
    const { fixture, servidor } = montar();
    q<HTMLInputElement>(fixture, '#fecha-turno').value = '2026-10-17';
    enviar(fixture, seccion('titulo-fecha'));
    servidor
      .expectOne((r) => r.url === '/api/disponibilidad')
      .flush({
        fecha: '2026-10-17',
        bloque: 'manana',
        kinesiologos: [{ kinesiologoId: 3, nombre: 'Kine Ficticio', franjas: [] }],
      });
    await aparece(fixture, '#sin-franjas');
    expect(q(fixture, '#sin-franjas').textContent).toContain('sábados y domingos');
    expect(q(fixture, 'input[name="franja"]')).toBeNull();
  });

  it('un día hábil sin franjas libres lo dice', async () => {
    const { fixture, servidor } = montar();
    q<HTMLInputElement>(fixture, '#fecha-turno').value = '2026-10-14';
    enviar(fixture, seccion('titulo-fecha'));
    servidor
      .expectOne((r) => r.url === '/api/disponibilidad')
      .flush({
        fecha: '2026-10-14',
        bloque: 'manana',
        kinesiologos: [{ kinesiologoId: 3, nombre: 'Kine Ficticio', franjas: [] }],
      });
    await aparece(fixture, '#sin-franjas');
    expect(q(fixture, '#sin-franjas').textContent).toContain('No quedan franjas libres');
  });

  it('un error de la API se muestra como alerta', async () => {
    const { fixture, servidor } = montar();
    q<HTMLInputElement>(fixture, '#fecha-turno').value = '2026-10-14';
    enviar(fixture, seccion('titulo-fecha'));
    const [cuerpo, opciones] = error('datos_invalidos', 400);
    servidor.expectOne((r) => r.url === '/api/disponibilidad').flush(cuerpo, opciones);
    await aparece(fixture, '#error-disponibilidad');
    expect(q(fixture, '#error-disponibilidad').textContent).toContain('Mensaje del sistema.');
  });
});

describe('AsignarTurno: paciente por DNI (RF-17, RF-19, RF-25)', () => {
  it('al elegir un paciente existente vuelve a pedir la disponibilidad con pacienteId', async () => {
    const { fixture, servidor } = montar();
    await conDisponibilidad(fixture, servidor);

    q<HTMLInputElement>(fixture, '#dni-turno').value = '30.123.456';
    enviar(fixture, seccion('titulo-paciente'));
    const busqueda = await peticion(servidor, '/api/pacientes');
    expect(busqueda.request.params.keys()).toEqual(['dni']);
    expect(busqueda.request.params.get('dni')).toBe('30123456');
    busqueda.flush({ pacientes: [ana] });

    const nueva = await peticion(servidor, '/api/disponibilidad');
    expect(nueva.request.params.get('pacienteId')).toBe('7');
    expect(nueva.request.params.get('fecha')).toBe('2026-10-14');
    expect(nueva.request.params.get('bloque')).toBe('manana');
    nueva.flush({ fecha: '2026-10-14', bloque: 'manana', kinesiologos: disponibles(['09:00']) });
    await aparece(fixture, '#paciente-elegido');
    expect(q(fixture, '#paciente-elegido').textContent).toContain('Ana Ficticia');
    // La hora que el paciente ya tenía ocupada ya no se ofrece.
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(q(fixture, '#franja-3-0800')).toBeNull();
      expect(q(fixture, '#franja-3-0900')).not.toBeNull();
    });
  });

  it('si la franja ya elegida deja de estar libre para el paciente, se descarta y se avisa', async () => {
    const { fixture, servidor } = montar();
    await conDisponibilidad(fixture, servidor);
    elegir(fixture, 'franja-3-0800');
    expect(q(fixture, '#resumen-franja').textContent).toContain('08:00');

    await conPacienteAna(fixture, servidor, ['09:00']);
    await aparece(fixture, '#aviso-franja');
    expect(q(fixture, '#resumen-franja')).toBeNull();
  });

  it('un DNI con formato inválido no consulta', () => {
    const { fixture, servidor } = montar();
    q<HTMLInputElement>(fixture, '#fecha-turno').value = '2026-10-14';
    enviar(fixture, seccion('titulo-fecha'));
    servidor.expectOne((r) => r.url === '/api/disponibilidad');
    fixture.detectChanges();
    q<HTMLInputElement>(fixture, '#dni-turno').value = '123';
    enviar(fixture, seccion('titulo-paciente'));
    fixture.detectChanges();
    expect(q(fixture, '#error-dni-turno').textContent).toContain('7 u 8 dígitos');
    servidor.expectNone('/api/pacientes');
  });

  it('un DNI inexistente ofrece el alta y, al crearlo, queda elegido', async () => {
    const { fixture, servidor } = montar();
    await conDisponibilidad(fixture, servidor);

    q<HTMLInputElement>(fixture, '#dni-turno').value = '30123456';
    enviar(fixture, seccion('titulo-paciente'));
    (await peticion(servidor, '/api/pacientes')).flush({ pacientes: [] });
    await aparece(fixture, '#ofrecer-alta');
    expect(q(fixture, '#sin-paciente').textContent).toContain('30123456');

    q(fixture, '#ofrecer-alta').click();
    fixture.detectChanges();
    expect(q<HTMLInputElement>(fixture, '#paciente-dni').value).toBe('30123456');
    q<HTMLInputElement>(fixture, '#paciente-nombre').value = 'Ana Ficticia';
    q<HTMLInputElement>(fixture, '#paciente-telefono').value = '1100000000';
    q<HTMLInputElement>(fixture, '#paciente-obra-social').value = 'Particular';
    enviar(fixture, 'app-formulario-paciente');

    const alta = await peticion(servidor, '/api/pacientes', 'POST');
    expect(alta.request.body).toEqual({
      dni: '30123456',
      nombre: 'Ana Ficticia',
      telefono: '1100000000',
      obraSocial: 'Particular',
    });
    alta.flush({ paciente: ana }, { status: 201, statusText: 'Created' });
    const nueva = await peticion(servidor, '/api/disponibilidad');
    expect(nueva.request.params.get('pacienteId')).toBe('7');
    nueva.flush({ fecha: '2026-10-14', bloque: 'manana', kinesiologos: disponibles(['09:00']) });
    await aparece(fixture, '#paciente-elegido');
  });

  it('un DNI en uso al dar de alta se marca en el campo DNI', async () => {
    const { fixture, servidor } = montar();
    await conDisponibilidad(fixture, servidor);
    q<HTMLInputElement>(fixture, '#dni-turno').value = '30123456';
    enviar(fixture, seccion('titulo-paciente'));
    (await peticion(servidor, '/api/pacientes')).flush({ pacientes: [] });
    await aparece(fixture, '#ofrecer-alta');
    q(fixture, '#ofrecer-alta').click();
    fixture.detectChanges();
    q<HTMLInputElement>(fixture, '#paciente-nombre').value = 'Ana Ficticia';
    q<HTMLInputElement>(fixture, '#paciente-telefono').value = '1100000000';
    q<HTMLInputElement>(fixture, '#paciente-obra-social').value = 'Particular';
    enviar(fixture, 'app-formulario-paciente');
    const [cuerpo, opciones] = error('dni_en_uso');
    (await peticion(servidor, '/api/pacientes', 'POST')).flush(cuerpo, opciones);
    await aparece(fixture, '#error-paciente-dni');
    expect(q(fixture, '#paciente-elegido')).toBeNull();
  });
});

describe('AsignarTurno: confirmar (RF-23 a RF-26)', () => {
  it('sin paciente no manda nada y avisa en el paso del paciente', async () => {
    const { fixture, servidor } = montar();
    await conDisponibilidad(fixture, servidor);
    elegir(fixture, 'franja-3-0800');
    enviar(fixture, seccion('titulo-confirmar'));
    fixture.detectChanges();
    expect(q(fixture, '#error-paciente').textContent).toContain('elegir el paciente');
    servidor.expectNone('/api/turnos');
  });

  it('sin franja no manda nada y avisa en el paso de la franja', async () => {
    const { fixture, servidor } = montar();
    await conDisponibilidad(fixture, servidor);
    await conPacienteAna(fixture, servidor);
    enviar(fixture, seccion('titulo-confirmar'));
    fixture.detectChanges();
    expect(q(fixture, '#error-franja').textContent).toContain('elegir una franja');
    servidor.expectNone('/api/turnos');
  });

  it('un coseguro con tres decimales no manda nada', async () => {
    const { fixture, servidor } = montar();
    await conDisponibilidad(fixture, servidor);
    await conPacienteAna(fixture, servidor);
    elegir(fixture, 'franja-3-0900');
    q<HTMLInputElement>(fixture, '#coseguro-adicional').value = '10,123';
    enviar(fixture, seccion('titulo-confirmar'));
    fixture.detectChanges();
    expect(q(fixture, '#error-coseguros').textContent).toContain('dos decimales');
    servidor.expectNone('/api/turnos');
  });

  it('manda paciente, kinesiólogo, fecha, hora de inicio y coseguros normalizados', async () => {
    const { fixture, servidor } = montar();
    await conDisponibilidad(fixture, servidor);
    await conPacienteAna(fixture, servidor);
    elegir(fixture, 'franja-4-0800');
    q<HTMLInputElement>(fixture, '#coseguro-obra-social').value = '1500,50';
    enviar(fixture, seccion('titulo-confirmar'));

    const p = await peticion(servidor, '/api/turnos', 'POST');
    expect(p.request.body).toEqual({
      pacienteId: 7,
      kinesiologoId: 4,
      fecha: '2026-10-14',
      horaInicio: '08:00',
      coseguroObraSocial: '1500.50',
    });
  });

  it('sin coseguros no manda las claves', async () => {
    const { fixture, servidor } = montar();
    await conDisponibilidad(fixture, servidor);
    await conPacienteAna(fixture, servidor);
    elegir(fixture, 'franja-3-0900');
    enviar(fixture, seccion('titulo-confirmar'));
    const p = await peticion(servidor, '/api/turnos', 'POST');
    expect(p.request.body).toEqual({
      pacienteId: 7,
      kinesiologoId: 3,
      fecha: '2026-10-14',
      horaInicio: '09:00',
    });
  });

  it('franja ocupada: avisa en el paso de la franja, descarta la elección y refresca', async () => {
    const { fixture, servidor } = montar();
    await conDisponibilidad(fixture, servidor);
    await conPacienteAna(fixture, servidor);
    elegir(fixture, 'franja-3-0900');
    enviar(fixture, seccion('titulo-confirmar'));

    const [cuerpo, opciones] = error('franja_ocupada');
    (await peticion(servidor, '/api/turnos', 'POST')).flush(cuerpo, opciones);
    await aparece(fixture, '#error-franja');
    expect(q(fixture, '#error-franja').textContent).toContain('se ocupó');

    const refresco = await peticion(servidor, '/api/disponibilidad');
    expect(refresco.request.params.get('pacienteId')).toBe('7');
    refresco.flush({ fecha: '2026-10-14', bloque: 'manana', kinesiologos: disponibles(['08:00']) });
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(q(fixture, '#franja-3-0900')).toBeNull();
    });
    expect(q(fixture, '#resumen-franja')).toBeNull();
    expect(q(fixture, '#confirmar-turno')).not.toBeNull();
  });

  it('paciente con turno en esa hora: avisa en el paso de la franja y refresca', async () => {
    const { fixture, servidor } = montar();
    await conDisponibilidad(fixture, servidor);
    await conPacienteAna(fixture, servidor);
    elegir(fixture, 'franja-3-0900');
    enviar(fixture, seccion('titulo-confirmar'));
    const [cuerpo, opciones] = error('paciente_con_turno_en_franja');
    (await peticion(servidor, '/api/turnos', 'POST')).flush(cuerpo, opciones);
    await aparece(fixture, '#error-franja');
    expect(q(fixture, '#error-franja').textContent).toContain('ya tiene un turno');
    await peticion(servidor, '/api/disponibilidad');
  });

  it('un dato faltante muestra el mensaje del servidor junto al botón', async () => {
    const { fixture, servidor } = montar();
    await conDisponibilidad(fixture, servidor);
    await conPacienteAna(fixture, servidor);
    elegir(fixture, 'franja-3-0900');
    enviar(fixture, seccion('titulo-confirmar'));
    const [cuerpo, opciones] = error('dato_faltante', 400);
    (await peticion(servidor, '/api/turnos', 'POST')).flush(cuerpo, opciones);
    await aparece(fixture, '#error-confirmar');
    expect(q(fixture, '#error-confirmar').textContent).toContain('Mensaje del sistema.');
  });
});

describe('AsignarTurno: ticket (RF-28)', () => {
  async function asignar() {
    const { fixture, servidor } = montar();
    await conDisponibilidad(fixture, servidor);
    await conPacienteAna(fixture, servidor);
    elegir(fixture, 'franja-3-0900');
    enviar(fixture, seccion('titulo-confirmar'));
    const p = await peticion(servidor, '/api/turnos', 'POST');
    p.flush(
      {
        turno: {
          id: 42,
          pacienteId: 7,
          kinesiologoId: 3,
          fecha: '2026-10-14',
          horaInicio: '09:00',
          estado: 'reservado',
          coseguroObraSocial: null,
          coseguroAdicional: null,
        },
      },
      { status: 201, statusText: 'Created' },
    );
    await aparece(fixture, '#descargar-ticket');
    return { fixture, servidor };
  }

  afterEach(() => vi.restoreAllMocks());

  it('al asignar muestra el número de turno y el botón de descarga', async () => {
    const { fixture } = await asignar();
    expect(texto(fixture).replace(/\s+/g, ' ')).toContain('Turno número 42');
    expect(texto(fixture).replace(/\s+/g, ' ')).toContain('14/10/2026 a las 09:00');
  });

  it('descarga el PDF con un nombre sin datos personales', async () => {
    const { fixture, servidor } = await asignar();
    URL.createObjectURL = vi.fn(() => 'blob:ficticio');
    URL.revokeObjectURL = vi.fn();
    let descargado: string | null = null;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      descargado = this.download;
    });

    q(fixture, '#descargar-ticket').click();
    (await peticion(servidor, '/api/turnos/42/ticket')).flush(
      new Blob(['%PDF'], { type: 'application/pdf' }),
    );
    await vi.waitFor(() => expect(descargado).toBe('turno-42.pdf'));
    expect(URL.createObjectURL).toHaveBeenCalled();
  });

  it('si la descarga falla, lo avisa', async () => {
    const { fixture, servidor } = await asignar();
    q(fixture, '#descargar-ticket').click();
    (await peticion(servidor, '/api/turnos/42/ticket')).flush(new Blob([]), {
      status: 404,
      statusText: 'No encontrado',
    });
    await aparece(fixture, '#error-ticket');
  });

  it('"Asignar otro turno" vuelve al principio', async () => {
    const { fixture } = await asignar();
    q(fixture, '#asignar-otro').click();
    fixture.detectChanges();
    expect(q(fixture, '#fecha-turno')).not.toBeNull();
    expect(q(fixture, '#paciente-elegido')).toBeNull();
  });

  it('no guarda datos del flujo en el almacenamiento del navegador', async () => {
    await asignar();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
