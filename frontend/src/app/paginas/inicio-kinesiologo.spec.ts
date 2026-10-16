import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { AgendaPropia, TurnoPropio } from '../nucleo/agenda/agenda';
import { erroresDeApi } from '../nucleo/http/interceptores';
import { InicioKinesiologo } from './inicio-kinesiologo';

function turno(id: number, cambios: Partial<TurnoPropio> = {}): TurnoPropio {
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

const raiz = (f: ComponentFixture<unknown>) => f.nativeElement as HTMLElement;
const q = (f: ComponentFixture<unknown>, s: string) => raiz(f).querySelector(s);

async function aparece(f: ComponentFixture<unknown>, selector: string): Promise<void> {
  await vi.waitFor(() => {
    f.detectChanges();
    expect(q(f, selector)).not.toBeNull();
  });
}

/** Nombres de paciente en el orden en que se ven en una tabla. */
const nombres = (f: ComponentFixture<unknown>, tabla: string) =>
  Array.from(raiz(f).querySelectorAll(`${tabla} tbody strong`)).map((e) => e.textContent?.trim());

function iniciar() {
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(withInterceptors([erroresDeApi])),
      provideHttpClientTesting(),
    ],
  });
  const servidor = TestBed.inject(HttpTestingController);
  const fixture = TestBed.createComponent(InicioKinesiologo);
  fixture.detectChanges();
  return { fixture, servidor };
}

const pedido = (servidor: HttpTestingController) =>
  vi.waitFor(() => servidor.expectOne((r) => r.url === '/api/mi-agenda'));

async function montar(agenda: Partial<AgendaPropia> = {}) {
  const { fixture, servidor } = iniciar();
  const p = await pedido(servidor);
  expect(p.request.params.keys()).toEqual([]);
  p.flush({ fecha: '2026-10-15', enEspera: [], proximos: [], ...agenda });
  await aparece(fixture, '#titulo-espera');
  return { fixture, servidor };
}

describe('Agenda del kinesiólogo (RF-40, D-15)', () => {
  it('carga la agenda de hoy sin mandar ningún identificador', async () => {
    const { fixture } = await montar();
    expect((q(fixture, '#mi-agenda-fecha') as HTMLInputElement).value).toBe('2026-10-15');
  });

  it('muestra la espera por hora de llegada, no por hora de turno (RF-40)', async () => {
    const { fixture } = await montar({
      enEspera: [
        turno(1, { estado: 'en_espera', horaInicio: '08:00', horaLlegada: '08:40' }),
        turno(2, { estado: 'en_espera', horaInicio: '09:00', horaLlegada: '07:55' }),
        turno(3, { estado: 'en_espera', horaInicio: '08:45', horaLlegada: '08:10' }),
      ],
    });
    expect(nombres(fixture, '#tabla-espera')).toEqual([
      'Paciente Ficticio 2',
      'Paciente Ficticio 3',
      'Paciente Ficticio 1',
    ]);
  });

  it('muestra los próximos por franja con paciente y estado, sin el monto abonado', async () => {
    const { fixture } = await montar({
      proximos: [turno(1, { horaInicio: '09:00', horaFin: '09:45' }), turno(2)],
    });
    expect(nombres(fixture, '#tabla-proximos')).toEqual([
      'Paciente Ficticio 2',
      'Paciente Ficticio 1',
    ]);
    const t = q(fixture, '#tabla-proximos')?.textContent ?? '';
    for (const dato of ['DNI 30123456', '1100000000', 'Particular', '08:00 a 08:45', 'Reservado']) {
      expect(t).toContain(dato);
    }
    expect(t).not.toMatch(/coseguro|abonar|\$/i);
  });

  it('muestra la hora de llegada que da la API', async () => {
    const { fixture } = await montar({
      enEspera: [turno(1, { estado: 'en_espera', horaLlegada: '07:41' })],
    });
    expect(q(fixture, '#tabla-espera tbody td')?.textContent).toBe('07:41');
    expect(q(fixture, '#tabla-espera')?.textContent).toContain('En espera');
  });

  it('sin acciones: ni botones de estado, ni corrección, ni ticket, ni enlaces (D-15, D-16)', async () => {
    const { fixture } = await montar({
      enEspera: [turno(1, { estado: 'en_espera', horaLlegada: '08:00' })],
      proximos: [turno(2)],
    });
    const tablas = Array.from(raiz(fixture).querySelectorAll('table'));
    expect(tablas.length).toBe(2);
    for (const tabla of tablas) {
      expect(tabla.querySelectorAll('button, a, input, select, [role="button"]').length).toBe(0);
    }
    expect(raiz(fixture).querySelectorAll('a').length).toBe(0);
    const botones = Array.from(raiz(fixture).querySelectorAll('button')).map((b) =>
      b.textContent?.trim(),
    );
    expect(botones).toEqual(['Actualizar']);
  });

  it('estado vacío claro en las dos listas', async () => {
    const { fixture } = await montar();
    expect(q(fixture, '#sin-espera')?.textContent).toContain('No hay pacientes en espera');
    expect(q(fixture, '#sin-proximos')?.textContent).toContain('No hay turnos próximos');
    expect(q(fixture, 'table')).toBeNull();
  });

  it('cambiar la fecha consulta solo esa fecha', async () => {
    const { fixture, servidor } = await montar();
    const campo = q(fixture, '#mi-agenda-fecha') as HTMLInputElement;
    campo.value = '2026-10-16';
    campo.dispatchEvent(new Event('change'));
    const p = await pedido(servidor);
    expect(p.request.params.keys()).toEqual(['fecha']);
    expect(p.request.params.get('fecha')).toBe('2026-10-16');
    p.flush({ fecha: '2026-10-16', enEspera: [], proximos: [turno(5)] });
    await aparece(fixture, '#tabla-proximos');
    expect(q(fixture, '#sin-espera')?.textContent).toContain('16/10/2026');
  });

  it('«Actualizar» vuelve a consultar la fecha vigente', async () => {
    const { fixture, servidor } = await montar();
    (q(fixture, '#actualizar') as HTMLButtonElement).click();
    const p = await pedido(servidor);
    expect(p.request.params.get('fecha')).toBe('2026-10-15');
    p.flush({
      fecha: '2026-10-15',
      enEspera: [turno(1, { estado: 'en_espera', horaLlegada: '08:00' })],
      proximos: [],
    });
    await aparece(fixture, '#tabla-espera');
  });

  it('un error de la API se avisa con un mensaje asociado y no deja datos viejos', async () => {
    const { fixture, servidor } = iniciar();
    (await pedido(servidor)).flush(
      { error: { codigo: 'no_autorizado', mensaje: 'Mensaje del sistema.' } },
      { status: 403, statusText: 'Forbidden' },
    );
    await aparece(fixture, '#error-carga');
    expect(q(fixture, '#error-carga')?.getAttribute('role')).toBe('alert');
    expect(q(fixture, 'table')).toBeNull();
  });
});
