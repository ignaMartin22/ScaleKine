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

const beto: Paciente = {
  id: 8,
  dni: '28111222',
  nombre: 'Beto Ficticio',
  telefono: '1100000001',
  obraSocial: 'OS Ficticia',
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
const texto = (f: ComponentFixture<unknown>) => (raiz(f).textContent ?? '').replace(/\s+/g, ' ');

/** Envía el primer formulario del paso vigente (o de `dentroDe`). */
function enviar(f: ComponentFixture<unknown>, dentroDe = 'section.asistente-paso'): void {
  q<HTMLFormElement>(f, dentroDe + ' form').dispatchEvent(
    new Event('submit', { cancelable: true }),
  );
}

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

const tituloDelPaso = (f: ComponentFixture<unknown>) => q(f, '#titulo-paso').textContent?.trim();
const pasoActual = (f: ComponentFixture<unknown>) =>
  q(f, '#pasos [aria-current="step"]').textContent?.trim();

function siguiente(f: ComponentFixture<unknown>): void {
  q<HTMLButtonElement>(f, '#siguiente').click();
  f.detectChanges();
}

function atras(f: ComponentFixture<unknown>): void {
  q<HTMLButtonElement>(f, '#atras').click();
  f.detectChanges();
}

/** Botón «Cambiar» del resumen, por el dato que cambia. */
function cambiar(f: ComponentFixture<unknown>, dato: 'paciente' | 'fecha' | 'franja'): void {
  q<HTMLButtonElement>(f, `#resumen-${dato} button.enlace`).click();
  f.detectChanges();
}

/** Paso 1: busca el DNI del paciente y responde la búsqueda; queda el paciente elegido. */
async function elegirPacienteEnPaso1(
  f: ComponentFixture<unknown>,
  s: HttpTestingController,
  paciente: Paciente = ana,
) {
  q<HTMLInputElement>(f, '#dni-turno').value = paciente.dni;
  enviar(f);
  (await peticion(s, '/api/pacientes')).flush({ pacientes: [paciente] });
  await aparece(f, '#paciente-elegido');
}

function escribirFecha(f: ComponentFixture<unknown>, fecha: string, bloque?: 'tarde'): void {
  const campo = q<HTMLInputElement>(f, '#fecha-turno');
  campo.value = fecha;
  campo.dispatchEvent(new Event('input'));
  if (bloque) q(f, `input[value="${bloque}"]`).dispatchEvent(new Event('change'));
  f.detectChanges();
}

/** Paso 2 a 3: elige fecha y bloque, avanza y responde la disponibilidad. */
async function pasarAlPaso3(
  f: ComponentFixture<unknown>,
  s: HttpTestingController,
  {
    fecha = '2026-10-14',
    horas = ['08:00', '09:00'],
    bloque = undefined as 'tarde' | undefined,
  } = {},
) {
  escribirFecha(f, fecha, bloque);
  siguiente(f);
  const p = await peticion(s, '/api/disponibilidad');
  p.flush({
    fecha,
    bloque: bloque ?? 'manana',
    kinesiologos: disponibles(horas),
  });
  await aparece(f, 'input[name="franja"]');
  await vi.waitFor(() => {
    f.detectChanges();
    expect(q<HTMLInputElement>(f, 'input[name="franja"]').disabled).toBe(false);
  });
  return p;
}

function elegir(f: ComponentFixture<unknown>, id: string): void {
  const radio = q<HTMLInputElement>(f, '#' + id);
  radio.checked = true;
  radio.dispatchEvent(new Event('change'));
  f.detectChanges();
}

/** Llega al paso 4 con Ana y la franja elegida. */
async function pasarAlPaso4(
  f: ComponentFixture<unknown>,
  s: HttpTestingController,
  franja = 'franja-3-0900',
) {
  await elegirPacienteEnPaso1(f, s);
  siguiente(f);
  await pasarAlPaso3(f, s);
  elegir(f, franja);
  siguiente(f);
  await aparece(f, '#coseguro-abonado');
}

describe('AsignarTurno: asistente por pasos (DESIGN.md §6.1)', () => {
  it('empieza en el paso 1, con el indicador, el resumen vacío y Siguiente deshabilitado', () => {
    const { fixture } = montar();
    expect(tituloDelPaso(fixture)).toBe('1. Paciente');
    expect(pasoActual(fixture)).toBe('1. Paciente');
    expect(raiz(fixture).querySelectorAll('#pasos li').length).toBe(4);
    expect(texto(fixture)).toContain('Paso 1 de 4 · Paciente');
    expect(q(fixture, '#resumen-vacio, .resumen-vacio').textContent).toContain('Todavía no');
    expect(q<HTMLButtonElement>(fixture, '#siguiente').disabled).toBe(true);
    expect(q(fixture, '#atras')).toBeNull();
  });

  it('Siguiente avanza con el paso completo, Atrás vuelve y no se pierde lo elegido', async () => {
    const { fixture, servidor } = montar();
    await elegirPacienteEnPaso1(fixture, servidor);
    expect(q<HTMLButtonElement>(fixture, '#siguiente').disabled).toBe(false);

    siguiente(fixture);
    expect(tituloDelPaso(fixture)).toBe('2. Fecha y bloque');
    expect(pasoActual(fixture)).toBe('2. Fecha y bloque');
    escribirFecha(fixture, '2026-10-14', 'tarde');

    atras(fixture);
    expect(tituloDelPaso(fixture)).toBe('1. Paciente');
    expect(q(fixture, '#paciente-elegido').textContent).toContain('Ana Ficticia');

    siguiente(fixture);
    expect(q<HTMLInputElement>(fixture, '#fecha-turno').value).toBe('2026-10-14');
    expect(q<HTMLInputElement>(fixture, 'input[value="tarde"]').checked).toBe(true);
  });

  it('al cambiar de paso el foco va al título del paso nuevo', async () => {
    const { fixture, servidor } = montar();
    await elegirPacienteEnPaso1(fixture, servidor);
    siguiente(fixture);
    await vi.waitFor(() => expect(document.activeElement?.id).toBe('titulo-paso'));
    expect(q(fixture, '#titulo-paso').getAttribute('tabindex')).toBe('-1');
    expect(q(fixture, '#titulo-paso').tagName).toBe('H2');
  });

  it('los pasos completos se pueden tocar para volver; los siguientes, no', async () => {
    const { fixture, servidor } = montar();
    await elegirPacienteEnPaso1(fixture, servidor);
    siguiente(fixture);
    const botones = () => Array.from(raiz(fixture).querySelectorAll('#pasos button'));
    expect(botones().map((b) => b.textContent?.trim())).toEqual(['1. Paciente']);
    expect(botones()[0].querySelector('app-icono')).not.toBeNull();
    (botones()[0] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(tituloDelPaso(fixture)).toBe('1. Paciente');
    expect(botones()).toHaveLength(0);
  });

  it('el resumen «Tu turno» muestra lo elegido y «Cambiar» vuelve a ese paso', async () => {
    const { fixture, servidor } = montar();
    await pasarAlPaso4(fixture, servidor);

    const resumen = q(fixture, '.resumen').textContent ?? '';
    expect(q(fixture, '.resumen h2').textContent).toBe('Tu turno');
    for (const dato of [
      'Ana Ficticia',
      'DNI 30.123.456',
      'Particular',
      '14/10/2026',
      'Mañana',
      'Kine Ficticio',
      '09:00 a 09:45',
    ]) {
      expect(resumen.replace(/\s+/g, ' ')).toContain(dato);
    }

    cambiar(fixture, 'franja');
    expect(tituloDelPaso(fixture)).toBe('3. Kinesiólogo y franja');
    // El resumen no ofrece «Cambiar» para el paso en que ya está ni para los siguientes.
    expect(q(fixture, '#resumen-franja button')).toBeNull();
    siguiente(fixture);
    cambiar(fixture, 'fecha');
    expect(tituloDelPaso(fixture)).toBe('2. Fecha y bloque');
    siguiente(fixture);
    await peticion(servidor, '/api/disponibilidad').then((p) =>
      p.flush({ fecha: '2026-10-14', bloque: 'manana', kinesiologos: disponibles(['09:00']) }),
    );
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(q<HTMLButtonElement>(fixture, '#siguiente').disabled).toBe(false);
    });
    siguiente(fixture);
    cambiar(fixture, 'paciente');
    expect(tituloDelPaso(fixture)).toBe('1. Paciente');
  });

  it('no guarda datos del flujo en el almacenamiento del navegador', async () => {
    const { fixture, servidor } = montar();
    await pasarAlPaso4(fixture, servidor);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});

describe('AsignarTurno: paso 1, paciente por DNI y tarjeta (RF-17, RF-19, §6.2)', () => {
  it('el paciente encontrado se muestra como tarjeta, con «Cambiar paciente»', async () => {
    const { fixture, servidor } = montar();
    q<HTMLInputElement>(fixture, '#dni-turno').value = '30.123.456';
    enviar(fixture);
    const busqueda = await peticion(servidor, '/api/pacientes');
    expect(busqueda.request.params.keys()).toEqual(['dni']);
    expect(busqueda.request.params.get('dni')).toBe('30123456');
    busqueda.flush({ pacientes: [ana] });
    await aparece(fixture, '#paciente-elegido');
    const tarjeta = q(fixture, '#paciente-elegido app-paciente-tarjeta.paciente-tarjeta');
    expect(tarjeta).not.toBeNull();
    expect(tarjeta.textContent).toContain('Ana Ficticia');
    expect(tarjeta.textContent).toContain('DNI 30.123.456 · Particular · 1100000000');
    expect(tarjeta.querySelector('app-icono')).not.toBeNull();
    expect(q(fixture, '#cambiar-paciente').textContent).toContain('Cambiar paciente');
    // En el paso 1 no hace falta pedir la disponibilidad todavía.
    servidor.expectNone('/api/disponibilidad');
  });

  it('un DNI con formato inválido no consulta', () => {
    const { fixture, servidor } = montar();
    q<HTMLInputElement>(fixture, '#dni-turno').value = '123';
    enviar(fixture);
    fixture.detectChanges();
    expect(q(fixture, '#error-dni-turno').textContent).toContain('7 u 8 dígitos');
    servidor.expectNone('/api/pacientes');
  });

  it('un DNI inexistente ofrece el alta y, al crearlo, queda elegido', async () => {
    const { fixture, servidor } = montar();
    q<HTMLInputElement>(fixture, '#dni-turno').value = '30123456';
    enviar(fixture);
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
    await aparece(fixture, '#paciente-elegido');
    expect(q<HTMLButtonElement>(fixture, '#siguiente').disabled).toBe(false);
  });

  it('un DNI en uso al dar de alta se marca en el campo DNI', async () => {
    const { fixture, servidor } = montar();
    q<HTMLInputElement>(fixture, '#dni-turno').value = '30123456';
    enviar(fixture);
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

describe('AsignarTurno: paso 2 y 3, fecha, bloque y disponibilidad (RF-22, RF-15, RF-25)', () => {
  it('sin fecha, Siguiente está deshabilitado y Enter avisa sin consultar', async () => {
    const { fixture, servidor } = montar();
    await elegirPacienteEnPaso1(fixture, servidor);
    siguiente(fixture);
    expect(q<HTMLButtonElement>(fixture, '#siguiente').disabled).toBe(true);
    enviar(fixture);
    fixture.detectChanges();
    expect(q(fixture, '#error-fecha-turno').textContent).toContain('Elegí la fecha');
    expect(q(fixture, '#fecha-turno').getAttribute('aria-invalid')).toBe('true');
    expect(tituloDelPaso(fixture)).toBe('2. Fecha y bloque');
    servidor.expectNone('/api/disponibilidad');
  });

  it('pide la disponibilidad con fecha, bloque y el paciente elegido, y muestra las franjas', async () => {
    const { fixture, servidor } = montar();
    await elegirPacienteEnPaso1(fixture, servidor);
    siguiente(fixture);
    const p = await pasarAlPaso3(fixture, servidor, {
      fecha: '2026-10-14',
      horas: ['15:00'],
      bloque: 'tarde',
    });
    expect(p.request.params.get('fecha')).toBe('2026-10-14');
    expect(p.request.params.get('bloque')).toBe('tarde');
    expect(p.request.params.get('pacienteId')).toBe('7');
    expect(tituloDelPaso(fixture)).toBe('3. Kinesiólogo y franja');
    expect(texto(fixture)).toContain('Kine Ficticio');
    expect(texto(fixture)).toContain('Otra Ficticia');
    expect(raiz(fixture).querySelectorAll('input[name="franja"]').length).toBe(2);
    // Hasta elegir una franja no se puede seguir.
    expect(q<HTMLButtonElement>(fixture, '#siguiente').disabled).toBe(true);
  });

  it('un sábado explica que no hay turnos', async () => {
    const { fixture, servidor } = montar();
    await elegirPacienteEnPaso1(fixture, servidor);
    siguiente(fixture);
    escribirFecha(fixture, '2026-10-17');
    siguiente(fixture);
    (await peticion(servidor, '/api/disponibilidad')).flush({
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
    await elegirPacienteEnPaso1(fixture, servidor);
    siguiente(fixture);
    escribirFecha(fixture, '2026-10-14');
    siguiente(fixture);
    (await peticion(servidor, '/api/disponibilidad')).flush({
      fecha: '2026-10-14',
      bloque: 'manana',
      kinesiologos: [{ kinesiologoId: 3, nombre: 'Kine Ficticio', franjas: [] }],
    });
    await aparece(fixture, '#sin-franjas');
    expect(q(fixture, '#sin-franjas').textContent).toContain('No quedan franjas libres');
  });

  it('un error de la API se muestra como alerta', async () => {
    const { fixture, servidor } = montar();
    await elegirPacienteEnPaso1(fixture, servidor);
    siguiente(fixture);
    escribirFecha(fixture, '2026-10-14');
    siguiente(fixture);
    const [cuerpo, opciones] = error('datos_invalidos', 400);
    (await peticion(servidor, '/api/disponibilidad')).flush(cuerpo, opciones);
    await aparece(fixture, '#error-disponibilidad');
    expect(q(fixture, '#error-disponibilidad').textContent).toContain('Mensaje del sistema.');
  });

  it('volver a avanzar con la misma fecha y bloque conserva la franja si sigue libre', async () => {
    const { fixture, servidor } = montar();
    await elegirPacienteEnPaso1(fixture, servidor);
    siguiente(fixture);
    await pasarAlPaso3(fixture, servidor);
    elegir(fixture, 'franja-3-0900');

    atras(fixture);
    siguiente(fixture);
    (await peticion(servidor, '/api/disponibilidad')).flush({
      fecha: '2026-10-14',
      bloque: 'manana',
      kinesiologos: disponibles(['08:00', '09:00']),
    });
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(q<HTMLButtonElement>(fixture, '#siguiente').disabled).toBe(false);
    });
    expect(q<HTMLInputElement>(fixture, '#franja-3-0900').checked).toBe(true);
    expect(q(fixture, '#aviso-franja')).toBeNull();
  });

  it('si la franja elegida deja de estar libre al volver a pedirla, se descarta y se avisa', async () => {
    const { fixture, servidor } = montar();
    await elegirPacienteEnPaso1(fixture, servidor);
    siguiente(fixture);
    await pasarAlPaso3(fixture, servidor);
    elegir(fixture, 'franja-3-0800');

    atras(fixture);
    siguiente(fixture);
    (await peticion(servidor, '/api/disponibilidad')).flush({
      fecha: '2026-10-14',
      bloque: 'manana',
      kinesiologos: disponibles(['09:00']),
    });
    await aparece(fixture, '#aviso-franja');
    expect(q(fixture, '#aviso-franja').textContent).toContain('ya no está libre');
    expect(q(fixture, '#resumen-franja')).toBeNull();
  });
});

describe('AsignarTurno: la franja se descarta si cambia el paciente, la fecha o el bloque (§6.1)', () => {
  it('al cambiar la fecha se descarta la franja aunque siga libre ese día, y se avisa en el paso 3', async () => {
    const { fixture, servidor } = montar();
    await elegirPacienteEnPaso1(fixture, servidor);
    siguiente(fixture);
    await pasarAlPaso3(fixture, servidor, { fecha: '2026-10-14' });
    elegir(fixture, 'franja-3-0900');
    expect(q(fixture, '#resumen-franja')).not.toBeNull();

    atras(fixture);
    escribirFecha(fixture, '2026-10-15');
    siguiente(fixture);
    const nueva = await peticion(servidor, '/api/disponibilidad');
    expect(nueva.request.params.get('fecha')).toBe('2026-10-15');
    // La misma franja está libre el día nuevo: igual hay que elegirla de nuevo.
    nueva.flush({
      fecha: '2026-10-15',
      bloque: 'manana',
      kinesiologos: disponibles(['08:00', '09:00']),
    });
    await aparece(fixture, '#franja-3-0900');

    expect(q(fixture, '#aviso-franja').textContent).toContain('Cambió la fecha o el bloque');
    expect(q(fixture, '#aviso-franja').textContent).toContain('se descartó');
    expect(q<HTMLInputElement>(fixture, '#franja-3-0900').checked).toBe(false);
    expect(q(fixture, '#resumen-franja')).toBeNull();
    expect(q<HTMLButtonElement>(fixture, '#siguiente').disabled).toBe(true);
  });

  it('al cambiar el bloque se descarta la franja y se avisa', async () => {
    const { fixture, servidor } = montar();
    await elegirPacienteEnPaso1(fixture, servidor);
    siguiente(fixture);
    await pasarAlPaso3(fixture, servidor);
    elegir(fixture, 'franja-4-0800');

    atras(fixture);
    q(fixture, 'input[value="tarde"]').dispatchEvent(new Event('change'));
    siguiente(fixture);
    (await peticion(servidor, '/api/disponibilidad')).flush({
      fecha: '2026-10-14',
      bloque: 'tarde',
      kinesiologos: disponibles(['08:00']),
    });
    await aparece(fixture, '#aviso-franja');
    expect(q(fixture, '#resumen-franja')).toBeNull();
  });

  it('al cambiar el paciente se descarta la franja y, con otro paciente, se avisa en el paso 3', async () => {
    const { fixture, servidor } = montar();
    await pasarAlPaso4(fixture, servidor);

    cambiar(fixture, 'paciente');
    q(fixture, '#cambiar-paciente').click();
    fixture.detectChanges();
    expect(q(fixture, '#resumen-franja')).toBeNull();
    expect(q(fixture, '#dni-turno')).not.toBeNull();

    await elegirPacienteEnPaso1(fixture, servidor, beto);
    siguiente(fixture);
    siguiente(fixture);
    const nueva = await peticion(servidor, '/api/disponibilidad');
    expect(nueva.request.params.get('pacienteId')).toBe('8');
    nueva.flush({
      fecha: '2026-10-14',
      bloque: 'manana',
      kinesiologos: disponibles(['08:00', '09:00']),
    });
    await aparece(fixture, '#aviso-franja');
    expect(q(fixture, '#aviso-franja').textContent).toContain('Cambió el paciente');
    expect(q<HTMLInputElement>(fixture, '#franja-3-0900').checked).toBe(false);
    expect(q<HTMLButtonElement>(fixture, '#siguiente').disabled).toBe(true);
  });

  it('cambiar el paciente sin haber elegido franja no avisa nada', async () => {
    const { fixture, servidor } = montar();
    await elegirPacienteEnPaso1(fixture, servidor);
    q(fixture, '#cambiar-paciente').click();
    fixture.detectChanges();
    await elegirPacienteEnPaso1(fixture, servidor, beto);
    siguiente(fixture);
    await pasarAlPaso3(fixture, servidor);
    expect(q(fixture, '#aviso-franja')).toBeNull();
  });
});

describe('AsignarTurno: paso 4, confirmar (RF-23 a RF-27)', () => {
  it('un coseguro con tres decimales no manda nada', async () => {
    const { fixture, servidor } = montar();
    await pasarAlPaso4(fixture, servidor);
    q<HTMLInputElement>(fixture, '#coseguro-abonado').value = '10,123';
    enviar(fixture);
    fixture.detectChanges();
    expect(q(fixture, '#error-coseguros').textContent).toContain('dos decimales');
    servidor.expectNone('/api/turnos');
  });

  it('manda paciente, kinesiólogo, fecha, hora de inicio y coseguro abonado normalizado', async () => {
    const { fixture, servidor } = montar();
    await pasarAlPaso4(fixture, servidor, 'franja-4-0800');
    q<HTMLInputElement>(fixture, '#coseguro-abonado').value = '1500,50';
    enviar(fixture);

    const p = await peticion(servidor, '/api/turnos', 'POST');
    expect(p.request.body).toEqual({
      pacienteId: 7,
      kinesiologoId: 4,
      fecha: '2026-10-14',
      horaInicio: '08:00',
      coseguroAbonado: '1500.50',
    });
  });

  it('sin coseguro abonado no manda la clave', async () => {
    const { fixture, servidor } = montar();
    await pasarAlPaso4(fixture, servidor);
    enviar(fixture);
    const p = await peticion(servidor, '/api/turnos', 'POST');
    expect(p.request.body).toEqual({
      pacienteId: 7,
      kinesiologoId: 3,
      fecha: '2026-10-14',
      horaInicio: '09:00',
    });
  });

  it('el monto tipeado se conserva al volver atrás y avanzar', async () => {
    const { fixture, servidor } = montar();
    await pasarAlPaso4(fixture, servidor);
    const campo = q<HTMLInputElement>(fixture, '#coseguro-abonado');
    campo.value = '700';
    campo.dispatchEvent(new Event('input'));
    atras(fixture);
    siguiente(fixture);
    expect(q<HTMLInputElement>(fixture, '#coseguro-abonado').value).toBe('700');
  });

  it('franja ocupada: vuelve al paso 3 con el aviso, descarta la elección y refresca', async () => {
    const { fixture, servidor } = montar();
    await pasarAlPaso4(fixture, servidor);
    enviar(fixture);

    const [cuerpo, opciones] = error('franja_ocupada');
    (await peticion(servidor, '/api/turnos', 'POST')).flush(cuerpo, opciones);
    await aparece(fixture, '#error-franja');
    expect(tituloDelPaso(fixture)).toBe('3. Kinesiólogo y franja');
    expect(q(fixture, '#error-franja').textContent).toContain('se ocupó');

    const refresco = await peticion(servidor, '/api/disponibilidad');
    expect(refresco.request.params.get('pacienteId')).toBe('7');
    refresco.flush({ fecha: '2026-10-14', bloque: 'manana', kinesiologos: disponibles(['08:00']) });
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(q(fixture, '#franja-3-0900')).toBeNull();
    });
    expect(q(fixture, '#resumen-franja')).toBeNull();
    expect(q<HTMLButtonElement>(fixture, '#siguiente').disabled).toBe(true);
  });

  it('paciente con turno en esa hora: vuelve al paso 3 y refresca', async () => {
    const { fixture, servidor } = montar();
    await pasarAlPaso4(fixture, servidor);
    enviar(fixture);
    const [cuerpo, opciones] = error('paciente_con_turno_en_franja');
    (await peticion(servidor, '/api/turnos', 'POST')).flush(cuerpo, opciones);
    await aparece(fixture, '#error-franja');
    expect(q(fixture, '#error-franja').textContent).toContain('ya tiene un turno');
    expect(tituloDelPaso(fixture)).toBe('3. Kinesiólogo y franja');
    await peticion(servidor, '/api/disponibilidad');
  });

  it('un paciente que ya no existe lleva al paso 1', async () => {
    const { fixture, servidor } = montar();
    await pasarAlPaso4(fixture, servidor);
    enviar(fixture);
    const [cuerpo, opciones] = error('paciente_no_encontrado', 404);
    (await peticion(servidor, '/api/turnos', 'POST')).flush(cuerpo, opciones);
    await aparece(fixture, '#error-paciente');
    expect(tituloDelPaso(fixture)).toBe('1. Paciente');
    expect(q(fixture, '#dni-turno')).not.toBeNull();
    await peticion(servidor, '/api/disponibilidad');
  });

  it('un dato faltante muestra el mensaje del servidor junto al botón, en el paso 4', async () => {
    const { fixture, servidor } = montar();
    await pasarAlPaso4(fixture, servidor);
    enviar(fixture);
    const [cuerpo, opciones] = error('dato_faltante', 400);
    (await peticion(servidor, '/api/turnos', 'POST')).flush(cuerpo, opciones);
    await aparece(fixture, '#error-confirmar');
    expect(q(fixture, '#error-confirmar').textContent).toContain('Mensaje del sistema.');
    expect(tituloDelPaso(fixture)).toBe('4. Coseguro abonado y confirmación');
  });

  it('un coseguro inválido según el servidor se marca en el campo', async () => {
    const { fixture, servidor } = montar();
    await pasarAlPaso4(fixture, servidor);
    q<HTMLInputElement>(fixture, '#coseguro-abonado').value = '10';
    enviar(fixture);
    const [cuerpo, opciones] = error('datos_invalidos', 400, ['coseguroAbonado']);
    (await peticion(servidor, '/api/turnos', 'POST')).flush(cuerpo, opciones);
    await aparece(fixture, '#error-coseguros');
    expect(q(fixture, '#error-coseguros').textContent).toContain('dos decimales');
  });
});

describe('AsignarTurno: ticket (RF-28)', () => {
  async function asignar() {
    const { fixture, servidor } = montar();
    await pasarAlPaso4(fixture, servidor);
    enviar(fixture);
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
          coseguroAbonado: null,
        },
      },
      { status: 201, statusText: 'Created' },
    );
    await aparece(fixture, '#descargar-ticket');
    return { fixture, servidor };
  }

  afterEach(() => vi.restoreAllMocks());

  it('al asignar muestra el número de turno y el botón de descarga, sin el asistente', async () => {
    const { fixture } = await asignar();
    expect(texto(fixture)).toContain('Turno número 42');
    expect(texto(fixture)).toContain('14/10/2026 a las 09:00');
    expect(q(fixture, '#pasos')).toBeNull();
    expect(q(fixture, '.resumen')).toBeNull();
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

  it('«Asignar otro turno» vuelve al paso 1 sin nada elegido', async () => {
    const { fixture } = await asignar();
    q(fixture, '#asignar-otro').click();
    fixture.detectChanges();
    expect(tituloDelPaso(fixture)).toBe('1. Paciente');
    expect(q(fixture, '#dni-turno')).not.toBeNull();
    expect(q(fixture, '#paciente-elegido')).toBeNull();
    expect(q(fixture, '.resumen-vacio')).not.toBeNull();
  });

  it('no guarda datos del flujo en el almacenamiento del navegador', async () => {
    await asignar();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
