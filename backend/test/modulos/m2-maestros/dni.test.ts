import { describe, expect, it } from 'vitest';
import { esDniValido, normalizarDni } from '../../../src/modulos/m2-maestros/dni.js';

describe('normalización y formato del DNI (RF-18)', () => {
  it.each([
    ['1234567', '1234567'],
    ['12345678', '12345678'],
    ['30.123.456', '30123456'],
    ['1.234.567', '1234567'],
    ['30 123 456', '30123456'],
    [' 30123456 ', '30123456'],
    ['30. 123 .456', '30123456'],
  ])('%j es válido y queda como %j', (entrada, esperado) => {
    expect(normalizarDni(entrada)).toBe(esperado);
    expect(esDniValido(entrada)).toBe(true);
  });

  it('los ceros a la izquierda cuentan como dígitos: 0123456 es válido y se guarda tal cual', () => {
    expect(normalizarDni('0123456')).toBe('0123456');
    expect(normalizarDni('01234567')).toBe('01234567');
    expect(normalizarDni('0000000')).toBe('0000000');
    // 6 dígitos con un cero delante siguen siendo 6.
    expect(normalizarDni('012345')).toBeNull();
  });

  it.each([
    ['6 dígitos', '123456'],
    ['6 dígitos con puntos', '123.456'],
    ['9 dígitos', '123456789'],
    ['9 dígitos con puntos', '123.456.789'],
    ['vacío', ''],
    ['solo espacios', '   '],
    ['solo puntos', '.......'],
    ['puntos y espacios sin dígitos', '. . . .'],
    ['letras', 'abcdefgh'],
    ['dígitos con una letra', '1234567a'],
    ['letra O por cero', '3O123456'],
    ['guion', '30-123-456'],
    ['signo más', '+30123456'],
    ['signo menos', '-3012345'],
    ['coma', '30,123,456'],
    ['barra', '30/123/456'],
    ['tabulación', '30123\t456'],
    ['salto de línea', '30123456\n'],
    ['NUL', '30123456\u0000'],
    ['NUL en el medio', '3012\u00003456'],
    ['dígitos de ancho completo', '３０１２３４５６'],
    ['dígitos arábigo-índicos', '٣٠١٢٣٤٥٦'],
    ['dígitos devanagari', '३०१२३४५६'],
    ['espacio de no separación', '30 123 456'],
    ['notación científica', '1e7'],
    ['hexadecimal', '0x123456'],
  ])('%s es inválido', (_caso, entrada) => {
    expect(normalizarDni(entrada)).toBeNull();
    expect(esDniValido(entrada)).toBe(false);
  });

  it('un punto decimal es un punto más: 1234567.5 se lee como 12345675', () => {
    expect(normalizarDni('1234567.5')).toBe('12345675');
  });

  it('quitar puntos no relaja el largo: tras limpiar sigue exigiendo 7 u 8 dígitos', () => {
    expect(normalizarDni('1.2.3.4.5.6.7.8')).toBe('12345678');
    expect(normalizarDni('1.2.3.4.5.6.7.8.9')).toBeNull();
  });
});
