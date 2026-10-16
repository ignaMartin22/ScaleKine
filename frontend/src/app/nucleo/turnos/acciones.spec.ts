import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ErrorApi } from '../http/error-api';
import { traducirErrorAccion } from './errores-agenda';
import { Turnos } from './turnos';

function preparar() {
  TestBed.configureTestingModule({
    providers: [provideHttpClient(), provideHttpClientTesting()],
  });
  return { servidor: TestBed.inject(HttpTestingController) };
}

describe('Turnos: acciones sobre un turno (RF-27, RF-30 a RF-36)', () => {
  const turno = { id: 12, estado: 'en_espera' };

  it('transiciona con POST { hacia }', async () => {
    const { servidor } = preparar();
    const resultado = TestBed.inject(Turnos).transicionar(12, 'en_espera');
    const p = servidor.expectOne({ method: 'POST', url: '/api/turnos/12/transicion' });
    expect(p.request.body).toEqual({ hacia: 'en_espera' });
    p.flush({ turno });
    expect((await resultado).id).toBe(12);
  });

  it('corrige con POST { estado }', async () => {
    const { servidor } = preparar();
    const resultado = TestBed.inject(Turnos).corregir(12, 'reservado');
    const p = servidor.expectOne({ method: 'POST', url: '/api/turnos/12/correccion' });
    expect(p.request.body).toEqual({ estado: 'reservado' });
    p.flush({ turno });
    await resultado;
  });

  it('reprograma con PUT de los tres datos', async () => {
    const { servidor } = preparar();
    const resultado = TestBed.inject(Turnos).reprogramar(12, {
      kinesiologoId: 4,
      fecha: '2026-10-20',
      horaInicio: '09:00',
    });
    const p = servidor.expectOne({ method: 'PUT', url: '/api/turnos/12/ubicacion' });
    expect(p.request.body).toEqual({ kinesiologoId: 4, fecha: '2026-10-20', horaInicio: '09:00' });
    p.flush({ turno });
    await resultado;
  });

  it('abono: manda siempre la clave monto, con null para sin abonar', async () => {
    const { servidor } = preparar();
    const resultado = TestBed.inject(Turnos).registrarAbono(12, '1500.50');
    const p = servidor.expectOne({ method: 'PUT', url: '/api/turnos/12/abono' });
    expect(p.request.body).toEqual({ monto: '1500.50' });
    p.flush({ turno });
    await resultado;
    const quitar = TestBed.inject(Turnos).registrarAbono(12, null);
    const q = servidor.expectOne({ method: 'PUT', url: '/api/turnos/12/abono' });
    expect(q.request.body).toEqual({ monto: null });
    q.flush({ turno });
    await quitar;
  });
});

describe('traducirErrorAccion (RF-35 a RF-37)', () => {
  const api = (codigo: string) => new ErrorApi(409, codigo, 'Mensaje del servidor.');

  it('turno modificado, transición no permitida y turno no reservado cierran y refrescan', () => {
    for (const codigo of [
      'turno_modificado',
      'transicion_no_permitida',
      'turno_no_reservado',
      'correccion_sin_cambio',
      'turno_no_encontrado',
    ]) {
      expect(traducirErrorAccion(api(codigo), 'transicion')).toMatchObject({
        refrescarAgenda: true,
        cerrar: true,
      });
    }
  });

  it('franja ocupada al reprogramar refresca la disponibilidad y la agenda', () => {
    expect(traducirErrorAccion(api('franja_ocupada'), 'reprogramacion')).toMatchObject({
      refrescarAgenda: true,
      refrescarDisponibilidad: true,
      cerrar: false,
    });
    expect(
      traducirErrorAccion(api('paciente_con_turno_en_franja'), 'reprogramacion'),
    ).toMatchObject({ refrescarDisponibilidad: true, cerrar: false });
  });

  it('franja ocupada al corregir no pide disponibilidad y explica el estado activo', () => {
    const t = traducirErrorAccion(api('franja_ocupada'), 'correccion');
    expect(t).toMatchObject({ refrescarAgenda: true, refrescarDisponibilidad: false });
    expect(t.mensaje).toContain('estado activo');
  });

  it('misma ubicación y kinesiólogo inexistente se quedan en el diálogo', () => {
    expect(traducirErrorAccion(api('reprogramacion_sin_cambio'), 'reprogramacion')).toMatchObject({
      cerrar: false,
      refrescarAgenda: false,
    });
    expect(traducirErrorAccion(api('kinesiologo_no_encontrado'), 'reprogramacion')).toMatchObject({
      refrescarDisponibilidad: true,
    });
  });

  it('turno anulado en el abono cierra el diálogo, avisa con claridad y relee la agenda', () => {
    const t = traducirErrorAccion(api('turno_anulado'), 'abono');
    expect(t).toMatchObject({ cerrar: true, refrescarAgenda: true });
    expect(t.mensaje).toContain('anulado');
    expect(t.mensaje).toContain('no admite');
  });

  it('datos inválidos en el abono dice qué formato se espera', () => {
    expect(traducirErrorAccion(api('datos_invalidos'), 'abono').mensaje).toContain('pesos');
  });

  it('un error desconocido conserva su mensaje', () => {
    expect(traducirErrorAccion(new Error('Falla.'), 'transicion')).toMatchObject({
      mensaje: 'Falla.',
      cerrar: false,
    });
  });
});
