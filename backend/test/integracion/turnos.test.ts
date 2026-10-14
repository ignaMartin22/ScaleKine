import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { cargarConfiguracion } from '../../src/comun/configuracion.js';
import { RelojFijo } from '../../src/comun/reloj.js';
import type { Rol } from '../../src/generado/prisma/client.js';
import { hashearContrasena } from '../../src/modulos/m1-identidad/contrasenas.js';
import { crearRutas } from '../../src/rutas.js';
import { crearServicioTurnos } from '../../src/modulos/m3-turnos/turnos.js';
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
/** Lunes. */
const FECHA = '2026-10-12';
/** Lunes anterior a `AHORA` (2026-10-07): la carga retroactiva se admite (RF-23). */
const FECHA_VENCIDA = '2026-09-14';
const SABADO = '2026-10-10';

// Argon2 es lento a propósito: se calcula una vez y se reutiliza en todas las pruebas.
const hashClave = hashearContrasena(CLAVE);

/** Base cuyo `TurnoEvento.create` falla, tanto dentro de la transacción como fuera de ella. */
const fallar = () => Promise.reject(new Error('fallo simulado del evento'));
const conEventoRoto = <T extends object>(cliente: T): T =>
  new Proxy(cliente, {
    get(destino, propiedad, receptor) {
      if (propiedad === 'turnoEvento') return { ...Reflect.get(destino, propiedad, receptor), create: fallar };
      if (propiedad === '$transaction') {
        return (fn: (tx: unknown) => Promise<unknown>) => db.$transaction((tx) => fn(conEventoRoto(tx)));
      }
      return Reflect.get(destino, propiedad, receptor);
    },
  });

async function crearAppDePrueba(baseDeDatos: typeof db = db) {
  const config = cargarConfiguracion({ ...ENTORNO_PRUEBA, COOKIE_SECURE: 'false' });
  const reloj = new RelojFijo(AHORA);
  const capturado = loggerCapturado();
  const rutas = await crearRutas({ db: baseDeDatos, reloj, config });
  return { app: crearApp({ config, logger: capturado.logger, reloj, rutas }), ...capturado };
}
type App = Awaited<ReturnType<typeof crearAppDePrueba>>['app'];

/** Cuenta ficticia del rol con sesión abierta; devuelve la cabecera `Cookie` y el id del usuario. */
async function ingresarComo(app: App, rol: Rol): Promise<{ cookie: string; usuarioId: number }> {
  if (rol === 'administrador') {
    const { cookie, usuario } = await ingresarComoAdministradorVerificado(app);
    return { cookie, usuarioId: usuario.id };
  }
  // Cuenta de relleno: el autor de la sesión nunca es el id 1, así un autor fijo no pasa inadvertido.
  await crearUsuario();
  const nombreUsuario = `ficticio-${rol}`;
  const usuario = await crearUsuario({ rol, nombreUsuario, hashContrasena: await hashClave });
  const res = await request(app).post('/api/sesion').set('Origin', ORIGEN_APP).send({ nombreUsuario, contrasena: CLAVE });
  expect(res.status).toBe(200);
  const cookie = (res.headers['set-cookie'] as string[] | undefined)?.[0]?.split(';')[0] ?? '';
  return { cookie, usuarioId: usuario.id };
}

const conCookie = (cookie?: string) => (cookie ? { Origin: ORIGEN_APP, Cookie: cookie } : { Origin: ORIGEN_APP });
const asignar = (app: App, cookie: string | undefined, cuerpo: unknown) =>
  request(app)
    .post('/api/turnos')
    .set(conCookie(cookie))
    .send(cuerpo as object);

/** Paciente y kinesiólogo de la mañana, con un cuerpo válido para la primera franja del lunes. */
async function escenario() {
  const paciente = await crearPaciente();
  const kinesiologo = await crearKinesiologo({ bloque: 'manana' });
  const cuerpo = {
    pacienteId: paciente.id,
    kinesiologoId: kinesiologo.id,
    fecha: FECHA,
    horaInicio: '08:00',
  };
  return { paciente, kinesiologo, cuerpo };
}

describe('asignar un turno (RF-23)', () => {
  it('crea el turno en reservado con sus coseguros y devuelve su identificador', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { paciente, kinesiologo, cuerpo } = await escenario();

    const res = await asignar(app, cookie, { ...cuerpo, coseguroObraSocial: 1500.5, coseguroAdicional: '300' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      turno: {
        id: expect.any(Number),
        pacienteId: paciente.id,
        kinesiologoId: kinesiologo.id,
        fecha: FECHA,
        horaInicio: '08:00',
        estado: 'reservado',
        coseguroObraSocial: '1500.50',
        coseguroAdicional: '300.00',
      },
    });
    const turno = await db.turno.findUniqueOrThrow({ where: { id: res.body.turno.id } });
    expect(turno.estado).toBe('reservado');
    expect(turno.fecha.toISOString()).toBe(`${FECHA}T00:00:00.000Z`);
    expect(turno.llegadaEn).toBeNull();
    expect(turno.coseguroObraSocial?.toFixed(2)).toBe('1500.50');
    expect(turno.coseguroAdicional?.toFixed(2)).toBe('300.00');
    expect(turno.creadoEn).toEqual(AHORA);
  });

  it('sin coseguros los deja sin cargar', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { cuerpo } = await escenario();

    const res = await asignar(app, cookie, { ...cuerpo, coseguroAdicional: null });

    expect(res.status).toBe(201);
    expect(res.body.turno).toMatchObject({ coseguroObraSocial: null, coseguroAdicional: null });
  });

  it.each(['', '   '])('un coseguro vacío (%j) queda sin cargar', async (vacio) => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { cuerpo } = await escenario();

    const res = await asignar(app, cookie, { ...cuerpo, coseguroObraSocial: vacio, coseguroAdicional: vacio });

    expect(res.status).toBe(201);
    expect(res.body.turno).toMatchObject({ coseguroObraSocial: null, coseguroAdicional: null });
    const turno = await db.turno.findUniqueOrThrow({ where: { id: res.body.turno.id } });
    expect(turno.coseguroObraSocial).toBeNull();
    expect(turno.coseguroAdicional).toBeNull();
  });

  it('el administrador también asigna', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'administrador');
    const { cuerpo } = await escenario();

    expect((await asignar(app, cookie, cuerpo)).status).toBe(201);
  });

  it('admite una fecha vencida (carga retroactiva)', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { cuerpo } = await escenario();

    const res = await asignar(app, cookie, { ...cuerpo, fecha: FECHA_VENCIDA });

    expect(res.status).toBe(201);
    expect(res.body.turno.fecha).toBe(FECHA_VENCIDA);
  });

  it('acepta la última franja de la mañana y las de la tarde en el bloque que corresponde', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { cuerpo } = await escenario();
    const tarde = await crearKinesiologo({ bloque: 'tarde' });

    expect((await asignar(app, cookie, { ...cuerpo, horaInicio: '11:45' })).status).toBe(201);
    expect((await asignar(app, cookie, { ...cuerpo, kinesiologoId: tarde.id, horaInicio: '18:15' })).status).toBe(201);
  });
});

describe('asignación: el evento de auditoría (RF-46)', () => {
  it('escribe un evento de asignación con el autor de la sesión y la hora del reloj', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie, usuarioId } = await ingresarComo(app, 'secretaria');
    const { cuerpo } = await escenario();

    const res = await asignar(app, cookie, cuerpo);

    const eventos = await db.turnoEvento.findMany({ where: { turnoId: res.body.turno.id } });
    expect(eventos).toHaveLength(1);
    expect(eventos[0]).toMatchObject({
      tipo: 'asignacion',
      autorId: usuarioId,
      estadoAnterior: null,
      estadoNuevo: null,
      ocurridoEn: AHORA,
    });
    const turno = await db.turno.findUniqueOrThrow({ where: { id: res.body.turno.id } });
    expect(turno.creadoPorId).toBe(usuarioId);
  });

  it('el autor sale de la sesión, aunque el cuerpo pida otro', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie, usuarioId } = await ingresarComo(app, 'secretaria');
    const otra = await crearUsuario({ rol: 'administrador' });
    const { cuerpo } = await escenario();

    const res = await asignar(app, cookie, {
      ...cuerpo,
      autorId: otra.id,
      creadoPorId: otra.id,
      estado: 'asistio',
    });

    expect(res.status).toBe(201);
    const turno = await db.turno.findUniqueOrThrow({ where: { id: res.body.turno.id } });
    expect(turno.estado).toBe('reservado');
    expect(turno.creadoPorId).toBe(usuarioId);
    const evento = await db.turnoEvento.findFirstOrThrow({ where: { turnoId: turno.id } });
    expect(evento.autorId).toBe(usuarioId);
  });

  it('si el turno se rechaza, no queda ni turno ni evento', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { cuerpo } = await escenario();
    expect((await asignar(app, cookie, cuerpo)).status).toBe(201);

    const res = await asignar(app, cookie, cuerpo);

    expect(res.status).toBe(409);
    expect(await db.turno.count()).toBe(1);
    expect(await db.turnoEvento.count()).toBe(1);
  });
});

describe('asignación: datos faltantes o inválidos (RF-26)', () => {
  it.each([
    ['pacienteId', 'paciente'],
    ['kinesiologoId', 'kinesiólogo'],
    ['fecha', 'fecha'],
    ['horaInicio', 'franja'],
  ])('sin %s dice que falta %s', async (campo, nombre) => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { cuerpo } = await escenario();
    const incompleto: Record<string, unknown> = { ...cuerpo };
    delete incompleto[campo];

    const res = await asignar(app, cookie, incompleto);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: { codigo: 'dato_faltante', mensaje: `Falta indicar: ${nombre}.` } });
    expect(await db.turno.count()).toBe(0);
    expect(await db.turnoEvento.count()).toBe(0);
  });

  it('un valor nulo o vacío cuenta como faltante, y se nombran todos los que faltan', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { cuerpo } = await escenario();

    const res = await asignar(app, cookie, { ...cuerpo, pacienteId: null, fecha: '' });

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual({ codigo: 'dato_faltante', mensaje: 'Falta indicar: paciente, fecha.' });
  });

  it('un cuerpo vacío dice que falta todo', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');

    const res = await asignar(app, cookie, {});

    expect(res.body.error.mensaje).toBe('Falta indicar: paciente, kinesiólogo, fecha, franja.');
  });

  it.each([
    ['pacienteId', 'uno'],
    ['pacienteId', 0],
    ['pacienteId', 1.5],
    ['pacienteId', 99_999_999_999],
    ['kinesiologoId', '1'],
    ['fecha', '2026-02-30'],
    ['fecha', '12/10/2026'],
    ['fecha', '0000-01-03'],
    ['fecha', 20261012],
    ['horaInicio', '8:00'],
    ['horaInicio', '25:00'],
    ['coseguroObraSocial', -1],
    ['coseguroObraSocial', '12,5'],
    ['coseguroObraSocial', 1.234],
    ['coseguroAdicional', 'abc'],
    ['coseguroAdicional', 1e12],
  ])('rechaza %s con valor inválido %j', async (campo, valor) => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { cuerpo } = await escenario();

    const res = await asignar(app, cookie, { ...cuerpo, [campo]: valor });

    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe('datos_invalidos');
    expect(res.body.error.campos).toEqual([`body.${campo}`]);
    expect(await db.turno.count()).toBe(0);
  });

  it('un paciente inexistente se rechaza con claridad', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { cuerpo } = await escenario();

    const res = await asignar(app, cookie, { ...cuerpo, pacienteId: 999_999 });

    expect(res.status).toBe(404);
    expect(res.body.error.codigo).toBe('paciente_no_encontrado');
    expect(await db.turno.count()).toBe(0);
  });

  it('un kinesiólogo inexistente se rechaza con claridad', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { cuerpo } = await escenario();

    const res = await asignar(app, cookie, { ...cuerpo, kinesiologoId: 999_999 });

    expect(res.status).toBe(404);
    expect(res.body.error.codigo).toBe('kinesiologo_no_encontrado');
    expect(await db.turno.count()).toBe(0);
  });
});

describe('asignación: kinesiólogo con la cuenta desactivada (RF-23)', () => {
  it('es como si no existiera: 404 y no queda ni turno ni evento', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { kinesiologo, cuerpo } = await escenario();
    await db.usuario.update({ where: { id: kinesiologo.usuarioId }, data: { activo: false } });

    const res = await asignar(app, cookie, cuerpo);
    const inexistente = await asignar(app, cookie, { ...cuerpo, kinesiologoId: 999_999 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual(inexistente.body);
    expect(res.body.error.codigo).toBe('kinesiologo_no_encontrado');
    expect(await db.turno.count()).toBe(0);
    expect(await db.turnoEvento.count()).toBe(0);
  });
});

describe('asignación: la franja tiene que ser de la grilla del bloque (RF-15)', () => {
  it.each(['08:30', '07:15', '12:30', '16:00', '18:15'])(
    'rechaza %s para un kinesiólogo de la mañana si no es una hora de inicio de su bloque',
    async (horaInicio) => {
      const { app } = await crearAppDePrueba();
      const { cookie } = await ingresarComo(app, 'secretaria');
      const { cuerpo } = await escenario();

      const res = await asignar(app, cookie, { ...cuerpo, horaInicio });

      expect(res.status).toBe(400);
      expect(res.body.error.codigo).toBe('franja_invalida');
      expect(await db.turno.count()).toBe(0);
      expect(await db.turnoEvento.count()).toBe(0);
    },
  );

  it('rechaza una franja de la mañana para un kinesiólogo de la tarde', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { paciente } = await escenario();
    const tarde = await crearKinesiologo({ bloque: 'tarde' });

    const res = await asignar(app, cookie, {
      pacienteId: paciente.id,
      kinesiologoId: tarde.id,
      fecha: FECHA,
      horaInicio: '08:00',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe('franja_invalida');
  });

  it('rechaza un sábado: la grilla es de lunes a viernes', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { cuerpo } = await escenario();

    const res = await asignar(app, cookie, { ...cuerpo, fecha: SABADO });

    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe('franja_invalida');
  });
});

describe('asignación: ocupación de la franja (RF-24, RF-25)', () => {
  it('rechaza una franja ocupada por el mismo kinesiólogo, aunque sea con otro paciente (RF-24)', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { cuerpo } = await escenario();
    expect((await asignar(app, cookie, cuerpo)).status).toBe(201);
    const otro = await crearPaciente();

    const res = await asignar(app, cookie, { ...cuerpo, pacienteId: otro.id });

    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe('franja_ocupada');
    expect(await db.turno.count()).toBe(1);
    expect(await db.turnoEvento.count()).toBe(1);
  });

  it('la franja ocupada por un turno en espera también se rechaza', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { paciente, kinesiologo, cuerpo } = await escenario();
    await crearTurno({ kinesiologoId: kinesiologo.id, estado: 'en_espera' });

    const res = await asignar(app, cookie, { ...cuerpo, pacienteId: paciente.id });

    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe('franja_ocupada');
  });

  it('rechaza al paciente que ya tiene turno en esa franja con otro kinesiólogo (RF-25)', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { cuerpo } = await escenario();
    expect((await asignar(app, cookie, cuerpo)).status).toBe(201);
    const otroKinesiologo = await crearKinesiologo({ bloque: 'manana' });

    const res = await asignar(app, cookie, { ...cuerpo, kinesiologoId: otroKinesiologo.id });

    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe('paciente_con_turno_en_franja');
    expect(await db.turno.count()).toBe(1);
    expect(await db.turnoEvento.count()).toBe(1);
  });

  it('otro kinesiólogo con otro paciente en la misma franja sí se acepta', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { cuerpo } = await escenario();
    expect((await asignar(app, cookie, cuerpo)).status).toBe(201);
    const otro = await crearPaciente();
    const otroKinesiologo = await crearKinesiologo({ bloque: 'manana' });

    const res = await asignar(app, cookie, { ...cuerpo, pacienteId: otro.id, kinesiologoId: otroKinesiologo.id });

    expect(res.status).toBe(201);
  });

  it.each(['anulado', 'asistio', 'no_asistio'] as const)(
    'un turno %s no ocupa la franja: ni la del kinesiólogo ni la del paciente',
    async (estado) => {
      const { app } = await crearAppDePrueba();
      const { cookie } = await ingresarComo(app, 'secretaria');
      const { paciente, kinesiologo, cuerpo } = await escenario();
      const otroKinesiologo = await crearKinesiologo({ bloque: 'manana' });
      const otro = await crearPaciente();
      // Un turno del paciente con otro kinesiólogo y uno del kinesiólogo con otro paciente.
      await crearTurno({ pacienteId: paciente.id, kinesiologoId: otroKinesiologo.id, estado });
      await crearTurno({ pacienteId: otro.id, kinesiologoId: kinesiologo.id, estado });

      const res = await asignar(app, cookie, cuerpo);

      expect(res.status).toBe(201);
    },
  );
});

describe('asignación: carrera entre pedidos simultáneos', () => {
  const SIMULTANEOS = 8;

  it('con el mismo kinesiólogo y la misma franja entra uno solo y el resto recibe "franja ocupada"', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { kinesiologo, cuerpo } = await escenario();
    const pacientes = [cuerpo.pacienteId, ...(await Promise.all(Array.from({ length: SIMULTANEOS - 1 }, () => crearPaciente()))).map((p) => p.id)];

    const respuestas = await Promise.all(
      pacientes.map((pacienteId) => asignar(app, cookie, { ...cuerpo, pacienteId, kinesiologoId: kinesiologo.id })),
    );

    expect(respuestas.filter((r) => r.status === 201)).toHaveLength(1);
    const rechazos = respuestas.filter((r) => r.status !== 201);
    expect(rechazos).toHaveLength(SIMULTANEOS - 1);
    for (const r of rechazos) {
      expect(r.status).toBe(409);
      expect(r.body.error.codigo).toBe('franja_ocupada');
    }
    expect(await db.turno.count()).toBe(1);
    expect(await db.turnoEvento.count()).toBe(1);
    const turno = await db.turno.findFirstOrThrow();
    expect((await db.turnoEvento.findFirstOrThrow()).turnoId).toBe(turno.id);
  });

  it('con el mismo paciente y la misma franja entra uno solo y el resto recibe el rechazo del paciente', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { cuerpo } = await escenario();
    const kinesiologos = [
      cuerpo.kinesiologoId,
      ...(await Promise.all(Array.from({ length: SIMULTANEOS - 1 }, () => crearKinesiologo({ bloque: 'manana' })))).map((k) => k.id),
    ];

    const respuestas = await Promise.all(kinesiologos.map((kinesiologoId) => asignar(app, cookie, { ...cuerpo, kinesiologoId })));

    expect(respuestas.filter((r) => r.status === 201)).toHaveLength(1);
    const rechazos = respuestas.filter((r) => r.status !== 201);
    expect(rechazos).toHaveLength(SIMULTANEOS - 1);
    for (const r of rechazos) {
      expect(r.status).toBe(409);
      expect(r.body.error.codigo).toBe('paciente_con_turno_en_franja');
    }
    expect(await db.turno.count()).toBe(1);
    expect(await db.turnoEvento.count()).toBe(1);
  });
});

describe('asignación: autorización y sesión', () => {
  it('el kinesiólogo recibe 403 y no se crea nada', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'kinesiologo');
    const { cuerpo } = await escenario();

    const res = await asignar(app, cookie, cuerpo);

    expect(res.status).toBe(403);
    expect(res.body).toEqual(ERROR_NO_AUTORIZADO);
    expect(await db.turno.count()).toBe(0);
    expect(await db.turnoEvento.count()).toBe(0);
  });

  it('sin sesión recibe 401 y no se crea nada', async () => {
    const { app } = await crearAppDePrueba();
    const { cuerpo } = await escenario();

    const res = await asignar(app, undefined, cuerpo);

    expect(res.status).toBe(401);
    expect(await db.turno.count()).toBe(0);
  });

  it('una escritura con Origin ajeno se rechaza', async () => {
    const { app } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { cuerpo } = await escenario();

    const res = await request(app)
      .post('/api/turnos')
      .set({ Origin: 'https://ajeno.example', Cookie: cookie })
      .send(cuerpo);

    expect(res.status).toBe(403);
    expect(await db.turno.count()).toBe(0);
  });
});

describe('asignación: no registra datos personales (RNF-08)', () => {
  it('ni los rechazos ni los éxitos dejan DNI ni nombres en el log', async () => {
    const { app, texto } = await crearAppDePrueba();
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { paciente, cuerpo } = await escenario();

    await asignar(app, cookie, cuerpo);
    await asignar(app, cookie, cuerpo);
    await asignar(app, cookie, { ...cuerpo, horaInicio: '08:30' });

    expect(texto()).not.toContain(paciente.dni);
    expect(texto()).not.toContain(paciente.nombre);
  });

  it('un error inesperado (500) tampoco deja DNI, nombre ni montos en el log', async () => {
    const { app, texto, registros } = await crearAppDePrueba(conEventoRoto(db));
    const { cookie } = await ingresarComo(app, 'secretaria');
    const { paciente, cuerpo } = await escenario();

    const res = await asignar(app, cookie, { ...cuerpo, coseguroObraSocial: '7654.32', coseguroAdicional: 8765.43 });

    expect(res.status).toBe(500);
    expect(res.body.error.codigo).toBe('error_interno');
    expect(registros().some((r) => r.msg === 'error no controlado')).toBe(true);
    for (const prohibido of [paciente.dni, paciente.nombre, '7654.32', '8765.43']) {
      expect(texto()).not.toContain(prohibido);
    }
  });
});

describe('asignación: turno y evento son una sola transacción (RF-46)', () => {
  it('si el evento no se puede escribir, el turno tampoco queda', async () => {
    const reloj = new RelojFijo(AHORA);
    const servicio = crearServicioTurnos({ db: conEventoRoto(db), reloj });
    const autor = await crearUsuario({ rol: 'secretaria' });
    const { cuerpo } = await escenario();

    await expect(servicio.asignar(cuerpo, autor.id)).rejects.toThrow('fallo simulado del evento');

    expect(await db.turno.count()).toBe(0);
    expect(await db.turnoEvento.count()).toBe(0);
  });
});
