import { contraste, leerTokens, type Tokens } from './contraste';
import { leerArchivo } from './leer-archivo';

/**
 * Contraste WCAG 2.1 AA de los pares de DESIGN.md §2 (RNF-15, DESIGN.md §10.3). Los valores salen
 * de `src/styles.css`, el archivo real que carga la aplicación: si alguien cambia un token, esta
 * prueba lo mide.
 */
const css = leerArchivo('src/styles.css');
const { claro, oscuro } = leerTokens(css);

const TEXTO = 4.5;
const CONTROL = 3;

const ESTADOS = ['reservado', 'en_espera', 'asistio', 'no_asistio', 'anulado'] as const;

/** [primer plano, fondo, mínimo]: texto normal 4,5:1; bordes, íconos y foco 3:1. */
const PARES: readonly (readonly [string, string, number])[] = [
  ['texto', 'fondo', TEXTO],
  ['texto', 'superficie', TEXTO],
  ['texto', 'superficie-2', TEXTO],
  ['texto', 'acento-suave', TEXTO],
  ['texto-2', 'fondo', TEXTO],
  ['texto-2', 'superficie', TEXTO],
  ['texto-2', 'superficie-2', TEXTO],
  ['primario', 'fondo', TEXTO],
  ['primario', 'superficie', TEXTO],
  ['sobre-primario', 'primario', TEXTO],
  ['sobre-primario', 'primario-hover', TEXTO],
  ['sobre-advertencia', 'advertencia', TEXTO],
  ['sobre-advertencia', 'advertencia-hover', TEXTO],
  ['sobre-peligro', 'peligro', TEXTO],
  ['sobre-peligro', 'peligro-hover', TEXTO],
  ['peligro', 'superficie', TEXTO],
  ['peligro', 'fondo', TEXTO],
  ['info', 'superficie', TEXTO],
  ['info', 'fondo', TEXTO],
  ['lateral-texto', 'lateral', TEXTO],
  ['lateral-texto-2', 'lateral', TEXTO],
  ['lateral-sobre-activo', 'lateral-activo', TEXTO],
  ...ESTADOS.map((e) => [`estado-${e}-texto`, `estado-${e}-fondo`, TEXTO] as const),
  // Bordes de controles, anillo de foco e íconos de mensajes: 3:1.
  ['borde-control', 'superficie', CONTROL],
  ['borde-control', 'fondo', CONTROL],
  ['acento', 'fondo', CONTROL],
  ['acento', 'superficie', CONTROL],
  ['advertencia', 'superficie', CONTROL],
  ['advertencia', 'fondo', CONTROL],
  ['exito', 'superficie', CONTROL],
  ['exito', 'fondo', CONTROL],
  ['lateral-activo', 'lateral', CONTROL],
];

function valor(tokens: Tokens, nombre: string): string {
  const v = tokens['--' + nombre];
  if (!v || !/^#[0-9a-f]{6}$/i.test(v)) {
    throw new Error(`El token --${nombre} no es un color #rrggbb en styles.css (vale ${v})`);
  }
  return v;
}

describe('contraste de los tokens (RNF-15, WCAG 2.1 AA)', () => {
  const modos: [string, Tokens][] = [
    ['claro', claro],
    ['oscuro', oscuro],
  ];

  for (const [modo, tokens] of modos) {
    describe(`modo ${modo}`, () => {
      for (const [frente, fondo, minimo] of PARES) {
        it(`--${frente} sobre --${fondo} llega a ${minimo}:1`, () => {
          const medido = contraste(valor(tokens, frente), valor(tokens, fondo));
          expect(
            medido,
            `${frente} ${valor(tokens, frente)} / ${fondo} ${valor(tokens, fondo)}`,
          ).toBeGreaterThanOrEqual(minimo);
        });
      }
    });
  }

  it('el cálculo reproduce un valor conocido (blanco sobre negro es 21:1)', () => {
    expect(contraste('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contraste('#0a7672', '#ffffff')).toBeCloseTo(5.46, 1);
  });

  it('el modo oscuro redefine los colores del modo claro', () => {
    for (const nombre of ['fondo', 'texto', 'primario', 'peligro', 'estado-reservado-texto']) {
      expect(oscuro['--' + nombre]).not.toBe(claro['--' + nombre]);
    }
  });
});

describe('reglas del sistema visual en styles.css (DESIGN.md §8, §9)', () => {
  it('pesa menos de 25 kB sin comprimir (DESIGN.md §1)', () => {
    expect(new TextEncoder().encode(css).length).toBeLessThan(25 * 1024);
  });

  it('no tiene animaciones, desenfoques ni importaciones externas', () => {
    for (const prohibido of [
      '@keyframes',
      'animation',
      'backdrop-filter',
      'blur(',
      '@import',
      'url(',
    ]) {
      expect(css, prohibido).not.toContain(prohibido);
    }
  });

  it('el foco visible usa --acento y se apaga el movimiento con prefers-reduced-motion', () => {
    expect(css).toMatch(/:focus-visible\s*{[^}]*outline:\s*2px solid var\(--acento\)/);
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('todo var(--token) que usa tiene definición', () => {
    const usados = new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
    for (const token of usados) {
      expect(claro[token], token).toBeDefined();
    }
  });
});
