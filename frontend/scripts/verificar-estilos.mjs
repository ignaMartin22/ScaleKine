// Controles del sistema visual (DESIGN.md §10.1 y §10.6, RNF-15):
// 1. Ningún color hexadecimal fuera de `src/styles.css`: los CSS de los componentes y las
//    plantillas usan solo los tokens (`var(--…)`).
// 2. `src/styles.css` pesa menos de 25 KB sin comprimir.
// 3. Ningún CSS ni plantilla carga recursos externos ni usa animaciones o desenfoques (§8).
//
// Uso: npm run verificar-estilos

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = fileURLToPath(new URL('../', import.meta.url));
const FUENTES = join(RAIZ, 'src');
const GLOBAL = join(FUENTES, 'styles.css');
const LIMITE_GLOBAL = 25 * 1024;

const HEXADECIMAL = /#[0-9a-fA-F]{3,8}\b/;
// En TypeScript y HTML `#algo` es una referencia de plantilla: solo se mira cuando es un valor de
// estilo (`color: #fff`, `style="…"`).
const HEXADECIMAL_EN_ESTILO =
  /(?:color|background|border|outline|fill|stroke|shadow)[\w-]*\s*[:=]\s*['"`]?[^;'"`\n]*#[0-9a-fA-F]{3,8}\b/;
const PROHIBIDO = [
  /@keyframes/,
  /animation\s*:/,
  /backdrop-filter/,
  /blur\(/,
  /@import/,
  /url\(\s*['"]?https?:/,
];

function archivos(carpeta) {
  return readdirSync(carpeta).flatMap((nombre) => {
    const ruta = join(carpeta, nombre);
    return statSync(ruta).isDirectory() ? archivos(ruta) : [ruta];
  });
}

const problemas = [];

for (const ruta of archivos(FUENTES)) {
  const nombre = relative(RAIZ, ruta).split(sep).join('/');
  const esCss = ruta.endsWith('.css');
  const esPlantilla =
    (ruta.endsWith('.ts') || ruta.endsWith('.html')) && !ruta.endsWith('.spec.ts');
  if (!esCss && !esPlantilla) continue;
  // Los estilos de las pruebas de contraste y los comentarios de licencia no son estilos de pantalla.
  if (nombre.startsWith('src/app/estilos/')) continue;

  const lineas = readFileSync(ruta, 'utf8').split(/\r?\n/);
  lineas.forEach((linea, i) => {
    const donde = `${nombre}:${i + 1}`;
    if (esCss && ruta !== GLOBAL && HEXADECIMAL.test(linea)) {
      problemas.push(
        `${donde}: color hexadecimal fuera de styles.css (usar un token): ${linea.trim()}`,
      );
    }
    if (esPlantilla && HEXADECIMAL_EN_ESTILO.test(linea)) {
      problemas.push(
        `${donde}: color hexadecimal en una plantilla (usar un token): ${linea.trim()}`,
      );
    }
    if (esCss || esPlantilla) {
      for (const patron of PROHIBIDO) {
        if (patron.test(linea))
          problemas.push(`${donde}: prohibido por DESIGN.md §8 (${patron}): ${linea.trim()}`);
      }
    }
  });
}

const bytes = statSync(GLOBAL).size;
if (bytes >= LIMITE_GLOBAL) {
  problemas.push(
    `src/styles.css pesa ${bytes} bytes; el límite es ${LIMITE_GLOBAL} (DESIGN.md §1)`,
  );
}

if (problemas.length > 0) {
  console.error(problemas.join('\n'));
  console.error(`\n${problemas.length} problema(s) de estilos.`);
  process.exit(1);
}
console.log(`Estilos en orden. styles.css: ${bytes} bytes de ${LIMITE_GLOBAL}.`);
