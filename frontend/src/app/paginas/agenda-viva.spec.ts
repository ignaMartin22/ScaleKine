import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
  type TestRequest,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { TurnoDeAgenda, TurnoPropio } from '../nucleo/agenda/agenda';
import { erroresDeApi } from '../nucleo/http/interceptores';
import { estadoDePrueba } from '../nucleo/sesion/estados-de-prueba';
import { Sesion } from '../nucleo/sesion/sesion';
import { SocketDePrueba } from '../nucleo/tiempo-real/socket-de-prueba';
import { FABRICA_SOCKET } from '../nucleo/tiempo-real/tiempo-real';
import type { Rol } from '../nucleo/sesion/modelo';
import { AgendaSecretaria } from './agenda-secretaria';
import { InicioKinesiologo } from './inicio-kinesiologo';

const raiz = (f: ComponentFixture<unknown>) => f.nativeElement as HTMLElement;

async function aparece(f: ComponentFixture<unknown>, comprobar: () => void): Promise<void> {
  await vi.waitFor(() => {
    f.detectChanges();
    comprobar();
  });
}

function configurar(rol: Rol) {
  const socket = new SocketDePrueba();
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(withInterceptors([erroresDeApi])),
      provideHttpClientTesting(),
      { provide: FABRICA_SOCKET, useValue: () => socket },
    ],
  });
  TestBed.inject(Sesion).establecer(estadoDePrueba(rol));
  const navegar = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
  return { socket, navegar, servidor: TestBed.inject(HttpTestingController) };
}

const pedido = (servidor: HttpTestingController, url: string) =>
  vi.waitFor(() => servidor.expectOne((r) => r.url === url)) as Promise<TestRequest>;

// Kinesiólogo

function propio(id: number, cambios: Partial<TurnoPropio> = {}): TurnoPropio {
  return {
    id,
    fecha: '2026-10-15',
    horaInicio: '08:00',
    horaFin: '08:45',
    estado: 'reservado',
    horaLlegada: null,
    paciente: {
      nombre: `Paciente Ficticio ${id}`,
      dni: '30123456',
      telefono: '1100000000',
      obraSocial: 'Particular',
    },
    ...cambios,
  };
}

async function montarKinesiologo(enEspera: TurnoPropio[], proximos: TurnoPropio[]) {
  const base = configurar('kinesiologo');
  const fixture = TestBed.createComponent(InicioKinesiologo);
  fixture.detectChanges();
  (await pedido(base.servidor, '/api/mi-agenda')).flush({
    fecha: '2026-10-15',
    enEspera,
    proximos,
  });
  await aparece(fixture, () =>
    expect(raiz(fixture).querySelector('#titulo-espera')).not.toBeNull(),
  );
  base.socket.emitir('connect');
  return { ...base, fixture };
}

const nombres = (f: ComponentFixture<unknown>, tabla: string) =>
  Array.from(raiz(f).querySelectorAll(`${tabla} tbody strong`)).map((e) => e.textContent?.trim());

describe('Agenda del kinesiólogo en vivo (RF-43, RF-44, RF-45)', () => {
  it('un turno que pasa a en_espera se mueve a la espera, por hora de llegada y no por franja', async () => {
    const { fixture, socket } = await montarKinesiologo(
      [propio(1, { estado: 'en_espera', horaInicio: '08:00', horaLlegada: '08:30' })],
      [propio(2, { horaInicio: '09:00' }), propio(3, { horaInicio: '10:00' })],
    );
    // Llega el turno de las 10:00 antes que el de las 08:00 pero después... de las 08:10.
    socket.emitir('turno:cambio', {
      turno: propio(3, { estado: 'en_espera', horaInicio: '10:00', horaLlegada: '08:10' }),
    });
    fixture.detectChanges();
    expect(nombres(fixture, '#tabla-espera')).toEqual([
      'Paciente Ficticio 3',
      'Paciente Ficticio 1',
    ]);
    expect(nombres(fixture, '#tabla-proximos')).toEqual(['Paciente Ficticio 2']);
  });

  it('un turno que sale de la espera (asistió) desaparece de las listas', async () => {
    const { fixture, socket } = await montarKinesiologo(
      [propio(1, { estado: 'en_espera', horaLlegada: '08:00' })],
      [],
    );
    socket.emitir('turno:cambio', {
      turno: propio(1, { estado: 'asistio', horaLlegada: '08:00' }),
    });
    fixture.detectChanges();
    expect(raiz(fixture).querySelector('#sin-espera')).not.toBeNull();
  });

  it('ignora un turno:cambio de otra fecha', async () => {
    const { fixture, socket } = await montarKinesiologo([], [propio(2)]);
    socket.emitir('turno:cambio', {
      turno: propio(7, { fecha: '2026-10-16', estado: 'en_espera', horaLlegada: '08:00' }),
    });
    fixture.detectChanges();
    expect(raiz(fixture).querySelector('#tabla-espera')).toBeNull();
    expect(nombres(fixture, '#tabla-proximos')).toEqual(['Paciente Ficticio 2']);
  });

  it('turno:quitado saca el turno de su agenda', async () => {
    const { fixture, socket } = await montarKinesiologo(
      [propio(1, { estado: 'en_espera', horaLlegada: '08:00' })],
      [propio(2)],
    );
    socket.emitir('turno:quitado', { turnoId: 1 });
    socket.emitir('turno:quitado', { turnoId: 2 });
    fixture.detectChanges();
    expect(raiz(fixture).querySelector('#sin-espera')).not.toBeNull();
    expect(raiz(fixture).querySelector('#sin-proximos')).not.toBeNull();
  });

  it('con la conexión caída muestra el indicador y al reconectar vuelve a pedir la agenda', async () => {
    const { fixture, socket, servidor } = await montarKinesiologo([], [propio(2)]);
    socket.emitir('disconnect', 'transport close');
    fixture.detectChanges();
    expect(raiz(fixture).textContent).toContain(
      'Sin conexión: la agenda puede estar desactualizada',
    );

    socket.emitir('connect');
    const lectura = await pedido(servidor, '/api/mi-agenda');
    lectura.flush({ fecha: '2026-10-15', enEspera: [], proximos: [propio(8)] });
    await aparece(fixture, () => {
      expect(nombres(fixture, '#tabla-proximos')).toEqual(['Paciente Ficticio 8']);
      expect(raiz(fixture).textContent).not.toContain('Sin conexión');
    });
  });

  it('sesion:cerrada vuelve al ingreso', async () => {
    const { socket, navegar } = await montarKinesiologo([], []);
    socket.emitir('sesion:cerrada', { motivo: 'vencida' });
    expect(navegar).toHaveBeenCalledWith('/ingresar');
  });
});

// Secretaría

const ACCIONES = {
  transiciones: [{ hacia: 'en_espera' as const, accion: 'Llegó' }],
  puedeCorregir: true,
};

function deAgenda(id: number, cambios: Partial<TurnoDeAgenda> = {}): TurnoDeAgenda {
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
    acciones: ACCIONES,
    ...cambios,
  };
}

async function montarSecretaria(turnos: TurnoDeAgenda[], recaudado = '0.00') {
  const base = configurar('secretaria');
  const fixture = TestBed.createComponent(AgendaSecretaria);
  fixture.detectChanges();
  (await pedido(base.servidor, '/api/kinesiologos')).flush({
    kinesiologos: [
      { id: 3, nombre: 'Kine Ficticio', bloque: 'manana', activo: true },
      { id: 4, nombre: 'Otra Ficticia', bloque: 'tarde', activo: true },
    ],
  });
  (await pedido(base.servidor, '/api/agenda')).flush({ fecha: '2026-10-15', turnos, recaudado });
  (await pedido(base.servidor, '/api/agenda/pendientes')).flush({ cantidad: 0, turnos: [] });
  await aparece(fixture, () =>
    expect(raiz(fixture).querySelector('#turno-' + turnos[0].id)).not.toBeNull(),
  );
  base.socket.emitir('connect');
  return { ...base, fixture };
}

const hay = (f: ComponentFixture<unknown>, id: number) =>
  raiz(f).querySelector('#turno-' + id) !== null;

/** Responde la relectura de pendientes que sigue a un turno:cambio. */
async function pendientesVacios(servidor: HttpTestingController) {
  (await pedido(servidor, '/api/agenda/pendientes')).flush({ cantidad: 0, turnos: [] });
}

const recaudadoVisible = (f: ComponentFixture<unknown>) =>
  raiz(f).querySelector('#recaudado-monto')?.textContent?.trim();

describe('Recaudado en vivo (RF-48, RF-44)', () => {
  it('un turno:cambio con un abono nuevo lo suma, en centavos: 0.10 + 0.20 es 0.30', async () => {
    const { fixture, socket, servidor } = await montarSecretaria(
      [deAgenda(1, { coseguroAbonado: '0.10' }), deAgenda(2)],
      '0.10',
    );
    expect(recaudadoVisible(fixture)).toBe('$ 0,10');
    socket.emitir('turno:cambio', { turno: deAgenda(2, { coseguroAbonado: '0.20' }) });
    fixture.detectChanges();
    expect(recaudadoVisible(fixture)).toBe('$ 0,30');
    await pendientesVacios(servidor);
  });

  it('suma con formato de miles y mantiene los dos decimales', async () => {
    const { fixture, socket, servidor } = await montarSecretaria(
      [deAgenda(1, { coseguroAbonado: '1999.99' })],
      '1999.99',
    );
    socket.emitir('turno:cambio', {
      turno: deAgenda(2, { horaInicio: '09:00', coseguroAbonado: '0.01' }),
    });
    fixture.detectChanges();
    expect(recaudadoVisible(fixture)).toBe('$ 2.000,00');
    await pendientesVacios(servidor);
  });

  it('un turno que pasa a anulado deja de contar', async () => {
    const { fixture, socket, servidor } = await montarSecretaria(
      [deAgenda(1, { coseguroAbonado: '500.00' }), deAgenda(2, { coseguroAbonado: '250.00' })],
      '750.00',
    );
    socket.emitir('turno:cambio', {
      turno: deAgenda(1, { estado: 'anulado', coseguroAbonado: '500.00' }),
    });
    fixture.detectChanges();
    expect(hay(fixture, 1)).toBe(true);
    expect(recaudadoVisible(fixture)).toBe('$ 250,00');
    await pendientesVacios(servidor);
  });

  it('un turno nuevo ya anulado no suma aunque traiga un monto', async () => {
    const { fixture, socket, servidor } = await montarSecretaria(
      [deAgenda(1, { coseguroAbonado: '100.00' })],
      '100.00',
    );
    socket.emitir('turno:cambio', {
      turno: deAgenda(2, { estado: 'anulado', coseguroAbonado: '900.00' }),
    });
    fixture.detectChanges();
    expect(recaudadoVisible(fixture)).toBe('$ 100,00');
    await pendientesVacios(servidor);
  });

  it('un turno que se corrige de anulado a otro estado vuelve a contar', async () => {
    const { fixture, socket, servidor } = await montarSecretaria(
      [deAgenda(1, { estado: 'anulado', coseguroAbonado: '300.00' })],
      '0.00',
    );
    socket.emitir('turno:cambio', { turno: deAgenda(1, { coseguroAbonado: '300.00' }) });
    fixture.detectChanges();
    expect(recaudadoVisible(fixture)).toBe('$ 300,00');
    await pendientesVacios(servidor);
  });

  it('un abono quitado baja el recaudado', async () => {
    const { fixture, socket, servidor } = await montarSecretaria(
      [deAgenda(1, { coseguroAbonado: '300.00' })],
      '300.00',
    );
    socket.emitir('turno:cambio', { turno: deAgenda(1, { coseguroAbonado: null }) });
    fixture.detectChanges();
    expect(recaudadoVisible(fixture)).toBe('$ 0,00');
    await pendientesVacios(servidor);
  });

  it('turno:quitado resta el turno que sale de la agenda', async () => {
    const { fixture, socket } = await montarSecretaria(
      [deAgenda(1, { coseguroAbonado: '100.00' }), deAgenda(2, { coseguroAbonado: '40.50' })],
      '140.50',
    );
    socket.emitir('turno:quitado', { turnoId: 2 });
    fixture.detectChanges();
    expect(recaudadoVisible(fixture)).toBe('$ 100,00');
  });

  it('un turno de otra fecha no suma, y uno reprogramado a otra fecha resta', async () => {
    const { fixture, socket, servidor } = await montarSecretaria(
      [deAgenda(1, { coseguroAbonado: '100.00' }), deAgenda(2, { coseguroAbonado: '50.00' })],
      '150.00',
    );
    socket.emitir('turno:cambio', {
      turno: deAgenda(9, { fecha: '2026-10-16', coseguroAbonado: '999.00' }),
    });
    fixture.detectChanges();
    expect(recaudadoVisible(fixture)).toBe('$ 150,00');
    await pendientesVacios(servidor);

    socket.emitir('turno:cambio', {
      turno: deAgenda(2, { fecha: '2026-10-20', coseguroAbonado: '50.00' }),
    });
    fixture.detectChanges();
    expect(recaudadoVisible(fixture)).toBe('$ 100,00');
    await pendientesVacios(servidor);
  });

  it('sigue el filtro de kinesiólogo: lo ajeno no suma y lo que sale del filtro resta', async () => {
    const { fixture, socket, servidor } = await montarSecretaria([deAgenda(1), deAgenda(2)]);
    const select = raiz(fixture).querySelector('#agenda-kinesiologo') as HTMLSelectElement;
    select.value = '3';
    select.dispatchEvent(new Event('change'));
    (await pedido(servidor, '/api/agenda')).flush({
      fecha: '2026-10-15',
      turnos: [deAgenda(1, { coseguroAbonado: '100.00' })],
      recaudado: '100.00',
    });
    await aparece(fixture, () => expect(recaudadoVisible(fixture)).toBe('$ 100,00'));

    socket.emitir('turno:cambio', {
      turno: deAgenda(5, {
        kinesiologo: { id: 4, nombre: 'Otra Ficticia' },
        coseguroAbonado: '700.00',
      }),
    });
    fixture.detectChanges();
    expect(recaudadoVisible(fixture)).toBe('$ 100,00');
    await pendientesVacios(servidor);

    socket.emitir('turno:cambio', {
      turno: deAgenda(1, {
        kinesiologo: { id: 4, nombre: 'Otra Ficticia' },
        coseguroAbonado: '100.00',
      }),
    });
    fixture.detectChanges();
    expect(recaudadoVisible(fixture)).toBe('$ 0,00');
    await pendientesVacios(servidor);
  });

  it('el kinesiólogo no ve el recaudado ni ningún monto', async () => {
    const { fixture } = await montarKinesiologo([], [propio(1)]);
    expect(raiz(fixture).querySelector('#recaudado')).toBeNull();
    expect(raiz(fixture).textContent).not.toContain('Recaudado');
    expect(raiz(fixture).textContent).not.toContain('$ ');
    expect(raiz(fixture).textContent).not.toContain('Coseguro');
  });
});

describe('Agenda de secretaría en vivo (RF-44, RF-45)', () => {
  it('reemplaza el turno por id con el estado y las acciones que manda el servidor', async () => {
    const { fixture, socket, servidor } = await montarSecretaria([deAgenda(1)]);
    socket.emitir('turno:cambio', {
      turno: deAgenda(1, {
        estado: 'en_espera',
        horaLlegada: '08:05',
        acciones: { transiciones: [{ hacia: 'asistio', accion: 'Asistió' }], puedeCorregir: true },
      }),
    });
    fixture.detectChanges();
    const textoFila = raiz(fixture).querySelector('#turno-1')?.textContent ?? '';
    expect(textoFila).toContain('En espera');
    expect(textoFila).toContain('08:05');
    expect(textoFila).toContain('Asistió');
    const botones = Array.from(raiz(fixture).querySelectorAll('#turno-1 button')).map((b) =>
      b.textContent?.trim(),
    );
    expect(botones).not.toContain('Llegó');
    await pendientesVacios(servidor);
  });

  it('agrega un turno nuevo de la fecha mostrada, en orden de franja', async () => {
    const { fixture, socket, servidor } = await montarSecretaria([
      deAgenda(1, { horaInicio: '09:00', horaFin: '09:45' }),
    ]);
    socket.emitir('turno:cambio', { turno: deAgenda(2, { horaInicio: '08:00' }) });
    fixture.detectChanges();
    const ids = Array.from(raiz(fixture).querySelectorAll('[id^="turno-"]')).map((e) => e.id);
    expect(ids.indexOf('turno-2')).toBeLessThan(ids.indexOf('turno-1'));
    await pendientesVacios(servidor);
  });

  it('ignora un turno:cambio de otra fecha', async () => {
    const { fixture, socket, servidor } = await montarSecretaria([deAgenda(1)]);
    socket.emitir('turno:cambio', { turno: deAgenda(2, { fecha: '2026-10-16' }) });
    fixture.detectChanges();
    expect(hay(fixture, 2)).toBe(false);
    expect(hay(fixture, 1)).toBe(true);
    await pendientesVacios(servidor);
  });

  it('un turno reprogramado a otra fecha se quita de la agenda mostrada', async () => {
    const { fixture, socket, servidor } = await montarSecretaria([deAgenda(1), deAgenda(2)]);
    socket.emitir('turno:cambio', { turno: deAgenda(2, { fecha: '2026-10-20' }) });
    fixture.detectChanges();
    expect(hay(fixture, 2)).toBe(false);
    expect(hay(fixture, 1)).toBe(true);
    await pendientesVacios(servidor);
  });

  it('respeta el filtro de kinesiólogo: lo ajeno no entra y lo que se va del filtro se quita', async () => {
    const { fixture, socket, servidor } = await montarSecretaria([deAgenda(1), deAgenda(2)]);
    const select = raiz(fixture).querySelector('#agenda-kinesiologo') as HTMLSelectElement;
    select.value = '3';
    select.dispatchEvent(new Event('change'));
    (await pedido(servidor, '/api/agenda')).flush({
      fecha: '2026-10-15',
      turnos: [deAgenda(1)],
      recaudado: '0.00',
    });
    await aparece(fixture, () => expect(hay(fixture, 2)).toBe(false));

    socket.emitir('turno:cambio', {
      turno: deAgenda(5, { kinesiologo: { id: 4, nombre: 'Otra Ficticia' } }),
    });
    fixture.detectChanges();
    expect(hay(fixture, 5)).toBe(false);
    await pendientesVacios(servidor);

    socket.emitir('turno:cambio', {
      turno: deAgenda(1, { kinesiologo: { id: 4, nombre: 'Otra Ficticia' } }),
    });
    fixture.detectChanges();
    expect(hay(fixture, 1)).toBe(false);
    await pendientesVacios(servidor);
  });

  it('turno:quitado saca el turno', async () => {
    const { fixture, socket } = await montarSecretaria([deAgenda(1), deAgenda(2)]);
    socket.emitir('turno:quitado', { turnoId: 2 });
    fixture.detectChanges();
    expect(hay(fixture, 2)).toBe(false);
    expect(hay(fixture, 1)).toBe(true);
  });

  it('con la conexión caída muestra el indicador y al reconectar relee agenda y pendientes', async () => {
    const { fixture, socket, servidor } = await montarSecretaria([deAgenda(1)]);
    socket.emitir('disconnect', 'transport close');
    fixture.detectChanges();
    expect(raiz(fixture).textContent).toContain(
      'Sin conexión: la agenda puede estar desactualizada',
    );

    socket.emitir('connect');
    (await pedido(servidor, '/api/agenda')).flush({
      fecha: '2026-10-15',
      turnos: [deAgenda(9)],
      recaudado: '0.00',
    });
    await pendientesVacios(servidor);
    await aparece(fixture, () => {
      expect(hay(fixture, 9)).toBe(true);
      expect(hay(fixture, 1)).toBe(false);
      expect(raiz(fixture).textContent).not.toContain('Sin conexión');
    });
  });

  it('sesion:cerrada vuelve al ingreso', async () => {
    const { socket, navegar } = await montarSecretaria([deAgenda(1)]);
    socket.emitir('sesion:cerrada', { motivo: 'revocada' });
    expect(navegar).toHaveBeenCalledWith('/ingresar');
  });
});
