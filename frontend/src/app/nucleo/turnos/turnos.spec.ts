import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ErrorApi } from '../http/error-api';
import { Disponibilidad } from './disponibilidad';
import { normalizarMonto, traducirErrorAsignacion } from './errores-asignacion';
import { Turnos, type DatosAsignacion } from './turnos';

function preparar() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return { servidor: TestBed.inject(HttpTestingController) };
}

describe('Disponibilidad (RF-22, RF-25)', () => {
  const kinesiologos = [
    { kinesiologoId: 3, nombre: 'Kine Ficticio', franjas: [{ inicio: '08:00', fin: '08:45' }] },
  ];

  it('sin paciente manda solo fecha y bloque', async () => {
    const { servidor } = preparar();
    const resultado = TestBed.inject(Disponibilidad).consultar('2026-10-14', 'manana');
    const p = servidor.expectOne((r) => r.url === '/api/disponibilidad');
    expect(p.request.method).toBe('GET');
    expect(p.request.params.keys().sort()).toEqual(['bloque', 'fecha']);
    expect(p.request.params.get('fecha')).toBe('2026-10-14');
    expect(p.request.params.get('bloque')).toBe('manana');
    p.flush({ fecha: '2026-10-14', bloque: 'manana', kinesiologos });
    expect(await resultado).toEqual(kinesiologos);
  });

  it('con paciente manda también pacienteId', async () => {
    const { servidor } = preparar();
    const resultado = TestBed.inject(Disponibilidad).consultar('2026-10-14', 'tarde', 7);
    const p = servidor.expectOne((r) => r.url === '/api/disponibilidad');
    expect(p.request.params.get('pacienteId')).toBe('7');
    expect(p.request.params.get('bloque')).toBe('tarde');
    p.flush({ fecha: '2026-10-14', bloque: 'tarde', kinesiologos: [] });
    expect(await resultado).toEqual([]);
  });
});

describe('Turnos (RF-23, RF-28)', () => {
  const datos: DatosAsignacion = {
    pacienteId: 7,
    kinesiologoId: 3,
    fecha: '2026-10-14',
    horaInicio: '08:00',
    coseguroObraSocial: '1500.50',
  };

  it('asigna con POST y devuelve el turno', async () => {
    const { servidor } = preparar();
    const resultado = TestBed.inject(Turnos).asignar(datos);
    const p = servidor.expectOne({ method: 'POST', url: '/api/turnos' });
    expect(p.request.body).toEqual(datos);
    const turno = { id: 12, ...datos, estado: 'reservado', coseguroAdicional: null };
    p.flush({ turno }, { status: 201, statusText: 'Created' });
    expect((await resultado).id).toBe(12);
  });

  it('descarga el ticket como blob', async () => {
    const { servidor } = preparar();
    const resultado = TestBed.inject(Turnos).descargarTicket(12);
    const p = servidor.expectOne({ method: 'GET', url: '/api/turnos/12/ticket' });
    expect(p.request.responseType).toBe('blob');
    p.flush(new Blob(['%PDF'], { type: 'application/pdf' }));
    expect((await resultado).type).toBe('application/pdf');
  });
});

describe('traducirErrorAsignacion (RF-24 a RF-26)', () => {
  const api = (codigo: string, campos: string[] = []) =>
    new ErrorApi(409, codigo, 'Mensaje del servidor.', campos);

  it('franja ocupada: paso franja y refresca', () => {
    const t = traducirErrorAsignacion(api('franja_ocupada'));
    expect(t).toMatchObject({ paso: 'franja', refrescar: true, olvidarPaciente: false });
    expect(t.mensaje).toContain('se ocupó');
  });

  it('paciente con turno en la franja: paso franja y refresca', () => {
    expect(traducirErrorAsignacion(api('paciente_con_turno_en_franja'))).toMatchObject({
      paso: 'franja',
      refrescar: true,
    });
  });

  it('franja inválida y kinesiólogo inexistente refrescan', () => {
    expect(traducirErrorAsignacion(api('franja_invalida')).refrescar).toBe(true);
    expect(traducirErrorAsignacion(api('kinesiologo_no_encontrado')).refrescar).toBe(true);
  });

  it('paciente inexistente: paso paciente', () => {
    expect(traducirErrorAsignacion(api('paciente_no_encontrado'))).toMatchObject({
      paso: 'paciente',
      olvidarPaciente: true,
    });
  });

  it('dato faltante conserva el mensaje que nombra lo que falta', () => {
    const t = traducirErrorAsignacion(api('dato_faltante'));
    expect(t).toMatchObject({ paso: 'confirmar', mensaje: 'Mensaje del servidor.' });
  });

  it('datos inválidos en un coseguro: paso coseguros', () => {
    expect(traducirErrorAsignacion(api('datos_invalidos', ['body.coseguroAdicional'])).paso).toBe(
      'coseguros',
    );
  });

  it('cualquier otro error va a la confirmación', () => {
    expect(traducirErrorAsignacion(new Error('x'))).toMatchObject({
      paso: 'confirmar',
      refrescar: false,
    });
  });
});

describe('normalizarMonto (RF-23)', () => {
  it('vacío es sin cargar', () => {
    expect(normalizarMonto('  ')).toBeUndefined();
  });
  it('acepta enteros y hasta dos decimales con coma o punto', () => {
    expect(normalizarMonto('1500')).toBe('1500');
    expect(normalizarMonto('1500,5')).toBe('1500.5');
    expect(normalizarMonto('1500.50')).toBe('1500.50');
  });
  it('rechaza tres decimales, negativos y texto', () => {
    expect(normalizarMonto('1.234')).toBeNull();
    expect(normalizarMonto('-5')).toBeNull();
    expect(normalizarMonto('abc')).toBeNull();
    expect(normalizarMonto('1,2,3')).toBeNull();
  });
});
