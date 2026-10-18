// =============================================================================
// Los iconos y el logo de HoneyComb, a partir de las dos imagenes de la marca
// =============================================================================
//
// Las fuentes son editor/public/favicon.png (la oscura) y
// tools/brand/logo-claro.png (la clara): la abeja dentro del hexagono, sobre un
// fondo cuadrado casi negro. De ahi salen:
//
//   editor/public/favicon.ico        (oscuro) la ventana del editor, su barra de
//                                    tareas y el acceso directo del instalador
//   editor/public/icon.png           (oscuro) lo mismo en PNG (Linux no usa .ico)
//   engine/resources/honeycomb.ico   (oscuro) el .exe del motor y su ventana
//                                    (ver engine/resources/engine.rc)
//   editor/public/logo-oscuro.png    el logo de la barra de menus en el tema oscuro
//   editor/public/logo-claro.png     y en el tema claro (Pastel claro)
//
// Lo de afuera del hexagono se vuelve transparente: un icono con el cuadrado
// negro se veria como un recuadro en la barra de tareas y en el tema claro. La
// mascara es el hexagono medido en las imagenes (no uno regular: el dibujo es
// apenas mas angosto), un poco hacia adentro para no arrastrar el borde oscuro
// que el antialias deja entre el marco y el fondo.
//
// Uso: node tools/gen-icon.mjs   (desde la raiz del repositorio)
//
// Sin dependencias: el PNG se lee y se escribe a mano con zlib, y el .ico
// guarda cada tamano como PNG, que Windows lee desde Vista.
// =============================================================================

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRAND = join(ROOT, 'tools', 'brand');

/** Los tamanos que Windows usa de un icono: lista, Explorador, barra de tareas, vistas grandes. */
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];
/** El logo de la barra de menus se ve a 20 px; 128 lo deja nitido en pantallas de alta densidad. */
const LOGO_SIZE = 128;

/**
 * El hexagono de las dos imagenes (1254 x 1254), medido en pixeles: punta
 * arriba y abajo en x = centerX, lados verticales en left y right entre
 * centerY - side y centerY + side.
 */
const HEXAGON = { centerX: 627, top: 171, bottom: 1005, left: 271, right: 983, centerY: 589, side: 214 };
/** Cuanto se mete la mascara hacia adentro, en pixeles de la imagen original. */
const INSET = 2.5;

// --- PNG: leer -----------------------------------------------------------------

/** Un PNG de 8 bits RGB o RGBA, sin entrelazar, como pixeles RGBA. */
function decodePng(file) {
  const bytes = readFileSync(file);
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString('latin1', offset + 4, offset + 8);
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      colorType = data[9];
      if (data[8] !== 8 || (colorType !== 2 && colorType !== 6) || data[12] !== 0) {
        throw new Error(`${file}: solo PNG de 8 bits RGB o RGBA, sin entrelazar`);
      }
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  const pixels = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const current = Buffer.alloc(stride);
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? current[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      let predicted = 0;
      if (filter === 1) predicted = left;
      else if (filter === 2) predicted = up;
      else if (filter === 3) predicted = (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      current[x] = (line[x] + predicted) & 0xff;
    }
    for (let x = 0; x < width; x += 1) {
      const at = (y * width + x) * 4;
      pixels[at] = current[x * channels];
      pixels[at + 1] = current[x * channels + 1];
      pixels[at + 2] = current[x * channels + 2];
      pixels[at + 3] = channels === 4 ? current[x * channels + 3] : 255;
    }
    previous = current;
  }
  return { width, height, pixels };
}

// --- La mascara y el recorte -------------------------------------------------------

/** true si (x, y) esta adentro del hexagono medido, achicado INSET. */
function insideHexagon(x, y) {
  const h = HEXAGON;
  const left = h.left + INSET;
  const right = h.right - INSET;
  const top = h.top + INSET * 1.15;
  const bottom = h.bottom - INSET * 1.15;
  if (x < left || x > right || y < top || y > bottom) return false;
  // Los cuatro lados inclinados: de la punta de arriba (o abajo) a cada esquina.
  const halfWidth = x < h.centerX ? h.centerX - left : right - h.centerX;
  const t = Math.abs(x - h.centerX) / halfWidth; // 0 en el centro, 1 en el lado
  const upper = top + t * (h.centerY - h.side - top);
  const lower = bottom - t * (bottom - (h.centerY + h.side));
  return y >= upper && y <= lower;
}

/**
 * El cuadrado que encierra al hexagono, con lo de afuera transparente.
 * Devuelve los pixeles RGBA premultiplicados en float, listos para achicar.
 */
function cropToHexagon(image) {
  const h = HEXAGON;
  const size = Math.max(h.bottom - h.top, h.right - h.left) + 4;
  const originX = Math.round(h.centerX - size / 2);
  const originY = Math.round((h.top + h.bottom) / 2 - size / 2);
  const out = new Float32Array(size * size * 4);
  const steps = 4;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sx = originX + x;
      const sy = originY + y;
      if (sx < 0 || sy < 0 || sx >= image.width || sy >= image.height) continue;
      let covered = 0;
      for (let j = 0; j < steps; j += 1) {
        for (let i = 0; i < steps; i += 1) {
          if (insideHexagon(sx + (i + 0.5) / steps, sy + (j + 0.5) / steps)) covered += 1;
        }
      }
      if (covered === 0) continue;
      const alpha = (covered / (steps * steps)) * (image.pixels[(sy * image.width + sx) * 4 + 3] / 255);
      const from = (sy * image.width + sx) * 4;
      const to = (y * size + x) * 4;
      out[to] = image.pixels[from] * alpha;
      out[to + 1] = image.pixels[from + 1] * alpha;
      out[to + 2] = image.pixels[from + 2] * alpha;
      out[to + 3] = alpha;
    }
  }
  return { size, pixels: out };
}

/**
 * Achica el cuadrado a "target" pixeles promediando el area que cubre cada
 * uno (en premultiplicado, para que el borde transparente no oscurezca).
 */
function resize(square, target) {
  const { size, pixels } = square;
  const scale = size / target;
  const out = Buffer.alloc(target * target * 4);
  for (let ty = 0; ty < target; ty += 1) {
    const y0 = ty * scale;
    const y1 = y0 + scale;
    for (let tx = 0; tx < target; tx += 1) {
      const x0 = tx * scale;
      const x1 = x0 + scale;
      const sum = [0, 0, 0, 0];
      let weight = 0;
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy += 1) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx += 1) {
          const w = wy * (Math.min(x1, sx + 1) - Math.max(x0, sx));
          const at = (sy * size + sx) * 4;
          for (let c = 0; c < 4; c += 1) sum[c] += pixels[at + c] * w;
          weight += w;
        }
      }
      const at = (ty * target + tx) * 4;
      const alpha = sum[3] / weight;
      if (alpha > 0) {
        out[at] = Math.round(Math.min(255, sum[0] / weight / alpha));
        out[at + 1] = Math.round(Math.min(255, sum[1] / weight / alpha));
        out[at + 2] = Math.round(Math.min(255, sum[2] / weight / alpha));
        out[at + 3] = Math.round(alpha * 255);
      }
    }
  }
  return out;
}

// --- PNG e ICO: escribir -----------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(pixels, size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits por canal
  header[9] = 6; // RGBA
  // Cada fila empieza con su filtro (0 = ninguno).
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let row = 0; row < size; row += 1) {
    pixels.copy(raw, row * (size * 4 + 1) + 1, row * size * 4, (row + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Un .ico con cada imagen guardada como PNG. */
function encodeIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 1 = icono
  header.writeUInt16LE(images.length, 4);
  const entries = [];
  let offset = 6 + 16 * images.length;
  for (const { size, png } of images) {
    const entry = Buffer.alloc(16);
    entry[0] = size >= 256 ? 0 : size; // 0 = 256
    entry[1] = size >= 256 ? 0 : size;
    entry.writeUInt16LE(1, 4); // planos
    entry.writeUInt16LE(32, 6); // bits por pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += png.length;
    entries.push(entry);
  }
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

// --- Todo junto ------------------------------------------------------------------------

const dark = cropToHexagon(decodePng(join(ROOT, 'editor', 'public', 'favicon.png')));
const light = cropToHexagon(decodePng(join(BRAND, 'logo-claro.png')));

const icons = ICON_SIZES.map((size) => ({ size, png: encodePng(resize(dark, size), size) }));
const ico = encodeIco(icons);

const outputs = [
  [join(ROOT, 'editor', 'public', 'favicon.ico'), ico],
  [join(ROOT, 'editor', 'public', 'icon.png'), icons.find((icon) => icon.size === 256).png],
  [join(ROOT, 'engine', 'resources', 'honeycomb.ico'), ico],
  [join(ROOT, 'editor', 'public', 'logo-oscuro.png'), encodePng(resize(dark, LOGO_SIZE), LOGO_SIZE)],
  [join(ROOT, 'editor', 'public', 'logo-claro.png'), encodePng(resize(light, LOGO_SIZE), LOGO_SIZE)],
];
for (const [file, bytes] of outputs) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
  console.log(`${file.slice(ROOT.length + 1)}: ${bytes.length} bytes`);
}
