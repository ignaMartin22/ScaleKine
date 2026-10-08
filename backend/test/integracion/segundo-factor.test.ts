import { Router } from 'express';
import { generateSync } from 'otplib';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { restablecer2faAdmin } from '../../src/cli/comandos.js';
import { cargarConfiguracion } from '../../src/comun/configuracion.js';
import { RelojFijo } from '../../src/comun/reloj.js';
import type { Rol } from '../../src/generado/prisma/client.js';
import { hashearContrasena } from '../../src/modulos/m1-identidad/contrasenas.js';
import { crearModuloIdentidad } from '../../src/modulos/m1-identidad/index.js';
import {
  cifrarSecreto,
  descifrarSecreto,
  generarSecretoTotp,
  hashCodigoRecuperacion,
  pasoTotp,
} from '../../src/modulos/m1-identidad/segundoFactor.js';
import { CLAVE_CIFRADO_PRUEBA, ENTORNO_PRUEBA, loggerCapturado, ORIGEN_APP } from '../ayudantes.js';
import { db } from './base.js';
import { crearUsuario } from './fabricas.js';

const CLAVE = 'clave-de-prueba-larga';
const NUEVA = 'mi-clave-elegida-2026';
const INICIO = '2026-10-07T12:00:00Z';
const SEGUNDOS_PASO = 30;

const ERROR_INVALIDO = { error: { codigo: 'segundo_factor_invalido', mensaje: 'El código no es válido.' } };
const clavePrueba = Buffer.from(CLAVE_CIFRADO_PRUEBA, 'base64');

// Cada prueba hace varios ingresos y cada uno verifica un hash de argon2, que es lento a propósito.
const LARGA = { timeout: 120_000 };

// Argon2 es lento a propósito: se calcula una vez y se reutiliza en todas las pruebas.
const hashClave = hashearContrasena(CLAVE);

async function appConIdentidad({ conClave = true }: { conClave?: boolean } = {}) {
  const entorno = {
    ...ENTORNO_PRUEBA,
    COOKIE_SECURE: 'false',
    ...(conClave ? { CLAVE_CIFRADO: CLAVE_CIFRADO_PRUEBA } : {}),
  };
  const config = cargarConfiguracion(entorno);
  const reloj = new RelojFijo(INICIO);
  const capturado = loggerCapturado();
  const identidad = await crearModuloIdentidad({ db, reloj, config });
  // Una ruta de negocio de mentira, con la variante que usarán las rutas reales (T-13).
  const negocio = Router();
  negocio.get('/prueba', identidad.exigirSesion, (_req, res) => {
    res.json({ ok: true });
  });
  const app = crearApp({ config, logger: capturado.logger, reloj, rutas: [identidad.rutas, negocio] });
  return { app, reloj, ...capturado };
}

type App = Awaited<ReturnType<typeof appConIdentidad>>['app'];

// Cada pedido sale de una dirección distinta, salvo que la prueba pida una fija, para que el límite
// por dirección no interfiera. Con `trust proxy` = 1, Express toma la IP de `X-Forwarded-For`.
let contadorIp = 0;
const ipNueva = () => {
  contadorIp += 1;
  return `198.51.${100 + (contadorIp >> 8)}.${contadorIp & 255}`;
};

const cookieDe = (res: { headers: Record<string, unknown> }): string =>
  (res.headers['set-cookie'] as string[] | undefined)?.[0]?.split(';')[0] ?? '';

/** Ingreso con contraseña; devuelve la cookie de la sesión nueva (todavía sin verificar). */
async function ingresar(app: App, nombreUsuario: string, contrasena = CLAVE) {
  const res = await request(app)
    .post('/api/sesion')
    .set('Origin', ORIGEN_APP)
    .set('X-Forwarded-For', ipNueva())
    .send({ nombreUsuario, contrasena });
  expect(res.status).toBe(200);
  return { cookie: cookieDe(res), cuerpo: res.body as Record<string, unknown> };
}

const pedir = (app: App, metodo: 'get' | 'put' | 'post', ruta: string, cookie: string, cuerpo?: object, ip = ipNueva()) =>
  request(app)[metodo](ruta).set('Origin', ORIGEN_APP).set('X-Forwarded-For', ip).set('Cookie', cookie).send(cuerpo);

const verificar = (app: App, cookie: string, codigo: string, ip = ipNueva()) =>
  pedir(app, 'post', '/api/sesion/segundo-factor/verificar', cookie, { codigo }, ip);
const iniciarActivacion = (app: App, cookie: string) =>
  pedir(app, 'post', '/api/sesion/segundo-factor/activacion', cookie, {});
const confirmarActivacion = (app: App, cookie: string, codigo: string) =>
  pedir(app, 'post', '/api/sesion/segundo-factor/activacion/confirmar', cookie, { codigo });
const consultarSesion = (app: App, cookie: string) => pedir(app, 'get', '/api/sesion', cookie);
const rutaDeNegocio = (app: App, cookie: string) => pedir(app, 'get', '/api/prueba', cookie);

/** Código TOTP del secreto para un instante, con la misma configuración que usa el servidor. */
function codigoTotp(secreto: string, instante: Date | string): string {
  return generateSync({
    secret: secreto,
    strategy: 'totp',
    algorithm: 'sha1',
    digits: 6,
    period: SEGUNDOS_PASO,
    epoch: Math.floor(new Date(instante).getTime() / 1000),
  });
}

const enSegundos = (instante: string, segundos: number) => new Date(new Date(instante).getTime() + segundos * 1000);

/** Seis dígitos que no son válidos en el paso actual ni en los contiguos (la tolerancia es de un paso). */
function codigoInvalido(secreto: string, instante = INICIO): string {
  const validos = [-1, 0, 1].map((d) => codigoTotp(secreto, enSegundos(instante, d * SEGUNDOS_PASO)));
  const candidato = ['000000', '111111', '222222', '333333'].find((c) => !validos.includes(c));
  if (!candidato) throw new Error('No hay código inválido disponible.');
  return candidato;
}

/** Códigos de recuperación ficticios de una cuenta con el segundo factor ya activo. */
const CODIGOS_RECUPERACION = ['aaaaa-bbbbb', 'ccccc-ddddd', 'eeeee-fffff'];

async function crearCuenta(
  nombreUsuario: string,
  {
    rol = 'administrador',
    totp = false,
    debeCambiarContrasena = false,
  }: { rol?: Rol; totp?: boolean; debeCambiarContrasena?: boolean } = {},
) {
  const base = await crearUsuario({
    nombreUsuario,
    rol,
    hashContrasena: await hashClave,
    debeCambiarContrasena,
    totpActivo: totp,
  });
  if (!totp) return { usuario: base, secreto: null };
  const secreto = generarSecretoTotp();
  const usuario = await db.usuario.update({
    where: { id: base.id },
    data: {
      secretoTotpCifrado: cifrarSecreto(secreto, clavePrueba, base.id),
      codigosRecuperacion: CODIGOS_RECUPERACION.map(hashCodigoRecuperacion),
    },
  });
  return { usuario, secreto };
}

const estadoDe = (id: number) => db.usuario.findUniqueOrThrow({ where: { id } });
const sesionesDe = (usuarioId: number) => db.sesion.findMany({ where: { usuarioId }, orderBy: { id: 'asc' } });

describe('activación del segundo factor (RNF-04)', () => {
  it('guarda el secreto cifrado en la base y devuelve el QR como data:', async () => {
    const { usuario } = await crearCuenta('admin1');
    const { app } = await appConIdentidad();
    const { cookie } = await ingresar(app, 'admin1');

    const res = await iniciarActivacion(app, cookie);

    expect(res.status).toBe(200);
    expect(res.body.qr).toMatch(/^data:image\/png;base64,/);
    const fila = await estadoDe(usuario.id);
    expect(fila.totpActivo).toBe(false);
    const cifrado = fila.secretoTotpCifrado!;
    expect(cifrado).toMatch(/^v1:/);
    const secreto = descifrarSecreto(cifrado, clavePrueba, usuario.id);
    expect(secreto).toMatch(/^[A-Za-z2-7]{20,}$/);
    expect(cifrado).not.toContain(secreto);
  }, LARGA.timeout);

  it('repetir la activación reemplaza el secreto pendiente', async () => {
    const { usuario } = await crearCuenta('admin1');
    const { app } = await appConIdentidad();
    const { cookie } = await ingresar(app, 'admin1');

    await iniciarActivacion(app, cookie);
    const primero = descifrarSecreto((await estadoDe(usuario.id)).secretoTotpCifrado!, clavePrueba, usuario.id);
    await iniciarActivacion(app, cookie);
    const segundo = descifrarSecreto((await estadoDe(usuario.id)).secretoTotpCifrado!, clavePrueba, usuario.id);

    expect(segundo).not.toBe(primero);
    // El código del secreto reemplazado ya no sirve para confirmar.
    expect((await confirmarActivacion(app, cookie, codigoTotp(primero, INICIO))).status).toBe(400);
    expect((await confirmarActivacion(app, cookie, codigoTotp(segundo, INICIO))).status).toBe(200);
  }, LARGA.timeout);

  it('confirmar con un código inválido da 400, no activa nada y no cuenta para el límite', async () => {
    const { usuario } = await crearCuenta('admin1');
    const { app } = await appConIdentidad();
    const { cookie } = await ingresar(app, 'admin1');
    await iniciarActivacion(app, cookie);
    const secreto = descifrarSecreto((await estadoDe(usuario.id)).secretoTotpCifrado!, clavePrueba, usuario.id);

    for (let i = 0; i < 6; i += 1) {
      const res = await confirmarActivacion(app, cookie, codigoInvalido(secreto));
      expect(res.status).toBe(400);
      expect(res.body.error.codigo).toBe('codigo_invalido');
    }

    const fila = await estadoDe(usuario.id);
    expect(fila.totpActivo).toBe(false);
    expect(fila.codigosRecuperacion).toEqual([]);
    expect(fila.ingresosFallidos).toBe(0);
    expect(fila.bloqueadoHasta).toBeNull();
    // Solo queda la fila del ingreso, con su punto devuelto: la confirmación no suma a la dirección.
    const puntos = await db.limiteIntentos.findMany();
    expect(puntos.every((p) => p.points === 0)).toBe(true);
  }, LARGA.timeout);

  it('confirmar sin haber pedido el QR da 400 activacion_no_iniciada', async () => {
    await crearCuenta('admin1');
    const { app } = await appConIdentidad();
    const { cookie } = await ingresar(app, 'admin1');

    const res = await confirmarActivacion(app, cookie, '123456');

    expect(res.status).toBe(400);
    expect(res.body.error.codigo).toBe('activacion_no_iniciada');
  }, LARGA.timeout);

  it('confirmar con un código válido activa el TOTP, devuelve 10 códigos y deja solo sus hashes', async () => {
    const { usuario } = await crearCuenta('admin1');
    const { app } = await appConIdentidad();
    const { cookie } = await ingresar(app, 'admin1');
    await iniciarActivacion(app, cookie);
    const secreto = descifrarSecreto((await estadoDe(usuario.id)).secretoTotpCifrado!, clavePrueba, usuario.id);

    const res = await confirmarActivacion(app, cookie, codigoTotp(secreto, INICIO));

    expect(res.status).toBe(200);
    const codigos = res.body.codigosRecuperacion as string[];
    expect(codigos).toHaveLength(10);
    expect(new Set(codigos).size).toBe(10);
    const fila = await estadoDe(usuario.id);
    expect(fila.totpActivo).toBe(true);
    expect(fila.ultimoPasoTotp).toBe(pasoTotp(new Date(INICIO)));
    expect(fila.codigosRecuperacion).toHaveLength(10);
    expect(fila.codigosRecuperacion).toEqual(codigos.map(hashCodigoRecuperacion));
    for (const codigo of codigos) expect(fila.codigosRecuperacion).not.toContain(codigo);
    expect(fila.secretoTotpCifrado).not.toContain(secreto);
    // La sesión que activó queda verificada: sigue sin paso pendiente y puede usar las rutas de negocio.
    expect((await sesionesDe(usuario.id))[0]!.segundoFactorVerificado).toBe(true);
    const sesion = await consultarSesion(app, cookie);
    expect(sesion.body).toMatchObject({ segundoFactor: 'verificado', pasoPendiente: null });
    expect((await rutaDeNegocio(app, cookie)).status).toBe(200);
  }, LARGA.timeout);

  it('con el segundo factor ya activo no se puede volver a activar', async () => {
    const { usuario, secreto } = await crearCuenta('admin1', { totp: true });
    const { app } = await appConIdentidad();
    const { cookie } = await ingresar(app, 'admin1');
    expect((await verificar(app, cookie, codigoTotp(secreto!, INICIO))).status).toBe(204);
    const antes = (await estadoDe(usuario.id)).secretoTotpCifrado;

    const res = await iniciarActivacion(app, cookie);

    expect(res.status).toBe(403);
    expect(res.body.error.codigo).toBe('paso_no_pendiente');
    expect((await estadoDe(usuario.id)).secretoTotpCifrado).toBe(antes);
  }, LARGA.timeout);

  it('sin CLAVE_CIFRADO la activación da 503 segundo_factor_sin_configurar', async () => {
    const { usuario } = await crearCuenta('admin1');
    const { app } = await appConIdentidad({ conClave: false });
    const { cookie } = await ingresar(app, 'admin1');

    const res = await iniciarActivacion(app, cookie);

    expect(res.status).toBe(503);
    expect(res.body.error.codigo).toBe('segundo_factor_sin_configurar');
    expect((await estadoDe(usuario.id)).secretoTotpCifrado).toBeNull();
  }, LARGA.timeout);
});

describe('verificación sin clave de cifrado (RNF-04)', () => {
  it('sin CLAVE_CIFRADO la verificación da 503 segundo_factor_sin_configurar y no cuenta como fallo', async () => {
    const { usuario } = await crearCuenta('admin1', { totp: true });
    const { app } = await appConIdentidad({ conClave: false });
    const { cookie } = await ingresar(app, 'admin1');

    const res = await verificar(app, cookie, '123456');

    expect(res.status).toBe(503);
    expect(res.body.error.codigo).toBe('segundo_factor_sin_configurar');
    expect((await estadoDe(usuario.id)).ingresosFallidos).toBe(0);
  }, LARGA.timeout);
});

describe('ingreso de un administrador con el segundo factor activo (RNF-04)', () => {
  it('antes de verificar, las demás rutas dan 403 debe_verificar_segundo_factor', async () => {
    await crearCuenta('admin1', { totp: true });
    const { app } = await appConIdentidad();
    const { cookie, cuerpo } = await ingresar(app, 'admin1');

    expect(cuerpo).toMatchObject({ segundoFactor: 'sin_verificar', pasoPendiente: 'verificar_segundo_factor' });
    const respuestas = [
      await rutaDeNegocio(app, cookie),
      await pedir(app, 'put', '/api/sesion/contrasena', cookie, { contrasenaActual: CLAVE, contrasenaNueva: NUEVA }),
      await iniciarActivacion(app, cookie),
      await confirmarActivacion(app, cookie, '123456'),
    ];
    for (const res of respuestas) {
      expect(res.status).toBe(403);
      expect(res.body.error.codigo).toBe('debe_verificar_segundo_factor');
    }
    // La sesión se puede consultar.
    expect((await consultarSesion(app, cookie)).body).toMatchObject({ pasoPendiente: 'verificar_segundo_factor' });
  }, LARGA.timeout);

  it('con un código TOTP válido la sesión queda verificada', async () => {
    const { usuario, secreto } = await crearCuenta('admin1', { totp: true });
    const { app } = await appConIdentidad();
    const { cookie } = await ingresar(app, 'admin1');

    const res = await verificar(app, cookie, codigoTotp(secreto!, INICIO));

    expect(res.status).toBe(204);
    expect((await sesionesDe(usuario.id))[0]!.segundoFactorVerificado).toBe(true);
    expect((await estadoDe(usuario.id)).ultimoPasoTotp).toBe(pasoTotp(new Date(INICIO)));
    expect((await consultarSesion(app, cookie)).body).toMatchObject({
      segundoFactor: 'verificado',
      pasoPendiente: null,
    });
    expect((await rutaDeNegocio(app, cookie)).status).toBe(200);
  }, LARGA.timeout);

  it('un código del paso anterior también se acepta (tolerancia de un paso)', async () => {
    const { secreto } = await crearCuenta('admin1', { totp: true });
    const { app } = await appConIdentidad();
    const { cookie } = await ingresar(app, 'admin1');

    const res = await verificar(app, cookie, codigoTotp(secreto!, enSegundos(INICIO, -SEGUNDOS_PASO)));

    expect(res.status).toBe(204);
  }, LARGA.timeout);

  it('con un código inválido responde 403 segundo_factor_invalido y la sesión sigue sin verificar', async () => {
    const { usuario, secreto } = await crearCuenta('admin1', { totp: true });
    const { app } = await appConIdentidad();
    const { cookie } = await ingresar(app, 'admin1');

    for (const codigo of [codigoInvalido(secreto!), 'zzzzz-zzzzz', '12345']) {
      const res = await verificar(app, cookie, codigo);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(ERROR_INVALIDO);
    }

    expect((await sesionesDe(usuario.id))[0]!.segundoFactorVerificado).toBe(false);
    expect((await rutaDeNegocio(app, cookie)).status).toBe(403);
  }, LARGA.timeout);

  it('la verificación valida la entrada con zod: sin código o con un tipo equivocado da 400', async () => {
    await crearCuenta('admin1', { totp: true });
    const { app } = await appConIdentidad();
    const { cookie } = await ingresar(app, 'admin1');

    expect((await pedir(app, 'post', '/api/sesion/segundo-factor/verificar', cookie, {})).status).toBe(400);
    expect((await pedir(app, 'post', '/api/sesion/segundo-factor/verificar', cookie, { codigo: 123456 })).status).toBe(
      400,
    );
  }, LARGA.timeout);

  it('un código de recuperación válido verifica la sesión', async () => {
    const { usuario } = await crearCuenta('admin1', { totp: true });
    const { app } = await appConIdentidad();
    const { cookie } = await ingresar(app, 'admin1');

    // Se normaliza: mayúsculas y sin guion también sirve.
    const res = await verificar(app, cookie, 'AAAAABBBBB');

    expect(res.status).toBe(204);
    expect((await sesionesDe(usuario.id))[0]!.segundoFactorVerificado).toBe(true);
  }, LARGA.timeout);
});

describe('un código no se reutiliza (RNF-04)', () => {
  it('el mismo TOTP en dos sesiones: solo la primera verifica', async () => {
    const { usuario, secreto } = await crearCuenta('admin1', { totp: true });
    const { app } = await appConIdentidad();
    const a = await ingresar(app, 'admin1');
    const b = await ingresar(app, 'admin1');
    const codigo = codigoTotp(secreto!, INICIO);

    const primera = await verificar(app, a.cookie, codigo);
    const segunda = await verificar(app, b.cookie, codigo);

    expect(primera.status).toBe(204);
    expect(segunda.status).toBe(403);
    expect(segunda.body).toEqual(ERROR_INVALIDO);
    const sesiones = await sesionesDe(usuario.id);
    expect(sesiones.map((s) => s.segundoFactorVerificado)).toEqual([true, false]);
  }, LARGA.timeout);

  it('el mismo TOTP en dos sesiones en paralelo: solo una gana', async () => {
    const { usuario, secreto } = await crearCuenta('admin1', { totp: true });
    const { app } = await appConIdentidad();
    const a = await ingresar(app, 'admin1');
    const b = await ingresar(app, 'admin1');
    const codigo = codigoTotp(secreto!, INICIO);

    const respuestas = await Promise.all([verificar(app, a.cookie, codigo), verificar(app, b.cookie, codigo)]);

    expect(respuestas.map((r) => r.status).sort()).toEqual([204, 403]);
    const sesiones = await sesionesDe(usuario.id);
    expect(sesiones.filter((s) => s.segundoFactorVerificado)).toHaveLength(1);
  }, LARGA.timeout);

  it('un código del paso siguiente sí sirve después de usar uno anterior; uno más viejo no', async () => {
    const { secreto } = await crearCuenta('admin1', { totp: true });
    const { app, reloj } = await appConIdentidad();
    const a = await ingresar(app, 'admin1');
    const b = await ingresar(app, 'admin1');
    const c = await ingresar(app, 'admin1');
    const viejo = codigoTotp(secreto!, enSegundos(INICIO, -SEGUNDOS_PASO));
    const actual = codigoTotp(secreto!, INICIO);

    expect((await verificar(app, a.cookie, actual)).status).toBe(204);
    // El código del paso anterior, aunque esté en la tolerancia, ya no es posterior al último usado.
    expect((await verificar(app, b.cookie, viejo)).status).toBe(403);
    reloj.avanzar(2 * SEGUNDOS_PASO * 1000);
    expect((await verificar(app, c.cookie, codigoTotp(secreto!, reloj.ahora()))).status).toBe(204);
  }, LARGA.timeout);

  it('un código de recuperación usado dos veces: solo sirve la primera, y deja de figurar en la lista', async () => {
    const { usuario } = await crearCuenta('admin1', { totp: true });
    const { app } = await appConIdentidad();
    const a = await ingresar(app, 'admin1');
    const b = await ingresar(app, 'admin1');

    expect((await verificar(app, a.cookie, CODIGOS_RECUPERACION[0]!)).status).toBe(204);
    const segunda = await verificar(app, b.cookie, CODIGOS_RECUPERACION[0]!);

    expect(segunda.status).toBe(403);
    expect(segunda.body).toEqual(ERROR_INVALIDO);
    const fila = await estadoDe(usuario.id);
    expect(fila.codigosRecuperacion).toHaveLength(2);
    expect(fila.codigosRecuperacion).not.toContain(hashCodigoRecuperacion(CODIGOS_RECUPERACION[0]!));
    // Los demás códigos siguen sirviendo.
    expect((await verificar(app, b.cookie, CODIGOS_RECUPERACION[1]!)).status).toBe(204);
  }, LARGA.timeout);

  it('un código de recuperación usado en paralelo en dos sesiones: solo una gana', async () => {
    const { usuario } = await crearCuenta('admin1', { totp: true });
    const { app } = await appConIdentidad();
    const a = await ingresar(app, 'admin1');
    const b = await ingresar(app, 'admin1');

    const respuestas = await Promise.all([
      verificar(app, a.cookie, CODIGOS_RECUPERACION[0]!),
      verificar(app, b.cookie, CODIGOS_RECUPERACION[0]!),
    ]);

    expect(respuestas.map((r) => r.status).sort()).toEqual([204, 403]);
    const fila = await estadoDe(usuario.id);
    expect(fila.codigosRecuperacion).toHaveLength(2);
    expect(fila.codigosRecuperacion).not.toContain(hashCodigoRecuperacion(CODIGOS_RECUPERACION[0]!));
    const sesiones = await sesionesDe(usuario.id);
    expect(sesiones.filter((s) => s.segundoFactorVerificado)).toHaveLength(1);
  }, LARGA.timeout);
});

describe('el segundo factor y el límite de intentos (RNF-02)', () => {
  it('5 códigos inválidos bloquean la cuenta y después un código válido recibe el mismo 403', async () => {
    const { usuario, secreto } = await crearCuenta('admin1', { totp: true });
    const { app } = await appConIdentidad();
    const { cookie } = await ingresar(app, 'admin1');
    const invalido = codigoInvalido(secreto!);

    for (let i = 0; i < 5; i += 1) {
      const res = await verificar(app, cookie, invalido);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(ERROR_INVALIDO);
    }
    const bloqueada = await estadoDe(usuario.id);
    expect(bloqueada.bloqueadoHasta).not.toBeNull();

    const valido = await verificar(app, cookie, codigoTotp(secreto!, INICIO));
    expect(valido.status).toBe(403);
    expect(valido.body).toEqual(ERROR_INVALIDO);
    const despues = await estadoDe(usuario.id);
    expect(despues.ultimoPasoTotp).toBeNull();
    expect((await sesionesDe(usuario.id))[0]!.segundoFactorVerificado).toBe(false);
    // Tampoco sirve un código de recuperación mientras dure el bloqueo, y no se gasta.
    expect((await verificar(app, cookie, CODIGOS_RECUPERACION[0]!)).body).toEqual(ERROR_INVALIDO);
    expect((await estadoDe(usuario.id)).codigosRecuperacion).toHaveLength(3);
  }, LARGA.timeout);

  it('la dirección cuenta los fallos y un éxito no consume un punto', async () => {
    const { secreto } = await crearCuenta('admin1', { totp: true });
    const { app } = await appConIdentidad();
    const { cookie } = await ingresar(app, 'admin1');
    const ip = '203.0.113.77';

    for (let i = 0; i < 3; i += 1) expect((await verificar(app, cookie, codigoInvalido(secreto!), ip)).status).toBe(403);
    const antes = await db.limiteIntentos.findUniqueOrThrow({ where: { key: `direccion:${ip}` } });
    expect(antes.points).toBe(3);

    expect((await verificar(app, cookie, codigoTotp(secreto!, INICIO), ip)).status).toBe(204);
    const despues = await db.limiteIntentos.findUniqueOrThrow({ where: { key: `direccion:${ip}` } });
    expect(despues.points).toBe(3);
  }, LARGA.timeout);

  it('un código repetido cuenta como fallo de la dirección', async () => {
    const { secreto } = await crearCuenta('admin1', { totp: true });
    const { app } = await appConIdentidad();
    const a = await ingresar(app, 'admin1');
    const b = await ingresar(app, 'admin1');
    const ip = '203.0.113.78';
    const codigo = codigoTotp(secreto!, INICIO);

    expect((await verificar(app, a.cookie, codigo, ip)).status).toBe(204);
    expect((await verificar(app, b.cookie, codigo, ip)).status).toBe(403);

    const fila = await db.limiteIntentos.findUniqueOrThrow({ where: { key: `direccion:${ip}` } });
    expect(fila.points).toBe(1);
  }, LARGA.timeout);

  it('con la dirección bloqueada por 20 fallos responde 429 sin verificar', async () => {
    const { secreto } = await crearCuenta('admin1', { totp: true });
    const { app } = await appConIdentidad();
    const { cookie } = await ingresar(app, 'admin1');
    const ip = '203.0.113.79';

    for (let i = 0; i < 20; i += 1) expect((await verificar(app, cookie, codigoInvalido(secreto!), ip)).status).toBe(403);
    const res = await verificar(app, cookie, codigoTotp(secreto!, INICIO), ip);

    expect(res.status).toBe(429);
    expect(res.body.error.codigo).toBe('demasiados_intentos');
  }, LARGA.timeout);
});

describe('otros roles y bloqueo de pasos (RNF-04, RF-06)', () => {
  it.each<Rol>(['secretaria', 'kinesiologo'])('%s no tiene paso de segundo factor', async (rol) => {
    await crearCuenta('persona1', { rol });
    const { app } = await appConIdentidad();
    const { cookie, cuerpo } = await ingresar(app, 'persona1');

    expect(cuerpo).toMatchObject({ segundoFactor: 'no_requerido', pasoPendiente: null });
    expect((await rutaDeNegocio(app, cookie)).status).toBe(200);
    for (const res of [await iniciarActivacion(app, cookie), await verificar(app, cookie, '123456')]) {
      expect(res.status).toBe(403);
      expect(res.body.error.codigo).toBe('paso_no_pendiente');
    }
  }, LARGA.timeout);

  it('el administrador sin TOTP solo accede a la activación, a consultar la sesión y a cerrarla', async () => {
    await crearCuenta('admin1');
    const { app } = await appConIdentidad();
    const { cookie, cuerpo } = await ingresar(app, 'admin1');

    expect(cuerpo).toMatchObject({ segundoFactor: 'sin_activar', pasoPendiente: 'activar_segundo_factor' });
    const bloqueadas = [
      await rutaDeNegocio(app, cookie),
      await pedir(app, 'put', '/api/sesion/contrasena', cookie, { contrasenaActual: CLAVE, contrasenaNueva: NUEVA }),
      await verificar(app, cookie, '123456'),
    ];
    for (const res of bloqueadas) {
      expect(res.status).toBe(403);
      expect(res.body.error.codigo).toBe('debe_activar_segundo_factor');
    }
    expect((await consultarSesion(app, cookie)).status).toBe(200);
    expect((await iniciarActivacion(app, cookie)).status).toBe(200);
    const cierre = await request(app).delete('/api/sesion').set('Origin', ORIGEN_APP).set('Cookie', cookie);
    expect(cierre.status).toBe(204);
    expect((await consultarSesion(app, cookie)).status).toBe(401);
  }, LARGA.timeout);

  it('con la contraseña temporal y sin TOTP: primero cambiar la contraseña y después activar', async () => {
    await crearCuenta('admin1', { debeCambiarContrasena: true });
    const { app } = await appConIdentidad();
    const { cookie, cuerpo } = await ingresar(app, 'admin1');

    expect(cuerpo).toMatchObject({ pasoPendiente: 'cambiar_contrasena' });
    for (const res of [await iniciarActivacion(app, cookie), await rutaDeNegocio(app, cookie)]) {
      expect(res.status).toBe(403);
      expect(res.body.error.codigo).toBe('debe_cambiar_contrasena');
    }
    const cambio = await pedir(app, 'put', '/api/sesion/contrasena', cookie, {
      contrasenaActual: CLAVE,
      contrasenaNueva: NUEVA,
    });
    expect(cambio.status).toBe(204);

    expect((await consultarSesion(app, cookie)).body).toMatchObject({ pasoPendiente: 'activar_segundo_factor' });
    const negocio = await rutaDeNegocio(app, cookie);
    expect(negocio.status).toBe(403);
    expect(negocio.body.error.codigo).toBe('debe_activar_segundo_factor');
    expect((await iniciarActivacion(app, cookie)).status).toBe(200);
  }, LARGA.timeout);

  it('con la contraseña temporal y TOTP activo: primero verificar, después cambiar la contraseña', async () => {
    const { secreto } = await crearCuenta('admin1', { totp: true, debeCambiarContrasena: true });
    const { app } = await appConIdentidad();
    const { cookie, cuerpo } = await ingresar(app, 'admin1');

    expect(cuerpo).toMatchObject({ pasoPendiente: 'verificar_segundo_factor' });
    const cambioAntes = await pedir(app, 'put', '/api/sesion/contrasena', cookie, {
      contrasenaActual: CLAVE,
      contrasenaNueva: NUEVA,
    });
    expect(cambioAntes.status).toBe(403);
    expect(cambioAntes.body.error.codigo).toBe('debe_verificar_segundo_factor');

    expect((await verificar(app, cookie, codigoTotp(secreto!, INICIO))).status).toBe(204);
    expect((await consultarSesion(app, cookie)).body).toMatchObject({
      segundoFactor: 'verificado',
      pasoPendiente: 'cambiar_contrasena',
    });
    const negocio = await rutaDeNegocio(app, cookie);
    expect(negocio.status).toBe(403);
    expect(negocio.body.error.codigo).toBe('debe_cambiar_contrasena');
    // Verificar otra vez ya no corresponde.
    expect((await verificar(app, cookie, codigoTotp(secreto!, INICIO))).body.error.codigo).toBe(
      'debe_cambiar_contrasena',
    );

    const cambio = await pedir(app, 'put', '/api/sesion/contrasena', cookie, {
      contrasenaActual: CLAVE,
      contrasenaNueva: NUEVA,
    });
    expect(cambio.status).toBe(204);
    expect((await rutaDeNegocio(app, cookie)).status).toBe(200);
  }, LARGA.timeout);

  it('una sesión nueva del mismo administrador vuelve a pedir el segundo factor', async () => {
    const { secreto } = await crearCuenta('admin1', { totp: true });
    const { app, reloj } = await appConIdentidad();
    const primera = await ingresar(app, 'admin1');
    expect((await verificar(app, primera.cookie, codigoTotp(secreto!, INICIO))).status).toBe(204);
    reloj.avanzar(2 * SEGUNDOS_PASO * 1000);

    const segunda = await ingresar(app, 'admin1');

    expect(segunda.cuerpo).toMatchObject({ segundoFactor: 'sin_verificar' });
    expect((await rutaDeNegocio(app, segunda.cookie)).status).toBe(403);
    expect((await rutaDeNegocio(app, primera.cookie)).status).toBe(200);
  }, LARGA.timeout);
});

describe('restablecer-2fa-admin (RNF-04)', () => {
  it('deja ultimoPasoTotp en null y el administrador vuelve al paso activar_segundo_factor', async () => {
    const { usuario, secreto } = await crearCuenta('admin1', { totp: true });
    const { app, reloj } = await appConIdentidad();
    const { cookie } = await ingresar(app, 'admin1');
    expect((await verificar(app, cookie, codigoTotp(secreto!, INICIO))).status).toBe(204);
    expect((await estadoDe(usuario.id)).ultimoPasoTotp).not.toBeNull();

    await restablecer2faAdmin({ db, reloj }, {});

    const fila = await estadoDe(usuario.id);
    expect(fila).toMatchObject({
      totpActivo: false,
      secretoTotpCifrado: null,
      ultimoPasoTotp: null,
      codigosRecuperacion: [],
    });
    expect((await consultarSesion(app, cookie)).status).toBe(401);
    const nueva = await ingresar(app, 'admin1');
    expect(nueva.cuerpo).toMatchObject({ segundoFactor: 'sin_activar', pasoPendiente: 'activar_segundo_factor' });
  }, LARGA.timeout);
});

describe('registros (RNF-08)', () => {
  it('ningún secreto, código ni hash aparece en el logger', async () => {
    const { usuario } = await crearCuenta('admin1');
    const { app, texto } = await appConIdentidad();
    const activa = await ingresar(app, 'admin1');
    const qr = (await iniciarActivacion(app, activa.cookie)).body.qr as string;
    const secreto = descifrarSecreto((await estadoDe(usuario.id)).secretoTotpCifrado!, clavePrueba, usuario.id);
    const codigoActivacion = codigoTotp(secreto, INICIO);
    expect((await confirmarActivacion(app, activa.cookie, codigoInvalido(secreto))).status).toBe(400);
    const confirmada = await confirmarActivacion(app, activa.cookie, codigoActivacion);
    const codigos = confirmada.body.codigosRecuperacion as string[];

    const otra = await ingresar(app, 'admin1');
    const invalido = codigoInvalido(secreto);
    expect((await verificar(app, otra.cookie, invalido)).status).toBe(403);
    expect((await verificar(app, otra.cookie, 'zzzzz-yyyyy')).status).toBe(403);
    expect((await verificar(app, otra.cookie, codigos[0]!)).status).toBe(204);
    const hashes = (await estadoDe(usuario.id)).codigosRecuperacion;

    const registrado = texto();
    expect(registrado.length).toBeGreaterThan(0);
    const sensibles = [
      secreto,
      qr,
      codigoActivacion,
      invalido,
      'zzzzz-yyyyy',
      ...codigos,
      ...hashes,
      hashCodigoRecuperacion(codigos[0]!),
      (await estadoDe(usuario.id)).secretoTotpCifrado!,
      CLAVE_CIFRADO_PRUEBA,
      CLAVE,
    ];
    for (const valor of sensibles) expect(registrado).not.toContain(valor);
  }, LARGA.timeout);
});

describe('el ingreso correcto y el límite por cuenta con segundo factor (RNF-02, RNF-04)', () => {
  it('administrador con TOTP: los fallos de código y de ingreso suman al mismo contador y cortan el ciclo', async () => {
    const { usuario, secreto } = await crearCuenta('admin1', { totp: true });
    const { app } = await appConIdentidad();
    const invalido = codigoInvalido(secreto!);
    let { cookie } = await ingresar(app, 'admin1');

    for (let i = 0; i < 4; i += 1) expect((await verificar(app, cookie, invalido)).status).toBe(403);
    expect((await estadoDe(usuario.id)).ingresosFallidos).toBe(4);
    // Ingresar de nuevo con la contraseña correcta no reinicia el contador.
    ({ cookie } = await ingresar(app, 'admin1'));
    expect((await estadoDe(usuario.id)).ingresosFallidos).toBe(4);

    expect((await verificar(app, cookie, invalido)).status).toBe(403);
    expect((await estadoDe(usuario.id)).bloqueadoHasta).not.toBeNull();
    const rechazado = await request(app)
      .post('/api/sesion')
      .set('Origin', ORIGEN_APP)
      .set('X-Forwarded-For', ipNueva())
      .send({ nombreUsuario: 'admin1', contrasena: CLAVE });
    expect(rechazado.status).toBe(401);
  }, LARGA.timeout);

  it('tras verificar con éxito el contador queda en 0', async () => {
    const { usuario, secreto } = await crearCuenta('admin1', { totp: true });
    const { app } = await appConIdentidad();
    const { cookie } = await ingresar(app, 'admin1');
    for (let i = 0; i < 3; i += 1) await verificar(app, cookie, codigoInvalido(secreto!));
    expect((await estadoDe(usuario.id)).ingresosFallidos).toBe(3);

    expect((await verificar(app, cookie, codigoTotp(secreto!, INICIO))).status).toBe(204);

    const fila = await estadoDe(usuario.id);
    expect(fila).toMatchObject({ ingresosFallidos: 0, bloqueadoHasta: null, bloqueosConsecutivos: 0 });
  }, LARGA.timeout);

  it.each<[string, Rol, boolean]>([
    ['secretaria', 'secretaria', false],
    ['kinesiólogo', 'kinesiologo', false],
    ['administrador sin TOTP activo', 'administrador', false],
  ])('%s: el ingreso correcto sigue reiniciando el contador', async (_nombre, rol, totp) => {
    const { usuario } = await crearCuenta('persona1', { rol, totp });
    await db.usuario.update({ where: { id: usuario.id }, data: { ingresosFallidos: 3 } });
    const { app } = await appConIdentidad();

    await ingresar(app, 'persona1');

    expect((await estadoDe(usuario.id)).ingresosFallidos).toBe(0);
  }, LARGA.timeout);
});

describe('códigos de recuperación distintos a la vez (RNF-04)', () => {
  it('dos códigos distintos en paralelo: los dos verifican y los dos desaparecen de la lista', async () => {
    const { usuario } = await crearCuenta('admin1', { totp: true });
    const { app } = await appConIdentidad();
    const a = await ingresar(app, 'admin1');
    const b = await ingresar(app, 'admin1');

    const respuestas = await Promise.all([
      verificar(app, a.cookie, CODIGOS_RECUPERACION[0]!),
      verificar(app, b.cookie, CODIGOS_RECUPERACION[1]!),
    ]);

    expect(respuestas.map((r) => r.status)).toEqual([204, 204]);
    expect((await estadoDe(usuario.id)).codigosRecuperacion).toEqual([
      hashCodigoRecuperacion(CODIGOS_RECUPERACION[2]!),
    ]);
  }, LARGA.timeout);
});

describe('el ingreso del administrador con TOTP toma la fila de la cuenta (RF-07, RF-08, RNF-02)', () => {
  it('un cambio de contraseña sin confirmar frena al ingreso con la contraseña vieja, que termina rechazado y sin sesión', async () => {
    const { usuario } = await crearCuenta('admin1', { totp: true });
    const { app } = await appConIdentidad();
    const hashNuevo = await hashearContrasena('otra-clave-de-prueba-larga');
    let confirmar!: () => void;
    const puedeConfirmar = new Promise<void>((resolver) => {
      confirmar = resolver;
    });
    let tomada!: () => void;
    const filaTomada = new Promise<void>((resolver) => {
      tomada = resolver;
    });
    // Otra conexión: cambia el hash y mantiene la transacción abierta (la fila queda bloqueada).
    const transaccion = db.$transaction(async (tx) => {
      await tx.usuario.update({ where: { id: usuario.id }, data: { hashContrasena: hashNuevo } });
      tomada();
      await puedeConfirmar;
    });
    await filaTomada;

    let terminado = false;
    const ingreso = request(app)
      .post('/api/sesion')
      .set('Origin', ORIGEN_APP)
      .set('X-Forwarded-For', ipNueva())
      .send({ nombreUsuario: 'admin1', contrasena: CLAVE })
      .then((res) => {
        terminado = true;
        return res;
      });
    await new Promise((resolver) => setTimeout(resolver, 800));
    expect(terminado).toBe(false);

    confirmar();
    await transaccion;
    const res = await ingreso;

    expect(res.status).toBe(401);
    expect(await sesionesDe(usuario.id)).toHaveLength(0);
  }, LARGA.timeout);
});
