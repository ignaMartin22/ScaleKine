import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { cargarConfiguracion } from '../../src/comun/configuracion.js';
import { RelojFijo } from '../../src/comun/reloj.js';
import { crearRutas } from '../../src/rutas.js';
import { ENTORNO_PRUEBA, loggerCapturado, ORIGEN_APP } from '../ayudantes.js';
import { db } from './base.js';
import {
  AHORA,
  crearKinesiologo,
  crearPaciente,
  crearTurno,
  ingresarComo,
} from './fabricas.js';

const LUNES = '2026-10-12';
const MARTES = '2026-10-13';
const MANANA = ['08:00', '08:45', '09:30', '10:15', '11:00', '11:45'];
const ERROR_NO_AUTORIZADO = {
  error: { codigo: 'no_autorizado', mensaje: 'No estás autorizado para realizar esta acción.' },
};

async function crearAppDePrueba() {
  const config = cargarConfiguracion({ ...ENTORNO_PRUEBA, COOKIE_SECURE: 'false' });
  const reloj = new RelojFijo(AHORA);
  const capturado = loggerCapturado();
  const rutas = await crearRutas({ db, reloj, config });
  return { app: crearApp({ config, logger: capturado.logger, reloj, rutas }), ...capturado };
}
type App = Awaited<ReturnType<typeof crearAppDePrueba>>['app'];

const consultar = (app: App, cookie: string | undefined, query: Record<string, string>) =>
  request(app)
    .get('/api/disponibilidad')
    .query(query)
    .set(cookie ? { Origin: ORIGEN_APP, Cookie: cookie } : { Origin: ORIGEN_APP });

interface Cuerpo {
  kinesiologos: { kinesiologoId: number; nombre: string; franjas: { inicio: string; fin: string }[] }[];
}
const franjasDe = (cuerpo: Cuerpo, id: number) =>
  cuerpo.kinesiologos.find((k) => k.kinesiologoId === id)?.franjas.map((f) => f.inicio);

describe('GET /api/disponibilidad (RF-22, RF-15)', () => {
  it('devuelve los kinesiólogos del bloque con la grilla completa y su hora de fin', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;
    const k = await crearKinesiologo({ bloque: 'manana' });

    const res = await consultar(app, cookie, { fecha: LUNES, bloque: 'manana' });

    expect(res.status).toBe(200);
    expect(res.body.fecha).toBe(LUNES);
    expect(res.body.bloque).toBe('manana');
    expect(res.body.kinesiologos).toHaveLength(1);
    expect(res.body.kinesiologos[0]).toMatchObject({ kinesiologoId: k.id, nombre: k.nombre });
    expect(franjasDe(res.body, k.id)).toEqual(MANANA);
    expect(res.body.kinesiologos[0].franjas[0]).toEqual({ inicio: '08:00', fin: '08:45' });
  });

  it('el administrador también puede consultar', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'administrador')).cookie;
    await crearKinesiologo();

    const res = await consultar(app, cookie, { fecha: LUNES, bloque: 'manana' });

    expect(res.status).toBe(200);
  });

  it('los turnos activos ocupan la franja y los cerrados no', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;
    const k = await crearKinesiologo();
    await crearTurno({ kinesiologoId: k.id, fecha: LUNES, horaInicio: '08:00', estado: 'reservado' });
    await crearTurno({ kinesiologoId: k.id, fecha: LUNES, horaInicio: '08:45', estado: 'en_espera' });
    await crearTurno({ kinesiologoId: k.id, fecha: LUNES, horaInicio: '09:30', estado: 'anulado' });
    await crearTurno({ kinesiologoId: k.id, fecha: LUNES, horaInicio: '10:15', estado: 'asistio' });
    await crearTurno({ kinesiologoId: k.id, fecha: LUNES, horaInicio: '11:00', estado: 'no_asistio' });

    const res = await consultar(app, cookie, { fecha: LUNES, bloque: 'manana' });

    expect(franjasDe(res.body, k.id)).toEqual(['09:30', '10:15', '11:00', '11:45']);
  });

  it('un turno de otra fecha no ocupa la franja', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;
    const k = await crearKinesiologo();
    await crearTurno({ kinesiologoId: k.id, fecha: MARTES, horaInicio: '08:00' });

    const res = await consultar(app, cookie, { fecha: LUNES, bloque: 'manana' });

    expect(franjasDe(res.body, k.id)).toEqual(MANANA);
  });

  it('los kinesiólogos de otro bloque no aparecen', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;
    const deManana = await crearKinesiologo({ bloque: 'manana' });
    const deTarde = await crearKinesiologo({ bloque: 'tarde' });

    const manana = await consultar(app, cookie, { fecha: LUNES, bloque: 'manana' });
    const tarde = await consultar(app, cookie, { fecha: LUNES, bloque: 'tarde' });

    expect((manana.body as Cuerpo).kinesiologos.map((k) => k.kinesiologoId)).toEqual([deManana.id]);
    expect((tarde.body as Cuerpo).kinesiologos.map((k) => k.kinesiologoId)).toEqual([deTarde.id]);
    expect(franjasDe(tarde.body, deTarde.id)).toEqual(['16:00', '16:45', '17:30', '18:15']);
  });

  it('un kinesiólogo con la cuenta desactivada no aparece y uno activo del mismo bloque sí (RF-22)', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;
    const activo = await crearKinesiologo({ bloque: 'manana' });
    const desactivado = await crearKinesiologo({ bloque: 'manana' });
    await db.usuario.update({ where: { id: desactivado.usuarioId }, data: { activo: false } });

    const res = await consultar(app, cookie, { fecha: LUNES, bloque: 'manana' });

    expect(res.status).toBe(200);
    expect((res.body as Cuerpo).kinesiologos.map((k) => k.kinesiologoId)).toEqual([activo.id]);
    expect(franjasDe(res.body, desactivado.id)).toBeUndefined();
  });

  it('un turno de otro kinesiólogo no ocupa la franja de este si no se pide paciente', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;
    const a = await crearKinesiologo();
    const b = await crearKinesiologo();
    await crearTurno({ kinesiologoId: b.id, fecha: LUNES, horaInicio: '08:00' });

    const res = await consultar(app, cookie, { fecha: LUNES, bloque: 'manana' });

    expect(franjasDe(res.body, a.id)).toEqual(MANANA);
    expect(franjasDe(res.body, b.id)).toEqual(MANANA.slice(1));
  });

  it('con paciente, su turno activo con otro kinesiólogo ocupa esa hora en todos', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;
    const a = await crearKinesiologo();
    const b = await crearKinesiologo();
    const paciente = await crearPaciente();
    const otro = await crearPaciente();
    await crearTurno({ kinesiologoId: b.id, pacienteId: paciente.id, fecha: LUNES, horaInicio: '08:00' });
    await crearTurno({ kinesiologoId: b.id, pacienteId: otro.id, fecha: LUNES, horaInicio: '08:45' });
    await crearTurno({
      kinesiologoId: b.id,
      pacienteId: paciente.id,
      fecha: LUNES,
      horaInicio: '09:30',
      estado: 'anulado',
    });

    const res = await consultar(app, cookie, { fecha: LUNES, bloque: 'manana', pacienteId: String(paciente.id) });

    expect(res.status).toBe(200);
    // Para `a`: sin la 08:00 del paciente; la 08:45 es de otro paciente con `b` y no lo afecta.
    expect(franjasDe(res.body, a.id)).toEqual(MANANA.slice(1));
    // Para `b`: sin la 08:00 (paciente) ni la 08:45 (suya); la anulada de las 09:30 queda libre.
    expect(franjasDe(res.body, b.id)).toEqual(['09:30', '10:15', '11:00', '11:45']);
  });

  it('sin paciente no se filtra por paciente', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;
    const a = await crearKinesiologo();
    const b = await crearKinesiologo();
    const paciente = await crearPaciente();
    await crearTurno({ kinesiologoId: b.id, pacienteId: paciente.id, fecha: LUNES, horaInicio: '08:00' });

    const res = await consultar(app, cookie, { fecha: LUNES, bloque: 'manana' });

    expect(franjasDe(res.body, a.id)).toEqual(MANANA);
  });

  it('un fin de semana devuelve los kinesiólogos sin franjas', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;
    const k = await crearKinesiologo();

    const res = await consultar(app, cookie, { fecha: '2026-10-10', bloque: 'manana' });

    expect(res.status).toBe(200);
    expect(franjasDe(res.body, k.id)).toEqual([]);
  });

  it('un paciente inexistente es 404 paciente_no_encontrado', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;

    const res = await consultar(app, cookie, { fecha: LUNES, bloque: 'manana', pacienteId: '999999' });

    expect(res.status).toBe(404);
    expect(res.body.error.codigo).toBe('paciente_no_encontrado');
  });

  it('el kinesiólogo recibe 403', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'kinesiologo')).cookie;

    const res = await consultar(app, cookie, { fecha: LUNES, bloque: 'manana' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual(ERROR_NO_AUTORIZADO);
  });

  it('sin sesión es 401', async () => {
    const { app } = await crearAppDePrueba();

    const res = await consultar(app, undefined, { fecha: LUNES, bloque: 'manana' });

    expect(res.status).toBe(401);
  });

  it.each([
    ['falta la fecha', { bloque: 'manana' }],
    ['falta el bloque', { fecha: LUNES }],
    ['fecha con otro formato', { fecha: '12/10/2026', bloque: 'manana' }],
    ['fecha inexistente', { fecha: '2026-02-30', bloque: 'manana' }],
    ['mes 13', { fecha: '2026-13-01', bloque: 'manana' }],
    ['año 0000', { fecha: '0000-01-01', bloque: 'manana' }],
    ['bloque desconocido', { fecha: LUNES, bloque: 'noche' }],
    ['paciente no numérico', { fecha: LUNES, bloque: 'manana', pacienteId: 'abc' }],
    ['paciente cero', { fecha: LUNES, bloque: 'manana', pacienteId: '0' }],
    ['paciente negativo', { fecha: LUNES, bloque: 'manana', pacienteId: '-1' }],
    ['paciente fuera de rango', { fecha: LUNES, bloque: 'manana', pacienteId: '99999999999' }],
  ])('parámetros inválidos (%s) son 400 datos_invalidos', async (_caso, query) => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;

    const res = await consultar(app, cookie, query);

    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe('datos_invalidos');
  });

  it('no escribe turnos ni deja datos personales en los logs', async () => {
    const { app, texto } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;
    const k = await crearKinesiologo();
    const paciente = await crearPaciente();
    await crearTurno({ kinesiologoId: k.id, pacienteId: paciente.id, fecha: LUNES, horaInicio: '08:00' });
    const antes = await db.turno.count();

    await consultar(app, cookie, { fecha: LUNES, bloque: 'manana', pacienteId: String(paciente.id) });

    expect(await db.turno.count()).toBe(antes);
    expect(texto()).not.toContain(paciente.dni);
    expect(texto()).not.toContain(paciente.nombre);
    expect(texto()).not.toContain(k.nombre);
  });
});
