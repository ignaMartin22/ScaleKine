import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { cargarConfiguracion } from '../../src/comun/configuracion.js';
import { RelojFijo } from '../../src/comun/reloj.js';
import { ESTADOS } from '../../src/modulos/m3-turnos/transiciones.js';
import { crearRutas } from '../../src/rutas.js';
import { ENTORNO_PRUEBA, loggerCapturado, ORIGEN_APP } from '../ayudantes.js';
import { db } from './base.js';
import {
  crearKinesiologo,
  crearPaciente,
  crearTurno,
  ingresarComo,
  ingresarComoAdministradorVerificado,
  ingresarComoKinesiologo,
} from './fabricas.js';

// Miércoles 14/10/2026, 12:00 en Buenos Aires (UTC-3).
const AHORA_PRUEBA = '2026-10-14T15:00:00Z';
const HOY = '2026-10-14';
const ERROR_NO_AUTORIZADO = {
  error: { codigo: 'no_autorizado', mensaje: 'No estás autorizado para realizar esta acción.' },
};

async function crearAppDePrueba(ahora = AHORA_PRUEBA) {
  const config = cargarConfiguracion({ ...ENTORNO_PRUEBA, COOKIE_SECURE: 'false' });
  const reloj = new RelojFijo(ahora);
  const capturado = loggerCapturado();
  const rutas = await crearRutas({ db, reloj, config });
  return { app: crearApp({ config, logger: capturado.logger, reloj, rutas }), reloj, ...capturado };
}
type App = Awaited<ReturnType<typeof crearAppDePrueba>>['app'];

const ficha = (app: App, id: number | string, cookie?: string) =>
  request(app)
    .get(`/api/pacientes/${id}/turnos`)
    .set(cookie ? { Origin: ORIGEN_APP, Cookie: cookie } : { Origin: ORIGEN_APP });

const ids = (turnos: { id: number }[]) => turnos.map((t) => t.id);

describe('GET /api/pacientes/:id/turnos (RF-47)', () => {
  it('parte los turnos en próximos (ascendente) e historial (descendente), con la proyección completa', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const k1 = await crearKinesiologo();
    const k2 = await crearKinesiologo();
    const paciente = await crearPaciente({ dni: '90111222', nombre: 'Paciente Ficticio Uno' });
    const otroPaciente = await crearPaciente();
    const dato = (fecha: string, horaInicio: string, kinesiologoId: number) =>
      crearTurno({ fecha, horaInicio, kinesiologoId, pacienteId: paciente.id });
    // Desordenados a propósito.
    const futuroLejano = await dato('2026-11-02', '09:00', k1.id);
    const pasadoLejano = await dato('2026-09-01', '08:00', k2.id);
    const futuroCercano = await dato('2026-10-15', '10:30', k2.id);
    const pasadoReciente = await dato('2026-10-14', '08:00', k1.id);
    await db.turno.update({
      where: { id: futuroCercano.id },
      data: { coseguroObraSocial: '1500.5', coseguroAdicional: '200' },
    });
    await crearTurno({ fecha: HOY, horaInicio: '08:45', pacienteId: otroPaciente.id, kinesiologoId: k1.id });

    const res = await ficha(app, paciente.id, cookie);

    expect(res.status).toBe(200);
    expect(ids(res.body.proximos)).toEqual([futuroCercano.id, futuroLejano.id]);
    expect(ids(res.body.historial)).toEqual([pasadoReciente.id, pasadoLejano.id]);
    expect(res.body.proximos[0]).toEqual({
      id: futuroCercano.id,
      fecha: '2026-10-15',
      horaInicio: '10:30',
      horaFin: '11:15',
      estado: 'reservado',
      llegadaEn: null,
      coseguroObraSocial: '1500.50',
      coseguroAdicional: '200.00',
      kinesiologo: { id: k2.id, nombre: k2.nombre },
    });
    // Turnos con dos kinesiólogos distintos en el historial.
    expect(res.body.historial.map((t: { kinesiologo: { id: number } }) => t.kinesiologo.id)).toEqual([k1.id, k2.id]);
  });

  it('el administrador también puede consultarla', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComoAdministradorVerificado(app);
    const paciente = await crearPaciente();

    const res = await ficha(app, paciente.id, cookie);

    expect(res.status).toBe(200);
  });

  it('la franja en curso es próxima; pasa al historial recién un minuto después del fin', async () => {
    const { app, reloj } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const paciente = await crearPaciente();
    const turno = await crearTurno({ fecha: HOY, horaInicio: '08:00', pacienteId: paciente.id });
    const ubicacion = async () => {
      const { body } = await ficha(app, paciente.id, cookie);
      return { proximos: ids(body.proximos), historial: ids(body.historial) };
    };
    const enProximos = { proximos: [turno.id], historial: [] };
    const enHistorial = { proximos: [], historial: [turno.id] };

    // La franja 08:00 a 08:45 (Buenos Aires) termina a las 11:45 UTC.
    reloj.fijar('2026-10-14T11:00:00Z'); // 08:00, empieza
    expect(await ubicacion()).toEqual(enProximos);
    reloj.fijar('2026-10-14T11:44:00Z'); // 08:44, justo antes del fin
    expect(await ubicacion()).toEqual(enProximos);
    reloj.fijar('2026-10-14T11:45:00Z'); // 08:45, justo en el fin
    expect(await ubicacion()).toEqual(enProximos);
    reloj.fijar('2026-10-14T11:46:00Z'); // 08:46, un minuto después
    expect(await ubicacion()).toEqual(enHistorial);
  });

  it('el límite se mide en la zona del consultorio y no en UTC', async () => {
    const { app, reloj } = await crearAppDePrueba('2026-10-15T02:45:00Z'); // 23:45 del 14, en Buenos Aires
    const { cookie } = await ingresarComo(app, 'secretaria');
    const paciente = await crearPaciente();
    const turno = await crearTurno({ fecha: HOY, horaInicio: '23:00', pacienteId: paciente.id });

    expect(ids((await ficha(app, paciente.id, cookie)).body.proximos)).toEqual([turno.id]);
    reloj.fijar('2026-10-15T02:46:00Z');
    expect(ids((await ficha(app, paciente.id, cookie)).body.historial)).toEqual([turno.id]);
  });

  it('muestra los cinco estados, también los cerrados, y conserva el de cada turno', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const paciente = await crearPaciente();
    const k = await crearKinesiologo();
    for (const [i, estado] of ESTADOS.entries()) {
      await crearTurno({
        fecha: '2026-09-01',
        horaInicio: `${String(8 + i).padStart(2, '0')}:00`,
        estado,
        pacienteId: paciente.id,
        kinesiologoId: k.id,
      });
    }

    const { body } = await ficha(app, paciente.id, cookie);

    expect(ESTADOS).toHaveLength(5);
    expect(body.proximos).toEqual([]);
    expect(body.historial.map((t: { estado: string }) => t.estado)).toEqual([...ESTADOS].reverse());
  });

  it('un paciente sin turnos tiene ambas listas vacías', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const paciente = await crearPaciente();

    const res = await ficha(app, paciente.id, cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ proximos: [], historial: [] });
  });

  it('404 si el paciente no existe; 400 ante un id mal formado', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');

    const inexistente = await ficha(app, 999999, cookie);
    expect(inexistente.status).toBe(404);
    expect(inexistente.body.error.codigo).toBe('paciente_no_encontrado');
    for (const id of ['abc', '0', '-1', '1.5']) {
      expect((await ficha(app, id, cookie)).status, id).toBe(400);
    }
  });

  it('sin sesión es 401', async () => {
    const { app } = await crearAppDePrueba();
    const paciente = await crearPaciente();

    expect((await ficha(app, paciente.id)).status).toBe(401);
  });

  it('el kinesiólogo recibe 403 aunque el paciente tenga turnos con él, sin datos del paciente', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie, kinesiologo } = await ingresarComoKinesiologo(app);
    const paciente = await crearPaciente({ nombre: 'Paciente Propio Ficticio' });
    await crearTurno({ fecha: HOY, horaInicio: '13:00', kinesiologoId: kinesiologo.id, pacienteId: paciente.id });

    const res = await ficha(app, paciente.id, cookie);

    expect(res.status).toBe(403);
    expect(res.body).toEqual(ERROR_NO_AUTORIZADO);
  });

  it('la respuesta no se guarda en caché (RNF-14)', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const paciente = await crearPaciente();

    const res = await ficha(app, paciente.id, cookie);

    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('no registra en el log nombre, DNI, teléfono, obra social ni coseguros', async () => {
    const { app, texto } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const paciente = await crearPaciente({
      dni: '90777666',
      nombre: 'Reservada Ficticia Nombre',
    });
    await db.paciente.update({
      where: { id: paciente.id },
      data: { telefono: '+5491155550123', obraSocial: 'Obra Social Ficticia Sur' },
    });
    const turno = await crearTurno({ fecha: '2026-09-01', pacienteId: paciente.id });
    await db.turno.update({ where: { id: turno.id }, data: { coseguroObraSocial: '7777.77' } });

    const res = await ficha(app, paciente.id, cookie);

    expect(res.status).toBe(200);
    expect(res.body.historial[0].coseguroObraSocial).toBe('7777.77');
    for (const dato of ['Reservada', '90777666', '5491155550123', 'Obra Social Ficticia', '7777']) {
      expect(texto(), dato).not.toContain(dato);
    }
  });
});
