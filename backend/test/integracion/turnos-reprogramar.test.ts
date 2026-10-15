import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { cargarConfiguracion } from '../../src/comun/configuracion.js';
import { RelojFijo } from '../../src/comun/reloj.js';
import type { EstadoTurno } from '../../src/generado/prisma/client.js';
import { crearServicioTurnos } from '../../src/modulos/m3-turnos/turnos.js';
import { crearRutas } from '../../src/rutas.js';
import { ENTORNO_PRUEBA, loggerCapturado, ORIGEN_APP } from '../ayudantes.js';
import { baseConEventoRoto, baseConLecturaSincronizada } from './ayudantesTurnos.js';
import { db } from './base.js';
import { AHORA, crearKinesiologo, crearPaciente, crearTurno, crearUsuario, ingresarComo } from './fabricas.js';

const ERROR_NO_AUTORIZADO = {
  error: { codigo: 'no_autorizado', mensaje: 'No estás autorizado para realizar esta acción.' },
};
/** Lunes. */
const FECHA = '2026-10-12';
const OTRA_FECHA = '2026-10-14';
/** Lunes anterior a `AHORA` (2026-10-07): se admite, como al asignar (RF-23). */
const FECHA_VENCIDA = '2026-09-14';
const SABADO = '2026-10-10';

async function crearAppDePrueba() {
  const config = cargarConfiguracion({ ...ENTORNO_PRUEBA, COOKIE_SECURE: 'false' });
  const reloj = new RelojFijo(AHORA);
  const capturado = loggerCapturado();
  const rutas = await crearRutas({ db, reloj, config });
  return { app: crearApp({ config, logger: capturado.logger, reloj, rutas }), ...capturado };
}
type App = Awaited<ReturnType<typeof crearAppDePrueba>>['app'];

const conCookie = (cookie?: string) => (cookie ? { Origin: ORIGEN_APP, Cookie: cookie } : { Origin: ORIGEN_APP });
const reprogramar = (app: App, cookie: string | undefined, id: number | string, cuerpo: unknown) =>
  request(app)
    .put(`/api/turnos/${id}/ubicacion`)
    .set(conCookie(cookie))
    .send(cuerpo as object);

const eventosDe = (turnoId: number) => db.turnoEvento.findMany({ where: { turnoId }, orderBy: { id: 'asc' } });
const turnoDe = (id: number) => db.turno.findUniqueOrThrow({ where: { id } });
const fechaDe = (t: { fecha: Date }) => t.fecha.toISOString().slice(0, 10);

/** Turno del lunes 08:00 con coseguros cargados, de un kinesiólogo de la mañana. */
async function escenario(estado: EstadoTurno = 'reservado') {
  const paciente = await crearPaciente();
  const kinesiologo = await crearKinesiologo();
  const base = await crearTurno({ pacienteId: paciente.id, kinesiologoId: kinesiologo.id, fecha: FECHA, estado });
  const turno = await db.turno.update({
    where: { id: base.id },
    data: { coseguroObraSocial: '1500.50', coseguroAdicional: '300' },
  });
  return { paciente, kinesiologo, turno, destino: { kinesiologoId: kinesiologo.id, fecha: FECHA, horaInicio: '09:30' } };
}

describe('reprogramar: casos válidos (RF-36)', () => {
  it('cambia solo la fecha', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { turno, kinesiologo } = await escenario();

    const res = await reprogramar(app, cookie, turno.id, {
      kinesiologoId: kinesiologo.id,
      fecha: OTRA_FECHA,
      horaInicio: '08:00',
    });

    expect(res.status).toBe(200);
    expect(res.body.turno).toMatchObject({
      id: turno.id,
      fecha: OTRA_FECHA,
      horaInicio: '08:00',
      kinesiologoId: kinesiologo.id,
    });
    const guardado = await turnoDe(turno.id);
    expect(fechaDe(guardado)).toBe(OTRA_FECHA);
    expect(guardado.horaInicio).toBe('08:00');
  });

  it('cambia solo la franja', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { turno, destino } = await escenario();

    const res = await reprogramar(app, cookie, turno.id, destino);

    expect(res.status).toBe(200);
    const guardado = await turnoDe(turno.id);
    expect(fechaDe(guardado)).toBe(FECHA);
    expect(guardado.horaInicio).toBe('09:30');
    expect(guardado.kinesiologoId).toBe(turno.kinesiologoId);
  });

  it('cambia solo el kinesiólogo', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { turno } = await escenario();
    const otro = await crearKinesiologo();

    const res = await reprogramar(app, cookie, turno.id, { kinesiologoId: otro.id, fecha: FECHA, horaInicio: '08:00' });

    expect(res.status).toBe(200);
    expect(res.body.turno.kinesiologoId).toBe(otro.id);
    const guardado = await turnoDe(turno.id);
    expect(guardado.kinesiologoId).toBe(otro.id);
    expect(fechaDe(guardado)).toBe(FECHA);
    expect(guardado.horaInicio).toBe('08:00');
  });

  it('mueve el mismo turno: conserva id, estado, paciente y coseguros, y no crea otro', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { turno, paciente, destino } = await escenario();

    const res = await reprogramar(app, cookie, turno.id, destino);

    expect(res.body.turno).toMatchObject({
      id: turno.id,
      estado: 'reservado',
      pacienteId: paciente.id,
      coseguroObraSocial: '1500.50',
      coseguroAdicional: '300.00',
      llegadaEn: null,
    });
    const guardado = await turnoDe(turno.id);
    expect(guardado).toMatchObject({ estado: 'reservado', pacienteId: paciente.id, llegadaEn: null });
    expect(guardado.coseguroObraSocial?.toFixed(2)).toBe('1500.50');
    expect(guardado.coseguroAdicional?.toFixed(2)).toBe('300.00');
    expect(await db.turno.count()).toBe(1);
  });

  it('un turno sin coseguros cargados sigue sin ellos', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { turno, destino } = await escenario();
    await db.turno.update({ where: { id: turno.id }, data: { coseguroObraSocial: null, coseguroAdicional: null } });

    const res = await reprogramar(app, cookie, turno.id, destino);

    expect(res.body.turno).toMatchObject({ coseguroObraSocial: null, coseguroAdicional: null });
  });

  it('admite una fecha vencida, como al asignar', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { turno, kinesiologo } = await escenario();

    const res = await reprogramar(app, cookie, turno.id, {
      kinesiologoId: kinesiologo.id,
      fecha: FECHA_VENCIDA,
      horaInicio: '08:00',
    });

    expect(res.status).toBe(200);
    expect(fechaDe(await turnoDe(turno.id))).toBe(FECHA_VENCIDA);
  });

  it('el administrador también puede reprogramar', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'administrador');
    const { turno, destino } = await escenario();

    expect((await reprogramar(app, cookie, turno.id, destino)).status).toBe(200);
  });

  it('libera la franja anterior: otro turno puede ocuparla después', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { turno, kinesiologo, destino } = await escenario();
    await reprogramar(app, cookie, turno.id, destino);

    const otro = await crearTurno({ kinesiologoId: kinesiologo.id, fecha: FECHA, horaInicio: '08:00' });

    expect(otro.horaInicio).toBe('08:00');
  });

  it('de la mañana a la tarde: cambia de kinesiólogo con una franja de la tarde', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { turno } = await escenario();
    const tarde = await crearKinesiologo({ bloque: 'tarde' });

    const res = await reprogramar(app, cookie, turno.id, { kinesiologoId: tarde.id, fecha: FECHA, horaInicio: '16:00' });

    expect(res.status).toBe(200);
    expect(await turnoDe(turno.id)).toMatchObject({ kinesiologoId: tarde.id, horaInicio: '16:00' });
  });
});

describe('reprogramar: evento (RF-46, D-9)', () => {
  it('registra un evento reprogramacion con el autor de la sesión y la hora del reloj, sin ubicación anterior', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie, usuarioId } = await ingresarComo(app, 'secretaria');
    const { turno, destino } = await escenario();

    await reprogramar(app, cookie, turno.id, { ...destino, autorId: 999, estado: 'anulado' });

    const eventos = await eventosDe(turno.id);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toEqual({
      id: eventos[0]?.id,
      turnoId: turno.id,
      tipo: 'reprogramacion',
      estadoAnterior: null,
      estadoNuevo: null,
      autorId: usuarioId,
      ocurridoEn: AHORA,
    });
    // Un autor o un estado en el cuerpo se ignoran.
    expect((await turnoDe(turno.id)).estado).toBe('reservado');
  });
});

describe('reprogramar: rechazos (RF-37)', () => {
  it.each(['en_espera', 'asistio', 'no_asistio', 'anulado'] as const)(
    'un turno %s no se reprograma: 409 turno_no_reservado, sin cambios ni evento',
    async (estado) => {
      const { app } = await crearAppDePrueba();
      const { cookie } = await ingresarComo(app, 'secretaria');
      const { turno, destino } = await escenario(estado);

      const res = await reprogramar(app, cookie, turno.id, destino);

      expect(res.status).toBe(409);
      expect(res.body.error.codigo).toBe('turno_no_reservado');
      const guardado = await turnoDe(turno.id);
      expect(guardado.estado).toBe(estado);
      expect(guardado.horaInicio).toBe('08:00');
      expect(await eventosDe(turno.id)).toHaveLength(0);
    },
  );

  it('franja ocupada por el kinesiólogo: 409 franja_ocupada, sin cambios ni evento', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { turno, kinesiologo, destino } = await escenario();
    await crearTurno({ kinesiologoId: kinesiologo.id, fecha: FECHA, horaInicio: destino.horaInicio });

    const res = await reprogramar(app, cookie, turno.id, destino);

    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe('franja_ocupada');
    expect(await turnoDe(turno.id)).toMatchObject({ horaInicio: '08:00', estado: 'reservado' });
    expect(await eventosDe(turno.id)).toHaveLength(0);
  });

  it('un turno en_espera del kinesiólogo también ocupa la franja', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { turno, kinesiologo, destino } = await escenario();
    await crearTurno({
      kinesiologoId: kinesiologo.id,
      fecha: FECHA,
      horaInicio: destino.horaInicio,
      estado: 'en_espera',
    });

    const res = await reprogramar(app, cookie, turno.id, destino);

    expect(res.body.error.codigo).toBe('franja_ocupada');
  });

  it('un turno anulado en la franja de destino no la ocupa', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { turno, kinesiologo, destino } = await escenario();
    await crearTurno({
      kinesiologoId: kinesiologo.id,
      fecha: FECHA,
      horaInicio: destino.horaInicio,
      estado: 'anulado',
    });

    expect((await reprogramar(app, cookie, turno.id, destino)).status).toBe(200);
  });

  it('paciente con otro turno activo en esa franja (con otro kinesiólogo): 409 paciente_con_turno_en_franja', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { turno, paciente, destino } = await escenario();
    const otro = await crearKinesiologo();
    await crearTurno({ pacienteId: paciente.id, kinesiologoId: otro.id, fecha: FECHA, horaInicio: destino.horaInicio });

    const res = await reprogramar(app, cookie, turno.id, destino);

    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe('paciente_con_turno_en_franja');
    expect(await turnoDe(turno.id)).toMatchObject({ horaInicio: '08:00', estado: 'reservado' });
    expect(await eventosDe(turno.id)).toHaveLength(0);
  });

  it('reprogramar a la misma ubicación exacta se rechaza: 409 reprogramacion_sin_cambio, sin evento', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { turno, kinesiologo } = await escenario();

    const res = await reprogramar(app, cookie, turno.id, {
      kinesiologoId: kinesiologo.id,
      fecha: FECHA,
      horaInicio: '08:00',
    });

    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe('reprogramacion_sin_cambio');
    expect(await eventosDe(turno.id)).toHaveLength(0);
  });
});

describe('reprogramar: la franja se valida contra el bloque del kinesiólogo nuevo (RF-15)', () => {
  it('un kinesiólogo de la tarde con una franja de la mañana: 400 franja_invalida', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { turno } = await escenario();
    const tarde = await crearKinesiologo({ bloque: 'tarde' });

    const res = await reprogramar(app, cookie, turno.id, { kinesiologoId: tarde.id, fecha: FECHA, horaInicio: '09:30' });

    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe('franja_invalida');
    expect(await turnoDe(turno.id)).toMatchObject({ kinesiologoId: turno.kinesiologoId, horaInicio: '08:00' });
    expect(await eventosDe(turno.id)).toHaveLength(0);
  });

  it('la franja del bloque anterior no vale para el kinesiólogo nuevo, y una del nuevo sí', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const tarde = await crearKinesiologo({ bloque: 'tarde' });
    const turno = await crearTurno({ kinesiologoId: tarde.id, fecha: FECHA, horaInicio: '16:00' });
    const manana = await crearKinesiologo();

    const invalida = await reprogramar(app, cookie, turno.id, {
      kinesiologoId: manana.id,
      fecha: FECHA,
      horaInicio: '16:45',
    });
    expect(invalida.body.error?.codigo).toBe('franja_invalida');
    const valida = await reprogramar(app, cookie, turno.id, {
      kinesiologoId: manana.id,
      fecha: FECHA,
      horaInicio: '11:45',
    });
    expect(valida.status).toBe(200);
  });

  it.each(['08:30', '12:00'])('una hora que no es inicio de franja (%s): 400 franja_invalida', async (horaInicio) => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { turno, kinesiologo } = await escenario();

    const res = await reprogramar(app, cookie, turno.id, { kinesiologoId: kinesiologo.id, fecha: FECHA, horaInicio });

    expect(res.body.error.codigo).toBe('franja_invalida');
  });

  it('un sábado: 400 franja_invalida', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { turno, kinesiologo } = await escenario();

    const res = await reprogramar(app, cookie, turno.id, {
      kinesiologoId: kinesiologo.id,
      fecha: SABADO,
      horaInicio: '08:00',
    });

    expect(res.body.error.codigo).toBe('franja_invalida');
    expect(await eventosDe(turno.id)).toHaveLength(0);
  });
});

describe('reprogramar: existencia y validación', () => {
  it('un kinesiólogo inexistente: 404 kinesiologo_no_encontrado', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { turno } = await escenario();

    const res = await reprogramar(app, cookie, turno.id, { kinesiologoId: 999999, fecha: FECHA, horaInicio: '09:30' });

    expect(res.status).toBe(404);
    expect(res.body.error.codigo).toBe('kinesiologo_no_encontrado');
    expect(await eventosDe(turno.id)).toHaveLength(0);
  });

  it('un kinesiólogo con la cuenta desactivada es como si no existiera: 404, y el turno no se mueve', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { turno } = await escenario();
    const otro = await crearKinesiologo();
    await db.usuario.update({ where: { id: otro.usuarioId }, data: { activo: false } });

    const res = await reprogramar(app, cookie, turno.id, { kinesiologoId: otro.id, fecha: FECHA, horaInicio: '09:30' });

    expect(res.status).toBe(404);
    expect(res.body.error.codigo).toBe('kinesiologo_no_encontrado');
    expect(await turnoDe(turno.id)).toMatchObject({ kinesiologoId: turno.kinesiologoId, horaInicio: '08:00' });
    expect(await eventosDe(turno.id)).toHaveLength(0);
  });

  it('un turno inexistente: 404 turno_no_encontrado', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { destino } = await escenario();

    const res = await reprogramar(app, cookie, 999999, destino);

    expect(res.status).toBe(404);
    expect(res.body.error.codigo).toBe('turno_no_encontrado');
  });

  it.each([
    ['falta la franja', { fecha: FECHA, kinesiologoId: 1 }],
    ['falta la fecha', { horaInicio: '08:00', kinesiologoId: 1 }],
    ['falta el kinesiólogo', { fecha: FECHA, horaInicio: '08:00' }],
    ['fecha imposible', { fecha: '2026-02-30', horaInicio: '08:00', kinesiologoId: 1 }],
    ['año 0000', { fecha: '0000-01-03', horaInicio: '08:00', kinesiologoId: 1 }],
    ['hora mal formada', { fecha: FECHA, horaInicio: '8:00', kinesiologoId: 1 }],
    ['kinesiólogo no entero', { fecha: FECHA, horaInicio: '08:00', kinesiologoId: '1' }],
    ['cuerpo vacío', {}],
  ])('%s: 400 datos_invalidos y el turno no cambia', async (_caso, cuerpo) => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { turno } = await escenario();

    const res = await reprogramar(app, cookie, turno.id, cuerpo);

    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe('datos_invalidos');
    expect(await turnoDe(turno.id)).toMatchObject({ horaInicio: '08:00' });
  });

  it('un identificador de turno mal formado: 400', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { destino } = await escenario();

    expect((await reprogramar(app, cookie, 'abc', destino)).status).toBe(400);
  });
});

describe('reprogramar: autorización, atomicidad y logs', () => {
  it('el kinesiólogo recibe 403 y el turno no cambia', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'kinesiologo');
    const { turno, destino } = await escenario();

    const res = await reprogramar(app, cookie, turno.id, destino);

    expect(res.status).toBe(403);
    expect(res.body).toEqual(ERROR_NO_AUTORIZADO);
    expect(await turnoDe(turno.id)).toMatchObject({ horaInicio: '08:00' });
    expect(await eventosDe(turno.id)).toHaveLength(0);
  });

  it('sin sesión responde 401 y el turno no cambia', async () => {
    const { app } = await crearAppDePrueba();
    const { turno, destino } = await escenario();

    expect((await reprogramar(app, undefined, turno.id, destino)).status).toBe(401);
    expect(await turnoDe(turno.id)).toMatchObject({ horaInicio: '08:00' });
  });

  it('si el evento no se puede escribir, el turno tampoco se mueve', async () => {
    const servicio = crearServicioTurnos({ db: baseConEventoRoto(), reloj: new RelojFijo(AHORA) });
    const autor = await crearUsuario({ rol: 'secretaria' });
    const { turno, destino } = await escenario();

    await expect(servicio.reprogramar(turno.id, destino, autor.id)).rejects.toThrow('fallo simulado');

    const guardado = await turnoDe(turno.id);
    expect(guardado).toMatchObject({ horaInicio: '08:00', kinesiologoId: turno.kinesiologoId });
    expect(fechaDe(guardado)).toBe(FECHA);
  });

  it('el registro no contiene el nombre ni el DNI del paciente ni los coseguros', async () => {
    const { app, texto } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { turno, paciente, destino } = await escenario();

    await reprogramar(app, cookie, turno.id, destino);

    const registro = texto();
    expect(registro).toContain('/api/turnos');
    for (const prohibido of [paciente.nombre, paciente.dni, '1500.50']) expect(registro).not.toContain(prohibido);
  });
});

describe('reprogramar: concurrencia', () => {
  it('carrera determinista con una transición: ambos leen "reservado"; uno entra, el otro da turno_modificado y queda un solo evento', async () => {
    const servicio = crearServicioTurnos({ db: baseConLecturaSincronizada(), reloj: new RelojFijo(AHORA) });
    const autor = await crearUsuario({ rol: 'secretaria' });
    const { turno, destino } = await escenario();

    const resultados = await Promise.allSettled([
      servicio.reprogramar(turno.id, destino, autor.id),
      servicio.transicionar(turno.id, 'anulado', autor.id, 'secretaria'),
    ]);

    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rechazo = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rechazo.reason).toMatchObject({ codigo: 'turno_modificado', estadoHttp: 409 });
    expect(await eventosDe(turno.id)).toHaveLength(1);
    const guardado = await turnoDe(turno.id);
    // O se movió y sigue reservado, o se anuló en su lugar: nunca las dos cosas.
    expect(guardado.horaInicio === destino.horaInicio).toBe(guardado.estado === 'reservado');
  });

  it('carrera determinista entre dos reprogramaciones del mismo turno: entra una, la otra da turno_modificado', async () => {
    const servicio = crearServicioTurnos({ db: baseConLecturaSincronizada(), reloj: new RelojFijo(AHORA) });
    const autor = await crearUsuario({ rol: 'secretaria' });
    const { turno, destino } = await escenario();

    const resultados = await Promise.allSettled([
      servicio.reprogramar(turno.id, destino, autor.id),
      servicio.reprogramar(turno.id, { ...destino, horaInicio: '10:15' }, autor.id),
    ]);

    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rechazo = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rechazo.reason).toMatchObject({ codigo: 'turno_modificado' });
    expect(await eventosDe(turno.id)).toHaveLength(1);
  });

  it('varias reprogramaciones simultáneas de turnos distintos a la misma franja: entra una sola', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const kinesiologo = await crearKinesiologo();
    const horas = ['08:00', '08:45', '10:15', '11:00', '11:45'];
    const turnos = [];
    for (const horaInicio of horas) {
      turnos.push(await crearTurno({ kinesiologoId: kinesiologo.id, fecha: FECHA, horaInicio }));
    }
    const destino = { kinesiologoId: kinesiologo.id, fecha: OTRA_FECHA, horaInicio: '09:30' };

    const respuestas = await Promise.all(turnos.map((t) => reprogramar(app, cookie, t.id, destino)));

    expect(respuestas.filter((r) => r.status === 200)).toHaveLength(1);
    const rechazadas = respuestas.filter((r) => r.status === 409);
    expect(rechazadas).toHaveLength(horas.length - 1);
    for (const r of rechazadas) expect(r.body.error.codigo).toBe('franja_ocupada');
    expect(await db.turno.count({ where: { fecha: new Date(OTRA_FECHA), horaInicio: '09:30' } })).toBe(1);
    expect(await db.turnoEvento.count({ where: { tipo: 'reprogramacion' } })).toBe(1);
  });
});
