import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { crearApp } from '../../src/app.js';
import { cargarConfiguracion } from '../../src/comun/configuracion.js';
import { RelojFijo } from '../../src/comun/reloj.js';
import { hashearContrasena, verificarContrasena } from '../../src/modulos/m1-identidad/contrasenas.js';
import { crearModuloIdentidad, SIN_BLOQUEO } from '../../src/modulos/m1-identidad/index.js';
import { ENTORNO_PRUEBA, loggerCapturado, ORIGEN_APP } from '../ayudantes.js';
import { db } from './base.js';
import { crearUsuario } from './fabricas.js';

const CLAVE = 'clave-de-prueba-larga';
const INCORRECTA = 'contrasena-equivocada';
const NUEVA = 'mi-clave-elegida-2026';
const INICIO = '2026-10-07T12:00:00Z';
const MINUTO = 60 * 1000;
const QUINCE_MIN = 15 * MINUTO;

const ERROR_CREDENCIALES = {
  error: { codigo: 'credenciales_invalidas', mensaje: 'Las credenciales no son válidas.' },
};
const ERROR_ACTUAL_INCORRECTA = {
  error: { codigo: 'contrasena_actual_incorrecta', mensaje: 'La contraseña actual no es correcta.' },
};
const ERROR_DEMASIADOS_INTENTOS = {
  error: {
    codigo: 'demasiados_intentos',
    mensaje: 'Hubo demasiados intentos fallidos desde esta conexión. Esperá unos minutos y volvé a intentar.',
  },
};

// Cada prueba hace decenas de pedidos y cada uno verifica un hash de argon2, que es lento a propósito.
const LARGA = { timeout: 120_000 };

// Argon2 es lento a propósito: se calcula una vez y se reutiliza en todas las pruebas.
const hashClave = hashearContrasena(CLAVE);

async function appConIdentidad() {
  const config = cargarConfiguracion({ ...ENTORNO_PRUEBA, COOKIE_SECURE: 'false' });
  const reloj = new RelojFijo(INICIO);
  const { logger } = loggerCapturado();
  const identidad = await crearModuloIdentidad({ db, reloj, config });
  const app = crearApp({ config, logger, reloj, rutas: [identidad.rutas] });
  return { app, reloj };
}

type App = Awaited<ReturnType<typeof appConIdentidad>>['app'];

// Cada intento de las pruebas de cuenta sale de una dirección distinta, para que el límite por
// dirección no interfiera. Con `trust proxy` = 1, Express toma la IP de `X-Forwarded-For`.
let contadorIp = 0;
const ipNueva = () => {
  contadorIp += 1;
  return `198.51.${100 + (contadorIp >> 8)}.${contadorIp & 255}`;
};

const intentar = (app: App, nombreUsuario: string, contrasena: string, ip: string) =>
  request(app)
    .post('/api/sesion')
    .set('Origin', ORIGEN_APP)
    .set('X-Forwarded-For', ip)
    .send({ nombreUsuario, contrasena });

/** Ingreso rechazado por contraseña incorrecta, por defecto desde una dirección que no se repite. */
const fallar = (app: App, nombreUsuario: string, ip = ipNueva()) =>
  intentar(app, nombreUsuario, INCORRECTA, ip);

/** Ingreso con la contraseña correcta, por defecto desde una dirección que no se repite. */
const ingresarBien = (app: App, nombreUsuario: string, ip = ipNueva()) =>
  intentar(app, nombreUsuario, CLAVE, ip);

const cambiar = (app: App, cookie: string, contrasenaActual: string, ip = ipNueva()) =>
  request(app)
    .put('/api/sesion/contrasena')
    .set('Origin', ORIGEN_APP)
    .set('X-Forwarded-For', ip)
    .set('Cookie', cookie)
    .send({ contrasenaActual, contrasenaNueva: NUEVA });

const cookieDe = (res: { headers: Record<string, unknown> }): string =>
  (res.headers['set-cookie'] as string[] | undefined)?.[0]?.split(';')[0] ?? '';

async function crearCuenta(nombreUsuario: string, datos: { activo?: boolean } = {}) {
  return crearUsuario({ nombreUsuario, hashContrasena: await hashClave, ...datos });
}

/** Cuenta con sesión abierta, lista para probar el cambio de contraseña. */
async function cuentaConSesion(app: App, nombreUsuario: string) {
  const usuario = await crearCuenta(nombreUsuario);
  const res = await ingresarBien(app, nombreUsuario);
  expect(res.status).toBe(200);
  return { usuario, cookie: cookieDe(res) };
}

const limiteDe = (id: number) =>
  db.usuario.findUniqueOrThrow({
    where: { id },
    select: { ingresosFallidos: true, bloqueadoHasta: true, bloqueosConsecutivos: true },
  });

const sesionesDe = (usuarioId: number) => db.sesion.count({ where: { usuarioId } });

async function repetir(veces: number, accion: (i: number) => Promise<unknown>) {
  for (let i = 0; i < veces; i += 1) await accion(i);
}

// Dirección fija de las pruebas de carrera, para leer su fila del límite.
const IP_CARRERA = '203.0.113.99';

const mas = (fecha: Date, ms: number) => new Date(fecha.getTime() + ms);

describe('límite de intentos por cuenta en el ingreso (RNF-02)', () => {
  it('bloquea al quinto fallo seguido, incluso con la contraseña correcta, hasta los 15 minutos', LARGA, async () => {
    const usuario = await crearCuenta('cuenta1');
    const { app, reloj } = await appConIdentidad();

    // Cuatro fallos no bloquean y un ingreso correcto reinicia el contador.
    await repetir(4, () => fallar(app, 'cuenta1'));
    expect((await limiteDe(usuario.id)).ingresosFallidos).toBe(4);
    expect((await ingresarBien(app, 'cuenta1')).status).toBe(200);
    expect(await limiteDe(usuario.id)).toEqual({
      ingresosFallidos: 0,
      bloqueadoHasta: null,
      bloqueosConsecutivos: 0,
    });
    const sesionesAntes = await sesionesDe(usuario.id);

    // Cinco seguidos bloquean: la contraseña correcta recibe el mismo error y no crea sesión.
    const bloqueo = reloj.ahora();
    await repetir(5, () => fallar(app, 'cuenta1'));
    expect((await limiteDe(usuario.id)).bloqueadoHasta).toEqual(mas(bloqueo, QUINCE_MIN));
    const rechazado = await ingresarBien(app, 'cuenta1');
    expect(rechazado.status).toBe(401);
    expect(rechazado.body).toEqual(ERROR_CREDENCIALES);
    expect(await sesionesDe(usuario.id)).toBe(sesionesAntes);

    reloj.avanzar(QUINCE_MIN - 1);
    expect((await ingresarBien(app, 'cuenta1')).status).toBe(401);
    reloj.avanzar(1);
    expect((await ingresarBien(app, 'cuenta1')).status).toBe(200);
  });

  it('el segundo bloqueo dura 30 minutos exactos', LARGA, async () => {
    await crearCuenta('cuenta1');
    const { app, reloj } = await appConIdentidad();

    await repetir(5, () => fallar(app, 'cuenta1'));
    reloj.avanzar(QUINCE_MIN);
    await repetir(5, () => fallar(app, 'cuenta1'));

    reloj.avanzar(2 * QUINCE_MIN - 1);
    expect((await ingresarBien(app, 'cuenta1')).status).toBe(401);
    reloj.avanzar(1);
    expect((await ingresarBien(app, 'cuenta1')).status).toBe(200);
  });

  it('cada bloqueo consecutivo dura el doble y un ingreso correcto vuelve a empezar', LARGA, async () => {
    const usuario = await crearCuenta('cuenta1');
    const { app, reloj } = await appConIdentidad();

    // Bloqueo 1: 15 minutos.
    let inicio = reloj.ahora();
    await repetir(5, () => fallar(app, 'cuenta1'));
    expect(await limiteDe(usuario.id)).toEqual({
      ingresosFallidos: 0,
      bloqueadoHasta: mas(inicio, QUINCE_MIN),
      bloqueosConsecutivos: 1,
    });

    // Bloqueo 2: 30 minutos, sin ingresar en el medio.
    reloj.avanzar(QUINCE_MIN);
    inicio = reloj.ahora();
    await repetir(5, () => fallar(app, 'cuenta1'));
    expect(await limiteDe(usuario.id)).toEqual({
      ingresosFallidos: 0,
      bloqueadoHasta: mas(inicio, 2 * QUINCE_MIN),
      bloqueosConsecutivos: 2,
    });

    // Bloqueo 3: 60 minutos.
    reloj.avanzar(2 * QUINCE_MIN);
    inicio = reloj.ahora();
    await repetir(5, () => fallar(app, 'cuenta1'));
    expect(await limiteDe(usuario.id)).toEqual({
      ingresosFallidos: 0,
      bloqueadoHasta: mas(inicio, 4 * QUINCE_MIN),
      bloqueosConsecutivos: 3,
    });

    // Un ingreso correcto reinicia los tres campos y el próximo bloqueo vuelve a durar 15 minutos.
    reloj.avanzar(4 * QUINCE_MIN);
    expect((await ingresarBien(app, 'cuenta1')).status).toBe(200);
    expect(await limiteDe(usuario.id)).toEqual({
      ingresosFallidos: 0,
      bloqueadoHasta: null,
      bloqueosConsecutivos: 0,
    });
    inicio = reloj.ahora();
    await repetir(5, () => fallar(app, 'cuenta1'));
    expect(await limiteDe(usuario.id)).toEqual({
      ingresosFallidos: 0,
      bloqueadoHasta: mas(inicio, QUINCE_MIN),
      bloqueosConsecutivos: 1,
    });
  });

  it('un ingreso correcto en el medio reinicia el contador', LARGA, async () => {
    const usuario = await crearCuenta('cuenta1');
    const { app } = await appConIdentidad();

    await repetir(4, () => fallar(app, 'cuenta1'));
    expect((await ingresarBien(app, 'cuenta1')).status).toBe(200);
    await repetir(4, () => fallar(app, 'cuenta1'));

    // Ocho fallos en total, pero solo cuatro seguidos: la cuenta no se bloqueó.
    expect(await limiteDe(usuario.id)).toEqual({
      ingresosFallidos: 4,
      bloqueadoHasta: null,
      bloqueosConsecutivos: 0,
    });

    // Un fallo más es el quinto seguido.
    await fallar(app, 'cuenta1');
    expect((await limiteDe(usuario.id)).bloqueadoHasta).not.toBeNull();
    expect((await ingresarBien(app, 'cuenta1')).status).toBe(401);
  });

  it('los intentos durante el bloqueo no lo extienden', LARGA, async () => {
    const usuario = await crearCuenta('cuenta1');
    const { app, reloj } = await appConIdentidad();
    await repetir(5, () => fallar(app, 'cuenta1'));
    const bloqueado = await limiteDe(usuario.id);
    expect(bloqueado.bloqueadoHasta).not.toBeNull();

    reloj.avanzar(5 * MINUTO);
    await repetir(10, () => fallar(app, 'cuenta1'));

    expect(await limiteDe(usuario.id)).toEqual(bloqueado);
  });

  it('diez ingresos fallidos concurrentes dejan un único bloqueo', LARGA, async () => {
    const usuario = await crearCuenta('cuenta1');
    const { app } = await appConIdentidad();

    await Promise.all(Array.from({ length: 10 }, () => fallar(app, 'cuenta1')));

    const guardado = await limiteDe(usuario.id);
    expect(guardado.bloqueosConsecutivos).toBe(1);
    expect(guardado.ingresosFallidos).toBe(0);
    expect(guardado.bloqueadoHasta).not.toBeNull();
  });

  it('un bloqueo aplicado entre la lectura de la cuenta y la sesión impide crearla', LARGA, async () => {
    const usuario = await crearCuenta('cuenta1');
    const { app, reloj } = await appConIdentidad();
    const sesionesAntes = await sesionesDe(usuario.id);

    // La cuenta se bloquea justo después de que el servicio la leyó sin bloqueo.
    const original = db.usuario.findUnique.bind(db.usuario);
    let primera = true;
    const espia = vi.spyOn(db.usuario, 'findUnique').mockImplementation(((args: never) => {
      const lectura = original(args);
      if (!primera) return lectura;
      primera = false;
      return lectura.then(async (usuarioLeido) => {
        await db.usuario.update({
          where: { id: usuario.id },
          data: { bloqueadoHasta: mas(reloj.ahora(), QUINCE_MIN) },
        });
        return usuarioLeido;
      });
    }) as never);
    try {
      const res = await ingresarBien(app, 'cuenta1', IP_CARRERA);
      expect(res.status).toBe(401);
      expect(res.body).toEqual(ERROR_CREDENCIALES);
    } finally {
      espia.mockRestore();
    }

    expect(await sesionesDe(usuario.id)).toBe(sesionesAntes);
    // El rechazo por la carrera sigue contando para la dirección: no se le devolvió el punto.
    const fila = await db.limiteIntentos.findUniqueOrThrow({ where: { key: `direccion:${IP_CARRERA}` } });
    expect(fila.points).toBe(1);
  });

  it('el rechazo es indistinguible entre contraseña incorrecta, usuario inexistente, cuenta inactiva y cuenta bloqueada (RF-02)', LARGA, async () => {
    await crearCuenta('existente1');
    await crearCuenta('inactiva1', { activo: false });
    const bloqueada = await crearCuenta('bloqueada1');
    const { app, reloj } = await appConIdentidad();
    await db.usuario.update({
      where: { id: bloqueada.id },
      data: { ingresosFallidos: 0, bloqueosConsecutivos: 1, bloqueadoHasta: mas(reloj.ahora(), QUINCE_MIN) },
    });

    const respuestas = [
      await fallar(app, 'existente1'),
      await fallar(app, 'inexistente1'),
      await ingresarBien(app, 'inactiva1'),
      await ingresarBien(app, 'bloqueada1'),
    ];

    for (const res of respuestas) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual(ERROR_CREDENCIALES);
    }
  });
});

describe('límite de intentos por cuenta en el cambio de contraseña (RNF-02)', () => {
  it('cinco cambios con la actual incorrecta bloquean la cuenta, también para la actual correcta', LARGA, async () => {
    const { app } = await appConIdentidad();
    const { usuario, cookie } = await cuentaConSesion(app, 'cuenta1');

    await repetir(5, async () => {
      const res = await cambiar(app, cookie, INCORRECTA);
      expect(res.status).toBe(403);
    });

    // La sexta, con la actual correcta, recibe la misma respuesta y la contraseña no cambia.
    const sexta = await cambiar(app, cookie, CLAVE);
    expect(sexta.status).toBe(403);
    expect(sexta.body).toEqual(ERROR_ACTUAL_INCORRECTA);
    const guardado = await db.usuario.findUniqueOrThrow({ where: { id: usuario.id } });
    expect(await verificarContrasena(guardado.hashContrasena, CLAVE)).toBe(true);

    const ingreso = await ingresarBien(app, 'cuenta1');
    expect(ingreso.status).toBe(401);
    expect(ingreso.body).toEqual(ERROR_CREDENCIALES);
  });

  it('los ingresos y los cambios fallidos suman al mismo contador de la cuenta', LARGA, async () => {
    const { app } = await appConIdentidad();
    const { cookie } = await cuentaConSesion(app, 'cuenta1');

    await repetir(3, () => fallar(app, 'cuenta1'));
    await repetir(2, () => cambiar(app, cookie, INCORRECTA));

    const ingreso = await ingresarBien(app, 'cuenta1');
    expect(ingreso.status).toBe(401);
    expect(ingreso.body).toEqual(ERROR_CREDENCIALES);
    expect((await cambiar(app, cookie, CLAVE)).body).toEqual(ERROR_ACTUAL_INCORRECTA);
  });

  it('el primer bloqueo por cambios dura 15 minutos exactos', LARGA, async () => {
    const { app, reloj } = await appConIdentidad();
    const { usuario, cookie } = await cuentaConSesion(app, 'cuenta1');

    const bloqueo = reloj.ahora();
    await repetir(5, () => cambiar(app, cookie, INCORRECTA));
    expect((await limiteDe(usuario.id)).bloqueadoHasta).toEqual(mas(bloqueo, QUINCE_MIN));

    reloj.avanzar(QUINCE_MIN - 1);
    const bloqueada = await cambiar(app, cookie, CLAVE);
    expect(bloqueada.status).toBe(403);
    expect(bloqueada.body).toEqual(ERROR_ACTUAL_INCORRECTA);
    reloj.avanzar(1);
    expect((await cambiar(app, cookie, CLAVE)).status).toBe(204);
  });

  it('el segundo bloqueo por cambios dura 30 minutos exactos', LARGA, async () => {
    const { app, reloj } = await appConIdentidad();
    const { cookie } = await cuentaConSesion(app, 'cuenta1');

    await repetir(5, () => cambiar(app, cookie, INCORRECTA));
    reloj.avanzar(QUINCE_MIN);
    await repetir(5, () => cambiar(app, cookie, INCORRECTA));

    reloj.avanzar(2 * QUINCE_MIN - 1);
    expect((await cambiar(app, cookie, CLAVE)).status).toBe(403);
    reloj.avanzar(1);
    expect((await cambiar(app, cookie, CLAVE)).status).toBe(204);
  });

  it('un bloqueo aplicado entre la lectura de la cuenta y el cambio impide cambiar la contraseña', LARGA, async () => {
    const { app, reloj } = await appConIdentidad();
    const { usuario, cookie } = await cuentaConSesion(app, 'cuenta1');
    const hashAntes = (await db.usuario.findUniqueOrThrow({ where: { id: usuario.id } })).hashContrasena;

    // La cuenta se bloquea justo después de la segunda lectura (la posterior a verificar la actual),
    // o sea dentro de la transacción del cambio.
    const original = db.usuario.findUnique.bind(db.usuario);
    let llamadas = 0;
    const espia = vi.spyOn(db.usuario, 'findUnique').mockImplementation(((args: never) => {
      const lectura = original(args);
      llamadas += 1;
      if (llamadas !== 2) return lectura;
      return lectura.then(async (usuarioLeido) => {
        await db.usuario.update({
          where: { id: usuario.id },
          data: { bloqueadoHasta: mas(reloj.ahora(), QUINCE_MIN) },
        });
        return usuarioLeido;
      });
    }) as never);
    try {
      // Mismo error que una actual incorrecta: otra respuesta delataría que la contraseña era la correcta.
      const res = await cambiar(app, cookie, CLAVE, IP_CARRERA);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(ERROR_ACTUAL_INCORRECTA);
    } finally {
      espia.mockRestore();
    }
    const fila = await db.limiteIntentos.findUniqueOrThrow({ where: { key: `direccion:${IP_CARRERA}` } });
    expect(fila.points).toBe(1);

    const guardado = await db.usuario.findUniqueOrThrow({ where: { id: usuario.id } });
    expect(guardado.hashContrasena).toBe(hashAntes);
    expect(guardado.bloqueadoHasta).toEqual(mas(reloj.ahora(), QUINCE_MIN));
  });

  it('un bloqueo que cae mientras se verifica la actual se rechaza sin correr el segundo hash', LARGA, async () => {
    const { app, reloj } = await appConIdentidad();
    const { usuario, cookie } = await cuentaConSesion(app, 'cuenta1');
    const hashAntes = (await db.usuario.findUniqueOrThrow({ where: { id: usuario.id } })).hashContrasena;

    // La cuenta se bloquea justo después de la lectura del hash, antes de que termine de verificarse.
    const original = db.usuario.findUnique.bind(db.usuario);
    let primera = true;
    const espia = vi.spyOn(db.usuario, 'findUnique').mockImplementation(((args: never) => {
      const lectura = original(args);
      if (!primera) return lectura;
      primera = false;
      return lectura.then(async (usuarioLeido) => {
        await db.usuario.update({
          where: { id: usuario.id },
          data: { bloqueadoHasta: mas(reloj.ahora(), QUINCE_MIN) },
        });
        return usuarioLeido;
      });
    }) as never);
    const transacciones = vi.spyOn(db, '$transaction');
    try {
      const res = await cambiar(app, cookie, CLAVE, IP_CARRERA);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(ERROR_ACTUAL_INCORRECTA);
      // Rechazada antes de hashear la contraseña nueva: no llegó a la transacción.
      expect(transacciones).not.toHaveBeenCalled();
    } finally {
      espia.mockRestore();
      transacciones.mockRestore();
    }

    const guardado = await db.usuario.findUniqueOrThrow({ where: { id: usuario.id } });
    expect(guardado.hashContrasena).toBe(hashAntes);
    const fila = await db.limiteIntentos.findUniqueOrThrow({ where: { key: `direccion:${IP_CARRERA}` } });
    expect(fila.points).toBe(1);
  });

  it('un cambio de hash concurrente (restablecimiento) sin bloqueo sigue dando 409', LARGA, async () => {
    const { app } = await appConIdentidad();
    const { usuario, cookie } = await cuentaConSesion(app, 'cuenta1');
    const hashRestablecido = await hashearContrasena('restablecida-por-admin-9');

    const original = db.usuario.findUnique.bind(db.usuario);
    let primera = true;
    const espia = vi.spyOn(db.usuario, 'findUnique').mockImplementation(((args: never) => {
      const lectura = original(args);
      if (!primera) return lectura;
      primera = false;
      return lectura.then(async (usuarioLeido) => {
        await db.usuario.update({ where: { id: usuario.id }, data: { hashContrasena: hashRestablecido } });
        return usuarioLeido;
      });
    }) as never);
    try {
      const res = await cambiar(app, cookie, CLAVE);
      expect(res.status).toBe(409);
      expect(res.body.error.codigo).toBe('contrasena_modificada');
    } finally {
      espia.mockRestore();
    }

    const guardado = await db.usuario.findUniqueOrThrow({ where: { id: usuario.id } });
    expect(guardado.hashContrasena).toBe(hashRestablecido);
  });

  it('un cambio correcto deja los tres campos sin fallos ni bloqueo', LARGA, async () => {
    const { app, reloj } = await appConIdentidad();
    const { usuario, cookie } = await cuentaConSesion(app, 'cuenta1');
    // Un bloqueo ya vencido, con fallos acumulados.
    await db.usuario.update({
      where: { id: usuario.id },
      data: { ingresosFallidos: 3, bloqueosConsecutivos: 2, bloqueadoHasta: mas(reloj.ahora(), -MINUTO) },
    });

    const res = await cambiar(app, cookie, CLAVE);
    expect(res.status).toBe(204);

    expect(await limiteDe(usuario.id)).toEqual(SIN_BLOQUEO);
  });
});

describe('límite de intentos por dirección (RNF-02)', () => {
  const X = '203.0.113.7';
  const Y = '203.0.113.8';

  /** Un fallo desde X, alternando nombres inexistentes y cuentas existentes (nunca más de 4 seguidos cada una). */
  const fallarDesdeX = (app: App, i: number) =>
    fallar(app, i % 2 === 0 ? `fantasma${i}` : `cuenta${Math.floor(i / 2) % 3}`, X);

  async function cuentasDeLaDireccion() {
    await Promise.all([0, 1, 2].map((n) => crearCuenta(`cuenta${n}`)));
    await crearCuenta('valida1');
  }

  it('bloquea la dirección al fallo 20 y la libera a los 15 minutos', LARGA, async () => {
    await cuentasDeLaDireccion();
    const { app, reloj } = await appConIdentidad();

    await repetir(19, (i) => fallarDesdeX(app, i));
    expect((await ingresarBien(app, 'valida1', X)).status).toBe(200);

    await fallarDesdeX(app, 19);
    const bloqueado = await ingresarBien(app, 'valida1', X);
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.body).toEqual(ERROR_DEMASIADOS_INTENTOS);
    const valida = await db.usuario.findUniqueOrThrow({ where: { nombreUsuario: 'valida1' } });
    // Solo existe la sesión del ingreso anterior al bloqueo.
    expect(await sesionesDe(valida.id)).toBe(1);

    // Otra dirección no se ve afectada.
    expect((await ingresarBien(app, 'valida1', Y)).status).toBe(200);

    reloj.avanzar(QUINCE_MIN - 1);
    expect((await ingresarBien(app, 'valida1', X)).status).toBe(429);
    reloj.avanzar(1);
    expect((await ingresarBien(app, 'valida1', X)).status).toBe(200);
  });

  it('una ráfaga de 25 ingresos fallidos en paralelo deja pasar exactamente 20 a verificar', LARGA, async () => {
    const { app } = await appConIdentidad();

    const respuestas = await Promise.all(Array.from({ length: 25 }, (_, i) => fallar(app, `fantasma${i}`, X)));

    expect(respuestas.filter((res) => res.status === 401)).toHaveLength(20);
    const rechazadas = respuestas.filter((res) => res.status === 429);
    expect(rechazadas).toHaveLength(5);
    for (const res of rechazadas) expect(res.body).toEqual(ERROR_DEMASIADOS_INTENTOS);
    const fila = await db.limiteIntentos.findUniqueOrThrow({ where: { key: `direccion:${X}` } });
    expect(fila.points).toBe(20);
  });

  it('un ingreso correcto no consume un punto de la dirección', LARGA, async () => {
    await cuentasDeLaDireccion();
    const { app } = await appConIdentidad();

    await repetir(19, (i) => fallarDesdeX(app, i));
    expect((await ingresarBien(app, 'valida1', X)).status).toBe(200);
    const fila = await db.limiteIntentos.findUniqueOrThrow({ where: { key: `direccion:${X}` } });
    expect(fila.points).toBe(19);

    // El fallo 20 todavía se verifica (401); recién con él la dirección queda bloqueada.
    expect((await fallarDesdeX(app, 19)).status).toBe(401);
    const bloqueado = await ingresarBien(app, 'valida1', X);
    expect(bloqueado.status).toBe(429);
    expect(bloqueado.body).toEqual(ERROR_DEMASIADOS_INTENTOS);
  });

  it('los ingresos correctos no renuevan la ventana: vence a los 15 minutos del primer intento', LARGA, async () => {
    await cuentasDeLaDireccion();
    const { app, reloj } = await appConIdentidad();

    await repetir(19, (i) => fallarDesdeX(app, i));
    reloj.avanzar(10 * MINUTO);
    expect((await ingresarBien(app, 'valida1', X)).status).toBe(200);
    reloj.avanzar(5 * MINUTO + 1);

    // Pasaron 15 minutos y 1 ms desde el primer fallo: la ventana venció y este fallo no bloquea.
    expect((await fallarDesdeX(app, 19)).status).toBe(401);
    expect((await ingresarBien(app, 'valida1', X)).status).toBe(200);
    const fila = await db.limiteIntentos.findUniqueOrThrow({ where: { key: `direccion:${X}` } });
    expect(fila.points).toBe(1);
  });

  it('el bloqueo dura 15 minutos desde el fallo que alcanza el umbral', LARGA, async () => {
    await cuentasDeLaDireccion();
    const { app, reloj } = await appConIdentidad();

    await repetir(19, (i) => fallarDesdeX(app, i));
    reloj.avanzar(5 * MINUTO);
    expect((await fallarDesdeX(app, 19)).status).toBe(401);

    // Pasada la ventana original (a los 15 minutos del primer fallo) sigue bloqueada.
    reloj.avanzar(10 * MINUTO);
    expect((await ingresarBien(app, 'valida1', X)).status).toBe(429);
    reloj.avanzar(5 * MINUTO - 1);
    expect((await ingresarBien(app, 'valida1', X)).status).toBe(429);
    reloj.avanzar(1);
    expect((await ingresarBien(app, 'valida1', X)).status).toBe(200);
  });

  it('la ventana empieza con el primer fallo y vence a los 15 minutos', LARGA, async () => {
    await cuentasDeLaDireccion();
    const { app, reloj } = await appConIdentidad();

    await repetir(19, (i) => fallarDesdeX(app, i));
    reloj.avanzar(QUINCE_MIN);
    await fallarDesdeX(app, 19);

    // La ventana empezó de nuevo: un solo fallo y la dirección sigue habilitada.
    expect((await ingresarBien(app, 'valida1', X)).status).toBe(200);
    const fila = await db.limiteIntentos.findUniqueOrThrow({ where: { key: `direccion:${X}` } });
    expect(fila.points).toBe(1);
  });

  it('los ingresos y los cambios fallidos suman para la misma dirección', LARGA, async () => {
    const { app } = await appConIdentidad();
    const sesiones: string[] = [];
    for (let n = 0; n < 5; n += 1) {
      sesiones.push((await cuentaConSesion(app, `cambio${n}`)).cookie);
    }

    // Diez ingresos y diez cambios fallidos, repartidos para no depender del bloqueo por cuenta.
    await repetir(10, (i) => fallar(app, `fantasma${i}`, X));
    await repetir(10, (i) => cambiar(app, sesiones[i % 5]!, INCORRECTA, X));

    const fila = await db.limiteIntentos.findUniqueOrThrow({ where: { key: `direccion:${X}` } });
    expect(fila.points).toBe(20);

    const ingreso = await ingresarBien(app, 'cambio0', X);
    expect(ingreso.status).toBe(429);
    expect(ingreso.body).toEqual(ERROR_DEMASIADOS_INTENTOS);
    const cambio = await cambiar(app, sesiones[0]!, CLAVE, X);
    expect(cambio.status).toBe(429);
    expect(cambio.body).toEqual(ERROR_DEMASIADOS_INTENTOS);

    // Un 429 no es un fallo nuevo.
    const despues = await db.limiteIntentos.findUniqueOrThrow({ where: { key: `direccion:${X}` } });
    expect(despues.points).toBe(20);
    expect(despues.expire).toBe(fila.expire);
  });

  it('el 429 es el mismo exista o no la cuenta', LARGA, async () => {
    await crearCuenta('existente1');
    const { app, reloj } = await appConIdentidad();
    await db.limiteIntentos.create({
      data: { key: `direccion:${X}`, points: 20, expire: BigInt(reloj.ahora().getTime() + QUINCE_MIN) },
    });

    const respuestas = [
      await ingresarBien(app, 'existente1', X),
      await fallar(app, 'existente1', X),
      await fallar(app, 'inexistente1', X),
    ];

    for (const res of respuestas) {
      expect(res.status).toBe(429);
      expect(res.body).toEqual(ERROR_DEMASIADOS_INTENTOS);
    }
  });

  it('borra las filas vencidas al registrar un fallo', LARGA, async () => {
    const { app, reloj } = await appConIdentidad();

    await fallar(app, 'fantasma1', X);
    expect(await db.limiteIntentos.count()).toBe(1);
    reloj.avanzar(QUINCE_MIN);
    await fallar(app, 'fantasma2', Y);

    const filas = await db.limiteIntentos.findMany();
    expect(filas.map((fila) => fila.key)).toEqual([`direccion:${Y}`]);
  });
});
