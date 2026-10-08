import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt } from 'node:crypto';
import { generateSecret, verifySync } from 'otplib';
import QRCode from 'qrcode';
import { ErrorNegocio } from '../../comun/errores.js';

/**
 * Núcleo puro del segundo factor del administrador (RNF-04, plan.md §4.11): cifrado del secreto,
 * TOTP y códigos de recuperación. No toca la base ni el logger: ningún secreto, código ni hash
 * debe registrarse.
 */

export const DIGITOS_TOTP = 6;
export const PERIODO_TOTP_SEGUNDOS = 30;
export const TOLERANCIA_PASOS_TOTP = 1;
export const CANTIDAD_CODIGOS_RECUPERACION = 10;

const EMISOR = 'ScaleKine';
const VERSION_CIFRADO = 'v1';
const LARGO_IV = 12;
const LARGO_TAG = 16;
const BYTES_SECRETO_TOTP = 20;
const ALFABETO_BASE32 = 'abcdefghijklmnopqrstuvwxyz234567';
const LARGO_GRUPO_RECUPERACION = 5;

export function exigirClaveCifrado(clave: Buffer | undefined): Buffer {
  if (!clave) {
    throw new ErrorNegocio(
      'segundo_factor_sin_configurar',
      'El segundo factor no está configurado en el servidor: falta la clave de cifrado.',
      503,
    );
  }
  return clave;
}

function datoAsociado(usuarioId: number): Buffer {
  return Buffer.from(`usuario:${usuarioId}`, 'utf8');
}

/** AES-256-GCM con el id de usuario como dato asociado. Formato `v1:<iv>:<tag>:<texto>` (base64). */
export function cifrarSecreto(secreto: string, clave: Buffer, usuarioId: number): string {
  const iv = randomBytes(LARGO_IV);
  const cifrador = createCipheriv('aes-256-gcm', clave, iv);
  cifrador.setAAD(datoAsociado(usuarioId));
  const texto = Buffer.concat([cifrador.update(secreto, 'utf8'), cifrador.final()]);
  const tag = cifrador.getAuthTag();
  return [VERSION_CIFRADO, iv.toString('base64'), tag.toString('base64'), texto.toString('base64')].join(':');
}

export function descifrarSecreto(cifrado: string, clave: Buffer, usuarioId: number): string {
  const partes = cifrado.split(':');
  if (partes.length !== 4 || partes[0] !== VERSION_CIFRADO) {
    throw new Error('Secreto cifrado con formato o versión no soportados.');
  }
  const iv = Buffer.from(partes[1] ?? '', 'base64');
  const tag = Buffer.from(partes[2] ?? '', 'base64');
  const texto = Buffer.from(partes[3] ?? '', 'base64');
  if (iv.length !== LARGO_IV || tag.length !== LARGO_TAG) {
    throw new Error('Secreto cifrado con formato inválido.');
  }
  try {
    const descifrador = createDecipheriv('aes-256-gcm', clave, iv);
    descifrador.setAAD(datoAsociado(usuarioId));
    descifrador.setAuthTag(tag);
    return Buffer.concat([descifrador.update(texto), descifrador.final()]).toString('utf8');
  } catch {
    // Mensaje fijo: el de node:crypto no se propaga para no arrastrar detalles del contenido.
    throw new Error('No se pudo descifrar el secreto: autenticación fallida.');
  }
}

/** 20 bytes aleatorios (160 bits) en base32. */
export function generarSecretoTotp(): string {
  return generateSecret({ length: BYTES_SECRETO_TOTP });
}

/** URI `otpauth://` con los parámetros explícitos (otplib omite los valores por defecto). */
export function uriOtpauth(secreto: string, nombreUsuario: string): string {
  const etiqueta = `${encodeURIComponent(EMISOR)}:${encodeURIComponent(nombreUsuario)}`;
  const parametros = new URLSearchParams({
    secret: secreto,
    issuer: EMISOR,
    algorithm: 'SHA1',
    digits: String(DIGITOS_TOTP),
    period: String(PERIODO_TOTP_SEGUNDOS),
  });
  return `otpauth://totp/${etiqueta}?${parametros.toString()}`;
}

export function generarQr(uri: string): Promise<string> {
  return QRCode.toDataURL(uri, { type: 'image/png' });
}

export function pasoTotp(ahora: Date): number {
  return Math.floor(ahora.getTime() / 1000 / PERIODO_TOTP_SEGUNDOS);
}

/** Seis dígitos se toman como TOTP; cualquier otra entrada, como código de recuperación. */
export function esCodigoTotp(entrada: string): boolean {
  return /^\d{6}$/.test(entrada);
}

/**
 * Devuelve el paso aceptado (el del instante o uno contiguo) o `null`. La hora sale solo de
 * `ahora`: se pasa como `epoch` a otplib, que de otro modo usaría el reloj del sistema.
 */
export function verificarCodigoTotp(secreto: string, codigo: string, ahora: Date): number | null {
  if (!esCodigoTotp(codigo)) return null;
  const resultado = verifySync({
    secret: secreto,
    token: codigo,
    strategy: 'totp',
    algorithm: 'sha1',
    digits: DIGITOS_TOTP,
    period: PERIODO_TOTP_SEGUNDOS,
    epoch: Math.floor(ahora.getTime() / 1000),
    epochTolerance: TOLERANCIA_PASOS_TOTP * PERIODO_TOTP_SEGUNDOS,
  });
  if (!resultado.valid) return null;
  const paso = pasoTotp(ahora) + resultado.delta;
  return Math.abs(resultado.delta) <= TOLERANCIA_PASOS_TOTP ? paso : null;
}

function grupoAleatorio(): string {
  let grupo = '';
  for (let i = 0; i < LARGO_GRUPO_RECUPERACION; i += 1) {
    grupo += ALFABETO_BASE32[randomInt(ALFABETO_BASE32.length)];
  }
  return grupo;
}

/** Normaliza: minúsculas, sin guiones ni espacios. */
function normalizarCodigo(codigo: string): string {
  return codigo.toLowerCase().replace(/[\s-]/g, '');
}

export function hashCodigoRecuperacion(codigo: string): string {
  return createHash('sha256').update(normalizarCodigo(codigo), 'utf8').digest('hex');
}

/** Diez códigos `xxxxx-xxxxx` (50 bits de entropía cada uno), sin repetidos. */
export function generarCodigosRecuperacion(): { codigos: string[]; hashes: string[] } {
  const codigos = new Set<string>();
  while (codigos.size < CANTIDAD_CODIGOS_RECUPERACION) {
    codigos.add(`${grupoAleatorio()}-${grupoAleatorio()}`);
  }
  const lista = [...codigos];
  return { codigos: lista, hashes: lista.map(hashCodigoRecuperacion) };
}
