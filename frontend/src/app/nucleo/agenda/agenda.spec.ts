import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Agenda } from './agenda';

function preparar() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return { servidor: TestBed.inject(HttpTestingController), agenda: TestBed.inject(Agenda) };
}

describe('Agenda de secretaría (RF-41)', () => {
  it('sin filtros no manda parámetros: la API usa hoy', async () => {
    const { servidor, agenda } = preparar();
    const resultado = agenda.consultar();
    const p = servidor.expectOne((r) => r.url === '/api/agenda');
    expect(p.request.method).toBe('GET');
    expect(p.request.params.keys()).toEqual([]);
    p.flush({ fecha: '2026-10-15', turnos: [] });
    expect(await resultado).toEqual({ fecha: '2026-10-15', turnos: [] });
  });

  it('manda fecha y kinesiólogo por query, sin datos personales', async () => {
    const { servidor, agenda } = preparar();
    const resultado = agenda.consultar('2026-10-14', 3);
    const p = servidor.expectOne((r) => r.url === '/api/agenda');
    expect(p.request.params.keys().sort()).toEqual(['fecha', 'kinesiologoId']);
    expect(p.request.params.get('fecha')).toBe('2026-10-14');
    expect(p.request.params.get('kinesiologoId')).toBe('3');
    p.flush({ fecha: '2026-10-14', turnos: [] });
    await resultado;
  });
});

describe('Pendientes de marcar (RF-42)', () => {
  it('consulta /api/agenda/pendientes sin parámetros', async () => {
    const { servidor, agenda } = preparar();
    const resultado = agenda.pendientes();
    const p = servidor.expectOne((r) => r.url === '/api/agenda/pendientes');
    expect(p.request.params.keys()).toEqual([]);
    p.flush({ cantidad: 0, turnos: [] });
    expect((await resultado).cantidad).toBe(0);
  });
});

describe('Agenda del kinesiólogo (RF-40, D-15)', () => {
  it('sin fecha no manda ningún parámetro', async () => {
    const { servidor, agenda } = preparar();
    const resultado = agenda.miAgenda();
    const p = servidor.expectOne((r) => r.url === '/api/mi-agenda');
    expect(p.request.method).toBe('GET');
    expect(p.request.params.keys()).toEqual([]);
    p.flush({ fecha: '2026-10-15', enEspera: [], proximos: [] });
    expect(await resultado).toEqual({ fecha: '2026-10-15', enEspera: [], proximos: [] });
  });

  it('manda solo la fecha: el kinesiólogo sale de la sesión, nunca de la petición', async () => {
    const { servidor, agenda } = preparar();
    const resultado = agenda.miAgenda('2026-10-14');
    const p = servidor.expectOne((r) => r.url === '/api/mi-agenda');
    expect(p.request.params.keys()).toEqual(['fecha']);
    expect(p.request.params.get('fecha')).toBe('2026-10-14');
    expect(p.request.params.has('kinesiologoId')).toBe(false);
    p.flush({ fecha: '2026-10-14', enEspera: [], proximos: [] });
    await resultado;
  });
});

describe('Turnos del paciente (RF-47)', () => {
  it('consulta /api/pacientes/:id/turnos sin parámetros', async () => {
    const { servidor, agenda } = preparar();
    const resultado = agenda.delPaciente(7);
    const p = servidor.expectOne('/api/pacientes/7/turnos');
    expect(p.request.method).toBe('GET');
    expect(p.request.params.keys()).toEqual([]);
    p.flush({ proximos: [], historial: [] });
    expect(await resultado).toEqual({ proximos: [], historial: [] });
  });
});
