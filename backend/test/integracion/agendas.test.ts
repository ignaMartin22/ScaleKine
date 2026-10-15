import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { cargarConfiguracion } from '../../src/comun/configuracion.js';
import { RelojFijo } from '../../src/comun/reloj.js';
import { accionesDisponibles, ESTADOS } from '../../src/modulos/m3-turnos/transiciones.js';
import { crearRutas } from '../../src/rutas.js';
import { ENTORNO_PRUEBA, loggerCapturado, ORIGEN_APP } from '../ayudantes.js';
import { db } from './base.js';
import {
  crearKinesiologo,
  crearPaciente,
  crearTurno,
  ingresarComo,
  ingresarComoKinesiologo,
} from './fabricas.js';

// Miércoles 14/10/2026, 12:00 en Buenos Aires (UTC-3).
const AHORA_PRUEBA = '2026-10-14T15:00:00Z';
const HOY = '2026-10-14';
const OTRO_DIA = '2026-10-15';
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

const pedir = (app: App, ruta: string, cookie?: string) =>
  request(app)
    .get(ruta)
    .set(cookie ? { Origin: ORIGEN_APP, Cookie: cookie } : { Origin: ORIGEN_APP });

const agenda = (app: App, consulta: string, cookie?: string) => pedir(app, `/api/agenda${consulta}`, cookie);
const miAgenda = (app: App, consulta: string, cookie?: string) => pedir(app, `/api/mi-agenda${consulta}`, cookie);

const ids = (turnos: { id: number }[]) => turnos.map((t) => t.id);

describe('GET /api/agenda (RF-41, RF-34)', () => {
  it('trae todos los turnos de la fecha, de todos los kinesiólogos, con la proyección completa', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const k1 = await crearKinesiologo();
    const k2 = await crearKinesiologo();
    const paciente = await crearPaciente({ dni: '90111222', nombre: 'Paciente Ficticio Uno' });
    const turno = await crearTurno({ fecha: HOY, horaInicio: '08:45', kinesiologoId: k1.id, pacienteId: paciente.id });
    await db.turno.update({ where: { id: turno.id }, data: { coseguroObraSocial: '1500.5', coseguroAdicional: '200' } });
    const otro = await crearTurno({ fecha: HOY, horaInicio: '08:00', kinesiologoId: k2.id });
    await crearTurno({ fecha: OTRO_DIA, kinesiologoId: k1.id });

    const res = await agenda(app, `?fecha=${HOY}`, cookie);

    expect(res.status).toBe(200);
    expect(res.body.fecha).toBe(HOY);
    expect(ids(res.body.turnos)).toEqual([otro.id, turno.id]); // por franja
    expect(res.body.turnos[1]).toEqual({
      id: turno.id,
      fecha: HOY,
      horaInicio: '08:45',
      horaFin: '09:30',
      estado: 'reservado',
      llegadaEn: null,
      coseguroObraSocial: '1500.50',
      coseguroAdicional: '200.00',
      paciente: {
        id: paciente.id,
        nombre: 'Paciente Ficticio Uno',
        dni: '90111222',
        telefono: paciente.telefono,
        obraSocial: 'Particular',
      },
      kinesiologo: { id: k1.id, nombre: k1.nombre },
      acciones: {
        transiciones: [
          { hacia: 'en_espera', accion: 'Llegó' },
          { hacia: 'no_asistio', accion: 'No asistió' },
          { hacia: 'anulado', accion: 'Anular' },
        ],
        puedeCorregir: true,
      },
    });
  });

  it('sin fecha usa hoy en la zona del consultorio, con el reloj inyectado', async () => {
    // 2026-10-15T01:00Z ya es día 15 en UTC, pero en Buenos Aires son las 22:00 del 14.
    const { app } = await crearAppDePrueba('2026-10-15T01:00:00Z');
    const { cookie } = await ingresarComo(app, 'secretaria');
    const deHoy = await crearTurno({ fecha: HOY });
    await crearTurno({ fecha: OTRO_DIA });

    const res = await agenda(app, '', cookie);

    expect(res.body.fecha).toBe(HOY);
    expect(ids(res.body.turnos)).toEqual([deHoy.id]);
  });

  it('filtra por kinesiólogo', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const k1 = await crearKinesiologo();
    const k2 = await crearKinesiologo();
    const t1 = await crearTurno({ fecha: HOY, kinesiologoId: k1.id });
    const t2 = await crearTurno({ fecha: HOY, kinesiologoId: k2.id });

    const solo1 = await agenda(app, `?fecha=${HOY}&kinesiologoId=${k1.id}`, cookie);
    const solo2 = await agenda(app, `?fecha=${HOY}&kinesiologoId=${k2.id}`, cookie);
    const inexistente = await agenda(app, `?fecha=${HOY}&kinesiologoId=999999`, cookie);

    expect(ids(solo1.body.turnos)).toEqual([t1.id]);
    expect(ids(solo2.body.turnos)).toEqual([t2.id]);
    expect(inexistente.status).toBe(200);
    expect(inexistente.body.turnos).toEqual([]);
  });

  it('las acciones de cada turno son las de accionesDisponibles para su estado y rol', async () => {
    const { app } = await crearAppDePrueba();
    const secretaria = await ingresarComo(app, 'secretaria');
    const kinesiologo = await crearKinesiologo();
    const porEstado = new Map<string, number>();
    let hora = 0;
    for (const estado of ESTADOS) {
      const horas = ['08:00', '08:45', '09:30', '10:15', '11:00'];
      const turno = await crearTurno({
        fecha: HOY,
        horaInicio: horas[hora++] ?? '11:45',
        kinesiologoId: kinesiologo.id,
        estado,
      });
      porEstado.set(estado, turno.id);
    }

    const res = await agenda(app, `?fecha=${HOY}`, secretaria.cookie);

    expect(res.body.turnos).toHaveLength(ESTADOS.length);
    for (const turno of res.body.turnos as { id: number; estado: (typeof ESTADOS)[number]; acciones: unknown }[]) {
      const esperadas = accionesDisponibles(turno.estado, 'secretaria');
      expect(turno.acciones).toEqual({
        transiciones: esperadas.transiciones.map(({ hacia, accion }) => ({ hacia, accion })),
        puedeCorregir: esperadas.puedeCorregir,
      });
    }
    // Los estados cerrados solo ofrecen la corrección.
    const cerrado = res.body.turnos.find((t: { id: number }) => t.id === porEstado.get('asistio'));
    expect(cerrado.acciones).toEqual({ transiciones: [], puedeCorregir: true });
  });

  it('el administrador también la ve, con las acciones de su rol', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'administrador');
    const turno = await crearTurno({ fecha: HOY, estado: 'en_espera' });
    await db.turno.update({ where: { id: turno.id }, data: { llegadaEn: new Date('2026-10-14T13:00:00Z') } });

    const res = await agenda(app, `?fecha=${HOY}`, cookie);

    expect(res.status).toBe(200);
    expect(res.body.turnos[0]).toMatchObject({
      id: turno.id,
      llegadaEn: '2026-10-14T13:00:00.000Z',
      acciones: { transiciones: [{ hacia: 'asistio', accion: 'Asistió' }], puedeCorregir: true },
    });
  });

  it('incluye turnos de un kinesiólogo con la cuenta desactivada', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const kinesiologo = await crearKinesiologo();
    const turno = await crearTurno({ fecha: HOY, kinesiologoId: kinesiologo.id });
    await db.usuario.update({ where: { id: kinesiologo.usuarioId }, data: { activo: false } });

    const res = await agenda(app, `?fecha=${HOY}`, cookie);

    expect(ids(res.body.turnos)).toEqual([turno.id]);
  });

  it('rechaza entradas mal formadas con 400', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');

    for (const consulta of ['?fecha=2026-02-30', '?fecha=ayer', '?kinesiologoId=abc', '?kinesiologoId=-1', '?kinesiologoId=0']) {
      const res = await agenda(app, consulta, cookie);
      expect(res.status, consulta).toBe(400);
      expect(res.body.error.codigo).toBe('datos_invalidos');
    }
  });

  it('el kinesiólogo recibe 403 y no ve ningún turno', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie, kinesiologo } = await ingresarComoKinesiologo(app);
    await crearTurno({ fecha: HOY, kinesiologoId: kinesiologo.id });

    const res = await agenda(app, `?fecha=${HOY}&kinesiologoId=${kinesiologo.id}`, cookie);

    expect(res.status).toBe(403);
    expect(res.body).toEqual(ERROR_NO_AUTORIZADO);
  });

  it('sin sesión responde 401', async () => {
    const { app } = await crearAppDePrueba();

    expect((await agenda(app, `?fecha=${HOY}`)).status).toBe(401);
  });

  it('solo lee: no cambia ningún turno ni registra eventos', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    await crearTurno({ fecha: HOY });
    const antes = await db.turno.findMany({ orderBy: { id: 'asc' } });

    await agenda(app, `?fecha=${HOY}`, cookie);

    expect(await db.turno.findMany({ orderBy: { id: 'asc' } })).toEqual(antes);
    expect(await db.turnoEvento.count()).toBe(0);
  });

  it('no registra datos personales en los logs', async () => {
    const { app, texto } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const paciente = await crearPaciente({ dni: '90555666', nombre: 'Paciente Reservado Log' });
    await crearTurno({ fecha: HOY, pacienteId: paciente.id });

    await agenda(app, `?fecha=${HOY}`, cookie);

    expect(texto()).not.toContain('Paciente Reservado Log');
    expect(texto()).not.toContain('90555666');
  });
});

describe('GET /api/mi-agenda (RF-40, D-15, D-16)', () => {
  /** Pone al turno `en_espera` con la hora de llegada indicada (UTC). */
  const enEspera = (id: number, llegada: string) =>
    db.turno.update({ where: { id }, data: { estado: 'en_espera', llegadaEn: new Date(llegada) } });

  it('separa en espera (por hora de llegada) y próximos (por franja), con los datos del paciente y los coseguros', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie, kinesiologo } = await ingresarComoKinesiologo(app);
    const paciente = await crearPaciente({ dni: '90333444', nombre: 'Paciente Ficticio Dos' });
    // Franja temprana pero llegó después: la espera se ordena por llegada, no por franja.
    const llegoSegundo = await crearTurno({ fecha: HOY, horaInicio: '08:00', kinesiologoId: kinesiologo.id });
    const llegoPrimero = await crearTurno({ fecha: HOY, horaInicio: '09:30', kinesiologoId: kinesiologo.id });
    await enEspera(llegoSegundo.id, '2026-10-14T11:20:00Z');
    await enEspera(llegoPrimero.id, '2026-10-14T11:05:00Z');
    const tarde = await crearTurno({ fecha: HOY, horaInicio: '11:00', kinesiologoId: kinesiologo.id, pacienteId: paciente.id });
    await db.turno.update({ where: { id: tarde.id }, data: { coseguroObraSocial: '800', coseguroAdicional: '50.25' } });
    const temprano = await crearTurno({ fecha: HOY, horaInicio: '10:15', kinesiologoId: kinesiologo.id });
    // Cerrados: no aparecen en ninguna lista.
    await crearTurno({ fecha: HOY, horaInicio: '08:45', kinesiologoId: kinesiologo.id, estado: 'asistio' });
    await crearTurno({ fecha: HOY, horaInicio: '11:45', kinesiologoId: kinesiologo.id, estado: 'anulado' });

    const res = await miAgenda(app, `?fecha=${HOY}`, cookie);

    expect(res.status).toBe(200);
    expect(res.body.fecha).toBe(HOY);
    expect(ids(res.body.enEspera)).toEqual([llegoPrimero.id, llegoSegundo.id]);
    expect(ids(res.body.proximos)).toEqual([temprano.id, tarde.id]);
    expect(res.body.enEspera[0]).toMatchObject({ estado: 'en_espera', llegadaEn: '2026-10-14T11:05:00.000Z' });
    expect(res.body.proximos[1]).toEqual({
      id: tarde.id,
      fecha: HOY,
      horaInicio: '11:00',
      horaFin: '11:45',
      estado: 'reservado',
      llegadaEn: null,
      coseguroObraSocial: '800.00',
      coseguroAdicional: '50.25',
      paciente: { nombre: 'Paciente Ficticio Dos', dni: '90333444', telefono: paciente.telefono, obraSocial: 'Particular' },
    });
  });

  it('no trae acciones: ni en la proyección ni en ningún lugar del cuerpo', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie, kinesiologo } = await ingresarComoKinesiologo(app);
    const espera = await crearTurno({ fecha: HOY, horaInicio: '08:00', kinesiologoId: kinesiologo.id });
    await enEspera(espera.id, '2026-10-14T11:00:00Z');
    await crearTurno({ fecha: HOY, horaInicio: '08:45', kinesiologoId: kinesiologo.id });

    const res = await miAgenda(app, `?fecha=${HOY}`, cookie);

    expect(res.body.enEspera).toHaveLength(1);
    expect(res.body.proximos).toHaveLength(1);
    const texto = JSON.stringify(res.body);
    for (const clave of ['acciones', 'transiciones', 'puedeCorregir', 'Llegó', 'Anular']) {
      expect(texto, clave).not.toContain(clave);
    }
  });

  it('sin fecha usa hoy en la zona del consultorio, con el reloj inyectado', async () => {
    const { app, reloj } = await crearAppDePrueba('2026-10-15T01:00:00Z'); // 22:00 del 14 en Buenos Aires
    const { cookie, kinesiologo } = await ingresarComoKinesiologo(app);
    const deHoy = await crearTurno({ fecha: HOY, kinesiologoId: kinesiologo.id });
    const demanana = await crearTurno({ fecha: OTRO_DIA, kinesiologoId: kinesiologo.id });

    const antes = await miAgenda(app, '', cookie);
    reloj.fijar('2026-10-15T04:00:00Z'); // 01:00 del 15 en Buenos Aires
    const despues = await miAgenda(app, '', cookie);

    expect(antes.body.fecha).toBe(HOY);
    expect(ids(antes.body.proximos)).toEqual([deHoy.id]);
    expect(despues.body.fecha).toBe(OTRO_DIA);
    expect(ids(despues.body.proximos)).toEqual([demanana.id]);
  });

  it('no ve turnos de otro kinesiólogo de la misma fecha, ni pasando su kinesiologoId, ni con otras claves', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie, kinesiologo } = await ingresarComoKinesiologo(app);
    const ajeno = await crearKinesiologo();
    const propio = await crearTurno({ fecha: HOY, horaInicio: '08:00', kinesiologoId: kinesiologo.id });
    const turnoAjeno = await crearTurno({ fecha: HOY, horaInicio: '08:45', kinesiologoId: ajeno.id });
    const esperaAjena = await crearTurno({ fecha: HOY, horaInicio: '09:30', kinesiologoId: ajeno.id });
    await enEspera(esperaAjena.id, '2026-10-14T11:00:00Z');
    const ajenos = [turnoAjeno.id, esperaAjena.id];

    const consultas = [
      `?fecha=${HOY}`,
      `?fecha=${HOY}&kinesiologoId=${ajeno.id}`,
      `?fecha=${HOY}&kinesiologoId=${ajeno.id}&kinesiologoId=${kinesiologo.id}`,
      `?fecha=${HOY}&kinesiologoId[]=${ajeno.id}`,
      `?fecha=${HOY}&usuarioId=${ajeno.usuarioId}&id=${ajeno.id}&kinesiologo=${ajeno.id}`,
      `?kinesiologoId=${ajeno.id}`,
    ];
    for (const consulta of consultas) {
      const res = await miAgenda(app, consulta, cookie);
      expect(res.status, consulta).toBe(200);
      const todos = [...res.body.enEspera, ...res.body.proximos].map((t: { id: number }) => t.id);
      expect(todos, consulta).toEqual([propio.id]);
      for (const id of ajenos) expect(todos).not.toContain(id);
    }
  });

  it('no ve turnos propios de otra fecha ni los de otro kinesiólogo en esa otra fecha', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie, kinesiologo } = await ingresarComoKinesiologo(app);
    const ajeno = await crearKinesiologo();
    const propioOtroDia = await crearTurno({ fecha: OTRO_DIA, kinesiologoId: kinesiologo.id });
    await crearTurno({ fecha: HOY, kinesiologoId: ajeno.id });
    await crearTurno({ fecha: OTRO_DIA, horaInicio: '08:45', kinesiologoId: ajeno.id });

    const hoy = await miAgenda(app, `?fecha=${HOY}`, cookie);
    const otro = await miAgenda(app, `?fecha=${OTRO_DIA}`, cookie);

    expect(hoy.body).toEqual({ fecha: HOY, enEspera: [], proximos: [] });
    expect(ids(otro.body.proximos)).toEqual([propioOtroDia.id]);
  });

  it('secretaría y administrador reciben 403: usan /api/agenda', async () => {
    const { app } = await crearAppDePrueba();
    const secretaria = await ingresarComo(app, 'secretaria');
    const administrador = await ingresarComo(app, 'administrador');

    for (const { cookie } of [secretaria, administrador]) {
      const res = await miAgenda(app, `?fecha=${HOY}`, cookie);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(ERROR_NO_AUTORIZADO);
    }
  });

  it('una cuenta kinesiólogo sin perfil de Kinesiologo recibe 403, no una lista vacía', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'kinesiologo'); // sin crear el perfil
    await crearTurno({ fecha: HOY });

    const res = await miAgenda(app, `?fecha=${HOY}`, cookie);

    expect(res.status).toBe(403);
    expect(res.body).toEqual(ERROR_NO_AUTORIZADO);
  });

  it('con la cuenta desactivada la sesión deja de valer: 401, sin agenda', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie, kinesiologo, usuarioId } = await ingresarComoKinesiologo(app);
    await crearTurno({ fecha: HOY, kinesiologoId: kinesiologo.id });
    expect((await miAgenda(app, `?fecha=${HOY}`, cookie)).status).toBe(200);

    await db.usuario.update({ where: { id: usuarioId }, data: { activo: false } });

    const res = await miAgenda(app, `?fecha=${HOY}`, cookie);
    expect(res.status).toBe(401);
    expect(res.body.turnos).toBeUndefined();
    expect(res.body.proximos).toBeUndefined();
  });

  it('sin sesión responde 401', async () => {
    const { app } = await crearAppDePrueba();

    expect((await miAgenda(app, `?fecha=${HOY}`)).status).toBe(401);
  });

  it('rechaza una fecha mal formada con 400', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComoKinesiologo(app);

    for (const consulta of ['?fecha=2026-13-01', '?fecha=hoy', '?fecha=']) {
      const res = await miAgenda(app, consulta, cookie);
      expect(res.status, consulta).toBe(400);
    }
  });

  it('solo lee y no registra datos personales en los logs', async () => {
    const { app, texto } = await crearAppDePrueba();
    const { cookie, kinesiologo } = await ingresarComoKinesiologo(app);
    const paciente = await crearPaciente({ dni: '90777888', nombre: 'Paciente Reservado Log' });
    await crearTurno({ fecha: HOY, kinesiologoId: kinesiologo.id, pacienteId: paciente.id });
    const antes = await db.turno.findMany({ orderBy: { id: 'asc' } });

    const res = await miAgenda(app, `?fecha=${HOY}`, cookie);

    expect(res.status).toBe(200);
    expect(await db.turno.findMany({ orderBy: { id: 'asc' } })).toEqual(antes);
    expect(await db.turnoEvento.count()).toBe(0);
    expect(texto()).not.toContain('Paciente Reservado Log');
    expect(texto()).not.toContain('90777888');
  });
});

describe('el kinesiólogo no consulta pacientes (RF-40, D-16)', () => {
  it('la búsqueda y la ficha siguen en 403 aunque tenga turnos con ese paciente', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie, kinesiologo } = await ingresarComoKinesiologo(app);
    const paciente = await crearPaciente({ dni: '90999000', nombre: 'Paciente Propio Ficticio' });
    await crearTurno({ fecha: HOY, kinesiologoId: kinesiologo.id, pacienteId: paciente.id });

    for (const ruta of [
      '/api/pacientes?dni=90999000',
      '/api/pacientes?nombre=Propio',
      `/api/pacientes/${paciente.id}`,
      `/api/pacientes/${paciente.id}/turnos`,
      `/api/pacientes/${paciente.id}/historial`,
    ]) {
      const res = await pedir(app, ruta, cookie);
      // Las rutas de la ficha con turnos e historial llegan en T-29 y ahora no existen (404); las
      // existentes deben responder 403. Ninguna devuelve datos del paciente.
      expect([403, 404], ruta).toContain(res.status);
      expect(JSON.stringify(res.body), ruta).not.toContain('Paciente Propio Ficticio');
      if (ruta.split('/').length <= 4) expect(res.status, ruta).toBe(403);
    }
  });
});
