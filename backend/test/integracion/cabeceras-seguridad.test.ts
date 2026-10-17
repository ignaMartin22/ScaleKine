import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  armarEntorno,
  CATALOGO,
  cookieDe,
  pedir,
  pedirEntrada,
  prepararEscenario,
  rutasReales,
  type Contexto,
  type Entrada,
  type Entorno,
  type Respuesta,
  type RolDePrueba,
  type Sesiones,
} from './entornoSeguridad.js';

/**
 * T-34 · Todas las rutas responden con las cabeceras de seguridad (RNF-10, RNF-14).
 *
 * Lo que pone la API: `helmet` (CSP, HSTS, frame-ancestors, referrer, nosniff, etc.), sin
 * `X-Powered-By`, y `Cache-Control: no-store` en todo `/api`. Lo que agrega Caddy en producción
 * (despliegue.md §6.2) no se verifica acá: lo cubre T-36.
 *
 * Las rutas salen de la enumeración real del router (`enumerarRutas.ts`, la de la guardiana de
 * `rutas.test.ts`), y una prueba exige que el catálogo de entradas las cubra todas.
 */

let entorno: Entorno;
let contexto: Contexto;
let sesiones: Sesiones;

const ROLES: (RolDePrueba | null)[] = [null, 'administrador', 'secretaria', 'kinesiologo'];

beforeAll(async () => {
  entorno = await armarEntorno();
});
afterAll(async () => {
  await entorno.cerrar();
});

/** Cabeceras que `helmet` pone con la configuración de `seguridad.ts`, valor por valor. */
const CABECERAS_DE_HELMET: Record<string, string> = {
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'x-content-type-options': 'nosniff',
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'x-permitted-cross-domain-policies': 'none',
  'x-dns-prefetch-control': 'off',
  'x-download-options': 'noopen',
  'origin-agent-cluster': '?1',
  'x-xss-protection': '0',
};

/** Directivas de la CSP que no pueden faltar ni debilitarse. */
const DIRECTIVAS_DE_CSP: Record<string, string> = {
  'default-src': "'self'",
  'script-src': "'self'",
  'frame-ancestors': "'none'",
  'base-uri': "'self'",
  'form-action': "'self'",
  'object-src': "'none'",
  'connect-src': "'self'",
};

function problemasDeCabeceras(res: Respuesta, { api }: { api: boolean }): string[] {
  const problemas: string[] = [];
  const h = res.headers;
  for (const [nombre, valor] of Object.entries(CABECERAS_DE_HELMET)) {
    if (h[nombre] !== valor) problemas.push(`${nombre}=${String(h[nombre])} (esperado ${valor})`);
  }
  const csp = String(h['content-security-policy'] ?? '');
  const directivas = new Map(
    csp
      .split(';')
      .map((d) => d.trim().split(/\s+/))
      .filter(([nombre]) => nombre)
      .map(([nombre, ...valores]) => [nombre ?? '', valores.join(' ')] as const),
  );
  for (const [nombre, valor] of Object.entries(DIRECTIVAS_DE_CSP)) {
    if (directivas.get(nombre) !== valor) problemas.push(`CSP ${nombre}=${String(directivas.get(nombre))} (esperado ${valor})`);
  }
  if (/unsafe-eval|unsafe-inline/.test(directivas.get('script-src') ?? '')) problemas.push('CSP script-src débil');
  if (h['x-powered-by'] !== undefined) problemas.push('X-Powered-By presente');
  if (api && h['cache-control'] !== 'no-store') problemas.push(`cache-control=${String(h['cache-control'])}`);
  return problemas;
}

function verificar(res: Respuesta, quien: string, opciones = { api: true }): void {
  expect(problemasDeCabeceras(res, opciones), `${quien} (${res.status})`).toEqual([]);
}

describe('cabeceras de seguridad en todas las rutas (RNF-10, RNF-14)', () => {
  it('el catálogo de entradas cubre exactamente las rutas reales del router', () => {
    const reales = rutasReales(entorno.app).map((r) => r.clave);

    expect(Object.keys(CATALOGO).sort()).toEqual(reales);
    expect(reales.length).toBeGreaterThanOrEqual(30);
  });

  it('cada ruta, con y sin sesión y con cada rol, lleva las cabeceras en éxito y en error', async () => {
    ({ contexto, sesiones } = await prepararEscenario(entorno.app));
    const estados = new Set<number>();
    let total = 0;

    for (const ruta of rutasReales(entorno.app)) {
      const entrada: Entrada = (CATALOGO[ruta.clave] ?? (() => ({ url: ruta.plantilla })))(contexto);
      for (const rol of ROLES) {
        const res = await pedirEntrada(entorno, ruta, entrada, cookieDe(entrada, sesiones, rol));
        verificar(res, `${ruta.clave} como ${rol ?? 'sin sesión'}`);
        estados.add(res.status);
        total += 1;
      }
    }

    // La barrida no pasa en vacío: hubo éxitos, 401 y 403.
    expect(total).toBeGreaterThanOrEqual(120);
    expect([...estados]).toEqual(expect.arrayContaining([200, 401, 403]));
  }, 120_000);

  it('las respuestas de error de cada ruta (cuerpo mal formado, demasiado grande, origen ajeno) también las llevan', async () => {
    ({ contexto, sesiones } = await prepararEscenario(entorno.app));
    const estados = new Set<number>();

    for (const ruta of rutasReales(entorno.app)) {
      const entrada: Entrada = (CATALOGO[ruta.clave] ?? (() => ({ url: ruta.plantilla })))(contexto);
      const cookie = cookieDe(entrada, sesiones, 'administrador');
      const variantes: Record<string, Respuesta> = {
        'id mal formado': await pedir(entorno, ruta.metodo, entrada.url.replace(/\/\d+(?=\/|\?|$)/, '/abc'), {
          ...(cookie ? { cookie } : {}),
          ...(entrada.cuerpo ? { cuerpo: entrada.cuerpo } : {}),
        }),
      };
      if (ruta.metodo !== 'get') {
        variantes['JSON inválido'] = await pedirEntrada(entorno, ruta, entrada, cookie, { crudo: '{"a":' });
        variantes['cuerpo enorme'] = await pedirEntrada(entorno, ruta, entrada, cookie, {
          crudo: JSON.stringify({ relleno: 'x'.repeat(150_000) }),
        });
        variantes['origen ajeno'] = await pedirEntrada(entorno, ruta, entrada, cookie, { origen: 'http://otro.example' });
      }
      for (const [caso, res] of Object.entries(variantes)) {
        verificar(res, `${ruta.clave} (${caso})`);
        estados.add(res.status);
      }
    }

    expect([...estados]).toEqual(expect.arrayContaining([400, 403, 413]));
  }, 120_000);

  it('una ruta inexistente (404) y el 401 de la API llevan las cabeceras, con y sin sesión', async () => {
    ({ contexto, sesiones } = await prepararEscenario(entorno.app));
    for (const cookie of [undefined, sesiones.secretaria]) {
      const opciones = cookie ? { cookie } : {};
      for (const ruta of ['/api/no-existe', '/api/pacientes/1/no-existe', '/api/turnos/1/ticket/extra']) {
        for (const metodo of ['get', 'post', 'put', 'delete'] as const) {
          const res = await pedir(entorno, metodo, ruta, opciones);
          expect(res.status, `${metodo} ${ruta}`).toBe(404);
          verificar(res, `${metodo.toUpperCase()} ${ruta} (${cookie ? 'con' : 'sin'} sesión)`);
        }
      }
    }
  }, 60_000);

  it('HEAD y OPTIONS sobre las rutas de lectura también llevan las cabeceras', async () => {
    ({ sesiones } = await prepararEscenario(entorno.app));
    for (const ruta of ['/api/salud', '/api/pacientes', '/api/agenda', '/api/sesion']) {
      const head = await request(entorno.url).head(ruta).set('Cookie', sesiones.secretaria);
      verificar(head, `HEAD ${ruta}`);
      const opciones = await request(entorno.url).options(ruta).set('Cookie', sesiones.secretaria);
      verificar(opciones, `OPTIONS ${ruta}`);
    }
  }, 60_000);

  it('fuera de /api (ruta inexistente de la raíz) llevan las de helmet; no-store es solo de la API', async () => {
    for (const ruta of ['/', '/no-existe', '/socket.io-falso']) {
      const res = await request(entorno.url).get(ruta);
      expect(res.status, ruta).toBe(404);
      verificar(res, `GET ${ruta}`, { api: false });
    }
  });

  it('autoprueba: la verificación detecta la falta de una cabecera de helmet y de no-store', async () => {
    const sana = await request(entorno.url).get('/api/salud');
    expect(problemasDeCabeceras(sana, { api: true })).toEqual([]);

    const sinMarco = { ...sana, headers: { ...sana.headers, 'x-frame-options': undefined } } as unknown as Respuesta;
    const sinCache = { ...sana, headers: { ...sana.headers, 'cache-control': 'max-age=60' } } as unknown as Respuesta;
    const conPoder = { ...sana, headers: { ...sana.headers, 'x-powered-by': 'Express' } } as unknown as Respuesta;
    const cspDebil = {
      ...sana,
      headers: { ...sana.headers, 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'" },
    } as unknown as Respuesta;

    expect(problemasDeCabeceras(sinMarco, { api: true }).join()).toContain('x-frame-options');
    expect(problemasDeCabeceras(sinCache, { api: true }).join()).toContain('cache-control');
    expect(problemasDeCabeceras(conPoder, { api: true }).join()).toContain('X-Powered-By');
    expect(problemasDeCabeceras(cspDebil, { api: true }).join()).toContain('CSP');
  });
});
