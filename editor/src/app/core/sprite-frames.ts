// Cuadros de animacion de un sprite: cuantos trae y como se recorta el primero.
//
// LOS CUADROS SON DEL SPRITE, NO DEL PERSONAJE. Una tira de 4 cuadros anima en
// 4 sea jugador o enemigo, y una imagen suelta tiene 1 aunque el personaje que
// la usaba antes tuviera 2. Antes la cantidad venia del tipo y se arrastraba al
// cambiar de imagen: un jugador (2 cuadros) con una imagen suelta partia la
// imagen por la mitad, o pedia un segundo cuadro que caia fuera de ella, y en
// el juego se veia cortado o no se veia.
//
// Por eso, al elegir una imagen, los cuadros se ponen con lo que la imagen
// dice de si misma, y 1 si no dice nada.
//
// COMO LO DICE: la herramienta de sprites guarda la cantidad DENTRO del PNG,
// en un bloque de texto "tEXt" con la clave "HoneyComb". Viaja con el archivo
// (copiarlo o renombrarlo no lo pierde) y no molesta a nadie: el motor, el
// navegador y cualquier visor de imagenes saltan los bloques que no conocen.
// Va justo despues de IHDR, el primer bloque, asi que para leerlo alcanza con
// los primeros bytes del archivo y no hace falta decodificar la imagen entera.

import { SourceRect } from '../models/level.model';

/** El "frameDuration" que asume el motor cuando una entidad no lo trae. */
export const DEFAULT_FRAME_DURATION = 0.15;

export interface SpriteFrames {
  /** Cuadros uno al lado del otro, del mismo ancho. 1 = quieto. */
  frames: number;
  /** Segundos por cuadro. */
  frameDuration: number;
}

/**
 * Recorte del primer cuadro de una tira: la imagen entera partida en "frames"
 * partes iguales, una al lado de la otra, que es como el motor la anima.
 */
export function stripRect(width: number, height: number, frames: number): SourceRect {
  return { x: 0, y: 0, width: Math.max(1, Math.floor(width / Math.max(1, frames))), height };
}

/**
 * true si el recorte es justo el de stripRect para esa imagen y esa cantidad:
 * el que se puso solo al elegir la imagen. Ese se puede volver a partir al
 * cambiar los cuadros; uno hecho a mano (un pedazo de una captura) no se toca.
 */
export function isStripRect(rect: SourceRect, width: number, height: number, frames: number): boolean {
  const strip = stripRect(width, height, frames);
  return rect.x === 0 && rect.y === 0 && rect.width === strip.width && rect.height === strip.height;
}

// --- Dentro del PNG ----------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const KEYWORD = 'HoneyComb';
/** Firma (8) + IHDR entero (4 de largo, 4 de tipo, 13 de datos, 4 de CRC). */
const AFTER_IHDR = 8 + 25;
/**
 * Cuanto base64 se decodifica para buscar el bloque: 4 KB dan 3 KB de archivo,
 * de sobra para la firma, IHDR y el bloque, que pesa menos de 100 bytes.
 */
const HEADER_BASE64_CHARS = 4096;
const PNG_DATA_URL_PREFIX = 'data:image/png;base64,';

let crcTable: Uint32Array | null = null;

/** CRC-32 de PNG (el mismo de zlib), sobre el tipo y los datos del bloque. */
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= AFTER_IHDR && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

export function readUint32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function asciiOf(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

/**
 * El PNG (en base64, como lo arma la herramienta de sprites) con la cantidad
 * de cuadros adentro. Un PNG de un solo cuadro no lo necesita y sale igual.
 */
export function withSpriteFrames(pngBase64: string, meta: SpriteFrames): string {
  const bytes = base64ToBytes(pngBase64);
  const startsWithIhdr = isPng(bytes) && readUint32(bytes, 8) === 13 && asciiOf(bytes.subarray(12, 16)) === 'IHDR';
  if (!startsWithIhdr || meta.frames <= 1) {
    return pngBase64;
  }
  const text = KEYWORD + '\0' + JSON.stringify({ frames: meta.frames, frameDuration: meta.frameDuration });
  const body = new Uint8Array(4 + text.length);
  body.set([0x74, 0x45, 0x58, 0x74]); // "tEXt"
  for (let i = 0; i < text.length; i += 1) {
    body[4 + i] = text.charCodeAt(i);
  }
  const chunk = new Uint8Array(4 + body.length + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, text.length);
  chunk.set(body, 4);
  view.setUint32(4 + body.length, crc32(body));

  const out = new Uint8Array(bytes.length + chunk.length);
  out.set(bytes.subarray(0, AFTER_IHDR));
  out.set(chunk, AFTER_IHDR);
  out.set(bytes.subarray(AFTER_IHDR), AFTER_IHDR + chunk.length);
  return bytesToBase64(out);
}

/**
 * Los cuadros que un PNG dice tener, leidos de su data URL. Null si no es un
 * PNG o no trae el bloque: una imagen cualquiera, que se toma como 1 cuadro.
 */
export function readSpriteFrames(dataUrl: string): SpriteFrames | null {
  if (!dataUrl.startsWith(PNG_DATA_URL_PREFIX)) {
    return null;
  }
  let head = dataUrl.slice(PNG_DATA_URL_PREFIX.length, PNG_DATA_URL_PREFIX.length + HEADER_BASE64_CHARS);
  head = head.slice(0, head.length - (head.length % 4));
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(head);
  } catch {
    return null;
  }
  if (!isPng(bytes)) {
    return null;
  }

  // Bloques: largo (4), tipo (4), datos, CRC (4). Se recorren hasta la imagen
  // (IDAT): los bloques de texto que se leen van antes.
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = readUint32(bytes, offset);
    const type = asciiOf(bytes.subarray(offset + 4, offset + 8));
    if (type === 'IDAT' || type === 'IEND' || offset + 8 + length > bytes.length) {
      return null;
    }
    if (type === 'tEXt') {
      const data = asciiOf(bytes.subarray(offset + 8, offset + 8 + length));
      const separator = data.indexOf('\0');
      if (separator >= 0 && data.slice(0, separator) === KEYWORD) {
        return parseMeta(data.slice(separator + 1));
      }
    }
    offset += 12 + length;
  }
  return null;
}

function parseMeta(text: string): SpriteFrames | null {
  try {
    const data = JSON.parse(text) as Partial<SpriteFrames>;
    const frames = typeof data.frames === 'number' && Number.isFinite(data.frames) ? Math.round(data.frames) : 0;
    if (frames < 1) {
      return null;
    }
    const duration = data.frameDuration;
    return {
      frames,
      frameDuration: typeof duration === 'number' && duration > 0 ? duration : DEFAULT_FRAME_DURATION,
    };
  } catch {
    return null;
  }
}
