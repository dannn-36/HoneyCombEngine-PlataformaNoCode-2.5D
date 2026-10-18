// HoneyComb Engine - Editor (herramienta de sprites: el documento y el dibujo)
//
// La logica de la herramienta de sprites (sprites/), sin Angular ni canvas,
// para poder testearla. Un sprite es una grilla de pixeles RGBA con CAPAS, que
// se apilan, y CUADROS, que se animan, como en Aseprite: cada cuadro tiene un
// "cel" (los pixeles de una capa en ese cuadro) por capa.
//
// INMUTABLE. Las operaciones devuelven un documento nuevo y nunca modifican los
// pixeles de uno que ya existe. Por eso deshacer es volver al documento
// anterior, sin copiar nada: un cuadro duplicado comparte sus cels con el
// original hasta que se pinta encima, y el trazo trabaja sobre una copia (ver
// el controlador). Las funciones de dibujo de abajo (stampBrush, floodFill...)
// SI modifican el buffer que reciben: son para esa copia de trabajo.
//
// AL GUARDAR, los cuadros van uno al lado del otro en un solo PNG (stripPixels):
// es como anima el motor ("frames" en schema/level.schema.json, desde
// sourceRect), con las capas visibles compuestas. Las capas, ocultas incluidas,
// van ademas por separado dentro del mismo PNG (ver core/sprite-layers.ts).

import { hexToRgb, rgbToHex } from './color';

export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0 = transparente, 255 = opaco. */
  a: number;
}

export const TRANSPARENT: Rgba = { r: 0, g: 0, b: 0, a: 0 };

export interface SpriteLayer {
  readonly id: string;
  readonly name: string;
  readonly visible: boolean;
}

export interface SpriteFrame {
  readonly id: string;
  /** Los pixeles de cada capa en este cuadro, por id de capa: width * height * 4 bytes RGBA. */
  readonly cels: Readonly<Record<string, Uint8ClampedArray>>;
}

export interface SpriteDoc {
  readonly width: number;
  readonly height: number;
  /** De abajo hacia arriba, que es el orden en que se componen. */
  readonly layers: readonly SpriteLayer[];
  readonly frames: readonly SpriteFrame[];
}

export interface PixelPoint {
  x: number;
  y: number;
}

/**
 * Lado maximo de un sprite. Las piezas de Kenney miden 256 x 512; mas de 1024
 * ya no es pixel art, y cada cel de 1024 x 1024 pesa 4 MB en memoria.
 */
export const SPRITE_SIDE_MAX = 1024;
/** Tope de cuadros y capas: de sobra para un sprite, y acota la memoria. */
export const SPRITE_FRAMES_MAX = 64;
export const SPRITE_LAYERS_MAX = 16;

let idCounter = 0;

function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter}`;
}

/** Lado valido: entero de 1 a SPRITE_SIDE_MAX. Basura (NaN) = 1. */
export function clampSide(value: number): number {
  return Math.min(SPRITE_SIDE_MAX, Math.max(1, Math.round(value) || 1));
}

export function blankPixels(width: number, height: number): Uint8ClampedArray {
  return new Uint8ClampedArray(width * height * 4);
}

/** Un sprite vacio: una capa transparente y un cuadro. */
export function createDoc(width: number, height: number): SpriteDoc {
  const w = clampSide(width);
  const h = clampSide(height);
  const layer: SpriteLayer = { id: newId('capa'), name: 'Capa 1', visible: true };
  return { width: w, height: h, layers: [layer], frames: [{ id: newId('cuadro'), cels: { [layer.id]: blankPixels(w, h) } }] };
}

/** Un rectangulo de una imagen RGBA, como pixeles propios. */
export function cropPixels(
  source: Uint8ClampedArray,
  sourceWidth: number,
  x: number,
  y: number,
  width: number,
  height: number,
): Uint8ClampedArray {
  const out = blankPixels(width, height);
  for (let row = 0; row < height; row += 1) {
    const from = ((y + row) * sourceWidth + x) * 4;
    out.set(source.subarray(from, from + width * 4), row * width * 4);
  }
  return out;
}

/**
 * Un sprite a partir de una imagen ya decodificada, partida en "frameCount"
 * cuadros iguales uno al lado del otro (una tira como las que anima el motor).
 * Falla si el ancho no se divide en partes iguales.
 */
export function docFromImage(pixels: Uint8ClampedArray, width: number, height: number, frameCount = 1): SpriteDoc {
  const count = Math.max(1, Math.floor(frameCount) || 1);
  if (width % count !== 0) {
    throw new Error(`${width} px de ancho no se dividen en ${count} cuadros iguales.`);
  }
  const frameWidth = width / count;
  if (frameWidth > SPRITE_SIDE_MAX || height > SPRITE_SIDE_MAX) {
    throw new Error(`La herramienta de sprites abre imágenes de hasta ${SPRITE_SIDE_MAX} px por lado.`);
  }
  if (count > SPRITE_FRAMES_MAX) {
    throw new Error(`Un sprite tiene como mucho ${SPRITE_FRAMES_MAX} cuadros.`);
  }
  const layer: SpriteLayer = { id: newId('capa'), name: 'Capa 1', visible: true };
  const frames = Array.from({ length: count }, (_, index) => ({
    id: newId('cuadro'),
    cels: { [layer.id]: cropPixels(pixels, width, index * frameWidth, 0, frameWidth, height) },
  }));
  return { width: frameWidth, height, layers: [layer], frames };
}

/** Una capa con los pixeles de todos sus cuadros uno al lado del otro: como se guarda (ver core/sprite-layers.ts). */
export interface LayerStrip {
  name: string;
  visible: boolean;
  pixels: Uint8ClampedArray;
}

/**
 * Un sprite con sus capas, a partir de las tiras de cada una (cuadros de
 * width x height, "frameCount" uno al lado del otro). Es lo que se guardo con
 * la herramienta, de vuelta como estaba. Falla si las tiras no tienen el
 * tamaño que dicen tener.
 */
export function docFromLayers(width: number, height: number, frameCount: number, strips: readonly LayerStrip[]): SpriteDoc {
  if (width > SPRITE_SIDE_MAX || height > SPRITE_SIDE_MAX || width < 1 || height < 1) {
    throw new Error(`La herramienta de sprites abre imágenes de hasta ${SPRITE_SIDE_MAX} px por lado.`);
  }
  if (frameCount < 1 || frameCount > SPRITE_FRAMES_MAX) {
    throw new Error(`Un sprite tiene como mucho ${SPRITE_FRAMES_MAX} cuadros.`);
  }
  if (strips.length < 1 || strips.length > SPRITE_LAYERS_MAX) {
    throw new Error(`Un sprite tiene entre 1 y ${SPRITE_LAYERS_MAX} capas.`);
  }
  const stripWidth = width * frameCount;
  const layers = strips.map((strip) => {
    if (strip.pixels.length !== stripWidth * height * 4) {
      throw new Error(`La capa «${strip.name}» no tiene el tamaño del sprite.`);
    }
    return { id: newId('capa'), name: strip.name || 'Capa', visible: strip.visible };
  });
  const frames = Array.from({ length: frameCount }, (_, index) => ({
    id: newId('cuadro'),
    cels: Object.fromEntries(
      layers.map((layer, layerIndex) => [
        layer.id,
        cropPixels(strips[layerIndex].pixels, stripWidth, index * width, 0, width, height),
      ]),
    ),
  }));
  return { width, height, layers, frames };
}

/** Los pixeles de una capa en todos los cuadros, uno al lado del otro: lo que se guarda de ella. */
export function layerStripPixels(doc: SpriteDoc, layerId: string): Uint8ClampedArray {
  const width = doc.width * doc.frames.length;
  const pixels = blankPixels(width, doc.height);
  doc.frames.forEach((frame, index) => {
    const cel = celOf(doc, frame, layerId);
    for (let row = 0; row < doc.height; row += 1) {
      pixels.set(cel.subarray(row * doc.width * 4, (row + 1) * doc.width * 4), (row * width + index * doc.width) * 4);
    }
  });
  return pixels;
}

/**
 * Un sprite de un solo cuadro partido en "count" cuadros iguales: lo que se
 * abrio como una imagen era una tira. Null si no se puede (mas de un cuadro, o
 * un ancho que no se divide).
 */
export function splitIntoFrames(doc: SpriteDoc, count: number): SpriteDoc | null {
  const parts = Math.floor(count);
  if (doc.frames.length !== 1 || parts < 2 || parts > SPRITE_FRAMES_MAX || doc.width % parts !== 0) {
    return null;
  }
  const width = doc.width / parts;
  const source = doc.frames[0];
  const frames = Array.from({ length: parts }, (_, index) => ({
    id: newId('cuadro'),
    cels: Object.fromEntries(
      doc.layers.map((layer) => [layer.id, cropPixels(celOf(doc, source, layer.id), doc.width, index * width, 0, width, doc.height)]),
    ),
  }));
  return { ...doc, width, frames };
}

/** Los pixeles de una capa en un cuadro. Un cel que falta se lee como transparente. */
export function celOf(doc: SpriteDoc, frame: SpriteFrame, layerId: string): Uint8ClampedArray {
  return frame.cels[layerId] ?? blankPixels(doc.width, doc.height);
}

/** Reemplaza los pixeles de una capa en un cuadro. */
export function setCel(doc: SpriteDoc, frameIndex: number, layerId: string, pixels: Uint8ClampedArray): SpriteDoc {
  const frames = doc.frames.map((frame, index) =>
    index === frameIndex ? { ...frame, cels: { ...frame.cels, [layerId]: pixels } } : frame,
  );
  return { ...doc, frames };
}

// --- Capas -------------------------------------------------------------------

/** "Capa N" con el primer N que no usa ninguna otra. */
function nextLayerName(doc: SpriteDoc): string {
  const used = new Set(doc.layers.map((layer) => layer.name));
  let n = doc.layers.length + 1;
  while (used.has(`Capa ${n}`)) {
    n += 1;
  }
  return `Capa ${n}`;
}

function layerIndex(doc: SpriteDoc, layerId: string): number {
  return doc.layers.findIndex((layer) => layer.id === layerId);
}

/** Capa nueva y transparente justo encima de "aboveId" (o arriba de todo). */
export function addLayer(doc: SpriteDoc, aboveId?: string): { doc: SpriteDoc; layerId: string } {
  if (doc.layers.length >= SPRITE_LAYERS_MAX) {
    return { doc, layerId: aboveId ?? doc.layers[doc.layers.length - 1].id };
  }
  const layer: SpriteLayer = { id: newId('capa'), name: nextLayerName(doc), visible: true };
  const at = aboveId === undefined ? doc.layers.length : layerIndex(doc, aboveId) + 1;
  const layers = [...doc.layers.slice(0, at), layer, ...doc.layers.slice(at)];
  const frames = doc.frames.map((frame) => ({ ...frame, cels: { ...frame.cels, [layer.id]: blankPixels(doc.width, doc.height) } }));
  return { doc: { ...doc, layers, frames }, layerId: layer.id };
}

/** Copia de una capa justo encima de ella. Comparte los pixeles hasta que se pinte encima. */
export function duplicateLayer(doc: SpriteDoc, layerId: string): { doc: SpriteDoc; layerId: string } {
  const at = layerIndex(doc, layerId);
  if (at < 0 || doc.layers.length >= SPRITE_LAYERS_MAX) {
    return { doc, layerId };
  }
  const original = doc.layers[at];
  const copy: SpriteLayer = { id: newId('capa'), name: `${original.name} copia`, visible: original.visible };
  const layers = [...doc.layers.slice(0, at + 1), copy, ...doc.layers.slice(at + 1)];
  const frames = doc.frames.map((frame) => ({ ...frame, cels: { ...frame.cels, [copy.id]: celOf(doc, frame, layerId) } }));
  return { doc: { ...doc, layers, frames }, layerId: copy.id };
}

/** Saca una capa. La ultima no se puede sacar: un sprite sin capas no tiene donde pintar. */
export function removeLayer(doc: SpriteDoc, layerId: string): SpriteDoc {
  if (doc.layers.length <= 1 || layerIndex(doc, layerId) < 0) {
    return doc;
  }
  const layers = doc.layers.filter((layer) => layer.id !== layerId);
  const frames = doc.frames.map((frame) => {
    const cels = { ...frame.cels };
    delete cels[layerId];
    return { ...frame, cels };
  });
  return { ...doc, layers, frames };
}

/** Sube (+1) o baja (-1) una capa en la pila. */
export function moveLayer(doc: SpriteDoc, layerId: string, delta: number): SpriteDoc {
  const from = layerIndex(doc, layerId);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= doc.layers.length) {
    return doc;
  }
  const layers = [...doc.layers];
  [layers[from], layers[to]] = [layers[to], layers[from]];
  return { ...doc, layers };
}

export function patchLayer(doc: SpriteDoc, layerId: string, patch: Partial<Omit<SpriteLayer, 'id'>>): SpriteDoc {
  return { ...doc, layers: doc.layers.map((layer) => (layer.id === layerId ? { ...layer, ...patch } : layer)) };
}

// --- Cuadros -----------------------------------------------------------------

/**
 * Cuadro nuevo justo despues de "afterIndex": vacio, o copia del cuadro
 * "afterIndex" (que comparte los pixeles hasta que se pinte encima).
 */
export function addFrame(doc: SpriteDoc, afterIndex: number, copy: boolean): { doc: SpriteDoc; index: number } {
  if (doc.frames.length >= SPRITE_FRAMES_MAX) {
    return { doc, index: afterIndex };
  }
  const source = doc.frames[afterIndex];
  const cels = Object.fromEntries(
    doc.layers.map((layer) => [layer.id, copy && source ? celOf(doc, source, layer.id) : blankPixels(doc.width, doc.height)]),
  );
  const at = afterIndex + 1;
  const frames = [...doc.frames.slice(0, at), { id: newId('cuadro'), cels }, ...doc.frames.slice(at)];
  return { doc: { ...doc, frames }, index: at };
}

/** Saca un cuadro. El ultimo no se puede sacar. */
export function removeFrame(doc: SpriteDoc, index: number): SpriteDoc {
  if (doc.frames.length <= 1 || index < 0 || index >= doc.frames.length) {
    return doc;
  }
  return { ...doc, frames: doc.frames.filter((_, i) => i !== index) };
}

/** Corre un cuadro un lugar a la izquierda (-1) o a la derecha (+1). */
export function moveFrame(doc: SpriteDoc, index: number, delta: number): SpriteDoc {
  const to = index + delta;
  if (index < 0 || index >= doc.frames.length || to < 0 || to >= doc.frames.length) {
    return doc;
  }
  const frames = [...doc.frames];
  [frames[index], frames[to]] = [frames[to], frames[index]];
  return { ...doc, frames };
}

// --- Composicion -------------------------------------------------------------

/** Pinta "source" encima de "target" (alfa normal, "source-over"). Modifica target. */
function blendOver(target: Uint8ClampedArray, source: Uint8ClampedArray): void {
  for (let i = 0; i < target.length; i += 4) {
    const sourceAlpha = source[i + 3];
    if (sourceAlpha === 0) {
      continue;
    }
    if (sourceAlpha === 255 || target[i + 3] === 0) {
      target[i] = source[i];
      target[i + 1] = source[i + 1];
      target[i + 2] = source[i + 2];
      target[i + 3] = sourceAlpha;
      continue;
    }
    const a = sourceAlpha / 255;
    const b = (target[i + 3] / 255) * (1 - a);
    const alpha = a + b;
    target[i] = (source[i] * a + target[i] * b) / alpha;
    target[i + 1] = (source[i + 1] * a + target[i + 1] * b) / alpha;
    target[i + 2] = (source[i + 2] * a + target[i + 2] * b) / alpha;
    target[i + 3] = alpha * 255;
  }
}

/**
 * Las capas visibles de un cuadro, una encima de otra. "override" reemplaza los
 * pixeles de una capa: es el trazo que se esta dibujando, todavia sin guardar
 * en el documento.
 */
export function compositeFrame(
  doc: SpriteDoc,
  frameIndex: number,
  override?: { layerId: string; pixels: Uint8ClampedArray },
): Uint8ClampedArray {
  const out = blankPixels(doc.width, doc.height);
  const frame = doc.frames[frameIndex];
  if (!frame) {
    return out;
  }
  for (const layer of doc.layers) {
    if (!layer.visible) {
      continue;
    }
    const pixels = override?.layerId === layer.id ? override.pixels : frame.cels[layer.id];
    if (pixels) {
      blendOver(out, pixels);
    }
  }
  return out;
}

/** Todos los cuadros, compuestos, uno al lado del otro: la imagen que se guarda. */
export function stripPixels(doc: SpriteDoc): { pixels: Uint8ClampedArray; width: number; height: number } {
  const width = doc.width * doc.frames.length;
  const pixels = blankPixels(width, doc.height);
  doc.frames.forEach((_, index) => {
    const frame = compositeFrame(doc, index);
    for (let row = 0; row < doc.height; row += 1) {
      pixels.set(frame.subarray(row * doc.width * 4, (row + 1) * doc.width * 4), (row * width + index * doc.width) * 4);
    }
  });
  return { pixels, width, height: doc.height };
}

/** Los colores distintos y opacos de un sprite, en el orden en que aparecen. Hasta "limit". */
export function uniqueColors(doc: SpriteDoc, limit: number): string[] {
  const seen = new Set<string>();
  for (const frame of doc.frames) {
    for (const layer of doc.layers) {
      const pixels = frame.cels[layer.id];
      if (!pixels) {
        continue;
      }
      for (let i = 0; i < pixels.length && seen.size < limit; i += 4) {
        if (pixels[i + 3] > 0) {
          seen.add(rgbToHex({ r: pixels[i], g: pixels[i + 1], b: pixels[i + 2] }));
        }
      }
    }
  }
  return [...seen];
}

// --- Color -------------------------------------------------------------------

export function rgbaToHex(color: Rgba): string {
  return rgbToHex(color);
}

/** "#rrggbb" a un color opaco. Cualquier otra cosa = null. */
export function hexToRgba(text: string): Rgba | null {
  const rgb = hexToRgb(text);
  return rgb ? { ...rgb, a: 255 } : null;
}

export function sameColor(a: Rgba, b: Rgba): boolean {
  // Dos transparentes son el mismo color aunque tengan distinto RGB debajo.
  if (a.a === 0 && b.a === 0) {
    return true;
  }
  return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
}

export function pixelAt(pixels: Uint8ClampedArray, width: number, x: number, y: number): Rgba {
  const i = (y * width + x) * 4;
  return { r: pixels[i], g: pixels[i + 1], b: pixels[i + 2], a: pixels[i + 3] };
}

// --- Dibujo (sobre la copia de trabajo) --------------------------------------

/** Escribe un pixel, sin mezclar: el pixel art reemplaza. Fuera del lienzo no hace nada. */
export function paintPixel(pixels: Uint8ClampedArray, width: number, height: number, x: number, y: number, color: Rgba): void {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return;
  }
  const i = (y * width + x) * 4;
  pixels[i] = color.r;
  pixels[i + 1] = color.g;
  pixels[i + 2] = color.b;
  pixels[i + 3] = color.a;
}

/**
 * El pincel cuadrado de "size" pixeles de lado, con (x, y) adentro. Con lado
 * par, el pixel del cursor queda arriba a la izquierda del centro.
 */
export function brushOrigin(x: number, y: number, size: number): PixelPoint {
  const half = Math.floor((size - 1) / 2);
  return { x: x - half, y: y - half };
}

export function stampBrush(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  x: number,
  y: number,
  size: number,
  color: Rgba,
): void {
  const origin = brushOrigin(x, y, size);
  for (let dy = 0; dy < size; dy += 1) {
    for (let dx = 0; dx < size; dx += 1) {
      paintPixel(pixels, width, height, origin.x + dx, origin.y + dy, color);
    }
  }
}

/**
 * Los pixeles de una linea de (x0, y0) a (x1, y1), con Bresenham: sin huecos ni
 * pixeles dobles.
 *
 * La 2:1 exacta (y la 1:2) va aparte, en pares de dos pixeles desde el primero:
 * es la linea de los bordes de un rombo isometrico. Bresenham la empezaria con
 * un escalon suelto, y dos lineas paralelas no quedarian alineadas.
 */
export function linePoints(x0: number, y0: number, x1: number, y1: number): PixelPoint[] {
  const ax = Math.abs(x1 - x0);
  const ay = Math.abs(y1 - y0);
  if (ay > 0 && (ax === 2 * ay || ay === 2 * ax)) {
    const sx = Math.sign(x1 - x0);
    const sy = Math.sign(y1 - y0);
    const alongX = ax > ay;
    const length = Math.max(ax, ay);
    return Array.from({ length: length + 1 }, (_, i) =>
      alongX ? { x: x0 + sx * i, y: y0 + sy * Math.floor(i / 2) } : { x: x0 + sx * Math.floor(i / 2), y: y0 + sy * i },
    );
  }

  const points: PixelPoint[] = [];
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  let x = x0;
  let y = y0;
  for (;;) {
    points.push({ x, y });
    if (x === x1 && y === y1) {
      return points;
    }
    const twice = 2 * error;
    if (twice >= dy) {
      error += dy;
      x += sx;
    }
    if (twice <= dx) {
      error += dx;
      y += sy;
    }
  }
}

/**
 * El final de una linea con Shift: llevado al angulo mas cercano entre
 * horizontal, vertical, 45 grados y los dos del pixel art isometrico (2:1 y
 * 1:2). Una linea 2:1 exacta es la que sale en escalones parejos de dos
 * pixeles, la de los bordes de un rombo.
 */
export function snapLineEnd(start: PixelPoint, end: PixelPoint): PixelPoint {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) {
    return end;
  }
  const sx = Math.sign(dx) || 1;
  const sy = Math.sign(dy) || 1;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  // Pendientes candidatas (alto / ancho) y el punto que da cada una.
  const candidates: { slope: number; point: PixelPoint }[] = [
    { slope: 0, point: { x: end.x, y: start.y } },
    { slope: 0.5, point: { x: start.x + sx * 2 * Math.round(ax / 2), y: start.y + sy * Math.round(ax / 2) } },
    { slope: 1, point: { x: start.x + sx * Math.max(ax, ay), y: start.y + sy * Math.max(ax, ay) } },
    { slope: 2, point: { x: start.x + sx * Math.round(ay / 2), y: start.y + sy * 2 * Math.round(ay / 2) } },
    { slope: Infinity, point: { x: start.x, y: end.y } },
  ];
  const angle = Math.atan2(ay, ax);
  let best = candidates[0];
  for (const candidate of candidates) {
    const candidateAngle = Math.atan(candidate.slope);
    if (Math.abs(candidateAngle - angle) < Math.abs(Math.atan(best.slope) - angle)) {
      best = candidate;
    }
  }
  return best.point;
}

/** Los pixeles de un rectangulo entre dos esquinas: el borde, o lleno. */
export function rectPoints(x0: number, y0: number, x1: number, y1: number, filled: boolean): PixelPoint[] {
  const left = Math.min(x0, x1);
  const right = Math.max(x0, x1);
  const top = Math.min(y0, y1);
  const bottom = Math.max(y0, y1);
  const points: PixelPoint[] = [];
  for (let y = top; y <= bottom; y += 1) {
    for (let x = left; x <= right; x += 1) {
      if (filled || y === top || y === bottom || x === left || x === right) {
        points.push({ x, y });
      }
    }
  }
  return points;
}

/**
 * Balde: pinta el area contigua (vecinos de arriba, abajo y los costados) del
 * mismo color exacto que el pixel de partida. Devuelve false si no cambio nada.
 */
export function floodFill(pixels: Uint8ClampedArray, width: number, height: number, x: number, y: number, color: Rgba): boolean {
  if (x < 0 || y < 0 || x >= width || y >= height) {
    return false;
  }
  const target = pixelAt(pixels, width, x, y);
  if (sameColor(target, color)) {
    return false;
  }
  const visited = new Uint8Array(width * height);
  const stack = [y * width + x];
  while (stack.length > 0) {
    const index = stack.pop()!;
    if (visited[index]) {
      continue;
    }
    visited[index] = 1;
    const px = index % width;
    const py = (index - px) / width;
    if (!sameColor(pixelAt(pixels, width, px, py), target)) {
      continue;
    }
    paintPixel(pixels, width, height, px, py, color);
    if (px > 0) stack.push(index - 1);
    if (px < width - 1) stack.push(index + 1);
    if (py > 0) stack.push(index - width);
    if (py < height - 1) stack.push(index + width);
  }
  return true;
}

/** Copia de los pixeles espejada: de izquierda a derecha ("horizontal") o de arriba abajo. */
export function flipPixels(pixels: Uint8ClampedArray, width: number, height: number, axis: 'horizontal' | 'vertical'): Uint8ClampedArray {
  const out = blankPixels(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const from = (y * width + x) * 4;
      const toX = axis === 'horizontal' ? width - 1 - x : x;
      const toY = axis === 'vertical' ? height - 1 - y : y;
      out.set(pixels.subarray(from, from + 4), (toY * width + toX) * 4);
    }
  }
  return out;
}

// --- Guia isometrica -----------------------------------------------------------

/**
 * Donde se apoya el rombo de la casilla en el lienzo, segun que se dibuja:
 *   base    su vertice de abajo en el borde de abajo: un bloque que llena la
 *           casilla (en la entidad, "bajada" de medio tile)
 *   centro  centrado: un tile de piso, que el motor centra en la celda
 *   pies    su centro en el borde de abajo: un personaje, que el motor apoya
 *           por el borde de abajo del sprite en el punto de la celda
 */
export type IsoAnchor = 'base' | 'centro' | 'pies';

/** El rombo de una casilla de tileWidth x tileHeight en un lienzo de width x height, en pixeles del sprite. */
export function isoDiamond(
  width: number,
  height: number,
  tileWidth: number,
  tileHeight: number,
  anchor: IsoAnchor,
): { cx: number; cy: number; halfWidth: number; halfHeight: number } {
  const cy = anchor === 'centro' ? height / 2 : anchor === 'base' ? height - tileHeight / 2 : height;
  return { cx: width / 2, cy, halfWidth: tileWidth / 2, halfHeight: tileHeight / 2 };
}
