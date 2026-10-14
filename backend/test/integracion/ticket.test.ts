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
import {
  AHORA,
  crearKinesiologo,
  crearPaciente,
  crearTurno,
  crearUsuario,
  ingresarComoAdministradorVerificado,
} from './fabricas.js';
import { decodificarQrDelPdf, textoDelPdf } from './qrDelPdf.js';

const CLAVE = 'clave-de-prueba-larga';
const hashClave = hashearContrasena(CLAVE);

const CONSULTORIO = { nombre: 'Consultorio Ficticio', direccion: 'Calle Falsa 123', telefono: '11 4000 0000' };

async function crearAppDePrueba() {
  const config = cargarConfiguracion({ ...ENTORNO_PRUEBA, COOKIE_SECURE: 'false' });
  const reloj = new RelojFijo(AHORA);
  const capturado = loggerCapturado();
  const rutas = await crearRutas({ db, reloj, config });
  return { app: crearApp({ config, logger: capturado.logger, reloj, rutas }), ...capturado };
}
type App = Awaited<ReturnType<typeof crearAppDePrueba>>['app'];

async function ingresarComo(app: App, rol: Rol): Promise<string> {
  if (rol === 'administrador') return (await ingresarComoAdministradorVerificado(app)).cookie;
  const nombreUsuario = `ficticio-${rol}`;
  await crearUsuario({ rol, nombreUsuario, hashContrasena: await hashClave });
  const res = await request(app).post('/api/sesion').set('Origin', ORIGEN_APP).send({ nombreUsuario, contrasena: CLAVE });
  expect(res.status).toBe(200);
  return (res.headers['set-cookie'] as string[] | undefined)?.[0]?.split(';')[0] ?? '';
}

/** Descarga binaria: se junta el cuerpo en un Buffer. */
const pedir = (app: App, id: number | string, cookie?: string) =>
  request(app)
    .get(`/api/turnos/${id}/ticket`)
    .set(cookie ? { Origin: ORIGEN_APP, Cookie: cookie } : { Origin: ORIGEN_APP })
    .buffer(true)
    .parse((res, devolver) => {
      const partes: Buffer[] = [];
      res.on('data', (parte: Buffer) => partes.push(parte));
      res.on('end', () => devolver(null, Buffer.concat(partes)));
    });

async function fijarConsultorio(datos = CONSULTORIO) {
  await db.consultorio.upsert({ where: { id: 1 }, create: { id: 1, ...datos }, update: datos });
}

async function escenario() {
  await fijarConsultorio();
  const paciente = await crearPaciente({ dni: '90123456', nombre: 'Ñandú Pérez' });
  await db.paciente.update({ where: { id: paciente.id }, data: { obraSocial: 'Obra Social Ficticia' } });
  const kinesiologo = await crearKinesiologo();
  const turno = await crearTurno({ pacienteId: paciente.id, kinesiologoId: kinesiologo.id, fecha: '2026-10-19' });
  await db.turno.update({
    where: { id: turno.id },
    data: { coseguroObraSocial: '7777.77', coseguroAdicional: '8888.88' },
  });
  return { paciente, kinesiologo, turno };
}

const textoEsperado = (id: number, paciente: string, kinesiologo: string, fechaHora: string) =>
  `Turno N° ${id}\nPaciente: ${paciente}\nKinesiólogo: ${kinesiologo}\nFecha y hora: ${fechaHora}`;

describe('ticket con QR (RF-28)', () => {
  it('responde el PDF con las cabeceras previstas y sin datos personales en el nombre', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = await ingresarComo(app, 'secretaria');
    const { turno } = await escenario();

    const res = await pedir(app, turno.id, cookie);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe(`attachment; filename="turno-${turno.id}.pdf"`);
    expect(res.headers['cache-control']).toBe('no-store');
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('el QR del PDF lleva número de turno, paciente, kinesiólogo, fecha y hora', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = await ingresarComo(app, 'administrador');
    const { turno, kinesiologo } = await escenario();

    const res = await pedir(app, turno.id, cookie);

    expect(res.status).toBe(200);
    expect(decodificarQrDelPdf(res.body as Buffer)).toBe(
      textoEsperado(turno.id, 'Ñandú Pérez', kinesiologo.nombre, 'lunes 19/10/2026, 08:00'),
    );
  });

  it('el QR no contiene el DNI, los coseguros ni la obra social', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = await ingresarComo(app, 'secretaria');
    const { turno } = await escenario();

    const qr = decodificarQrDelPdf((await pedir(app, turno.id, cookie)).body as Buffer);

    for (const prohibido of ['90123456', '7777', '8888', 'Obra Social Ficticia']) {
      expect(qr).not.toContain(prohibido);
    }
  });

  it('usa los datos vigentes del consultorio en cada pedido, antes y después de cambiarlos', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = await ingresarComo(app, 'secretaria');
    const { turno } = await escenario();

    const antes = textoDelPdf((await pedir(app, turno.id, cookie)).body as Buffer);
    expect(antes).toContain('Consultorio Ficticio');
    expect(antes).toContain('Calle Falsa 123');
    expect(antes).toContain('11 4000 0000');

    await fijarConsultorio({ nombre: 'Consultorio Renovado', direccion: 'Avenida Nueva 456', telefono: '11 5000 1111' });
    const despues = (await pedir(app, turno.id, cookie)).body as Buffer;
    const textoDespues = textoDelPdf(despues);
    expect(textoDespues).toContain('Consultorio Renovado');
    expect(textoDespues).toContain('Avenida Nueva 456');
    expect(textoDespues).toContain('11 5000 1111');
    expect(textoDespues).not.toContain('Consultorio Ficticio');
    // El QR del turno sigue legible tras el cambio.
    expect(decodificarQrDelPdf(despues)).toContain(`Turno N° ${turno.id}`);
  });

  it('el PDF repite en texto legible los datos del turno, con tildes y eñes', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = await ingresarComo(app, 'secretaria');
    const { turno, kinesiologo } = await escenario();

    const texto = textoDelPdf((await pedir(app, turno.id, cookie)).body as Buffer);

    expect(texto).toContain(`Turno N° ${turno.id}`);
    expect(texto).toContain('Paciente: Ñandú Pérez');
    expect(texto).toContain(`Kinesiólogo: ${kinesiologo.nombre}`);
    expect(texto).toContain('Fecha y hora: lunes 19/10/2026, 08:00');
    expect(texto).not.toContain('90123456');
  });

  it('tras reprogramar, el QR lleva la fecha y la hora nuevas', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = await ingresarComo(app, 'secretaria');
    const { turno, kinesiologo } = await escenario();
    const antes = decodificarQrDelPdf((await pedir(app, turno.id, cookie)).body as Buffer);
    expect(antes).toBe(textoEsperado(turno.id, 'Ñandú Pérez', kinesiologo.nombre, 'lunes 19/10/2026, 08:00'));

    // T-24 (reprogramar por la API) todavía no existe: se simula moviendo el turno con Prisma.
    // Cuando T-24 exista, agrega el mismo caso reprogramando por la API.
    await db.turno.update({ where: { id: turno.id }, data: { fecha: new Date('2026-10-22'), horaInicio: '09:30' } });

    const despues = decodificarQrDelPdf((await pedir(app, turno.id, cookie)).body as Buffer);
    expect(despues).toBe(textoEsperado(turno.id, 'Ñandú Pérez', kinesiologo.nombre, 'jueves 22/10/2026, 09:30'));
  });

  it('el kinesiólogo recibe 403 y no se genera el ticket', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = await ingresarComo(app, 'kinesiologo');
    const { turno } = await escenario();

    const res = await pedir(app, turno.id, cookie);

    expect(res.status).toBe(403);
    expect(res.headers['content-type']).not.toContain('application/pdf');
  });

  it('sin sesión responde 401', async () => {
    const { app } = await crearAppDePrueba();
    const { turno } = await escenario();
    expect((await pedir(app, turno.id)).status).toBe(401);
  });

  it('un turno inexistente responde 404 y un identificador mal formado, 400', async () => {
    const { app } = await crearAppDePrueba();
    const cookie = await ingresarComo(app, 'secretaria');
    await escenario();

    expect((await pedir(app, 999999, cookie)).status).toBe(404);
    expect((await pedir(app, 'abc', cookie)).status).toBe(400);
  });

  it('ni el nombre del paciente ni el contenido del ticket pasan por los logs', async () => {
    const { app, texto } = await crearAppDePrueba();
    const cookie = await ingresarComo(app, 'secretaria');
    const { turno } = await escenario();

    await pedir(app, turno.id, cookie);

    const registro = texto();
    expect(registro).toContain('/api/turnos');
    for (const prohibido of ['Ñandú', 'Pérez', 'Consultorio Ficticio', 'Calle Falsa', '90123456']) {
      expect(registro).not.toContain(prohibido);
    }
  });
});
