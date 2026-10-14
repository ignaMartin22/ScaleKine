import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { cargarConfiguracion } from '../../src/comun/configuracion.js';
import { RelojFijo } from '../../src/comun/reloj.js';
import type { EstadoTurno, Rol } from '../../src/generado/prisma/client.js';
import { hashearContrasena } from '../../src/modulos/m1-identidad/contrasenas.js';
import { crearServicioTurnos } from '../../src/modulos/m3-turnos/turnos.js';
import { crearRutas } from '../../src/rutas.js';
import { ENTORNO_PRUEBA, loggerCapturado, ORIGEN_APP } from '../ayudantes.js';
import { db } from './base.js';
import {
  AHORA,
  crearKinesiologo,
  crearPaciente,
  crearTurno,
  crearUsuario,
  ingresarComoAdministradorVerificado,
} from './fabricas.js';

const CLAVE = 'clave-de-prueba-larga';
const ERROR_NO_AUTORIZADO = {
  error: { codigo: 'no_autorizado', mensaje: 'No estás autorizado para realizar esta acción.' },
};
const ESTADOS: EstadoTurno[] = ['reservado', 'en_espera', 'asistio', 'no_asistio', 'anulado'];
const ACTIVOS: EstadoTurno[] = ['reservado', 'en_espera'];
/** Hora de llegada previa, distinta de `AHORA`, para ver si se conserva o se reemplaza. */
const LLEGADA_PREVIA = new Date('2026-10-07T09:30:00Z');

const hashClave = hashearContrasena(CLAVE);

async function crearAppDePrueba() {
  const config = cargarConfiguracion({ ...ENTORNO_PRUEBA, COOKIE_SECURE: 'false' });
  const reloj = new RelojFijo(AHORA);
  const capturado = loggerCapturado();
  const rutas = await crearRutas({ db, reloj, config });
  return { app: crearApp({ config, logger: capturado.logger, reloj, rutas }), ...capturado };
}
type App = Awaited<ReturnType<typeof crearAppDePrueba>>['app'];

async function ingresarComo(app: App, rol: Rol): Promise<{ cookie: string; usuarioId: number }> {
  if (rol === 'administrador') {
    const { cookie, usuario } = await ingresarComoAdministradorVerificado(app);
    return { cookie, usuarioId: usuario.id };
  }
  // Cuenta de relleno: el autor de la sesión nunca es el id 1.
  await crearUsuario();
  const nombreUsuario = `ficticio-${rol}`;
  const usuario = await crearUsuario({ rol, nombreUsuario, hashContrasena: await hashClave });
  const res = await request(app).post('/api/sesion').set('Origin', ORIGEN_APP).send({ nombreUsuario, contrasena: CLAVE });
  expect(res.status).toBe(200);
  const cookie = (res.headers['set-cookie'] as string[] | undefined)?.[0]?.split(';')[0] ?? '';
  return { cookie, usuarioId: usuario.id };
}

const conCookie = (cookie?: string) => (cookie ? { Origin: ORIGEN_APP, Cookie: cookie } : { Origin: ORIGEN_APP });
const transicionar = (app: App, cookie: string | undefined, id: number | string, cuerpo: unknown) =>
  request(app)
    .post(`/api/turnos/${id}/transicion`)
    .set(conCookie(cookie))
    .send(cuerpo as object);
const corregir = (app: App, cookie: string | undefined, id: number | string, cuerpo: unknown) =>
  request(app)
    .post(`/api/turnos/${id}/correccion`)
    .set(conCookie(cookie))
    .send(cuerpo as object);
const coseguros = (app: App, cookie: string | undefined, id: number | string, cuerpo: unknown) =>
  request(app)
    .put(`/api/turnos/${id}/coseguros`)
    .set(conCookie(cookie))
    .send(cuerpo as object);

const eventosDe = (turnoId: number) => db.turnoEvento.findMany({ where: { turnoId }, orderBy: { id: 'asc' } });

/** Turno con llegada previa si está en un estado donde corresponde (en_espera, asistio). */
const turnoEn = (estado: EstadoTurno, extra: { llegadaEn?: Date | null } = {}) =>
  crearTurno({ estado }).then((t) =>
    extra.llegadaEn === undefined ? t : db.turno.update({ where: { id: t.id }, data: { llegadaEn: extra.llegadaEn } }),
  );

describe('transicionar: el flujo normal (RF-30 a RF-33)', () => {
  it.each([
    ['reservado', 'en_espera'],
    ['en_espera', 'asistio'],
    ['reservado', 'no_asistio'],
    ['reservado', 'anulado'],
  ] as const)('%s -> %s: cambia el estado y registra un evento de cambio de estado', async (desde, hacia) => {
    const { app } = await crearAppDePrueba();
    const { cookie, usuarioId } = await ingresarComo(app, 'secretaria');
    const turno = await turnoEn(desde, desde === 'en_espera' ? { llegadaEn: LLEGADA_PREVIA } : {});

    const res = await transicionar(app, cookie, turno.id, { hacia });

    expect(res.status).toBe(200);
    expect(res.body.turno).toMatchObject({ id: turno.id, estado: hacia });
    const guardado = await db.turno.findUniqueOrThrow({ where: { id: turno.id } });
    expect(guardado.estado).toBe(hacia);
    const eventos = await eventosDe(turno.id);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      tipo: 'cambio_estado',
      estadoAnterior: desde,
      estadoNuevo: hacia,
      autorId: usuarioId,
      ocurridoEn: AHORA,
    });
  });

  it('al pasar a en_espera registra la llegada con el reloj inyectable', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const turno = await turnoEn('reservado');

    const res = await transicionar(app, cookie, turno.id, { hacia: 'en_espera' });

    expect(res.body.turno.llegadaEn).toBe(AHORA.toISOString());
    expect((await db.turno.findUniqueOrThrow({ where: { id: turno.id } })).llegadaEn).toEqual(AHORA);
  });

  it.each(['no_asistio', 'anulado'] as const)('pasar a %s no registra llegada', async (hacia) => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const turno = await turnoEn('reservado');

    await transicionar(app, cookie, turno.id, { hacia });

    expect((await db.turno.findUniqueOrThrow({ where: { id: turno.id } })).llegadaEn).toBeNull();
  });

  it('pasar a asistio conserva la hora de llegada', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const turno = await turnoEn('en_espera', { llegadaEn: LLEGADA_PREVIA });

    await transicionar(app, cookie, turno.id, { hacia: 'asistio' });

    expect((await db.turno.findUniqueOrThrow({ where: { id: turno.id } })).llegadaEn).toEqual(LLEGADA_PREVIA);
  });

  it('el administrador también transiciona', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'administrador');
    const turno = await turnoEn('reservado');

    expect((await transicionar(app, cookie, turno.id, { hacia: 'anulado' })).status).toBe(200);
  });

  it('el autor del evento sale de la sesión, aunque el cuerpo pida otro', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie, usuarioId } = await ingresarComo(app, 'secretaria');
    const otra = await crearUsuario({ rol: 'administrador' });
    const turno = await turnoEn('reservado');

    const res = await transicionar(app, cookie, turno.id, { hacia: 'anulado', autorId: otra.id, estadoAnterior: 'asistio' });

    expect(res.status).toBe(200);
    expect((await eventosDe(turno.id))[0]).toMatchObject({ autorId: usuarioId, estadoAnterior: 'reservado' });
  });

  it('las acciones salen de la tabla: todo par fuera de ella se rechaza sin tocar el turno ni escribir evento', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const permitidas = new Set(['reservado>en_espera', 'en_espera>asistio', 'reservado>no_asistio', 'reservado>anulado']);

    for (const desde of ESTADOS) {
      for (const hacia of ESTADOS) {
        if (permitidas.has(`${desde}>${hacia}`)) continue;
        const turno = await turnoEn(desde);
        const res = await transicionar(app, cookie, turno.id, { hacia });
        expect(res.status, `${desde}>${hacia}`).toBe(409);
        expect(res.body.error.codigo).toBe('transicion_no_permitida');
        expect((await db.turno.findUniqueOrThrow({ where: { id: turno.id } })).estado).toBe(desde);
        expect(await eventosDe(turno.id)).toHaveLength(0);
        await db.turno.update({ where: { id: turno.id }, data: { estado: 'anulado' } });
      }
    }
  });

  it('una acción desde el mismo estado dice que ya está en ese estado', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const turno = await turnoEn('reservado');

    const res = await transicionar(app, cookie, turno.id, { hacia: 'reservado' });

    expect(res.status).toBe(409);
    expect(res.body.error.mensaje).toBe('El turno ya está en ese estado.');
  });

  it('un turno inexistente da 404', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');

    const res = await transicionar(app, cookie, 999_999, { hacia: 'en_espera' });

    expect(res.status).toBe(404);
    expect(res.body.error.codigo).toBe('turno_no_encontrado');
  });

  it.each([
    [{ hacia: 'volando' }],
    [{}],
    [{ hacia: 3 }],
    [{ hacia: null }],
  ])('rechaza el cuerpo inválido %j', async (cuerpo) => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const turno = await turnoEn('reservado');

    const res = await transicionar(app, cookie, turno.id, cuerpo);

    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe('datos_invalidos');
    expect((await db.turno.findUniqueOrThrow({ where: { id: turno.id } })).estado).toBe('reservado');
  });

  it.each(['abc', '0', '-1', '1.5', '99999999999'])('rechaza el identificador %j', async (id) => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');

    const res = await transicionar(app, cookie, id, { hacia: 'en_espera' });

    expect(res.status).toBe(400);
  });

  it('dos transiciones simultáneas sobre el mismo turno: entra una, la otra da 409 y queda un solo evento', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const turno = await turnoEn('reservado');

    // Desde reservado, dos acciones distintas: sin la condición de estado, ambas se aplicarían.
    const respuestas = await Promise.all([
      transicionar(app, cookie, turno.id, { hacia: 'no_asistio' }),
      transicionar(app, cookie, turno.id, { hacia: 'anulado' }),
    ]);

    expect(respuestas.map((r) => r.status).sort()).toEqual([200, 409]);
    const perdedora = respuestas.find((r) => r.status === 409);
    expect(['turno_modificado', 'transicion_no_permitida']).toContain(perdedora?.body.error.codigo);
    const ganadora = respuestas.find((r) => r.status === 200);
    const eventos = await eventosDe(turno.id);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ estadoAnterior: 'reservado', estadoNuevo: ganadora?.body.turno.estado });
    expect((await db.turno.findUniqueOrThrow({ where: { id: turno.id } })).estado).toBe(ganadora?.body.turno.estado);
  });

  it('carrera determinista: ambos leen "reservado" antes de que cualquiera escriba; uno entra, el otro da 409 y queda un solo evento', async () => {
    // Barrera: ninguna transacción actualiza hasta que las dos leyeron el estado.
    let leyeron = 0;
    let soltar!: () => void;
    const ambosLeyeron = new Promise<void>((r) => (soltar = r));
    const conBarrera = (cliente: object): object =>
      new Proxy(cliente, {
        get(destino, propiedad, receptor) {
          if (propiedad === 'turno') {
            const turno = Reflect.get(destino, propiedad, receptor) as { findUnique: (a: unknown) => Promise<unknown> };
            return new Proxy(turno, {
              get(t, p, r) {
                if (p !== 'findUnique') return Reflect.get(t, p, r);
                return async (args: unknown) => {
                  const fila = await t.findUnique(args);
                  if (++leyeron === 2) soltar();
                  await ambosLeyeron;
                  return fila;
                };
              },
            });
          }
          return Reflect.get(destino, propiedad, receptor);
        },
      });
    const conLecturaSincronizada = new Proxy(db, {
      get(destino, propiedad, receptor) {
        if (propiedad === '$transaction') {
          return (fn: (tx: unknown) => Promise<unknown>) => db.$transaction((tx) => fn(conBarrera(tx)));
        }
        return Reflect.get(destino, propiedad, receptor);
      },
    });
    const servicio = crearServicioTurnos({ db: conLecturaSincronizada, reloj: new RelojFijo(AHORA) });
    const autor = await crearUsuario({ rol: 'secretaria' });
    const turno = await turnoEn('reservado');

    const resultados = await Promise.allSettled([
      servicio.transicionar(turno.id, 'no_asistio', autor.id, 'secretaria'),
      servicio.transicionar(turno.id, 'anulado', autor.id, 'secretaria'),
    ]);

    expect(resultados.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rechazo = resultados.find((r) => r.status === 'rejected') as PromiseRejectedResult;
    expect(rechazo.reason).toMatchObject({ codigo: 'turno_modificado', estadoHttp: 409 });
    const eventos = await eventosDe(turno.id);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({ estadoAnterior: 'reservado' });
    expect((await db.turno.findUniqueOrThrow({ where: { id: turno.id } })).estado).toBe(eventos[0]?.estadoNuevo);
  });

  it('dos pedidos iguales simultáneos: entra uno solo y la llegada se escribe una vez', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const turno = await turnoEn('reservado');

    const respuestas = await Promise.all(
      Array.from({ length: 6 }, () => transicionar(app, cookie, turno.id, { hacia: 'en_espera' })),
    );

    expect(respuestas.filter((r) => r.status === 200)).toHaveLength(1);
    expect(respuestas.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await eventosDe(turno.id)).toHaveLength(1);
  });
});

describe('transicionar: autorización y atomicidad', () => {
  it('el kinesiólogo recibe 403 y el turno no cambia', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'kinesiologo');
    const turno = await turnoEn('reservado');

    const res = await transicionar(app, cookie, turno.id, { hacia: 'en_espera' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual(ERROR_NO_AUTORIZADO);
    expect((await db.turno.findUniqueOrThrow({ where: { id: turno.id } })).estado).toBe('reservado');
    expect(await db.turnoEvento.count()).toBe(0);
  });

  it('sin sesión recibe 401', async () => {
    const { app } = await crearAppDePrueba();
    const turno = await turnoEn('reservado');

    expect((await transicionar(app, undefined, turno.id, { hacia: 'en_espera' })).status).toBe(401);
    expect(await db.turnoEvento.count()).toBe(0);
  });

  it('si el evento no se puede escribir, el cambio de estado tampoco queda', async () => {
    const rota = new Proxy(db, {
      get(destino, propiedad, receptor) {
        if (propiedad === '$transaction') {
          return (fn: (tx: unknown) => Promise<unknown>) =>
            db.$transaction((tx) =>
              fn(
                new Proxy(tx, {
                  get: (t, p, r) =>
                    p === 'turnoEvento'
                      ? { ...Reflect.get(t, p, r), create: () => Promise.reject(new Error('fallo simulado del evento')) }
                      : Reflect.get(t, p, r),
                }),
              ),
            );
        }
        return Reflect.get(destino, propiedad, receptor);
      },
    });
    const servicio = crearServicioTurnos({ db: rota, reloj: new RelojFijo(AHORA) });
    const autor = await crearUsuario({ rol: 'secretaria' });
    const turno = await turnoEn('reservado');

    await expect(servicio.transicionar(turno.id, 'en_espera', autor.id, 'secretaria')).rejects.toThrow('fallo simulado');

    const guardado = await db.turno.findUniqueOrThrow({ where: { id: turno.id } });
    expect(guardado.estado).toBe('reservado');
    expect(guardado.llegadaEn).toBeNull();
  });

  it('no deja DNI ni nombre en el log', async () => {
    const { app, texto } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const paciente = await crearPaciente();
    const kinesiologo = await crearKinesiologo();
    const turno = await crearTurno({ pacienteId: paciente.id, kinesiologoId: kinesiologo.id });

    await transicionar(app, cookie, turno.id, { hacia: 'en_espera' });
    await transicionar(app, cookie, turno.id, { hacia: 'anulado' });
    await corregir(app, cookie, turno.id, { estado: 'asistio' });

    expect(texto()).not.toContain(paciente.dni);
    expect(texto()).not.toContain(paciente.nombre);
  });
});

describe('corregir (RF-35, RF-37)', () => {
  const pares = ESTADOS.flatMap((desde) => ESTADOS.filter((h) => h !== desde).map((hacia) => [desde, hacia] as const));

  it.each(pares)('%s -> %s: se aplica y registra una corrección con anterior y nuevo', async (desde, hacia) => {
    const { app } = await crearAppDePrueba();
    const { cookie, usuarioId } = await ingresarComo(app, 'secretaria');
    const turno = await turnoEn(desde);

    const res = await corregir(app, cookie, turno.id, { estado: hacia });

    expect(res.status).toBe(200);
    expect(res.body.turno.estado).toBe(hacia);
    expect((await db.turno.findUniqueOrThrow({ where: { id: turno.id } })).estado).toBe(hacia);
    const eventos = await eventosDe(turno.id);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      tipo: 'correccion',
      estadoAnterior: desde,
      estadoNuevo: hacia,
      autorId: usuarioId,
      ocurridoEn: AHORA,
    });
  });

  it.each(ESTADOS)('corregir %s al mismo estado se rechaza sin evento', async (estado) => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const turno = await turnoEn(estado);

    const res = await corregir(app, cookie, turno.id, { estado });

    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe('correccion_sin_cambio');
    expect(await eventosDe(turno.id)).toHaveLength(0);
  });

  it('al volver a reservado limpia la hora de llegada', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const turno = await turnoEn('en_espera', { llegadaEn: LLEGADA_PREVIA });

    const res = await corregir(app, cookie, turno.id, { estado: 'reservado' });

    expect(res.body.turno.llegadaEn).toBeNull();
    expect((await db.turno.findUniqueOrThrow({ where: { id: turno.id } })).llegadaEn).toBeNull();
  });

  it.each(['asistio', 'no_asistio', 'anulado'] as const)(
    'de en_espera a %s conserva la hora de llegada',
    async (hacia) => {
      const { app } = await crearAppDePrueba();
      const { cookie } = await ingresarComo(app, 'secretaria');
      const turno = await turnoEn('en_espera', { llegadaEn: LLEGADA_PREVIA });

      await corregir(app, cookie, turno.id, { estado: hacia });

      expect((await db.turno.findUniqueOrThrow({ where: { id: turno.id } })).llegadaEn).toEqual(LLEGADA_PREVIA);
    },
  );

  it('de asistio a en_espera conserva la llegada que ya tenía', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const turno = await turnoEn('asistio', { llegadaEn: LLEGADA_PREVIA });

    await corregir(app, cookie, turno.id, { estado: 'en_espera' });

    expect((await db.turno.findUniqueOrThrow({ where: { id: turno.id } })).llegadaEn).toEqual(LLEGADA_PREVIA);
  });

  it.each(['reservado', 'no_asistio', 'anulado'] as const)(
    'de %s a en_espera sin llegada previa registra la hora de la corrección',
    async (desde) => {
      const { app } = await crearAppDePrueba();
      const { cookie } = await ingresarComo(app, 'secretaria');
      const turno = await turnoEn(desde);

      const res = await corregir(app, cookie, turno.id, { estado: 'en_espera' });

      expect(res.body.turno.llegadaEn).toBe(AHORA.toISOString());
    },
  );

  it('de un estado cerrado sin llegada a otro cerrado la deja sin cargar', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const turno = await turnoEn('no_asistio');

    await corregir(app, cookie, turno.id, { estado: 'anulado' });

    expect((await db.turno.findUniqueOrThrow({ where: { id: turno.id } })).llegadaEn).toBeNull();
  });

  describe.each(['asistio', 'no_asistio', 'anulado'] as const)('desde %s sobre una franja ocupada (RF-37)', (cerrado) => {
    it.each(ACTIVOS)('hacia %s con otro paciente del mismo kinesiólogo: franja_ocupada, sin cambios ni evento', async (activo) => {
      const { app } = await crearAppDePrueba();
      const { cookie } = await ingresarComo(app, 'secretaria');
      const kinesiologo = await crearKinesiologo();
      const turno = await crearTurno({ kinesiologoId: kinesiologo.id, estado: cerrado });
      await db.turno.update({ where: { id: turno.id }, data: { llegadaEn: LLEGADA_PREVIA } });
      await crearTurno({ kinesiologoId: kinesiologo.id, estado: 'reservado' });

      const res = await corregir(app, cookie, turno.id, { estado: activo });

      expect(res.status).toBe(409);
      expect(res.body.error.codigo).toBe('franja_ocupada');
      const guardado = await db.turno.findUniqueOrThrow({ where: { id: turno.id } });
      expect(guardado.estado).toBe(cerrado);
      expect(guardado.llegadaEn).toEqual(LLEGADA_PREVIA);
      expect(await eventosDe(turno.id)).toHaveLength(0);
    });

    it.each(ACTIVOS)('hacia %s con el mismo paciente y otro kinesiólogo: paciente_con_turno_en_franja', async (activo) => {
      const { app } = await crearAppDePrueba();
      const { cookie } = await ingresarComo(app, 'secretaria');
      const paciente = await crearPaciente();
      const turno = await crearTurno({ pacienteId: paciente.id, estado: cerrado });
      await crearTurno({ pacienteId: paciente.id, estado: 'en_espera' });

      const res = await corregir(app, cookie, turno.id, { estado: activo });

      expect(res.status).toBe(409);
      expect(res.body.error.codigo).toBe('paciente_con_turno_en_franja');
      expect((await db.turno.findUniqueOrThrow({ where: { id: turno.id } })).estado).toBe(cerrado);
      expect(await eventosDe(turno.id)).toHaveLength(0);
    });

    it.each(ACTIVOS)('hacia %s con la franja libre: se acepta', async (activo) => {
      const { app } = await crearAppDePrueba();
      const { cookie } = await ingresarComo(app, 'secretaria');
      const turno = await crearTurno({ estado: cerrado });

      const res = await corregir(app, cookie, turno.id, { estado: activo });

      expect(res.status).toBe(200);
      expect((await eventosDe(turno.id))[0]).toMatchObject({ tipo: 'correccion', estadoAnterior: cerrado, estadoNuevo: activo });
    });
  });

  it('corregir entre estados cerrados sobre una franja ocupada por otro turno activo es válido', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const kinesiologo = await crearKinesiologo();
    const turno = await crearTurno({ kinesiologoId: kinesiologo.id, estado: 'asistio' });
    await crearTurno({ kinesiologoId: kinesiologo.id, estado: 'reservado' });

    expect((await corregir(app, cookie, turno.id, { estado: 'anulado' })).status).toBe(200);
  });

  it('un turno inexistente da 404', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');

    const res = await corregir(app, cookie, 999_999, { estado: 'anulado' });

    expect(res.status).toBe(404);
    expect(res.body.error.codigo).toBe('turno_no_encontrado');
  });

  it.each([[{ estado: 'volando' }], [{}], [{ estado: 7 }]])('rechaza el cuerpo inválido %j', async (cuerpo) => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const turno = await turnoEn('reservado');

    const res = await corregir(app, cookie, turno.id, cuerpo);

    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe('datos_invalidos');
  });

  it('el autor sale de la sesión, aunque el cuerpo pida otro', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie, usuarioId } = await ingresarComo(app, 'administrador');
    const otra = await crearUsuario({ rol: 'secretaria' });
    const turno = await turnoEn('asistio');

    await corregir(app, cookie, turno.id, { estado: 'anulado', autorId: otra.id });

    expect((await eventosDe(turno.id))[0]?.autorId).toBe(usuarioId);
  });

  it('el kinesiólogo recibe 403 y sin sesión 401', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'kinesiologo');
    const turno = await turnoEn('asistio');

    const prohibido = await corregir(app, cookie, turno.id, { estado: 'anulado' });
    const sinSesion = await corregir(app, undefined, turno.id, { estado: 'anulado' });

    expect(prohibido.status).toBe(403);
    expect(prohibido.body).toEqual(ERROR_NO_AUTORIZADO);
    expect(sinSesion.status).toBe(401);
    expect((await db.turno.findUniqueOrThrow({ where: { id: turno.id } })).estado).toBe('asistio');
    expect(await db.turnoEvento.count()).toBe(0);
  });
});

describe('modificar coseguros (RF-27, RF-46)', () => {
  it('guarda los montos sin alterar estado ni franja, y registra el evento sin estados', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie, usuarioId } = await ingresarComo(app, 'secretaria');
    const turno = await turnoEn('en_espera', { llegadaEn: LLEGADA_PREVIA });

    const res = await coseguros(app, cookie, turno.id, { coseguroObraSocial: 1500.5, coseguroAdicional: '300' });

    expect(res.status).toBe(200);
    expect(res.body.turno).toMatchObject({ coseguroObraSocial: '1500.50', coseguroAdicional: '300.00', estado: 'en_espera' });
    const guardado = await db.turno.findUniqueOrThrow({ where: { id: turno.id } });
    expect(guardado).toMatchObject({ estado: 'en_espera', horaInicio: turno.horaInicio, kinesiologoId: turno.kinesiologoId });
    expect(guardado.fecha).toEqual(turno.fecha);
    expect(guardado.llegadaEn).toEqual(LLEGADA_PREVIA);
    expect(guardado.coseguroObraSocial?.toFixed(2)).toBe('1500.50');
    const eventos = await eventosDe(turno.id);
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      tipo: 'modificacion_coseguros',
      autorId: usuarioId,
      estadoAnterior: null,
      estadoNuevo: null,
      ocurridoEn: AHORA,
    });
  });

  it('funciona en un turno cerrado y permite dejar los montos sin cargar', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const turno = await turnoEn('asistio');
    await db.turno.update({ where: { id: turno.id }, data: { coseguroObraSocial: '10.00', coseguroAdicional: '20.00' } });

    const res = await coseguros(app, cookie, turno.id, { coseguroObraSocial: '', coseguroAdicional: null });

    expect(res.status).toBe(200);
    expect(res.body.turno).toMatchObject({ coseguroObraSocial: null, coseguroAdicional: null, estado: 'asistio' });
  });

  it.each([
    ['coseguroObraSocial', -1],
    ['coseguroObraSocial', '12,5'],
    ['coseguroAdicional', 1.234],
    ['coseguroAdicional', 'abc'],
    ['coseguroAdicional', 1e12],
  ])('rechaza %s con valor inválido %j', async (campo, valor) => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const turno = await turnoEn('reservado');

    const res = await coseguros(app, cookie, turno.id, { [campo]: valor });

    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe('datos_invalidos');
    expect(await db.turnoEvento.count()).toBe(0);
  });

  it('un turno inexistente da 404 y no escribe evento', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');

    const res = await coseguros(app, cookie, 999_999, { coseguroObraSocial: 5 });

    expect(res.status).toBe(404);
    expect(res.body.error.codigo).toBe('turno_no_encontrado');
    expect(await db.turnoEvento.count()).toBe(0);
  });

  it('el kinesiólogo recibe 403 y sin sesión 401, sin cambios', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'kinesiologo');
    const turno = await turnoEn('reservado');

    const prohibido = await coseguros(app, cookie, turno.id, { coseguroObraSocial: 5 });
    const sinSesion = await coseguros(app, undefined, turno.id, { coseguroObraSocial: 5 });

    expect(prohibido.status).toBe(403);
    expect(sinSesion.status).toBe(401);
    expect((await db.turno.findUniqueOrThrow({ where: { id: turno.id } })).coseguroObraSocial).toBeNull();
    expect(await db.turnoEvento.count()).toBe(0);
  });

  it('no deja los montos en el log', async () => {
    const { app, texto } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const turno = await turnoEn('reservado');

    await coseguros(app, cookie, turno.id, { coseguroObraSocial: '7654.32', coseguroAdicional: 8765.43 });

    expect(texto()).not.toContain('7654.32');
    expect(texto()).not.toContain('8765.43');
  });
});
