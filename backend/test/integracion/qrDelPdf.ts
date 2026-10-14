import { inflateSync } from 'node:zlib';
import { createRequire } from 'node:module';

// El paquete es CommonJS y su tipo exporta la función como `default`.
const jsQR = createRequire(import.meta.url)('jsqr') as typeof import('jsqr').default;

/**
 * Decodifica el QR de un ticket PDF generado por pdfkit: busca la imagen RGB incrustada (pdfkit la
 * deja como píxeles comprimidos con Flate, sin predictor), la descomprime y se la pasa a jsQR.
 * Devuelve el texto del QR. Sin servicios externos.
 */
export function decodificarQrDelPdf(pdf: Buffer): string {
  // Latin1 mapea un carácter por byte, así los índices del texto valen para el Buffer.
  const texto = pdf.toString('latin1');
  const imagenes = [...texto.matchAll(/<<([^>]*\/Subtype \/Image[^>]*)>>\nstream\n/g)];
  for (const imagen of imagenes) {
    const dic = imagen[1] ?? '';
    if (!dic.includes('/DeviceRGB')) continue;
    const ancho = Number(/\/Width (\d+)/.exec(dic)?.[1]);
    const alto = Number(/\/Height (\d+)/.exec(dic)?.[1]);
    const largo = Number(/\/Length (\d+)/.exec(dic)?.[1]);
    const inicio = (imagen.index ?? 0) + imagen[0].length;
    const rgb = inflateSync(pdf.subarray(inicio, inicio + largo));
    if (rgb.length !== ancho * alto * 3) throw new Error('La imagen del PDF no es RGB de 8 bits.');
    const rgba = new Uint8ClampedArray(ancho * alto * 4);
    for (let i = 0; i < ancho * alto; i++) {
      rgba[i * 4] = rgb[i * 3] ?? 0;
      rgba[i * 4 + 1] = rgb[i * 3 + 1] ?? 0;
      rgba[i * 4 + 2] = rgb[i * 3 + 2] ?? 0;
      rgba[i * 4 + 3] = 255;
    }
    const codigo = jsQR(rgba, ancho, alto);
    if (!codigo) throw new Error('No se pudo decodificar el QR del PDF.');
    return codigo.data;
  }
  throw new Error('El PDF no contiene la imagen del QR.');
}

/**
 * Texto legible de las páginas del PDF: descomprime los streams y junta las cadenas hexadecimales
 * que pdfkit escribe con las fuentes estándar (WinAnsi, un byte por carácter).
 */
export function textoDelPdf(pdf: Buffer): string {
  const texto = pdf.toString('latin1');
  const partes: string[] = [];
  for (const flujo of texto.matchAll(/\/Filter \/FlateDecode[^>]*\/Length (\d+)[^>]*>>\nstream\n|<<[^>]*\/Length (\d+)[^>]*\/Filter \/FlateDecode[^>]*>>\nstream\n/g)) {
    const largo = Number(flujo[1] ?? flujo[2]);
    const inicio = (flujo.index ?? 0) + flujo[0].length;
    let contenido: string;
    try {
      contenido = inflateSync(pdf.subarray(inicio, inicio + largo)).toString('latin1');
    } catch {
      continue;
    }
    if (!contenido.includes(' Tf')) continue;
    for (const hex of contenido.matchAll(/<([0-9a-fA-F]+)>/g)) {
      partes.push(Buffer.from(hex[1] ?? '', 'hex').toString('latin1'));
    }
    partes.push('\n');
  }
  return partes.join('');
}
