/** Cálculo de contraste de WCAG 2.1 y lectura de los tokens de color de `styles.css`. */

export type Tokens = Readonly<Record<string, string>>;

function luminancia(hex: string): number {
  const canales = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * canales[0] + 0.7152 * canales[1] + 0.0722 * canales[2];
}

/** Relación de contraste entre dos colores `#rrggbb` (de 1 a 21). */
export function contraste(a: string, b: string): number {
  const [claro, oscuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (oscuro + 0.05);
}

/** Contenido de las llaves que abren en `desde` (que apunta a la llave de apertura). */
function bloque(css: string, desde: number): string {
  let profundidad = 0;
  for (let i = desde; i < css.length; i++) {
    if (css[i] === '{') profundidad++;
    if (css[i] === '}' && --profundidad === 0) return css.slice(desde + 1, i);
  }
  throw new Error('Llave sin cerrar en styles.css');
}

function variables(texto: string): Record<string, string> {
  const resultado: Record<string, string> = {};
  for (const [, nombre, valor] of texto.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    resultado[nombre] = valor.trim();
  }
  return resultado;
}

/**
 * Lee los tokens reales de `styles.css`: los de `:root` son el modo claro y los de
 * `@media (prefers-color-scheme: dark) { :root { … } }`, el oscuro (que hereda lo que no redefine).
 */
export function leerTokens(css: string): { claro: Tokens; oscuro: Tokens } {
  const raiz = css.indexOf(':root {');
  const media = css.indexOf('@media (prefers-color-scheme: dark)');
  if (raiz < 0 || media < 0) throw new Error('styles.css no define el modo claro y el oscuro');
  const claro = variables(bloque(css, css.indexOf('{', raiz)));
  const bloqueOscuro = bloque(css, css.indexOf('{', media));
  const oscuro = { ...claro, ...variables(bloque(bloqueOscuro, bloqueOscuro.indexOf('{'))) };
  return { claro, oscuro };
}
