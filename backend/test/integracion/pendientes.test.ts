import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { cargarConfiguracion } from '../../src/comun/configuracion.js';
import { RelojFijo } from '../../src/comun/reloj.js';
import { crearRutas } from '../../src/rutas.js';
import { ENTORNO_PRUEBA, loggerCapturado, ORIGEN_APP } from '../ayudantes.js';
import { db } from './base.js';
import { crearKinesiologo, crearPaciente, crearTurno, ingresarComo } from './fabricas.js';

// Miércoles 14/10/2026, 12:00 en Buenos Aires (UTC-3).
const AHORA_PRUEBA = '2026-10-14T15:00:00Z';
const HOY = '2026-10-14';
const AYER = '2026-10-13';
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

const consultar = (app: App, cookie?: string) =>
  request(app)
    .get('/api/agenda/pendientes')
    .set(cookie ? { Origin: ORIGEN_APP, Cookie: cookie } : { Origin: ORIGEN_APP });

const ids = (cuerpo: { turnos: { id: number }[] }) => cuerpo.turnos.map((t) => t.id);

describe('GET /api/agenda/pendientes (RF-42)', () => {
  it('un turno activo con la franja terminada aparece, con lo necesario para ir a él', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const kinesiologo = await crearKinesiologo();
    const paciente = await crearPaciente({ nombre: 'Paciente Ficticio Uno' });
    const turno = await crearTurno({
      fecha: HOY,
      horaInicio: '08:00',
      kinesiologoId: kinesiologo.id,
      pacienteId: paciente.id,
    });

    const res = await consultar(app, cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      cantidad: 1,
      turnos: [
        {
          id: turno.id,
          fecha: HOY,
          horaInicio: '08:00',
          estado: 'reservado',
          kinesiologoId: kinesiologo.id,
          kinesiologoNombre: kinesiologo.nombre,
          pacienteId: paciente.id,
          pacienteNombre: 'Paciente Ficticio Uno',
        },
      ],
    });
  });

  it('el administrador también puede consultarlo', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'administrador');

    const res = await consultar(app, cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cantidad: 0, turnos: [] });
  });

  it('la franja en curso o futura no aparece; la que terminó un minuto antes, sí', async () => {
    const { app, reloj } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const terminada = await crearTurno({ fecha: HOY, horaInicio: '11:00' }); // termina 11:45
    const enCurso = await crearTurno({ fecha: HOY, horaInicio: '11:45' }); // termina 12:30
    const futuraHoy = await crearTurno({ fecha: HOY, horaInicio: '16:00' });
    const futuraManana = await crearTurno({ fecha: '2026-10-15', horaInicio: '08:00' });

    const res = await consultar(app, cookie);

    expect(ids(res.body)).toEqual([terminada.id]);
    expect(res.body.cantidad).toBe(1);

    // Justo en el fin de la franja de las 11:45 (12:30 locales = 15:30 UTC) todavía no; un minuto después, sí.
    reloj.fijar('2026-10-14T15:30:00Z');
    expect(ids((await consultar(app, cookie)).body)).toEqual([terminada.id]);
    reloj.fijar('2026-10-14T15:31:00Z');
    const despues = ids((await consultar(app, cookie)).body);
    expect(despues).toEqual([terminada.id, enCurso.id]);
    expect(despues).not.toContain(futuraHoy.id);
    expect(despues).not.toContain(futuraManana.id);
  });

  it('los turnos cerrados no aparecen aunque su franja haya terminado', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    for (const estado of ['asistio', 'no_asistio', 'anulado'] as const) {
      await crearTurno({ fecha: AYER, horaInicio: '08:00', estado });
    }

    const res = await consultar(app, cookie);

    expect(res.body).toEqual({ cantidad: 0, turnos: [] });
  });

  it('un turno en_espera de ayer aparece', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const turno = await crearTurno({ fecha: AYER, horaInicio: '16:00', estado: 'en_espera' });

    const res = await consultar(app, cookie);

    expect(ids(res.body)).toEqual([turno.id]);
    expect(res.body.turnos[0]).toMatchObject({ fecha: AYER, estado: 'en_espera' });
  });

  it('trae pendientes de cualquier fecha, del más viejo al más nuevo', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const hoy = await crearTurno({ fecha: HOY, horaInicio: '08:00' });
    const ayerTarde = await crearTurno({ fecha: AYER, horaInicio: '16:45' });
    const ayerTemprano = await crearTurno({ fecha: AYER, horaInicio: '08:45' });
    const viejo = await crearTurno({ fecha: '2026-08-03', horaInicio: '11:45', estado: 'en_espera' });

    const res = await consultar(app, cookie);

    expect(ids(res.body)).toEqual([viejo.id, ayerTemprano.id, ayerTarde.id, hoy.id]);
    expect(res.body.cantidad).toBe(4);
  });

  it('usa la zona del consultorio: a las 22:00 locales del 13 un turno del 14 no está pendiente', async () => {
    // 2026-10-14T01:00Z ya es día 14 en UTC, pero en Buenos Aires son las 22:00 del 13.
    const { app } = await crearAppDePrueba('2026-10-14T01:00:00Z');
    const { cookie } = await ingresarComo(app, 'secretaria');
    const delDia14 = await crearTurno({ fecha: HOY, horaInicio: '08:00' });
    const tardeDelDia13 = await crearTurno({ fecha: AYER, horaInicio: '18:15' }); // termina 19:00 local

    const res = await consultar(app, cookie);

    expect(ids(res.body)).toEqual([tardeDelDia13.id]);
    expect(ids(res.body)).not.toContain(delDia14.id);
  });

  it('el kinesiólogo recibe 403 y no ve turnos ajenos', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'kinesiologo');
    await crearTurno({ fecha: AYER });

    const res = await consultar(app, cookie);

    expect(res.status).toBe(403);
    expect(res.body).toEqual(ERROR_NO_AUTORIZADO);
  });

  it('sin sesión responde 401', async () => {
    const { app } = await crearAppDePrueba();

    const res = await consultar(app);

    expect(res.status).toBe(401);
  });

  it('solo lee: no cambia ningún turno ni registra eventos', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    await crearTurno({ fecha: AYER, estado: 'reservado' });
    await crearTurno({ fecha: AYER, horaInicio: '08:45', estado: 'en_espera' });
    const antes = await db.turno.findMany({ orderBy: { id: 'asc' } });

    const res = await consultar(app, cookie);

    expect(res.body.cantidad).toBe(2);
    expect(await db.turno.findMany({ orderBy: { id: 'asc' } })).toEqual(antes);
    expect(await db.turnoEvento.count()).toBe(0);
  });

  it('no registra datos personales en los logs', async () => {
    const { app, texto } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const paciente = await crearPaciente({ nombre: 'Paciente Reservado Log' });
    await crearTurno({ fecha: AYER, pacienteId: paciente.id });

    await consultar(app, cookie);

    expect(texto()).not.toContain('Paciente Reservado Log');
  });
});
