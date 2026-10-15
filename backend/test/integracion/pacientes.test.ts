import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { crearApp } from '../../src/app.js';
import { cargarConfiguracion } from '../../src/comun/configuracion.js';
import { RelojFijo } from '../../src/comun/reloj.js';
import { crearRutas } from '../../src/rutas.js';
import { ENTORNO_PRUEBA, loggerCapturado, ORIGEN_APP } from '../ayudantes.js';
import { db } from './base.js';
import { AHORA, crearPaciente, ingresarComo } from './fabricas.js';

const ERROR_NO_AUTORIZADO = {
  error: {
    codigo: 'no_autorizado',
    mensaje: 'No estás autorizado para realizar esta acción.',
  },
};
const ALTA = {
  dni: '90.123.456',
  nombre: 'Marta Ficticia Pérez',
  telefono: '11 5555 0101',
  obraSocial: 'Obra Ficticia',
};

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

const conCookie = (cookie?: string) => (cookie ? { Origin: ORIGEN_APP, Cookie: cookie } : { Origin: ORIGEN_APP });
const alta = (app: App, cookie: string | undefined, cuerpo: unknown) =>
  request(app)
    .post('/api/pacientes')
    .set(conCookie(cookie))
    .send(cuerpo as object);
const editar = (app: App, cookie: string | undefined, id: number | string, cuerpo: unknown) =>
  request(app)
    .put(`/api/pacientes/${id}`)
    .set(conCookie(cookie))
    .send(cuerpo as object);
const ficha = (app: App, cookie: string | undefined, id: number | string) =>
  request(app).get(`/api/pacientes/${id}`).set(conCookie(cookie));
const buscar = (app: App, cookie: string | undefined, consulta: string) =>
  request(app).get(`/api/pacientes${consulta}`).set(conCookie(cookie));

describe('alta de paciente (RF-17, RF-18)', () => {
  it('guarda el DNI normalizado y devuelve el paciente; "Particular" lo manda el cliente', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;

    const res = await alta(app, cookie, { ...ALTA, obraSocial: 'Particular' });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      paciente: {
        id: expect.any(Number),
        dni: '90123456',
        nombre: ALTA.nombre,
        telefono: ALTA.telefono,
        obraSocial: 'Particular',
      },
    });
    expect(
      await db.paciente.findUniqueOrThrow({
        where: { id: res.body.paciente.id },
      }),
    ).toMatchObject({
      dni: '90123456',
    });
  });

  it('el administrador también puede dar de alta', async () => {
    const { app } = await crearAppDePrueba();
    expect((await alta(app, (await ingresarComo(app, 'administrador')).cookie, ALTA)).status).toBe(201);
  });

  it('un DNI de 7 dígitos y uno con ceros a la izquierda son válidos', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;

    expect((await alta(app, cookie, { ...ALTA, dni: '9.123.456' })).body.paciente.dni).toBe('9123456');
    expect((await alta(app, cookie, { ...ALTA, dni: '0123456' })).body.paciente.dni).toBe('0123456');
  });

  it('el backend no completa la obra social: sin ella, 400', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;

    const res = await alta(app, cookie, { ...ALTA, obraSocial: undefined });

    expect(res.status).toBe(400);
    expect(await db.paciente.count()).toBe(0);
  });

  it('DNI ya registrado, aunque se escriba distinto: 409 dni_en_uso y no se crea nada', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;
    await crearPaciente({ dni: '90123456' });

    const res = await alta(app, cookie, ALTA);

    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe('dni_en_uso');
    expect(await db.paciente.count()).toBe(1);
  });

  it('dos altas simultáneas con el mismo DNI: una gana y la otra recibe 409', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;

    const [a, b] = await Promise.all([
      alta(app, cookie, ALTA),
      alta(app, cookie, { ...ALTA, dni: '90123456', nombre: 'Otra Ficticia' }),
    ]);

    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect([a, b].find((r) => r.status === 409)!.body.error.codigo).toBe('dni_en_uso');
    expect(await db.paciente.count()).toBe(1);
  });

  it.each([
    ['sin DNI', { ...ALTA, dni: undefined }],
    ['DNI de 6 dígitos', { ...ALTA, dni: '123456' }],
    ['DNI de 9 dígitos', { ...ALTA, dni: '123.456.789' }],
    ['DNI con letras', { ...ALTA, dni: '9012345a' }],
    ['DNI con guiones', { ...ALTA, dni: '90-123-456' }],
    ['DNI de ancho completo', { ...ALTA, dni: '９０１２３４５６' }],
    ['DNI numérico', { ...ALTA, dni: 90123456 }],
    ['sin nombre', { ...ALTA, nombre: undefined }],
    ['nombre vacío', { ...ALTA, nombre: '   ' }],
    ['sin teléfono', { ...ALTA, telefono: undefined }],
    ['teléfono vacío', { ...ALTA, telefono: '' }],
    ['obra social vacía', { ...ALTA, obraSocial: ' ' }],
    ['NUL en el nombre', { ...ALTA, nombre: 'Ana\u0000' }],
    ['cuerpo vacío', {}],
  ])('%s: 400 y no se crea nada', async (_caso, cuerpo) => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;

    const res = await alta(app, cookie, cuerpo);

    expect(res.status).toBe(400);
    expect(await db.paciente.count()).toBe(0);
  });

  it('el kinesiólogo recibe 403; sin sesión, 401; y no se crea nada', async () => {
    const { app } = await crearAppDePrueba();
    const kine = (await ingresarComo(app, 'kinesiologo')).cookie;

    const prohibido = await alta(app, kine, ALTA);
    const sinSesion = await alta(app, undefined, ALTA);

    expect(prohibido.status).toBe(403);
    expect(prohibido.body).toEqual(ERROR_NO_AUTORIZADO);
    expect(sinSesion.status).toBe(401);
    expect(await db.paciente.count()).toBe(0);
  });
});

describe('edición de paciente (RF-20)', () => {
  it('reemplaza los datos y normaliza el DNI', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;
    const { id } = await crearPaciente({ dni: '90000001' });

    const res = await editar(app, cookie, id, { ...ALTA, dni: '91.000.002' });

    expect(res.status).toBe(200);
    expect(res.body.paciente).toEqual({
      id,
      dni: '91000002',
      nombre: ALTA.nombre,
      telefono: ALTA.telefono,
      obraSocial: ALTA.obraSocial,
    });
    expect(await db.paciente.findUniqueOrThrow({ where: { id } })).toMatchObject({
      dni: '91000002',
      nombre: ALTA.nombre,
    });
  });

  it('guardar el propio DNI, aunque escrito con puntos, no es conflicto', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;
    const { id } = await crearPaciente({ dni: '90123456' });

    const res = await editar(app, cookie, id, {
      ...ALTA,
      telefono: '11 5555 9999',
    });

    expect(res.status).toBe(200);
    expect(res.body.paciente).toMatchObject({
      dni: '90123456',
      telefono: '11 5555 9999',
    });
  });

  it('el DNI de otro paciente: 409 dni_en_uso y los datos no cambian', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;
    const { id } = await crearPaciente({ dni: '90000001' });
    await crearPaciente({ dni: '90123456' });

    const res = await editar(app, cookie, id, ALTA);

    expect(res.status).toBe(409);
    expect(res.body.error.codigo).toBe('dni_en_uso');
    expect(await db.paciente.findUniqueOrThrow({ where: { id } })).toMatchObject({
      dni: '90000001',
    });
  });

  it.each([
    ['DNI de 6 dígitos', { ...ALTA, dni: '123456' }],
    ['DNI de 9 dígitos', { ...ALTA, dni: '123456789' }],
    ['DNI con letras', { ...ALTA, dni: 'ABC12345' }],
    ['sin DNI', { ...ALTA, dni: undefined }],
    ['nombre vacío', { ...ALTA, nombre: '' }],
    ['sin teléfono', { ...ALTA, telefono: undefined }],
    ['sin obra social', { ...ALTA, obraSocial: undefined }],
  ])('%s: 400 y no cambia nada', async (_caso, cuerpo) => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;
    const { id } = await crearPaciente({ dni: '90000001' });
    const antes = await db.paciente.findUniqueOrThrow({ where: { id } });

    const res = await editar(app, cookie, id, cuerpo);

    expect(res.status).toBe(400);
    expect(await db.paciente.findUniqueOrThrow({ where: { id } })).toEqual(antes);
  });

  it('paciente inexistente: 404; id mal formado: 400', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;

    const inexistente = await editar(app, cookie, 99999, ALTA);
    const malFormado = await editar(app, cookie, 'abc', ALTA);

    expect(inexistente.status).toBe(404);
    expect(inexistente.body.error.codigo).toBe('paciente_no_encontrado');
    expect(malFormado.status).toBe(400);
  });

  it('el kinesiólogo recibe 403; sin sesión, 401; y no cambia nada', async () => {
    const { app } = await crearAppDePrueba();
    const kine = (await ingresarComo(app, 'kinesiologo')).cookie;
    const { id } = await crearPaciente({ dni: '90000001' });

    expect((await editar(app, kine, id, ALTA)).status).toBe(403);
    expect((await editar(app, undefined, id, ALTA)).status).toBe(401);
    expect(await db.paciente.findUniqueOrThrow({ where: { id } })).toMatchObject({
      dni: '90000001',
    });
  });
});

describe('ficha del paciente (RF-21)', () => {
  it('devuelve los datos de M2', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;
    const p = await crearPaciente({ dni: '90000001' });

    const res = await ficha(app, cookie, p.id);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      paciente: {
        id: p.id,
        dni: '90000001',
        nombre: p.nombre,
        telefono: p.telefono,
        obraSocial: p.obraSocial,
      },
    });
  });

  it('inexistente: 404; mal formado: 400; kinesiólogo: 403; sin sesión: 401', async () => {
    const { app } = await crearAppDePrueba();
    const secretaria = (await ingresarComo(app, 'secretaria')).cookie;
    const kine = (await ingresarComo(app, 'kinesiologo')).cookie;
    const p = await crearPaciente();

    expect((await ficha(app, secretaria, 99999)).status).toBe(404);
    expect((await ficha(app, secretaria, 'x')).status).toBe(400);
    const prohibido = await ficha(app, kine, p.id);
    expect(prohibido.status).toBe(403);
    expect(prohibido.body).toEqual(ERROR_NO_AUTORIZADO);
    expect((await ficha(app, undefined, p.id)).status).toBe(401);
  });
});

describe('búsqueda de pacientes (RF-19, RF-21)', () => {
  it.each(['30123456', '30.123.456', '30 123 456'])('por DNI exacto: %j encuentra al paciente', async (dni) => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;
    const p = await crearPaciente({ dni: '30123456' });
    await crearPaciente({ dni: '30123457' });

    const res = await buscar(app, cookie, `?dni=${encodeURIComponent(dni)}`);

    expect(res.status).toBe(200);
    expect(res.body.pacientes).toEqual([
      {
        id: p.id,
        dni: '30123456',
        nombre: p.nombre,
        telefono: p.telefono,
        obraSocial: p.obraSocial,
      },
    ]);
  });

  it('por DNI inexistente: 200 con lista vacía (ofrece el alta)', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'administrador')).cookie;
    await crearPaciente({ dni: '30123456' });

    const res = await buscar(app, cookie, '?dni=30123450');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pacientes: [] });
  });

  it('el DNI es exacto: un prefijo no encuentra nada', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;
    await crearPaciente({ dni: '30123456' });

    expect((await buscar(app, cookie, '?dni=3012345')).body.pacientes).toEqual([]);
  });

  it.each(['123456', '123456789', 'abcdefgh', '30-123-456', '', '%20%20'])(
    'DNI de formato inválido %j: 400, no "sin resultados"',
    async (dni) => {
      const { app } = await crearAppDePrueba();
      const cookie = (await ingresarComo(app, 'secretaria')).cookie;

      const res = await buscar(app, cookie, `?dni=${dni}`);

      expect(res.status).toBe(400);
      expect(res.body.error.codigo).toBe('datos_invalidos');
    },
  );

  it('por nombre: parcial, sin distinguir mayúsculas y ordenado por nombre', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;
    await crearPaciente({ nombre: 'Zulema Gómez' });
    await crearPaciente({ nombre: 'Ana Gómez' });
    await crearPaciente({ nombre: 'Luis Pérez' });

    const res = await buscar(app, cookie, `?nombre=${encodeURIComponent('gÓm')}`);

    expect(res.status).toBe(200);
    expect(res.body.pacientes.map((p: { nombre: string }) => p.nombre)).toEqual(['Ana Gómez', 'Zulema Gómez']);
  });

  it('por nombre: sin coincidencias, lista vacía; los espacios de los costados se recortan', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;
    await crearPaciente({ nombre: 'Ana Gómez' });

    expect((await buscar(app, cookie, '?nombre=zzz')).body).toEqual({
      pacientes: [],
    });
    const recortada = await buscar(app, cookie, '?nombre=%20%20g%C3%B3mez%20');
    expect(recortada.body.pacientes).toHaveLength(1);
  });

  it('por nombre: los comodines de LIKE se buscan como texto', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;
    await crearPaciente({ nombre: 'Ana Gómez' });
    await crearPaciente({ nombre: '100% Ficticio' });

    expect((await buscar(app, cookie, '?nombre=%25%25%25')).body.pacientes).toEqual([]);
    expect((await buscar(app, cookie, '?nombre=___')).body.pacientes).toEqual([]);
    expect((await buscar(app, cookie, '?nombre=%5C%5C%5C')).body.pacientes).toEqual([]);
    expect((await buscar(app, cookie, '?nombre=100%25')).body.pacientes).toHaveLength(1);
  });

  it('por nombre: mínimo de 3 caracteres y tope de 20 resultados', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;
    for (let i = 0; i < 25; i++) await crearPaciente({ nombre: `Ficticio ${String(i).padStart(2, '0')}` });

    expect((await buscar(app, cookie, '?nombre=Fi')).status).toBe(400);
    expect((await buscar(app, cookie, '?nombre=%20a%20')).status).toBe(400);
    const res = await buscar(app, cookie, '?nombre=ficticio');
    expect(res.status).toBe(200);
    expect(res.body.pacientes).toHaveLength(20);
    expect(res.body.pacientes[0].nombre).toBe('Ficticio 00');
  });

  it.each(['', '?dni=30123456&nombre=Ana', '?nombre=', '?otro=1'])(
    'consulta %j sin exactamente uno de dni y nombre: 400',
    async (consulta) => {
      const { app } = await crearAppDePrueba();
      const cookie = (await ingresarComo(app, 'secretaria')).cookie;

      expect((await buscar(app, cookie, consulta)).status).toBe(400);
    },
  );

  it('el kinesiólogo recibe 403 aunque la consulta sea inválida; sin sesión, 401', async () => {
    const { app } = await crearAppDePrueba();
    const kine = (await ingresarComo(app, 'kinesiologo')).cookie;
    await crearPaciente({ dni: '30123456' });

    for (const consulta of ['?dni=30123456', '?nombre=Ficticio', '']) {
      const res = await buscar(app, kine, consulta);
      expect(res.status).toBe(403);
      expect(res.body).toEqual(ERROR_NO_AUTORIZADO);
    }
    expect((await buscar(app, undefined, '?dni=30123456')).status).toBe(401);
  });
});

describe('datos sensibles fuera de los logs (CLAUDE.md)', () => {
  it('ni el alta, ni la edición, ni las búsquedas, ni los errores registran DNI, nombre, teléfono u obra social', async () => {
    const { app, texto } = await crearAppDePrueba();
    const cookie = (await ingresarComo(app, 'secretaria')).cookie;

    const creada = await alta(app, cookie, ALTA);
    await editar(app, cookie, creada.body.paciente.id, {
      ...ALTA,
      dni: '90.123.457',
    });
    await alta(app, cookie, { ...ALTA, dni: '90123457' }); // 409
    await alta(app, cookie, { ...ALTA, dni: '90123' }); // 400
    await buscar(app, cookie, '?dni=90.123.457');
    await buscar(app, cookie, '?dni=90123999');
    await buscar(app, cookie, '?dni=9012');
    await buscar(app, cookie, '?nombre=Marta%20Fict');
    await ficha(app, cookie, creada.body.paciente.id);

    const registro = texto();
    expect(registro).toContain('/api/pacientes'); // las peticiones sí se registran, solo la ruta
    const secretos = ['90123456', '90.123.456', '90123457', '90.123.457', '90123999', '9012', 'Marta', 'Ficticia'];
    for (const secreto of [...secretos, ALTA.telefono, 'Obra Ficticia', 'dni=', 'nombre=']) {
      expect(registro).not.toContain(secreto);
    }
  });
});
