import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ErrorNegocio } from '../../../src/comun/errores.js';
import { RelojFijo } from '../../../src/comun/reloj.js';
import {
  CANTIDAD_CODIGOS_RECUPERACION,
  cifrarSecreto,
  descifrarSecreto,
  esCodigoTotp,
  exigirClaveCifrado,
  generarCodigosRecuperacion,
  generarQr,
  generarSecretoTotp,
  hashCodigoRecuperacion,
  pasoTotp,
  uriOtpauth,
  verificarCodigoTotp,
} from '../../../src/modulos/m1-identidad/segundoFactor.js';

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function aBase32(bytes: Buffer): string {
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  let salida = '';
  for (let i = 0; i < bits.length; i += 5) {
    salida += ALFABETO[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)];
  }
  return salida;
}

// Secreto de la RFC 6238 (SHA1): ASCII "12345678901234567890".
const SECRETO_RFC = aBase32(Buffer.from('12345678901234567890', 'ascii'));
const instante = (segundos: number) => new RelojFijo(new Date(segundos * 1000)).ahora();

describe('TOTP (RNF-04)', () => {
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1234567890, '005924'],
  ])('verifica el vector RFC 6238 a T=%i', (t, codigo) => {
    expect(verificarCodigoTotp(SECRETO_RFC, codigo, instante(t))).toBe(pasoTotp(instante(t)));
  });

  it('calcula el paso por división entera de 30 s', () => {
    expect(pasoTotp(instante(59))).toBe(1);
    expect(pasoTotp(instante(60))).toBe(2);
  });

  it('acepta el paso anterior y el siguiente y devuelve ese paso', () => {
    const t = 1111111109;
    const paso = pasoTotp(instante(t));
    // Código del paso actual, visto desde 30 s después y 30 s antes.
    expect(verificarCodigoTotp(SECRETO_RFC, '081804', instante(t + 30))).toBe(paso);
    expect(verificarCodigoTotp(SECRETO_RFC, '081804', instante(t - 30))).toBe(paso);
  });

  it('rechaza a dos pasos de distancia', () => {
    expect(verificarCodigoTotp(SECRETO_RFC, '081804', instante(1111111109 + 60))).toBeNull();
    expect(verificarCodigoTotp(SECRETO_RFC, '081804', instante(1111111109 - 60))).toBeNull();
  });

  it('usa solo el instante recibido, no el reloj del sistema', () => {
    expect(verificarCodigoTotp(SECRETO_RFC, '287082', new Date())).toBeNull();
  });

  it('rechaza un código erróneo', () => {
    expect(verificarCodigoTotp(SECRETO_RFC, '000000', instante(59))).toBeNull();
  });

  it('rechaza entradas que no son exactamente 6 dígitos', () => {
    for (const entrada of ['28708a', '28708', '2870822', '', '287 082', 'abcdef']) {
      expect(verificarCodigoTotp(SECRETO_RFC, entrada, instante(59))).toBeNull();
    }
  });

  it('distingue TOTP de código de recuperación', () => {
    expect(esCodigoTotp('123456')).toBe(true);
    expect(esCodigoTotp('12345')).toBe(false);
    expect(esCodigoTotp('1234567')).toBe(false);
    expect(esCodigoTotp('12345a')).toBe(false);
    expect(esCodigoTotp('abcde-fghij')).toBe(false);
  });

  it('genera secretos base32 de 160 bits, distintos entre sí', () => {
    const a = generarSecretoTotp();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(generarSecretoTotp()).not.toBe(a);
  });
});

describe('cifrado del secreto (RNF-04)', () => {
  const clave = randomBytes(32);
  const secreto = generarSecretoTotp();

  it('ida y vuelta', () => {
    expect(descifrarSecreto(cifrarSecreto(secreto, clave, 7), clave, 7)).toBe(secreto);
  });

  it('tiene formato v1:<iv>:<tag>:<texto> y no contiene el secreto en claro', () => {
    const cifrado = cifrarSecreto(secreto, clave, 7);
    expect(cifrado.split(':')).toHaveLength(4);
    expect(cifrado.startsWith('v1:')).toBe(true);
    expect(cifrado).not.toContain(secreto);
  });

  it('dos cifrados del mismo secreto difieren (IV aleatorio)', () => {
    expect(cifrarSecreto(secreto, clave, 7)).not.toBe(cifrarSecreto(secreto, clave, 7));
  });

  function alterar(cifrado: string, indice: number): string {
    const partes = cifrado.split(':');
    const bytes = Buffer.from(partes[indice] ?? '', 'base64');
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    partes[indice] = bytes.toString('base64');
    return partes.join(':');
  }

  it('rechaza tag, texto o IV alterados', () => {
    const cifrado = cifrarSecreto(secreto, clave, 7);
    expect(() => descifrarSecreto(alterar(cifrado, 2), clave, 7)).toThrow();
    expect(() => descifrarSecreto(alterar(cifrado, 3), clave, 7)).toThrow();
    expect(() => descifrarSecreto(alterar(cifrado, 1), clave, 7)).toThrow();
  });

  it('rechaza el dato asociado de otro usuario', () => {
    expect(() => descifrarSecreto(cifrarSecreto(secreto, clave, 7), clave, 8)).toThrow();
  });

  it('rechaza una clave distinta', () => {
    expect(() => descifrarSecreto(cifrarSecreto(secreto, clave, 7), randomBytes(32), 7)).toThrow();
  });

  it('rechaza otra versión y formatos rotos', () => {
    const cifrado = cifrarSecreto(secreto, clave, 7);
    expect(() => descifrarSecreto(cifrado.replace(/^v1/, 'v2'), clave, 7)).toThrow();
    expect(() => descifrarSecreto('basura', clave, 7)).toThrow();
    expect(() => descifrarSecreto('', clave, 7)).toThrow();
    expect(() => descifrarSecreto('v1:aa:bb', clave, 7)).toThrow();
    expect(() => descifrarSecreto('v1:aa:bb:cc', clave, 7)).toThrow();
  });

  it('el error no incluye el secreto ni el texto cifrado', () => {
    const cifrado = cifrarSecreto(secreto, clave, 7);
    const texto = cifrado.split(':')[3] ?? '';
    try {
      descifrarSecreto(alterar(cifrado, 2), clave, 7);
      expect.unreachable();
    } catch (error) {
      const mensaje = (error as Error).message;
      expect(mensaje).not.toContain(secreto);
      expect(mensaje).not.toContain(texto);
    }
  });

  it('exige la clave de cifrado configurada', () => {
    try {
      exigirClaveCifrado(undefined);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ErrorNegocio);
      expect((error as ErrorNegocio).codigo).toBe('segundo_factor_sin_configurar');
    }
    expect(exigirClaveCifrado(clave)).toBe(clave);
  });
});

describe('códigos de recuperación (RNF-04)', () => {
  it('genera 10 códigos únicos con el formato esperado y un hash por código', () => {
    const { codigos, hashes } = generarCodigosRecuperacion();
    expect(codigos).toHaveLength(CANTIDAD_CODIGOS_RECUPERACION);
    expect(new Set(codigos).size).toBe(CANTIDAD_CODIGOS_RECUPERACION);
    for (const codigo of codigos) expect(codigo).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
    expect(hashes).toEqual(codigos.map(hashCodigoRecuperacion));
    expect(new Set(hashes).size).toBe(CANTIDAD_CODIGOS_RECUPERACION);
  });

  it('dos tandas distintas no comparten códigos', () => {
    const a = generarCodigosRecuperacion().codigos;
    const b = generarCodigosRecuperacion().codigos;
    expect(a.filter((c) => b.includes(c))).toEqual([]);
  });

  it('normaliza antes de calcular el hash', () => {
    const hash = hashCodigoRecuperacion('abcdefghij');
    expect(hashCodigoRecuperacion('ABCDE-FGHIJ')).toBe(hash);
    expect(hashCodigoRecuperacion('abcde fghij')).toBe(hash);
    expect(hashCodigoRecuperacion(' abcde-fghij ')).toBe(hash);
    expect(hashCodigoRecuperacion('abcde-fghik')).not.toBe(hash);
  });

  it('el hash es SHA-256 en hex y no es el código', () => {
    const hash = hashCodigoRecuperacion('abcde-fghij');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('abcde');
  });
});

describe('enrolamiento (RNF-04)', () => {
  it('la URI otpauth lleva emisor, algoritmo, dígitos y período', () => {
    const uri = uriOtpauth(SECRETO_RFC, 'admin');
    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('ScaleKine');
    expect(uri).toContain(`secret=${SECRETO_RFC}`);
    expect(uri).toMatch(/algorithm=SHA1/i);
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });

  it('el QR es una imagen PNG en data URL', async () => {
    const qr = await generarQr(uriOtpauth(SECRETO_RFC, 'admin'));
    expect(qr.startsWith('data:image/png;base64,')).toBe(true);
  });
});
