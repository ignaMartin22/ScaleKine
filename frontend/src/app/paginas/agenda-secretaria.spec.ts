import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { TurnoDeAgenda, TurnoPendiente } from '../nucleo/agenda/agenda';
import { erroresDeApi } from '../nucleo/http/interceptores';
import { AgendaSecretaria } from './agenda-secretaria';

type Acciones = TurnoDeAgenda['acciones'];

const FLUJO_RESERVADO: Acciones = {
  transiciones: [
    { hacia: 'en_espera', accion: 'Llegó' },
    { hacia: 'no_asistio', accion: 'No asistió' },
    { hacia: 'anulado', accion: 'Anular' },
  ],
  puedeCorregir: true,
};

function turno(id: number, cambios: Partial<TurnoDeAgenda> = {}): TurnoDeAgenda {
  return {
    id,
    fecha: '2026-10-15',
    horaInicio: '08:00',
    horaFin: '08:45',
    estado: 'reservado',
    horaLlegada: null,
    coseguroAbonado: null,
    paciente: {
      id: 7,
      nombre: 'Ana Ficticia',
      dni: '30123456',
      telefono: '1100000000',
      obraSocial: 'Particular',
    },
    kinesiologo: { id: 3, nombre: 'Kine Ficticio' },
    acciones: FLUJO_RESERVADO,
    ...cambios,
  };
}

const cerrado = (id: number, estado: TurnoDeAgenda['estado'] = 'asistio') =>
  turno(id, {
    estado,
    horaInicio: '09:00',
    horaFin: '09:45',
    paciente: {
      id: 8,
      nombre: 'Beto Ficticio',
      dni: '28111222',
      telefono: '1100000001',
      obraSocial: 'OS Ficticia',
    },
    acciones: { transiciones: [], puedeCorregir: true },
  });

const pendiente = (id: number, cambios: Partial<TurnoPendiente> = {}): TurnoPendiente => ({
  id,
  fecha: '2026-10-14',
  horaInicio: '10:00',
  estado: 'reservado',
  kinesiologoId: 3,
  kinesiologoNombre: 'Kine Ficticio',
  pacienteId: 7,
  pacienteNombre: 'Ana Ficticia',
  ...cambios,
});

const KINESIOLOGOS = [
  { id: 3, nombre: 'Kine Ficticio', bloque: 'manana', activo: true },
  { id: 4, nombre: 'Otra Ficticia', bloque: 'tarde', activo: true },
];

function error(codigo: string, estado = 409) {
  return [
    { error: { codigo, mensaje: 'Mensaje del sistema.' } },
    { status: estado, statusText: 'Error' },
  ] as const;
}

const raiz = (f: ComponentFixture<unknown>) => f.nativeElement as HTMLElement;
const q = <T extends HTMLElement = HTMLElement>(f: ComponentFixture<unknown>, s: string) =>
  raiz(f).querySelector(s) as T;

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

async function desaparece(f: ComponentFixture<unknown>, selector: string): Promise<void> {
  await vi.waitFor(() => {
    f.detectChanges();
    expect(q(f, selector)).toBeNull();
  });
}

/** Botón dentro de `dentroDe` cuyo texto visible empieza con `rotulo`. */
function boton(f: ComponentFixture<unknown>, rotulo: string, dentroDe = 'body') {
  const lista = Array.from(
    raiz(f).querySelectorAll<HTMLButtonElement>(
      dentroDe === 'body' ? 'button' : `${dentroDe} button`,
    ),
  );
  const encontrado = lista.find((b) => (b.textContent ?? '').trim().startsWith(rotulo));
  if (!encontrado) throw new Error(`No hay un botón «${rotulo}»`);
  return encontrado;
}

const botones = (f: ComponentFixture<unknown>) =>
  Array.from(raiz(f).querySelectorAll('button')).map((b) => (b.textContent ?? '').trim());

const fila = (f: ComponentFixture<unknown>, id: number) => q(f, '#turno-' + id);

/** Monta la página y responde la carga inicial (kinesiólogos, agenda de hoy y pendientes). */
async function montar(
  turnos: TurnoDeAgenda[] = [turno(1), cerrado(2)],
  pendientes: TurnoPendiente[] = [],
  recaudado = '0.00',
) {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(withInterceptors([erroresDeApi])),
      provideHttpClientTesting(),
    ],
  });
  const servidor = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(AgendaSecretaria);
  fixture.detectChanges();
  (await peticion(servidor, '/api/kinesiologos')).flush({ kinesiologos: KINESIOLOGOS });
  const agenda = await peticion(servidor, '/api/agenda');
  expect(agenda.request.params.keys()).toEqual([]);
  agenda.flush({ fecha: '2026-10-15', turnos, recaudado });
  (await peticion(servidor, '/api/agenda/pendientes')).flush({
    cantidad: pendientes.length,
    turnos: pendientes,
  });
  await aparece(fixture, '#turno-' + (turnos[0]?.id ?? 0));
  return { fixture, servidor };
}

/** Responde la relectura de la agenda y de los pendientes que sigue a una escritura. */
async function relectura(
  servidor: HttpTestingController,
  turnos: TurnoDeAgenda[],
  pendientes: TurnoPendiente[] = [],
  recaudado = '0.00',
) {
  (await peticion(servidor, '/api/agenda')).flush({ fecha: '2026-10-15', turnos, recaudado });
  (await peticion(servidor, '/api/agenda/pendientes')).flush({
    cantidad: pendientes.length,
    turnos: pendientes,
  });
}

describe('AgendaSecretaria: lista y filtros (RF-41)', () => {
  it('muestra paciente, kinesiólogo, franja, estado, llegada y coseguro abonado', async () => {
    const llegado = turno(1, {
      estado: 'en_espera',
      horaLlegada: '10:05',
      coseguroAbonado: '1500.50',
      acciones: { transiciones: [{ hacia: 'asistio', accion: 'Asistió' }], puedeCorregir: true },
    });
    const { fixture } = await montar([llegado]);
    const t = fila(fixture, 1).textContent ?? '';
    for (const dato of [
      'Ana Ficticia',
      'DNI 30123456',
      '1100000000',
      'Particular',
      'Kine Ficticio',
      '08:00 a 08:45',
      'En espera',
      'Llegó a las 10:05',
      '$ 1.500,50',
    ]) {
      expect(t).toContain(dato);
    }
    expect(q<HTMLInputElement>(fixture, '#agenda-fecha').value).toBe('2026-10-15');
  });

  it('la hora de llegada que se ve es exactamente horaLlegada, sin recalcularla', async () => {
    // El instante ISO caería a las 08:05 en Buenos Aires, pero lo que manda la API es lo que se muestra.
    const llegado = {
      ...turno(1, { estado: 'en_espera', horaLlegada: '07:41' }),
      llegadaEn: '2026-10-19T11:05:00.000Z',
    };
    const { fixture } = await montar([llegado]);
    const t = fila(fixture, 1).textContent ?? '';
    expect(t).toContain('Llegó a las 07:41');
    expect(t).not.toContain('08:05');
  });

  it('sin turnos lo dice', async () => {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    const servidor = TestBed.inject(HttpTestingController);
    const fixture = TestBed.createComponent(AgendaSecretaria);
    fixture.detectChanges();
    (await peticion(servidor, '/api/kinesiologos')).flush({ kinesiologos: [] });
    (await peticion(servidor, '/api/agenda')).flush({
      fecha: '2026-10-15',
      turnos: [],
      recaudado: '0.00',
    });
    (await peticion(servidor, '/api/agenda/pendientes')).flush({ cantidad: 0, turnos: [] });
    await aparece(fixture, '#sin-turnos');
  });

  it('el filtro por kinesiólogo pide la agenda con kinesiologoId', async () => {
    const { fixture, servidor } = await montar();
    const select = q<HTMLSelectElement>(fixture, '#agenda-kinesiologo');
    expect(Array.from(select.options).map((o) => o.textContent?.trim())).toEqual([
      'Todos',
      'Kine Ficticio',
      'Otra Ficticia',
    ]);
    select.value = '4';
    select.dispatchEvent(new Event('change'));
    const p = await peticion(servidor, '/api/agenda');
    expect(p.request.params.get('kinesiologoId')).toBe('4');
    expect(p.request.params.get('fecha')).toBe('2026-10-15');
    p.flush({
      fecha: '2026-10-15',
      turnos: [turno(9, { kinesiologo: { id: 4, nombre: 'Otra Ficticia' } })],
      recaudado: '0.00',
    });
    await aparece(fixture, '#turno-9');
    expect(fila(fixture, 1)).toBeNull();
  });

  it('el filtro por fecha pide la agenda de ese día', async () => {
    const { fixture, servidor } = await montar();
    const campo = q<HTMLInputElement>(fixture, '#agenda-fecha');
    campo.value = '2026-10-16';
    campo.dispatchEvent(new Event('change'));
    const p = await peticion(servidor, '/api/agenda');
    expect(p.request.params.get('fecha')).toBe('2026-10-16');
    expect(p.request.params.has('kinesiologoId')).toBe(false);
    p.flush({ fecha: '2026-10-16', turnos: [], recaudado: '0.00' });
    await aparece(fixture, '#sin-turnos');
  });

  it('un error al cargar la agenda se muestra como alerta', async () => {
    const { fixture, servidor } = await montar();
    const campo = q<HTMLInputElement>(fixture, '#agenda-fecha');
    campo.value = '2026-10-16';
    campo.dispatchEvent(new Event('change'));
    const [cuerpo, opciones] = error('error_inesperado', 500);
    (await peticion(servidor, '/api/agenda')).flush(cuerpo, opciones);
    await aparece(fixture, '#error-carga');
    expect(q(fixture, '#error-carga').getAttribute('role')).toBe('alert');
  });
});

describe('AgendaSecretaria: acciones que manda la API (RF-34)', () => {
  it('muestra solo las transiciones recibidas, con el texto de la API', async () => {
    const { fixture } = await montar([
      turno(1),
      turno(2, {
        estado: 'en_espera',
        acciones: { transiciones: [{ hacia: 'asistio', accion: 'Asistió' }], puedeCorregir: false },
      }),
      cerrado(3, 'anulado'),
    ]);
    const de = (id: number) =>
      Array.from(fila(fixture, id).querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(de(1)).toEqual([
      'Llegó',
      'No asistió',
      'Anular',
      'Reprogramar',
      'Registrar abono',
      'Ticket (PDF)',
      'Corregir estado',
    ]);
    // En espera: solo lo que la API ofrece; sin reprogramar (solo reservados) ni corregir.
    expect(de(2)).toEqual(['Asistió', 'Registrar abono', 'Ticket (PDF)']);
    // Un turno cerrado no recibe acciones de flujo, y nunca se calcula "Anular" en el cliente.
    // Un turno anulado no admite abono (RF-27): no se ofrece la acción.
    expect(de(3)).toEqual(['Ticket (PDF)', 'Corregir estado']);
  });

  it('usa el texto de la acción tal como llega', async () => {
    const { fixture } = await montar([
      turno(1, {
        acciones: {
          transiciones: [{ hacia: 'en_espera', accion: 'Marcar llegada' }],
          puedeCorregir: false,
        },
      }),
    ]);
    expect(botones(fixture)).toContain('Marcar llegada');
    expect(botones(fixture)).not.toContain('Anular');
  });

  it('Llegó aplica la transición sin confirmación y relee la agenda', async () => {
    const { fixture, servidor } = await montar();
    boton(fixture, 'Llegó').click();
    const p = await peticion(servidor, '/api/turnos/1/transicion', 'POST');
    expect(p.request.body).toEqual({ hacia: 'en_espera' });
    expect(q(fixture, '[role="dialog"]')).toBeNull();
    p.flush({ turno: { id: 1, estado: 'en_espera' } });
    await relectura(servidor, [
      turno(1, {
        estado: 'en_espera',
        horaLlegada: '08:00',
        acciones: { transiciones: [{ hacia: 'asistio', accion: 'Asistió' }], puedeCorregir: true },
      }),
    ]);
    await aparece(fixture, '#mensaje-turno-1');
    expect(q(fixture, '#mensaje-turno-1').textContent).toContain('«En espera»');
    expect(q(fixture, '#mensaje-turno-1').getAttribute('role')).toBe('status');
    expect(fila(fixture, 1).textContent).toContain('En espera');
  });

  it('Asistió marca la asistencia sin pedir confirmación', async () => {
    const { fixture, servidor } = await montar([
      turno(1, {
        estado: 'en_espera',
        acciones: { transiciones: [{ hacia: 'asistio', accion: 'Asistió' }], puedeCorregir: true },
      }),
    ]);
    boton(fixture, 'Asistió').click();
    const p = await peticion(servidor, '/api/turnos/1/transicion', 'POST');
    expect(p.request.body).toEqual({ hacia: 'asistio' });
    p.flush({ turno: { id: 1 } });
    await relectura(servidor, [cerrado(1)]);
  });

  it('Anular pide confirmación y no escribe hasta confirmar', async () => {
    const { fixture, servidor } = await montar();
    boton(fixture, 'Anular').click();
    await aparece(fixture, '[role="dialog"]');
    servidor.expectNone((r) => r.url.includes('/transicion'));
    const dialogo = q(fixture, '[role="dialog"]');
    expect(dialogo.getAttribute('aria-modal')).toBe('true');
    expect(dialogo.getAttribute('aria-labelledby')).toBe('titulo-dialogo');
    expect(q(fixture, '#titulo-dialogo').textContent).toContain('Anular');
    expect(dialogo.textContent).toContain('Ana Ficticia');
    await vi.waitFor(() => expect(document.activeElement?.id).toBe('confirmar-accion'));

    q(fixture, '#confirmar-accion').click();
    const p = await peticion(servidor, '/api/turnos/1/transicion', 'POST');
    expect(p.request.body).toEqual({ hacia: 'anulado' });
    p.flush({ turno: { id: 1 } });
    await relectura(servidor, [cerrado(1, 'anulado')]);
    await desaparece(fixture, '[role="dialog"]');
  });

  it('No asistió pide confirmación; Cancelar no escribe y devuelve el foco', async () => {
    const { fixture, servidor } = await montar();
    const abridor = boton(fixture, 'No asistió');
    abridor.focus();
    abridor.click();
    await aparece(fixture, '[role="dialog"]');
    boton(fixture, 'Cancelar', '[role="dialog"]').click();
    await desaparece(fixture, '[role="dialog"]');
    servidor.expectNone((r) => r.url.includes('/transicion'));
    expect(document.activeElement).toBe(abridor);
  });

  it('Escape cierra el diálogo sin escribir', async () => {
    const { fixture, servidor } = await montar();
    boton(fixture, 'Anular').click();
    await aparece(fixture, '[role="dialog"]');
    q(fixture, '[role="dialog"]').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    await desaparece(fixture, '[role="dialog"]');
    servidor.expectNone((r) => r.url.includes('/transicion'));
  });

  it('Tab desde el último elemento del diálogo vuelve al primero', async () => {
    const { fixture } = await montar();
    boton(fixture, 'Anular').click();
    await aparece(fixture, '[role="dialog"]');
    const cancelar = boton(fixture, 'Cancelar', '[role="dialog"]');
    cancelar.focus();
    const evento = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
    cancelar.dispatchEvent(evento);
    expect(evento.defaultPrevented).toBe(true);
    expect(document.activeElement?.id).toBe('confirmar-accion');
  });

  it('turno_modificado avisa en el turno y relee la agenda', async () => {
    const { fixture, servidor } = await montar();
    boton(fixture, 'Llegó').click();
    const [cuerpo, opciones] = error('turno_modificado');
    (await peticion(servidor, '/api/turnos/1/transicion', 'POST')).flush(cuerpo, opciones);
    // La agenda se vuelve a leer: otra secretaria ya había marcado la llegada.
    await relectura(servidor, [
      turno(1, {
        estado: 'en_espera',
        acciones: { transiciones: [{ hacia: 'asistio', accion: 'Asistió' }], puedeCorregir: true },
      }),
    ]);
    await aparece(fixture, '#mensaje-turno-1');
    const aviso = q(fixture, '#mensaje-turno-1');
    expect(aviso.getAttribute('role')).toBe('alert');
    expect(aviso.textContent).toContain('Otra persona modificó este turno');
    expect(fila(fixture, 1).textContent).toContain('En espera');
    expect(botones(fixture)).not.toContain('Llegó');
  });

  it('turno_modificado en una anulación confirmada cierra el diálogo, avisa y relee', async () => {
    const { fixture, servidor } = await montar();
    boton(fixture, 'Anular').click();
    await aparece(fixture, '[role="dialog"]');
    q(fixture, '#confirmar-accion').click();
    const [cuerpo, opciones] = error('turno_modificado');
    (await peticion(servidor, '/api/turnos/1/transicion', 'POST')).flush(cuerpo, opciones);
    await relectura(servidor, [cerrado(1, 'no_asistio')]);
    await desaparece(fixture, '[role="dialog"]');
    expect(q(fixture, '#mensaje-turno-1').textContent).toContain('Otra persona modificó');
  });

  it('transicion_no_permitida avisa y relee', async () => {
    const { fixture, servidor } = await montar();
    boton(fixture, 'Llegó').click();
    const [cuerpo, opciones] = error('transicion_no_permitida');
    (await peticion(servidor, '/api/turnos/1/transicion', 'POST')).flush(cuerpo, opciones);
    await relectura(servidor, [cerrado(1)]);
    await aparece(fixture, '#mensaje-turno-1');
    expect(q(fixture, '#mensaje-turno-1').textContent).toContain('ya no corresponde');
  });
});

describe('AgendaSecretaria: corrección de estado (RF-35)', () => {
  it('pide el estado destino entre los cinco, aclara que es una corrección y confirma', async () => {
    const { fixture, servidor } = await montar([cerrado(2, 'anulado')]);
    boton(fixture, 'Corregir estado').click();
    await aparece(fixture, '[role="dialog"]');
    const dialogo = q(fixture, '[role="dialog"]');
    expect(q(fixture, '#titulo-dialogo').textContent).toContain('Corregir el estado');
    expect(dialogo.textContent).toContain('corrección, no el flujo normal');
    const radios = Array.from(dialogo.querySelectorAll<HTMLInputElement>('input[type="radio"]'));
    expect(radios.map((r) => r.value)).toEqual([
      'reservado',
      'en_espera',
      'asistio',
      'no_asistio',
      'anulado',
    ]);
    // El estado actual no se ofrece como destino.
    expect(radios.find((r) => r.value === 'anulado')?.disabled).toBe(true);

    // Sin elegir un estado, avisa y no escribe.
    q(fixture, '#confirmar-correccion').click();
    await aparece(fixture, '#error-dialogo');
    servidor.expectNone((r) => r.url.includes('/correccion'));

    radios[0].checked = true;
    radios[0].dispatchEvent(new Event('change'));
    q(fixture, '#confirmar-correccion').click();
    const p = await peticion(servidor, '/api/turnos/2/correccion', 'POST');
    expect(p.request.body).toEqual({ estado: 'reservado' });
    p.flush({ turno: { id: 2 } });
    await relectura(servidor, [turno(2)]);
    await desaparece(fixture, '[role="dialog"]');
    expect(q(fixture, '#mensaje-turno-2').textContent).toContain('Corregido');
  });

  it('si la franja está ocupada, el error queda en el diálogo y se relee la agenda', async () => {
    const { fixture, servidor } = await montar([cerrado(2, 'anulado')]);
    boton(fixture, 'Corregir estado').click();
    await aparece(fixture, '[role="dialog"]');
    const radio = q<HTMLInputElement>(fixture, 'input[value="reservado"]');
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
    q(fixture, '#confirmar-correccion').click();
    const [cuerpo, opciones] = error('franja_ocupada');
    (await peticion(servidor, '/api/turnos/2/correccion', 'POST')).flush(cuerpo, opciones);
    await relectura(servidor, [cerrado(2, 'anulado')]);
    await aparece(fixture, '#error-dialogo');
    expect(q(fixture, '#error-dialogo').getAttribute('role')).toBe('alert');
    expect(q(fixture, '#error-dialogo').textContent).toContain('estado activo');
    expect(q(fixture, '[role="dialog"]')).not.toBeNull();
  });
});

describe('AgendaSecretaria: reprogramación (RF-36, RF-37)', () => {
  it('solo se ofrece para turnos reservados', async () => {
    const { fixture } = await montar([turno(1), cerrado(2)]);
    expect(
      Array.from(fila(fixture, 1).querySelectorAll('button')).map((b) => b.textContent?.trim()),
    ).toContain('Reprogramar');
    expect(
      Array.from(fila(fixture, 2).querySelectorAll('button')).map((b) => b.textContent?.trim()),
    ).not.toContain('Reprogramar');
  });

  it('pide la disponibilidad con el pacienteId del turno y confirma con PUT /ubicacion', async () => {
    const { fixture, servidor } = await montar();
    boton(fixture, 'Reprogramar').click();
    const d = await peticion(servidor, '/api/disponibilidad');
    expect(d.request.params.get('pacienteId')).toBe('7');
    expect(d.request.params.get('fecha')).toBe('2026-10-15');
    expect(d.request.params.get('bloque')).toBe('manana');
    d.flush({
      fecha: '2026-10-15',
      bloque: 'manana',
      kinesiologos: [
        { kinesiologoId: 3, nombre: 'Kine Ficticio', franjas: [{ inicio: '10:00', fin: '10:45' }] },
      ],
    });
    await aparece(fixture, 'input[name="reprogramar-franja"]');

    // Cambiar la fecha vuelve a pedir la disponibilidad, siempre con el paciente.
    const fecha = q<HTMLInputElement>(fixture, '#reprogramar-fecha');
    fecha.value = '2026-10-16';
    fecha.dispatchEvent(new Event('change'));
    const d2 = await peticion(servidor, '/api/disponibilidad');
    expect(d2.request.params.get('pacienteId')).toBe('7');
    expect(d2.request.params.get('fecha')).toBe('2026-10-16');
    d2.flush({
      fecha: '2026-10-16',
      bloque: 'manana',
      kinesiologos: [
        { kinesiologoId: 3, nombre: 'Kine Ficticio', franjas: [{ inicio: '11:00', fin: '11:45' }] },
      ],
    });
    await aparece(fixture, '#rep-franja-3-1100');

    const radio = q<HTMLInputElement>(fixture, '#rep-franja-3-1100');
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
    q(fixture, '#confirmar-reprogramacion').click();
    const p = await peticion(servidor, '/api/turnos/1/ubicacion', 'PUT');
    expect(p.request.body).toEqual({ kinesiologoId: 3, fecha: '2026-10-16', horaInicio: '11:00' });
    p.flush({ turno: { id: 1 } });
    await relectura(servidor, [turno(1, { fecha: '2026-10-16' })]);
    await desaparece(fixture, '[role="dialog"]');
    expect(q(fixture, '#mensaje-turno-1').textContent).toContain('Reprogramado');
  });

  it('el bloque tarde pide la disponibilidad de la tarde con el paciente', async () => {
    const { fixture, servidor } = await montar();
    boton(fixture, 'Reprogramar').click();
    (await peticion(servidor, '/api/disponibilidad')).flush({
      fecha: '2026-10-15',
      bloque: 'manana',
      kinesiologos: [],
    });
    await aparece(fixture, '#sin-franjas-reprogramar');
    const tarde = q<HTMLInputElement>(fixture, 'input[value="tarde"]');
    tarde.checked = true;
    tarde.dispatchEvent(new Event('change'));
    const d = await peticion(servidor, '/api/disponibilidad');
    expect(d.request.params.get('bloque')).toBe('tarde');
    expect(d.request.params.get('pacienteId')).toBe('7');
    d.flush({ fecha: '2026-10-15', bloque: 'tarde', kinesiologos: [] });
  });

  it('sin franja elegida avisa y no escribe', async () => {
    const { fixture, servidor } = await montar();
    boton(fixture, 'Reprogramar').click();
    (await peticion(servidor, '/api/disponibilidad')).flush({
      fecha: '2026-10-15',
      bloque: 'manana',
      kinesiologos: [],
    });
    await aparece(fixture, '#sin-franjas-reprogramar');
    q(fixture, '#confirmar-reprogramacion').click();
    await aparece(fixture, '#error-dialogo');
    expect(q(fixture, '#error-dialogo').textContent).toContain('Falta elegir una franja');
    servidor.expectNone((r) => r.url.includes('/ubicacion'));
  });

  it('si la franja se ocupó, avisa en el diálogo y vuelve a pedir disponibilidad y agenda', async () => {
    const { fixture, servidor } = await montar();
    boton(fixture, 'Reprogramar').click();
    const libre = {
      fecha: '2026-10-15',
      bloque: 'manana',
      kinesiologos: [
        { kinesiologoId: 3, nombre: 'Kine Ficticio', franjas: [{ inicio: '10:00', fin: '10:45' }] },
      ],
    };
    (await peticion(servidor, '/api/disponibilidad')).flush(libre);
    await aparece(fixture, '#rep-franja-3-1000');
    const radio = q<HTMLInputElement>(fixture, '#rep-franja-3-1000');
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
    q(fixture, '#confirmar-reprogramacion').click();
    const [cuerpo, opciones] = error('franja_ocupada');
    (await peticion(servidor, '/api/turnos/1/ubicacion', 'PUT')).flush(cuerpo, opciones);

    await relectura(servidor, [turno(1)]);
    const d = await peticion(servidor, '/api/disponibilidad');
    expect(d.request.params.get('pacienteId')).toBe('7');
    d.flush({ ...libre, kinesiologos: [{ ...libre.kinesiologos[0], franjas: [] }] });
    await aparece(fixture, '#error-dialogo');
    expect(q(fixture, '#error-dialogo').textContent).toContain('se ocupó');
    expect(q(fixture, '[role="dialog"]')).not.toBeNull();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(q(fixture, '#sin-franjas-reprogramar')).not.toBeNull();
    });
  });

  it('turno_no_reservado cierra el diálogo, avisa en el turno y relee', async () => {
    const { fixture, servidor } = await montar();
    boton(fixture, 'Reprogramar').click();
    (await peticion(servidor, '/api/disponibilidad')).flush({
      fecha: '2026-10-15',
      bloque: 'manana',
      kinesiologos: [
        { kinesiologoId: 3, nombre: 'Kine Ficticio', franjas: [{ inicio: '10:00', fin: '10:45' }] },
      ],
    });
    await aparece(fixture, '#rep-franja-3-1000');
    const radio = q<HTMLInputElement>(fixture, '#rep-franja-3-1000');
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
    q(fixture, '#confirmar-reprogramacion').click();
    const [cuerpo, opciones] = error('turno_no_reservado');
    (await peticion(servidor, '/api/turnos/1/ubicacion', 'PUT')).flush(cuerpo, opciones);
    await relectura(servidor, [cerrado(1)]);
    await desaparece(fixture, '[role="dialog"]');
    expect(q(fixture, '#mensaje-turno-1').textContent).toContain('ya cambió de estado');
  });
});

describe('AgendaSecretaria: coseguro abonado (RF-27)', () => {
  it('muestra Sin abonar cuando no hay monto', async () => {
    const { fixture } = await montar([turno(1)]);
    expect(fila(fixture, 1).textContent).toContain('Sin abonar');
  });

  it('precarga el monto y manda la clave monto', async () => {
    const { fixture, servidor } = await montar([turno(1, { coseguroAbonado: '1500.50' })]);
    boton(fixture, 'Corregir abono').click();
    await aparece(fixture, '#editar-coseguro-abonado');
    const campo = q<HTMLInputElement>(fixture, '#editar-coseguro-abonado');
    expect(campo.value).toBe('1500.50');

    campo.value = '300,5';
    q(fixture, '#guardar-abono').click();
    const p = await peticion(servidor, '/api/turnos/1/abono', 'PUT');
    expect(p.request.body).toEqual({ monto: '300.5' });
    p.flush({ turno: { id: 1 } });
    await relectura(servidor, [turno(1, { coseguroAbonado: '300.50' })]);
    await desaparece(fixture, '[role="dialog"]');
    expect(fila(fixture, 1).textContent).toContain('$ 300,50');
  });

  it('vaciar el monto manda null y no omite la clave', async () => {
    const { fixture, servidor } = await montar([turno(1, { coseguroAbonado: '1500.50' })]);
    boton(fixture, 'Corregir abono').click();
    await aparece(fixture, '#editar-coseguro-abonado');
    q<HTMLInputElement>(fixture, '#editar-coseguro-abonado').value = '';
    q(fixture, '#guardar-abono').click();
    const p = await peticion(servidor, '/api/turnos/1/abono', 'PUT');
    expect(p.request.body).toEqual({ monto: null });
    p.flush({ turno: { id: 1 } });
    await relectura(servidor, [turno(1)]);
  });

  it('un monto inválido avisa y no escribe', async () => {
    const { fixture, servidor } = await montar();
    boton(fixture, 'Registrar abono').click();
    await aparece(fixture, '#editar-coseguro-abonado');
    q<HTMLInputElement>(fixture, '#editar-coseguro-abonado').value = '1.234';
    q(fixture, '#guardar-abono').click();
    await aparece(fixture, '#error-dialogo');
    expect(q(fixture, '#error-dialogo').textContent).toContain('hasta dos decimales');
    servidor.expectNone((r) => r.url.includes('/abono'));
  });

  it('el botón dice «Registrar abono» sin monto y «Corregir abono» con monto', async () => {
    const { fixture } = await montar([turno(1), turno(2, { coseguroAbonado: '10.00' })]);
    const rotulos = (id: number) =>
      Array.from(fila(fixture, id).querySelectorAll('button')).map((b) => b.textContent?.trim());
    expect(rotulos(1)).toContain('Registrar abono');
    expect(rotulos(1)).not.toContain('Corregir abono');
    expect(rotulos(2)).toContain('Corregir abono');
  });

  it('un turno anulado muestra su monto pero no ofrece registrar ni corregir el abono', async () => {
    const { fixture } = await montar([{ ...cerrado(1, 'anulado'), coseguroAbonado: '500.00' }]);
    expect(fila(fixture, 1).textContent).toContain('$ 500,00');
    expect(botones(fixture)).not.toContain('Corregir abono');
    expect(botones(fixture)).not.toContain('Registrar abono');
  });

  it('«Quitar abono» manda monto null y deja el turno sin abonar', async () => {
    const { fixture, servidor } = await montar([turno(1, { coseguroAbonado: '1500.50' })]);
    boton(fixture, 'Corregir abono').click();
    await aparece(fixture, '#quitar-abono');
    q(fixture, '#quitar-abono').click();
    const p = await peticion(servidor, '/api/turnos/1/abono', 'PUT');
    expect(p.request.body).toEqual({ monto: null });
    p.flush({ turno: { id: 1 } });
    await relectura(servidor, [turno(1)]);
    await desaparece(fixture, '[role="dialog"]');
    expect(fila(fixture, 1).textContent).toContain('Sin abonar');
    expect(q(fixture, '#mensaje-turno-1').textContent).toContain('quedó sin abonar');
  });

  it('sin monto cargado no ofrece quitar el abono', async () => {
    const { fixture } = await montar([turno(1)]);
    boton(fixture, 'Registrar abono').click();
    await aparece(fixture, '#editar-coseguro-abonado');
    expect(q(fixture, '#quitar-abono')).toBeNull();
  });

  it('409 turno_anulado: avisa en el turno con un mensaje claro y relee la agenda', async () => {
    const { fixture, servidor } = await montar([turno(1)]);
    boton(fixture, 'Registrar abono').click();
    await aparece(fixture, '#editar-coseguro-abonado');
    q<HTMLInputElement>(fixture, '#editar-coseguro-abonado').value = '100';
    q(fixture, '#guardar-abono').click();
    const [cuerpo, opciones] = error('turno_anulado');
    (await peticion(servidor, '/api/turnos/1/abono', 'PUT')).flush(cuerpo, opciones);
    await relectura(servidor, [cerrado(1, 'anulado')]);
    await desaparece(fixture, '[role="dialog"]');
    const mensaje = q(fixture, '#mensaje-turno-1');
    expect(mensaje.getAttribute('role')).toBe('alert');
    expect(mensaje.textContent).toContain('anulado');
    expect(mensaje.textContent).toContain('no admite');
  });

  it('al registrar un abono el recaudado sale de la relectura de la agenda', async () => {
    const { fixture, servidor } = await montar([turno(1)], [], '0.00');
    expect(q(fixture, '#recaudado-monto').textContent).toContain('$ 0,00');
    boton(fixture, 'Registrar abono').click();
    await aparece(fixture, '#editar-coseguro-abonado');
    q<HTMLInputElement>(fixture, '#editar-coseguro-abonado').value = '2500,5';
    q(fixture, '#guardar-abono').click();
    (await peticion(servidor, '/api/turnos/1/abono', 'PUT')).flush({ turno: { id: 1 } });
    await relectura(servidor, [turno(1, { coseguroAbonado: '2500.50' })], [], '2500.50');
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(q(fixture, '#recaudado-monto').textContent).toContain('$ 2.500,50');
    });
  });
});

describe('AgendaSecretaria: recaudado al pie (RF-48)', () => {
  it('muestra el recaudado que manda la API, formateado en pesos', async () => {
    const { fixture } = await montar([turno(1, { coseguroAbonado: '1500.50' })], [], '1500.50');
    expect(q(fixture, '#recaudado').textContent).toContain('Recaudado');
    expect(q(fixture, '#recaudado-monto').textContent).toBe('$ 1.500,50');
  });

  it('se muestra también sin turnos, en cero', async () => {
    const { fixture, servidor } = await montar([turno(1)], [], '0.00');
    const f = q<HTMLInputElement>(fixture, '#agenda-fecha');
    f.value = '2026-10-16';
    f.dispatchEvent(new Event('change'));
    (await peticion(servidor, '/api/agenda')).flush({
      fecha: '2026-10-16',
      turnos: [],
      recaudado: '0.00',
    });
    await aparece(fixture, '#sin-turnos');
    expect(q(fixture, '#recaudado-monto').textContent).toBe('$ 0,00');
  });

  it('al cambiar la fecha o el filtro vuelve a tomar el recaudado de la API', async () => {
    const { fixture, servidor } = await montar([turno(1)], [], '300.00');
    const f = q<HTMLInputElement>(fixture, '#agenda-fecha');
    f.value = '2026-10-16';
    f.dispatchEvent(new Event('change'));
    const porFecha = await peticion(servidor, '/api/agenda');
    expect(porFecha.request.params.get('fecha')).toBe('2026-10-16');
    porFecha.flush({ fecha: '2026-10-16', turnos: [turno(2)], recaudado: '45.00' });
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(q(fixture, '#recaudado-monto').textContent).toBe('$ 45,00');
    });

    const select = q<HTMLSelectElement>(fixture, '#agenda-kinesiologo');
    select.value = '4';
    select.dispatchEvent(new Event('change'));
    const porFiltro = await peticion(servidor, '/api/agenda');
    expect(porFiltro.request.params.get('kinesiologoId')).toBe('4');
    porFiltro.flush({ fecha: '2026-10-16', turnos: [turno(3)], recaudado: '10.10' });
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(q(fixture, '#recaudado-monto').textContent).toBe('$ 10,10');
    });
  });
});

describe('AgendaSecretaria: ticket (RF-28)', () => {
  it('descarga el PDF del turno', async () => {
    const { fixture, servidor } = await montar();
    URL.createObjectURL = vi.fn(() => 'blob:ficticio');
    URL.revokeObjectURL = vi.fn();
    const descargas: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      descargas.push(this.download);
    });
    boton(fixture, 'Ticket').click();
    (await peticion(servidor, '/api/turnos/1/ticket')).flush(
      new Blob(['%PDF'], { type: 'application/pdf' }),
    );
    await vi.waitFor(() => expect(descargas).toEqual(['turno-1.pdf']));
  });

  it('si falla, el mensaje queda en el turno', async () => {
    const { fixture, servidor } = await montar();
    boton(fixture, 'Ticket').click();
    (await peticion(servidor, '/api/turnos/1/ticket')).flush(new Blob([]), {
      status: 500,
      statusText: 'Error',
    });
    await aparece(fixture, '#mensaje-turno-1');
    expect(q(fixture, '#mensaje-turno-1').getAttribute('role')).toBe('alert');
  });
});

describe('AgendaSecretaria: aviso de pendientes (RF-42)', () => {
  it('sin pendientes no hay aviso', async () => {
    const { fixture } = await montar();
    expect(q(fixture, '#aviso-pendientes')).toBeNull();
  });

  it('con pendientes muestra la cantidad y marca los turnos de la lista', async () => {
    const { fixture } = await montar(
      [turno(1), cerrado(2)],
      [pendiente(1, { fecha: '2026-10-15' }), pendiente(5)],
    );
    await aparece(fixture, '#aviso-pendientes');
    expect(q(fixture, '#titulo-pendientes').textContent).toContain('Hay 2 turnos pendientes');
    expect(fila(fixture, 1).textContent).toContain('Pendiente de marcar');
    expect(fila(fixture, 2).textContent).not.toContain('Pendiente de marcar');
  });

  it('con uno solo usa el singular', async () => {
    const { fixture } = await montar([turno(1), cerrado(2)], [pendiente(5)]);
    await aparece(fixture, '#aviso-pendientes');
    expect(q(fixture, '#titulo-pendientes').textContent).toContain('Hay 1 turno pendiente');
  });

  it('ir a un pendiente lleva la agenda a su fecha, sin filtro, y enfoca la fila', async () => {
    const { fixture, servidor } = await montar([turno(1), cerrado(2)], [pendiente(5)]);
    const select = q<HTMLSelectElement>(fixture, '#agenda-kinesiologo');
    select.value = '4';
    select.dispatchEvent(new Event('change'));
    (await peticion(servidor, '/api/agenda')).flush({
      fecha: '2026-10-15',
      turnos: [turno(1)],
      recaudado: '0.00',
    });

    await aparece(fixture, '#aviso-pendientes');
    boton(fixture, 'Ver en la agenda').click();
    const p = await peticion(servidor, '/api/agenda');
    expect(p.request.params.get('fecha')).toBe('2026-10-14');
    expect(p.request.params.has('kinesiologoId')).toBe(false);
    p.flush({
      fecha: '2026-10-14',
      turnos: [turno(5, { fecha: '2026-10-14', horaInicio: '10:00', horaFin: '10:45' })],
      recaudado: '0.00',
    });
    await aparece(fixture, '#turno-5');
    expect(q<HTMLInputElement>(fixture, '#agenda-fecha').value).toBe('2026-10-14');
    await vi.waitFor(() => expect(document.activeElement?.id).toBe('turno-5'));
    expect(fila(fixture, 5).textContent).toContain('Pendiente de marcar');
  });

  it('tras marcar un pendiente se relee y el aviso desaparece', async () => {
    const { fixture, servidor } = await montar([turno(1)], [pendiente(1, { fecha: '2026-10-15' })]);
    await aparece(fixture, '#aviso-pendientes');
    boton(fixture, 'No asistió').click();
    await aparece(fixture, '[role="dialog"]');
    q(fixture, '#confirmar-accion').click();
    (await peticion(servidor, '/api/turnos/1/transicion', 'POST')).flush({ turno: { id: 1 } });
    await relectura(servidor, [cerrado(1, 'no_asistio')], []);
    await desaparece(fixture, '#aviso-pendientes');
  });

  it('no deja datos del paciente en la URL ni en el almacenamiento del navegador', async () => {
    const { fixture } = await montar([turno(1)], [pendiente(1, { fecha: '2026-10-15' })]);
    await aparece(fixture, '#aviso-pendientes');
    boton(fixture, 'Ver en la agenda').click();
    expect(window.location.href).not.toContain('Ficticia');
    expect(window.location.href).not.toContain('30123456');
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });
});
