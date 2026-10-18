// Las capas de un sprite, guardadas dentro de su PNG.
//
// La imagen que usa el juego es UNA: todos los cuadros con sus capas visibles
// ya compuestas (ver stripPixels en core/sprite-doc.ts). Antes eso era todo lo
// que se guardaba, y al volver a abrir la textura en la herramienta de sprites
// llegaba aplanada, en una sola capa: lo que estaba separado (el contorno, el
// color, una capa oculta con un boceto) se perdia.
//
// Ahora, ademas, el PNG lleva cada capa por separado en un bloque propio
// "hcLY", justo antes del final del archivo. Como el bloque de los cuadros
// (ver core/sprite-frames.ts), viaja con el archivo, y el motor, el navegador y
// cualquier visor lo saltan: la primera letra en minuscula dice "se puede
// ignorar". La cuarta en MAYUSCULA dice "no copiar si se edita la imagen": un
// programa que la cambie no deberia arrastrar capas que ya no son las suyas.
//
// Por si alguno lo copia igual, el bloque guarda un resumen de la imagen
// (IDAT) que acompañaba: si al abrirla ya no coincide, la imagen se cambio por
// fuera y se abre aplanada, como siempre, en vez de mostrar capas viejas.
//
// Adentro va texto JSON (UTF-8): el tamaño de un cuadro, cuantos cuadros, y
// cada capa con su nombre, si se ve, y sus pixeles como otro PNG (una tira con
// todos sus cuadros).

import { base64ToBytes, bytesToBase64, crc32, readUint32 } from './sprite-frames';

/** Una capa guardada: los pixeles de todos sus cuadros, uno al lado del otro, como PNG en base64. */
export interface StoredLayer {
  name: string;
  visible: boolean;
  png: string;
}

export interface StoredLayers {
  /** Un cuadro, en pixeles. */
  width: number;
  height: number;
  frames: number;
  /** De abajo hacia arriba, como en el documento. */
  layers: StoredLayer[];
}

const CHUNK_TYPE = 'hcLY';
const FORMAT = 1;

function typeBytes(type: string): Uint8Array {
  return Uint8Array.from(type, (char) => char.charCodeAt(0));
}

function asciiOf(bytes: Uint8Array): string {
  return String.fromCharCode(...bytes);
}

interface Chunk {
  type: string;
  /** Donde empieza el bloque (su largo). */
  offset: number;
  data: Uint8Array;
}

/** Los bloques de un PNG, en orden. Null si no es un PNG o esta cortado. */
function chunksOf(bytes: Uint8Array): Chunk[] | null {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 8 || !signature.every((byte, index) => bytes[index] === byte)) {
    return null;
  }
  const chunks: Chunk[] = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = readUint32(bytes, offset);
    if (offset + 12 + length > bytes.length) {
      return null;
    }
    const type = asciiOf(bytes.subarray(offset + 4, offset + 8));
    chunks.push({ type, offset, data: bytes.subarray(offset + 8, offset + 8 + length) });
    offset += 12 + length;
    if (type === 'IEND') {
      return chunks;
    }
  }
  return null;
}

/**
 * Un resumen de la imagen: FNV-1a de 32 bits sobre los datos de todos los
 * IDAT. No es seguridad, es para notar que otro programa la volvio a guardar.
 */
function imageDigest(chunks: Chunk[]): string {
  let hash = 0x811c9dc5;
  for (const chunk of chunks) {
    if (chunk.type !== 'IDAT') {
      continue;
    }
    for (const byte of chunk.data) {
      hash ^= byte;
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, '0');
}

function makeChunk(type: string, data: Uint8Array): Uint8Array {
  const body = new Uint8Array(4 + data.length);
  body.set(typeBytes(type));
  body.set(data, 4);
  const chunk = new Uint8Array(4 + body.length + 4);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.length);
  chunk.set(body, 4);
  view.setUint32(4 + body.length, crc32(body));
  return chunk;
}

/**
 * El PNG (en base64, como lo arma la herramienta de sprites) con sus capas
 * adentro. Si ya traia un bloque de capas, se reemplaza. Un PNG que no se
 * puede leer sale igual.
 */
export function withSpriteLayers(pngBase64: string, stored: StoredLayers): string {
  const bytes = base64ToBytes(pngBase64);
  const chunks = chunksOf(bytes);
  if (!chunks) {
    return pngBase64;
  }
  const payload = new TextEncoder().encode(
    JSON.stringify({ format: FORMAT, image: imageDigest(chunks), ...stored }),
  );
  const layerChunk = makeChunk(CHUNK_TYPE, payload);
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  for (const chunk of chunks) {
    if (chunk.type === CHUNK_TYPE) {
      continue;
    }
    if (chunk.type === 'IEND') {
      parts.push(layerChunk);
    }
    parts.push(bytes.subarray(chunk.offset, chunk.offset + 12 + chunk.data.length));
  }
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return bytesToBase64(out);
}

/**
 * Las capas que trae un PNG, leidas de su data URL. Null si no es un PNG, no
 * las trae, estan rotas, o la imagen ya no es la que se guardo con ellas.
 */
export function readSpriteLayers(dataUrl: string): StoredLayers | null {
  const prefix = 'data:image/png;base64,';
  if (!dataUrl.startsWith(prefix)) {
    return null;
  }
  let chunks: Chunk[] | null;
  try {
    chunks = chunksOf(base64ToBytes(dataUrl.slice(prefix.length)));
  } catch {
    return null;
  }
  const chunk = chunks?.find((candidate) => candidate.type === CHUNK_TYPE);
  if (!chunks || !chunk) {
    return null;
  }
  try {
    const data = JSON.parse(new TextDecoder().decode(chunk.data)) as Partial<StoredLayers> & { format?: unknown; image?: unknown };
    if (data.format !== FORMAT || data.image !== imageDigest(chunks)) {
      return null;
    }
    const whole = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value > 0;
    if (!whole(data.width) || !whole(data.height) || !whole(data.frames) || !Array.isArray(data.layers) || data.layers.length === 0) {
      return null;
    }
    const layers = data.layers.filter(
      (layer): layer is StoredLayer =>
        !!layer && typeof layer.png === 'string' && typeof layer.name === 'string' && typeof layer.visible === 'boolean',
    );
    if (layers.length !== data.layers.length) {
      return null;
    }
    return { width: data.width!, height: data.height!, frames: data.frames!, layers };
  } catch {
    return null;
  }
}
