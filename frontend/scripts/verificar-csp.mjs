// Verifica que el build de producción funcione con la CSP de producción sin violaciones (T-05,
// RNF-10) y que la navegación por rol lleve a cada pantalla.
//
// 1. Sirve dist/ con la misma CSP que Caddy (docs/despliegue.md §6.2).
// 2. Simula /api/sesion: sin sesión (401) o con un rol ficticio, según la cookie `rol-prueba`.
// 3. Recorre las rutas con un navegador sin interfaz y junta violaciones de CSP y errores de página.
//
// Uso: npm run build && npm run verificar-csp
// Navegador: NAVEGADOR=chrome|msedge (por defecto, msedge en Windows y chrome en el resto).

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const RAIZ = fileURLToPath(new URL('../dist/scalekine-frontend/browser/', import.meta.url));

/** Copia de la política de despliegue.md §6.2, con {$DOMINIO} reemplazado por el servidor local. */
function politica(dominio) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    `connect-src 'self' wss://${dominio}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
};

function rolDeCookie(cabecera = '') {
  const encontrado = cabecera.match(/(?:^|;\s*)rol-prueba=([a-z]+)/);
  return encontrado?.[1];
}

async function servir(peticion, respuesta, dominio) {
  const ruta = new URL(peticion.url, 'http://local').pathname;
  respuesta.setHeader('Content-Security-Policy', politica(dominio));

  if (ruta === '/api/sesion') {
    const rol = rolDeCookie(peticion.headers.cookie);
    respuesta.setHeader('Content-Type', 'application/json');
    if (!rol) {
      respuesta.writeHead(401).end(JSON.stringify({ error: { codigo: 'sin_sesion', mensaje: 'Sin sesión.' } }));
    } else {
      respuesta.writeHead(200).end(JSON.stringify({ usuario: { nombreUsuario: 'usuario.ficticio', rol } }));
    }
    return;
  }

  // Archivo estático, o index.html para las rutas de la aplicación (como try_files en Caddy).
  let archivo = normalize(join(RAIZ, ruta));
  if (!archivo.startsWith(normalize(RAIZ))) return respuesta.writeHead(400).end();
  const existe = await stat(archivo).then((s) => s.isFile(), () => false);
  if (!existe) archivo = join(RAIZ, 'index.html');
  respuesta.setHeader('Content-Type', TIPOS[extname(archivo)] ?? 'application/octet-stream');
  respuesta.writeHead(200).end(await readFile(archivo));
}

/** [rol simulado, ruta pedida, ruta donde debe terminar] */
const RECORRIDOS = [
  [undefined, '/', '/ingresar'],
  [undefined, '/admin', '/ingresar'],
  [undefined, '/secretaria', '/ingresar'],
  [undefined, '/kinesiologo', '/ingresar'],
  [undefined, '/no-existe', '/no-existe'],
  ['administrador', '/', '/admin'],
  ['administrador', '/secretaria', '/secretaria'],
  ['administrador', '/kinesiologo', '/admin'],
  ['secretaria', '/ingresar', '/secretaria'],
  ['secretaria', '/admin', '/secretaria'],
  ['kinesiologo', '/', '/kinesiologo'],
  ['kinesiologo', '/secretaria', '/kinesiologo'],
];

async function main() {
  const servidor = createServer((pet, res) => {
    servir(pet, res, `localhost:${servidor.address().port}`).catch(() => res.writeHead(500).end());
  });
  await new Promise((listo) => servidor.listen(0, '127.0.0.1', listo));
  const base = `http://localhost:${servidor.address().port}`;

  const canal = process.env.NAVEGADOR ?? (process.platform === 'win32' ? 'msedge' : 'chrome');
  const navegador = await chromium.launch({ channel: canal, headless: true });
  const problemas = [];

  try {
    for (const [rol, ruta, destino] of RECORRIDOS) {
      const contexto = await navegador.newContext();
      if (rol) await contexto.addCookies([{ name: 'rol-prueba', value: rol, url: base }]);
      const pagina = await contexto.newPage();
      const etiqueta = `${rol ?? 'sin sesión'} → ${ruta}`;

      await pagina.addInitScript(() => {
        window.__violaciones = [];
        document.addEventListener('securitypolicyviolation', (e) =>
          window.__violaciones.push(`${e.violatedDirective}: ${e.blockedURI || 'en línea'}`),
        );
      });
      pagina.on('pageerror', (error) => problemas.push(`${etiqueta}: error de página: ${error.message}`));
      pagina.on('console', (mensaje) => {
        if (/content security policy/i.test(mensaje.text())) problemas.push(`${etiqueta}: ${mensaje.text()}`);
      });

      await pagina.goto(base + ruta, { waitUntil: 'networkidle' });
      await pagina.locator('h1').first().waitFor();

      const final = new URL(pagina.url()).pathname;
      if (final !== destino) problemas.push(`${etiqueta}: terminó en ${final}, se esperaba ${destino}`);
      for (const v of await pagina.evaluate(() => window.__violaciones)) problemas.push(`${etiqueta}: violación de CSP: ${v}`);

      await contexto.close();
    }
  } finally {
    await navegador.close();
    servidor.close();
  }

  if (problemas.length > 0) {
    console.error(`Se encontraron ${problemas.length} problemas:\n${problemas.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`Sin violaciones de CSP en ${RECORRIDOS.length} recorridos, y cada rol llegó a su pantalla.`);
}

await main();
