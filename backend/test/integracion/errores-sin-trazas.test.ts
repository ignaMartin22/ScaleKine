import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  armarEntorno,
  baseQueFalla,
  CATALOGO,
  cookieDe,
  errorDePrismaConDatos,
  pedirEntrada,
  prepararEscenario,
  rutasReales,
  verificarErrorSinTrazas,
  type Contexto,
  type Entrada,
  type Entorno,
  type Respuesta,
  type RolDePrueba,
  type RutaReal,
  type Sesiones,
} from './entornoSeguridad.js';

/**
 * T-34 · Ninguna respuesta de error contiene trazas (RNF-10, plan.md §4.15). Para cada ruta real:
 * pedidos mal formados, sin sesión, con cada rol y con un error interno forzado. En todos los casos
 * un error responde con el formato del manejador central (`{ error: { codigo, mensaje[, campos] } }`)
 * y sin `stack`, rutas de archivo, `node_modules`, mensajes de Prisma/PostgreSQL ni el texto del
 * error interno. Un pedido mal formado nunca debe terminar en un 5xx.
 */

let entorno: Entorno;
let contexto: Contexto;
let sesiones: Sesiones;

beforeAll(async () => {
  entorno = await armarEntorno();
});
afterAll(async () => {
  await entorno.cerrar();
});

const ROLES: RolDePrueba[] = ['administrador', 'secretaria', 'kinesiologo'];

const entradaDe = (ruta: RutaReal): Entrada => (CATALOGO[ruta.clave] ?? (() => ({ url: ruta.plantilla })))(contexto);

/** Rol con el que la ruta se prueba como "usuario legítimo": la agenda propia es del kinesiólogo. */
const rolLegitimo = (ruta: RutaReal): RolDePrueba => (ruta.plantilla === '/api/mi-agenda' ? 'kinesiologo' : 'administrador');

/** Cuerpos con tipos erróneos, NUL y claves peligrosas a partir de uno válido. */
function cuerposMalformados(base: Record<string, unknown>): { caso: string; cuerpo: unknown }[] {
  const casos: { caso: string; cuerpo: unknown }[] = [
    { caso: 'arreglo vacío', cuerpo: [] },
    { caso: 'null', cuerpo: null },
    { caso: 'texto', cuerpo: 'texto' },
    { caso: 'número', cuerpo: 42 },
    { caso: 'booleano', cuerpo: true },
    { caso: 'objeto vacío', cuerpo: {} },
    { caso: 'arreglo con el cuerpo', cuerpo: [base] },
    { caso: '__proto__', cuerpo: JSON.parse('{"__proto__":{"rol":"administrador"},"constructor":{"x":1}}') as unknown },
  ];
  const claves = Object.keys(base);
  for (const clave of claves) {
    for (const [nombre, malo] of [
      ['número', 12345],
      ['objeto', { x: 1 }],
      ['arreglo', [1, 2]],
      ['booleano', true],
      ['null', null],
      ['texto enorme', 'a'.repeat(5000)],
      ['NUL', 'a\u0000b'],
      ['negativo', -1],
      ['decimal enorme', 1e308],
    ] as const) {
      casos.push({ caso: `${clave} como ${nombre}`, cuerpo: { ...base, [clave]: malo } });
    }
  }
  if (claves.length > 0) {
    casos.push({ caso: 'todo NUL', cuerpo: Object.fromEntries(claves.map((c) => [c, 'a\u0000b'])) });
  }
  return casos;
}

const CAMINOS_MALOS = ['abc', '0', '-1', '99999999999', '%00', '1e3', '%ZZ', '%E0%A4%A', '..%2f..%2fetc', 'a'.repeat(3000)];

/** URLs mal formadas a partir de una válida: identificadores y valores de query erróneos. */
function urlsMalformadas(url: string): { caso: string; url: string }[] {
  const [camino = '', query = ''] = url.split('?');
  const casos: { caso: string; url: string }[] = [];
  if (/\/\d+(?=\/|$)/.test(camino)) {
    for (const malo of CAMINOS_MALOS) {
      casos.push({ caso: `id ${malo.slice(0, 12)}`, url: `${camino.replace(/\/\d+(?=\/|$)/, `/${malo}`)}${query ? `?${query}` : ''}` });
    }
  }
  const pares = query ? query.split('&').map((p) => p.split('=') as [string, string]) : [['dni', '1']];
  for (const [clave] of pares) {
    for (const [nombre, valor] of [
      ['NUL', '%00'],
      ['vacío', ''],
      ['enorme', 'a'.repeat(5000)],
      ['negativo', '-5'],
      ['percent roto', '%ZZ'],
    ] as const) {
      casos.push({ caso: `query ${clave}=${nombre}`, url: `${camino}?${clave}=${valor}` });
    }
    casos.push({ caso: `query ${clave}[]`, url: `${camino}?${clave}[]=1&${clave}[]=2` });
    casos.push({ caso: `query ${clave}[a]`, url: `${camino}?${clave}[a]=1` });
    casos.push({ caso: `query ${clave} repetido`, url: `${camino}?${clave}=1&${clave}=2` });
  }
  return casos;
}

/** Un pedido mal formado nunca es un 5xx; si es error, no tiene trazas. */
function exigirRechazoLimpio(res: Respuesta, quien: string): void {
  expect(res.status, `${quien} -> ${res.status} ${(res.text ?? '').slice(0, 160)}`).toBeLessThan(500);
  if (res.status >= 400) verificarErrorSinTrazas(res, quien);
}

describe('ninguna respuesta de error contiene trazas (RNF-10)', () => {
  it('sin sesión y con cada rol (401 y 403), en todas las rutas', async () => {
    ({ contexto, sesiones } = await prepararEscenario(entorno.app));
    const estados = new Set<number>();

    for (const ruta of rutasReales(entorno.app)) {
      const entrada = entradaDe(ruta);
      for (const rol of [null, ...ROLES]) {
        const res = await pedirEntrada(entorno, ruta, entrada, cookieDe(entrada, sesiones, rol));
        estados.add(res.status);
        if (res.status >= 400) verificarErrorSinTrazas(res, `${ruta.clave} como ${rol ?? 'sin sesión'}`);
      }
      // Cookie de una sesión que no existe.
      const falsa = await pedirEntrada(entorno, ruta, entrada, entrada.sinCookie ? undefined : 'sesion=token-que-no-existe');
      if (falsa.status >= 400) verificarErrorSinTrazas(falsa, `${ruta.clave} con sesión inexistente`);
    }

    expect([...estados]).toEqual(expect.arrayContaining([200, 401, 403]));
  }, 120_000);

  it('cuerpo con JSON inválido, demasiado grande o de otro tipo, en toda ruta de escritura', async () => {
    ({ contexto, sesiones } = await prepararEscenario(entorno.app));
    const estados = new Set<number>();

    for (const ruta of rutasReales(entorno.app).filter((r) => r.metodo !== 'get')) {
      const entrada = entradaDe(ruta);
      const cookie = cookieDe(entrada, sesiones, rolLegitimo(ruta));
      const casos: Record<string, Respuesta> = {
        'JSON truncado': await pedirEntrada(entorno, ruta, entrada, cookie, { crudo: '{"a":' }),
        'JSON con basura': await pedirEntrada(entorno, ruta, entrada, cookie, { crudo: '{"a":1}}}garbage' }),
        'JSON vacío': await pedirEntrada(entorno, ruta, entrada, cookie, { crudo: '' }),
        'JSON con NUL crudo': await pedirEntrada(entorno, ruta, entrada, cookie, { crudo: '{"a":"\u0000"}' }),
        'cuerpo de 150 kB': await pedirEntrada(entorno, ruta, entrada, cookie, {
          crudo: JSON.stringify({ relleno: 'x'.repeat(150_000) }),
        }),
        'cuerpo de 5 MB': await pedirEntrada(entorno, ruta, entrada, cookie, {
          crudo: JSON.stringify({ relleno: 'x'.repeat(5_000_000) }),
        }),
        'anidamiento profundo': await pedirEntrada(entorno, ruta, entrada, cookie, {
          crudo: `${'['.repeat(5000)}${']'.repeat(5000)}`,
        }),
        'texto plano': await request(entorno.url)
          .post(entrada.url)
          .set('Origin', 'http://localhost:4200')
          .set('Content-Type', 'text/plain')
          .set('Cookie', cookie ?? '')
          .send('dni=1&nombre=2'),
        'formulario': await request(entorno.url)
          [ruta.metodo](entrada.url)
          .set('Origin', 'http://localhost:4200')
          .set('Cookie', cookie ?? '')
          .type('form')
          .send('dni=1&nombre=2'),
      };
      for (const [caso, res] of Object.entries(casos)) {
        estados.add(res.status);
        exigirRechazoLimpio(res, `${ruta.clave} (${caso})`);
      }
    }

    expect([...estados]).toEqual(expect.arrayContaining([400, 413]));
  }, 180_000);

  it('tipos erróneos, NUL y claves peligrosas en cada campo de cada cuerpo', async () => {
    ({ contexto, sesiones } = await prepararEscenario(entorno.app));
    let total = 0;

    for (const ruta of rutasReales(entorno.app).filter((r) => r.metodo !== 'get' && CATALOGO[r.clave])) {
      const entrada = entradaDe(ruta);
      const cookie = cookieDe(entrada, sesiones, rolLegitimo(ruta));
      for (const { caso, cuerpo } of cuerposMalformados(entrada.cuerpo ?? {})) {
        const res = await pedirEntrada(entorno, ruta, entrada, cookie, { cuerpo });
        exigirRechazoLimpio(res, `${ruta.clave} (${caso})`);
        total += 1;
      }
    }

    expect(total).toBeGreaterThan(300);
  }, 300_000);

  it('identificadores y parámetros de consulta mal formados, en toda ruta', async () => {
    ({ contexto, sesiones } = await prepararEscenario(entorno.app));
    let total = 0;

    for (const ruta of rutasReales(entorno.app).filter((r) => CATALOGO[r.clave])) {
      const entrada = entradaDe(ruta);
      const cookie = cookieDe(entrada, sesiones, rolLegitimo(ruta));
      for (const { caso, url } of urlsMalformadas(entrada.url)) {
        const res = await pedirEntrada(entorno, ruta, { ...entrada, url }, cookie);
        exigirRechazoLimpio(res, `${ruta.clave} (${caso})`);
        total += 1;
      }
    }

    expect(total).toBeGreaterThan(150);
  }, 300_000);

  it('codificaciones y cabeceras raras: charset no soportado, compresión desconocida, URL con percent roto', async () => {
    ({ contexto, sesiones } = await prepararEscenario(entorno.app));
    const casos: Record<string, Respuesta> = {
      'charset utf-16': await request(entorno.url)
        .post('/api/pacientes')
        .set('Origin', 'http://localhost:4200')
        .set('Cookie', sesiones.secretaria)
        .set('Content-Type', 'application/json; charset=utf-16')
        .send('{"dni":"1"}'),
      'Content-Encoding desconocido': await request(entorno.url)
        .post('/api/pacientes')
        .set('Origin', 'http://localhost:4200')
        .set('Cookie', sesiones.secretaria)
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', 'br')
        .send('{"dni":"1"}'),
      'gzip corrupto': await request(entorno.url)
        .post('/api/pacientes')
        .set('Origin', 'http://localhost:4200')
        .set('Cookie', sesiones.secretaria)
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', 'gzip')
        .send('esto no es gzip'),
      'percent roto en la ruta': await request(entorno.url).get('/api/pacientes/%E0%A4%A').set('Cookie', sesiones.secretaria),
      'percent roto sin sesión': await request(entorno.url).get('/api/%ZZ'),
      'cookie enorme': await request(entorno.url).get('/api/sesion').set('Cookie', `sesion=${'a'.repeat(6000)}`),
      'cookie con NUL codificado': await request(entorno.url).get('/api/sesion').set('Cookie', 'sesion=a%00b'),
      'origen enorme': await request(entorno.url).post('/api/pacientes').set('Origin', `http://${'a'.repeat(5000)}.example`).send({}),
    };

    for (const [caso, res] of Object.entries(casos)) exigirRechazoLimpio(res, caso);
    // Son errores del cliente que Express y body-parser clasifican con su 4xx: no un fallo interno.
    expect(casos['Content-Encoding desconocido']?.status).toBe(415);
    expect(casos['charset utf-16']?.status).toBe(415);
    expect(casos['percent roto en la ruta']?.status).toBe(400);
    expect(casos['percent roto sin sesión']?.status).toBe(400);
    expect(casos['percent roto en la ruta']?.body).toEqual({
      error: { codigo: 'peticion_invalida', mensaje: 'La petición no es válida.' },
    });
  }, 60_000);

  it('un error interno forzado responde 500 con el mensaje fijo, sin la traza ni el texto del error', async () => {
    ({ contexto, sesiones } = await prepararEscenario(entorno.app));
    const TEXTO = 'FALLO-INTERNO-DISTINTIVO-7731';
    const DNI = '91827364';
    const errores: Record<string, unknown> = {
      'Error común con ruta y texto': new Error(`${TEXTO} en C:\\proyecto\\src\\modulos\\x.ts:10 (node_modules/prisma)`),
      'TypeError': new TypeError(`${TEXTO} cannot read properties of undefined`),
      'error de Prisma con datos': errorDePrismaConDatos(DNI, 'Zacarias Quillfeather'),
      'rechazo que no es un Error': `${TEXTO} dni ${DNI}`,
      'rechazo con un objeto': { mensaje: TEXTO, stack: `Error: ${TEXTO}\n    at x (C:\\a.ts:1:1)`, status: 500 },
    };

    for (const [tipo, error] of Object.entries(errores)) {
      const roto = await armarEntorno({ base: baseQueFalla(error) });
      try {
        let con500 = 0;
        for (const ruta of rutasReales(roto.app)) {
          const entrada = entradaDe(ruta);
          const cookie = cookieDe(entrada, sesiones, rolLegitimo(ruta));
          const res = await pedirEntrada(roto, ruta, entrada, cookie);
          if (res.status < 500) continue;
          con500 += 1;
          expect(res.status, `${tipo} · ${ruta.clave}`).toBe(500);
          verificarErrorSinTrazas(res, `${tipo} · ${ruta.clave}`, [TEXTO, DNI, 'Quillfeather']);
          expect(res.body, `${tipo} · ${ruta.clave}`).toEqual({
            error: { codigo: 'error_interno', mensaje: 'Ocurrió un error inesperado. Intentá de nuevo.' },
          });
        }
        // Que la prueba no pase en vacío: las rutas de datos tocaron la base y fallaron.
        expect(con500, tipo).toBeGreaterThanOrEqual(20);
        // El detalle sí queda en el log del servidor, que es el lugar correcto para la traza.
        expect(roto.registros().filter((r) => r.msg === 'error no controlado').length, tipo).toBeGreaterThanOrEqual(20);
      } finally {
        await roto.cerrar();
      }
    }
  }, 300_000);

  it('autoprueba: la verificación detecta una traza, un mensaje de Prisma y un formato ajeno', () => {
    const falsa = (status: number, texto: string, cuerpo: unknown, tipo = 'application/json') =>
      ({ status, text: texto, body: cuerpo, headers: { 'content-type': tipo } }) as unknown as Respuesta;
    const ok = falsa(400, '{"error":{"codigo":"datos_invalidos","mensaje":"Los datos enviados no son válidos."}}', {
      error: { codigo: 'datos_invalidos', mensaje: 'Los datos enviados no son válidos.' },
    });
    const conTraza = falsa(500, '', { error: { codigo: 'x', mensaje: 'y' }, stack: 'Error\n    at f (/a/b.ts:1:1)' });
    const conStack = falsa(500, 'Error: boom\n    at Object.<anonymous> (C:\\a\\b.ts:1:1)', { error: { codigo: 'x', mensaje: 'y' } });
    const conPrisma = falsa(500, '', { error: { codigo: 'x', mensaje: 'Invalid `prisma.paciente.findFirst()` invocation' } });
    const conEco = falsa(400, '{"error":{"codigo":"x","mensaje":"dni 91827364"}}', { error: { codigo: 'x', mensaje: 'dni 91827364' } });
    const html = falsa(500, '<pre>Error</pre>', {}, 'text/html');

    expect(() => verificarErrorSinTrazas(ok, 'ok')).not.toThrow();
    expect(() => verificarErrorSinTrazas(conTraza, 'traza')).toThrow();
    expect(() => verificarErrorSinTrazas(conStack, 'stack')).toThrow();
    expect(() => verificarErrorSinTrazas(conPrisma, 'prisma')).toThrow();
    expect(() => verificarErrorSinTrazas(conEco, 'eco', ['91827364'])).toThrow();
    expect(() => verificarErrorSinTrazas(html, 'html')).toThrow();
  });
});
