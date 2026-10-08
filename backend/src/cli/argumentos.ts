import { parseArgs } from 'node:util';
import { z } from 'zod';
import type { DatosInstalacion, SeleccionAdministrador } from './comandos.js';

/** Error de uso de la línea de comandos: el mensaje nunca incluye los valores recibidos. */
export class ErrorUso extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorUso';
  }
}

export const USO = `Uso: cli <subcomando> [opciones]

Subcomandos:
  instalar --nombre <consultorio> --direccion <dirección> --telefono <teléfono> [--usuario <nombre>]
      Crea el administrador (contraseña temporal, se muestra una sola vez) y el consultorio.
      El nombre de usuario del administrador es "administrador" si no se indica.
  restablecer-admin [--usuario <nombre>]
      Genera una nueva contraseña temporal para el administrador y cierra sus sesiones.
  restablecer-2fa-admin [--usuario <nombre>]
      Desactiva el segundo factor del administrador para que lo vuelva a activar.
  revocar-sesiones
      Revoca todas las sesiones de todas las cuentas (respuesta a incidentes).
`;

export type Orden =
  | { comando: 'instalar'; datos: DatosInstalacion }
  | { comando: 'restablecer-admin'; datos: SeleccionAdministrador }
  | { comando: 'restablecer-2fa-admin'; datos: SeleccionAdministrador }
  | { comando: 'revocar-sesiones' };

// PostgreSQL no admite el carácter NUL en columnas de texto.
const texto = (maximo: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximo)
    .refine((valor) => !valor.includes('\u0000'));

const esquemas = {
  instalar: z.strictObject({
    usuario: texto(64).default('administrador'),
    nombre: texto(200),
    direccion: texto(200),
    telefono: texto(50),
  }),
  'restablecer-admin': z.strictObject({ usuario: texto(64).optional() }),
  'restablecer-2fa-admin': z.strictObject({ usuario: texto(64).optional() }),
  'revocar-sesiones': z.strictObject({}),
} as const;

type Comando = keyof typeof esquemas;

const esComando = (valor: string): valor is Comando => Object.hasOwn(esquemas, valor);

/**
 * Interpreta la línea de comandos (sin `node` ni el script). Valida cada subcomando con zod y
 * rechaza opciones que no le corresponden. Lanza `ErrorUso`, sin los valores recibidos.
 */
export function interpretarArgumentos(argv: readonly string[]): Orden {
  let parseado;
  try {
    parseado = parseArgs({
      args: [...argv],
      allowPositionals: true,
      strict: true,
      options: {
        usuario: { type: 'string' },
        nombre: { type: 'string' },
        direccion: { type: 'string' },
        telefono: { type: 'string' },
      },
    });
  } catch {
    // El mensaje de `parseArgs` puede repetir lo que se tipeó; se informa solo el motivo general.
    throw new ErrorUso('Opciones inválidas: una opción no existe o le falta su valor.');
  }

  const [comando, ...sobrantes] = parseado.positionals;
  if (comando === undefined || !esComando(comando)) throw new ErrorUso('Falta el subcomando o no existe.');
  if (sobrantes.length > 0) throw new ErrorUso('Sobran argumentos sin nombre de opción.');

  const resultado = esquemas[comando].safeParse(parseado.values);
  if (!resultado.success) {
    // Solo los nombres de las opciones con problema, nunca sus valores.
    const opciones = [...new Set(resultado.error.issues.flatMap((i) => i.path.map(String)))];
    const detalle = opciones.length > 0 ? ` (${opciones.map((o) => `--${o}`).join(', ')})` : '';
    throw new ErrorUso(`Opciones faltantes, inválidas o que no corresponden a este subcomando${detalle}.`);
  }
  return { comando, datos: resultado.data } as Orden;
}
