import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { cargarConfiguracion } from '../../src/comun/configuracion.js';
import { RelojFijo } from '../../src/comun/reloj.js';
import type { Rol } from '../../src/generado/prisma/client.js';
import { hashearContrasena } from '../../src/modulos/m1-identidad/contrasenas.js';
import { crearRutas } from '../../src/rutas.js';
import { ENTORNO_PRUEBA, loggerCapturado, ORIGEN_APP } from '../ayudantes.js';
import { db } from './base.js';
import { AHORA, crearUsuario, ingresarComoAdministradorVerificado } from './fabricas.js';

const CLAVE = 'clave-de-prueba-larga';
const ERROR_NO_AUTORIZADO = {
  error: {
    codigo: 'no_autorizado',
    mensaje: 'No estás autorizado para realizar esta acción.',
  },
};
const ORIGINAL = {
  nombre: 'Consultorio Ficticio',
  direccion: 'Calle Falsa 123',
  telefono: '11 5555 0000',
};
const NUEVOS = {
  nombre: 'Kinesiología Ficticia Sur',
  direccion: 'Avenida Inventada 456',
  telefono: '11 5555 1111',
};

// Argon2 es lento a propósito: se calcula una vez y se reutiliza en todas las pruebas.
const hashClave = hashearContrasena(CLAVE);

async function crearAppDePrueba() {
  const config = cargarConfiguracion({
    ...ENTORNO_PRUEBA,
    COOKIE_SECURE: 'false',
  });
  const reloj = new RelojFijo(AHORA);
  const capturado = loggerCapturado();
  const rutas = await crearRutas({ db, reloj, config });
  return {
    app: crearApp({ config, logger: capturado.logger, reloj, rutas }),
    ...capturado,
  };
}
type App = Awaited<ReturnType<typeof crearAppDePrueba>>['app'];

/** Cuenta ficticia del rol, con sesión abierta; devuelve la cabecera `Cookie`. */
async function ingresarComo(app: App, rol: Rol): Promise<string> {
  if (rol === 'administrador') return (await ingresarComoAdministradorVerificado(app)).cookie;
  const nombreUsuario = `ficticio-${rol}`;
  await crearUsuario({ rol, nombreUsuario, hashContrasena: await hashClave });
  const res = await request(app)
    .post('/api/sesion')
    .set('Origin', ORIGEN_APP)
    .send({ nombreUsuario, contrasena: CLAVE });
  expect(res.status).toBe(200);
  return (res.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
}

const instalar = () => db.consultorio.create({ data: { id: 1, ...ORIGINAL } });
const leer = (app: App, cookie?: string) => {
  const peticion = request(app).get('/api/consultorio');
  return cookie ? peticion.set('Cookie', cookie) : peticion;
};
const editar = (app: App, cookie: string | undefined, cuerpo: unknown) => {
  const peticion = request(app).put('/api/consultorio').set('Origin', ORIGEN_APP);
  return (cookie ? peticion.set('Cookie', cookie) : peticion).send(cuerpo as object);
};

describe('lectura del consultorio (RF-13)', () => {
  it.each(['secretaria', 'administrador'] as const)('%s lee nombre, dirección y teléfono', async (rol) => {
    const { app } = await crearAppDePrueba();
    await instalar();
    const cookie = await ingresarComo(app, rol);

    const res = await leer(app, cookie);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ consultorio: ORIGINAL });
  });

  it('el kinesiólogo recibe 403 y no ve ningún dato (D-16)', async () => {
    const { app } = await crearAppDePrueba();
    await instalar();
    const cookie = await ingresarComo(app, 'kinesiologo');

    const res = await leer(app, cookie);

    expect(res.status).toBe(403);
    expect(res.body).toEqual(ERROR_NO_AUTORIZADO);
  });

  it('sin sesión recibe 401', async () => {
    const { app } = await crearAppDePrueba();
    await instalar();

    const res = await leer(app);

    expect(res.status).toBe(401);
  });

  it('si la instalación no creó la fila, responde un error claro y no la crea', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = await ingresarComo(app, 'secretaria');

    const res = await leer(app, cookie);

    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe('consultorio_no_instalado');
    expect(JSON.stringify(res.body)).not.toMatch(/at .*\.ts|stack/i);
    await expect(db.consultorio.count()).resolves.toBe(0);
  });
});

describe('edición del consultorio (RF-13)', () => {
  it.each(['secretaria', 'administrador'] as const)('%s edita y la lectura posterior lo refleja', async (rol) => {
    const { app } = await crearAppDePrueba();
    await instalar();
    const cookie = await ingresarComo(app, rol);

    const res = await editar(app, cookie, NUEVOS);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ consultorio: NUEVOS });
    expect((await leer(app, cookie)).body).toEqual({ consultorio: NUEVOS });
    await expect(
      db.consultorio.findMany({
        select: { id: true, nombre: true, direccion: true, telefono: true },
      }),
    ).resolves.toEqual([{ id: 1, ...NUEVOS }]);
  });

  it('guarda los textos sin espacios en los extremos', async () => {
    const { app } = await crearAppDePrueba();
    await instalar();
    const cookie = await ingresarComo(app, 'secretaria');

    const res = await editar(app, cookie, {
      nombre: `  ${NUEVOS.nombre} `,
      direccion: ` ${NUEVOS.direccion}`,
      telefono: `${NUEVOS.telefono}  `,
    });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ consultorio: NUEVOS });
  });

  it('el kinesiólogo recibe 403 y no se modifica nada', async () => {
    const { app } = await crearAppDePrueba();
    await instalar();
    const cookie = await ingresarComo(app, 'kinesiologo');

    const res = await editar(app, cookie, NUEVOS);

    expect(res.status).toBe(403);
    expect(res.body).toEqual(ERROR_NO_AUTORIZADO);
    await expect(db.consultorio.findUniqueOrThrow({ where: { id: 1 } })).resolves.toMatchObject(ORIGINAL);
  });

  it('sin sesión recibe 401 y no se modifica nada', async () => {
    const { app } = await crearAppDePrueba();
    await instalar();

    const res = await editar(app, undefined, NUEVOS);

    expect(res.status).toBe(401);
    await expect(db.consultorio.findUniqueOrThrow({ where: { id: 1 } })).resolves.toMatchObject(ORIGINAL);
  });

  it('si la fila no existe responde 409 y no la crea desde la API', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = await ingresarComo(app, 'secretaria');

    const res = await editar(app, cookie, NUEVOS);

    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe('consultorio_no_instalado');
    await expect(db.consultorio.count()).resolves.toBe(0);
  });

  describe('datos inválidos: 400 y sin cambios', () => {
    const casos: [string, unknown][] = [
      ['sin nombre', { direccion: NUEVOS.direccion, telefono: NUEVOS.telefono }],
      ['sin dirección', { nombre: NUEVOS.nombre, telefono: NUEVOS.telefono }],
      ['sin teléfono', { nombre: NUEVOS.nombre, direccion: NUEVOS.direccion }],
      ['nombre vacío', { ...NUEVOS, nombre: '' }],
      ['dirección solo espacios', { ...NUEVOS, direccion: '   ' }],
      ['teléfono solo espacios', { ...NUEVOS, telefono: ' \t ' }],
      ['nombre demasiado largo', { ...NUEVOS, nombre: 'a'.repeat(121) }],
      ['dirección demasiado larga', { ...NUEVOS, direccion: 'a'.repeat(201) }],
      ['teléfono demasiado largo', { ...NUEVOS, telefono: '1'.repeat(41) }],
      ['carácter NUL en el nombre', { ...NUEVOS, nombre: 'Consultorio\u0000' }],
      ['tipo incorrecto', { ...NUEVOS, telefono: 1155551111 }],
      ['cuerpo vacío', {}],
    ];

    it.each(casos)('%s', async (_nombre, cuerpo) => {
      const { app } = await crearAppDePrueba();
      await instalar();
      const cookie = await ingresarComo(app, 'secretaria');

      const res = await editar(app, cookie, cuerpo);

      expect(res.status).toBe(400);
      expect(res.body.error.codigo).toBe('datos_invalidos');
      await expect(db.consultorio.findUniqueOrThrow({ where: { id: 1 } })).resolves.toMatchObject(ORIGINAL);
    });
  });

  it('un id en el cuerpo se ignora: la fila única no se desdobla', async () => {
    const { app } = await crearAppDePrueba();
    await instalar();
    const cookie = await ingresarComo(app, 'secretaria');

    const res = await editar(app, cookie, { ...NUEVOS, id: 2 });

    expect(res.status).toBe(200);
    await expect(db.consultorio.findMany()).resolves.toEqual([{ id: 1, ...NUEVOS }]);
  });

  it('no registra nombre, dirección ni teléfono en los logs', async () => {
    const { app, texto } = await crearAppDePrueba();
    await instalar();
    const cookie = await ingresarComo(app, 'secretaria');

    await editar(app, cookie, NUEVOS);
    await leer(app, cookie);

    const registro = texto();
    expect(registro).not.toContain(NUEVOS.nombre);
    expect(registro).not.toContain(NUEVOS.direccion);
    expect(registro).not.toContain(NUEVOS.telefono);
  });
});
