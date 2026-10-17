// =============================================================================
// Generador del spritesheet de primitivas isometricas
// =============================================================================
//
// Rasteriza las figuras de bloqueo (cubo, piramide, rampa, ...) a PIXELES y
// escribe dos cosas, que tienen que salir siempre de la misma corrida:
//
//   assets/textures/shapes.png            <- lo que carga el RUNTIME
//   editor/src/app/core/shape-sheet.ts    <- los mismos pixeles + la tabla de
//                                            recortes, para el EDITOR
//
// POR QUE ASI. El motor no sabe dibujar geometria: dibuja un recorte de una
// textura (ver el Submit de main.cpp y sourceRect en schema/level.schema.json).
// Entonces, para que una primitiva exista de verdad en el juego, tiene que ser
// pixeles en un PNG y nada mas -- ningun campo nuevo en el schema, ninguna
// linea nueva de C++.
//
// Y POR QUE EL .TS. El editor tiene que dibujar EXACTAMENTE los mismos pixeles
// que el runtime, o el nivel se veria distinto en cada lado. Embebiendo el PNG
// en el bundle se logra eso sin darle al editor acceso binario al disco, y sin
// que la paleta quede vacia cuando todavia no hay un proyecto abierto.
//
// Uso:  node tools/gen-shape-sprites.mjs
//
// Es la UNICA fuente de verdad de estas figuras: editar el PNG a mano lo
// desincroniza del .ts. Para cambiar una figura se cambia SHAPES aca y se
// vuelve a correr.
// =============================================================================

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// --- Medidas ----------------------------------------------------------------
//
// El sheet se genera para el tile estandar del proyecto (64x32, la proporcion
// 2:1 del pixel art isometrico; ver los defaults de grid en el schema).
const TILE_W = 64;
const TILE_H = 32;
const HALF_W = TILE_W / 2; // 32
const HALF_H = TILE_H / 2; // 16

// Alto de un cubo, y unidad en la que se miden las figuras. En 2:1 el lado
// vertical de un cubo mide medio tile de ancho, y asi las tres caras dan un
// cubo que se lee como cubo.
const CUBE = HALF_W; // 32

// Celda del sheet. El alto lo fija la figura mas alta (el pilar: 2 cubos mas
// el medio rombo de su base y el de su tapa) redondeado hacia arriba.
const CELL_W = 64;
const CELL_H = 96;
const COLS = 4;
// Separacion entre celdas. No hace falta para que el recorte salga bien (el
// motor y el editor muestrean sin filtrado), pero deja el sheet legible al
// abrirlo en un editor de imagenes y evita cualquier sangrado si algun dia se
// activa el filtrado bilineal.
const GUTTER = 2;

// Linea de suelo dentro de la celda: la Y del CENTRO del rombo de la base, que
// es el punto con el que la figura se apoya en su casilla. El medio rombo de
// adelante queda por debajo, ocupando las ultimas filas de la celda.
const GROUND_Y = CELL_H - 1 - HALF_H; // 79

// Cuanto hay que BAJAR el sprite respecto de donde lo pondria la regla de
// entidad del runtime (borde de abajo del sprite en el ancla de la celda).
//
// El runtime dibuja en  ancla.y - alto + groundOffset,  asi que el centro del
// rombo de la base cae en  ancla.y - alto + GROUND_Y + groundOffset.  Para que
// eso sea exactamente el ancla -- que es donde el runtime centra el piso --,
// el offset tiene que ser la distancia de la linea de suelo al borde inferior.
//
// Un personaje no declara el campo (queda en 0) y se sigue dibujando con los
// pies en el ancla, como siempre.
const GROUND_OFFSET = CELL_H - GROUND_Y; // 17

// --- Materiales ---------------------------------------------------------------
//
// Cuatro materiales. PIEDRA son las ocho figuras de siempre: mismos ids y mismo
// lugar en el sheet, asi los niveles que ya las usan siguen apuntando al mismo
// recorte. Madera, pasto y metal se agregan DESPUES, en filas nuevas, con el id
// de la figura y el material (cube_wood, cone_grass...).
//
// Cada material da tres tonos base (tapa, cara izquierda, cara derecha: la luz
// entra de arriba a la izquierda) y un dibujo propio por cara: juntas de
// piedra, tablas de madera, borde de pasto sobre tierra, remaches de metal.
const MATERIALS = [
  {
    id: 'stone', suffix: '', label: 'Piedra',
    top: [178, 174, 166], left: [140, 136, 130], right: [104, 101, 97],
  },
  {
    id: 'wood', suffix: '_wood', label: 'Madera',
    top: [204, 156, 100], left: [164, 114, 68], right: [122, 82, 48],
  },
  {
    id: 'grass', suffix: '_grass', label: 'Pasto',
    top: [126, 186, 80], left: [138, 98, 64], right: [104, 72, 46],
    // Verde de las caras laterales (el borde de pasto, y el follaje de las
    // figuras redondas: cono = arbol, esfera = arbusto).
    leafLeft: [96, 154, 60], leafRight: [70, 120, 44],
  },
  {
    id: 'metal', suffix: '_metal', label: 'Metal',
    top: [176, 188, 200], left: [130, 142, 156], right: [92, 103, 118],
  },
];

// --- Las figuras ------------------------------------------------------------
//
// height y width son las mismas unidades que usaba la version procedural:
// height en cubos, width como escala de la huella sobre la celda.
const SHAPES = [
  { id: 'cube', label: 'Cubo', height: 1, width: 1 },
  { id: 'pyramid', label: 'Pirámide', height: 1.5, width: 1 },
  { id: 'ramp', label: 'Rampa', height: 1, width: 1 },
  { id: 'slab', label: 'Losa', height: 0.25, width: 1 },
  { id: 'cylinder', label: 'Cilindro', height: 1, width: 0.82 },
  { id: 'cone', label: 'Cono', height: 1.5, width: 0.82 },
  { id: 'sphere', label: 'Esfera', height: 1, width: 0.8 },
  { id: 'pillar', label: 'Pilar', height: 2, width: 0.42 },
];

/** Todas las celdas del sheet: piedra primero (las de siempre), despues el resto. */
const VARIANTS = MATERIALS.flatMap((material) =>
  SHAPES.map((shape) => ({ ...shape, id: shape.id + material.suffix, shape: shape.id, material })),
);

// --- Lienzo de pixeles ------------------------------------------------------

const ROWS = Math.ceil(VARIANTS.length / COLS);
const SHEET_W = (CELL_W + GUTTER) * COLS - GUTTER;
const SHEET_H = (CELL_H + GUTTER) * ROWS - GUTTER;
const pixels = new Uint8Array(SHEET_W * SHEET_H * 4); // RGBA, arranca transparente

function setPixel(x, y, rgba) {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= SHEET_W || py >= SHEET_H) return;
  const offset = (py * SHEET_W + px) * 4;
  pixels[offset] = rgba[0];
  pixels[offset + 1] = rgba[1];
  pixels[offset + 2] = rgba[2];
  pixels[offset + 3] = rgba[3];
}

function getPixel(x, y) {
  const offset = (y * SHEET_W + x) * 4;
  return [pixels[offset], pixels[offset + 1], pixels[offset + 2], pixels[offset + 3]];
}

// --- Color ------------------------------------------------------------------

const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));
const mul = (color, factor) => [clamp(color[0] * factor), clamp(color[1] * factor), clamp(color[2] * factor), 255];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * Ruido determinista por pixel: el mismo sheet sale identico en cada corrida,
 * asi que regenerarlo no ensucia el diff con pixeles que cambian al azar.
 */
function hash(x, y, seed = 0) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(seed | 0, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Pasa un brillo continuo a pocos escalones: el sombreado se lee como pixel art y no como degradé. */
const band = (value, steps) => Math.round(value * steps) / steps;

/**
 * Rellena un poligono convexo por barrido de scanlines, pidiendo el color de
 * cada pixel a "shader" (o un color fijo).
 *
 * El barrido va por CENTRO de pixel (y + 0.5) a proposito: es lo que hace que
 * un rombo 2:1 salga con el escalonado limpio de dos pixeles de ancho por uno
 * de alto que caracteriza al pixel art isometrico, en vez de un borde con
 * escalones de tamano irregular.
 */
function fillPolygon(points, shader) {
  const paint = typeof shader === 'function' ? shader : () => shader;
  const ys = points.map((p) => p.y);
  const yStart = Math.max(0, Math.floor(Math.min(...ys)));
  const yEnd = Math.min(SHEET_H - 1, Math.ceil(Math.max(...ys)));

  for (let y = yStart; y <= yEnd; y += 1) {
    const scan = y + 0.5;
    const crossings = [];
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if (a.y <= scan && b.y > scan) {
        crossings.push(a.x + ((scan - a.y) / (b.y - a.y)) * (b.x - a.x));
      } else if (b.y <= scan && a.y > scan) {
        crossings.push(b.x + ((scan - b.y) / (a.y - b.y)) * (a.x - b.x));
      }
    }
    if (crossings.length < 2) continue;
    crossings.sort((p, q) => p - q);
    for (let i = 0; i + 1 < crossings.length; i += 2) {
      const from = Math.round(crossings[i]);
      const to = Math.round(crossings[i + 1]) - 1;
      for (let x = from; x <= to; x += 1) setPixel(x, y, paint(x, y));
    }
  }
}

/** Elipse rellena, con color por pixel, para las bases, tapas y esferas. */
function fillEllipse(cx, cy, rx, ry, shader) {
  const paint = typeof shader === 'function' ? shader : () => shader;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y += 1) {
    const dy = (y + 0.5 - cy) / ry;
    if (Math.abs(dy) > 1) continue;
    const half = rx * Math.sqrt(1 - dy * dy);
    for (let x = Math.round(cx - half); x < Math.round(cx + half); x += 1) {
      setPixel(x, y, paint(x, y));
    }
  }
}

/**
 * Contorno selectivo de 1px alrededor de la silueta de una celda.
 *
 * Cada pixel vacio pegado a la figura se pinta con el tono de la figura
 * oscurecido, no con un gris fijo: el borde de una tapa de pasto sale verde
 * oscuro y el de una cara de madera, marron oscuro. Despega la figura del fondo
 * sin la linea negra pareja que la hacia ver recortada.
 *
 * La sombra en el piso (alpha bajo) cuenta como vacio: no lleva contorno.
 */
function outlineCell(cellX, cellY) {
  const solid = (x, y) =>
    x >= cellX && y >= cellY && x < cellX + CELL_W && y < cellY + CELL_H && getPixel(x, y)[3] === 255;

  const edits = [];
  for (let y = cellY; y < cellY + CELL_H; y += 1) {
    for (let x = cellX; x < cellX + CELL_W; x += 1) {
      if (solid(x, y)) continue;
      const neighbors = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].filter(([nx, ny]) => solid(nx, ny));
      if (neighbors.length === 0) continue;
      const avg = [0, 1, 2].map(
        (channel) => neighbors.reduce((acc, [nx, ny]) => acc + getPixel(nx, ny)[channel], 0) / neighbors.length,
      );
      edits.push([x, y, [clamp(avg[0] * 0.38), clamp(avg[1] * 0.38), clamp(avg[2] * 0.4), 255]]);
    }
  }
  // En una segunda pasada: si se pintara sobre la marcha, el contorno recien
  // puesto contaria como "figura" y el borde creceria solo.
  for (const [x, y, color] of edits) setPixel(x, y, color);
}

// --- Sombreado por material -----------------------------------------------
//
// Tres tipos de superficie:
//   cara vertical: s (0..1 a lo largo de la base), hp (pixeles sobre la base)
//   tapa:          u, v (0..1 sobre los dos ejes del rombo)
//   curva:         brillo ya calculado con la normal (cilindro, cono, esfera)
// lx, ly son la posicion dentro de la celda, para el ruido.

function sideColor(mat, shapeId, face, info) {
  const { s, hp, height, width, lx, ly } = info;
  const isLeft = face === 'left';
  let color = isLeft ? mat.left : mat.right;
  let f = 1;

  if (mat.id === 'stone') {
    f *= 1 + (hash(lx, ly, 1) - 0.5) * 0.1;
    // Sillares: hiladas de 12 px y juntas cada 16 px, trabadas entre hiladas.
    const course = 12;
    const row = Math.floor(hp / course);
    if (height >= course && hp > 1.5 && hp % course < 1) f *= 0.74;
    const along = s * width + (row % 2) * 8;
    if (width >= 16 && hp > 1.5 && hp < height - 1.5 && along % 16 < 1) f *= 0.76;
  } else if (mat.id === 'wood') {
    // Tablas de 6 px con la veta corriendo a lo largo.
    if (hp > 1.5 && hp % 6 < 1) f *= 0.7;
    f *= 0.93 + hash(Math.floor((s * width) / 3), Math.floor(hp / 6), 2) * 0.12;
    if (hash(lx, ly, 3) > 0.985) f *= 0.78;
  } else if (mat.id === 'grass') {
    // Tierra con piedritas y un borde de pasto que cae irregular desde arriba.
    const lip = 3 + Math.floor(hash(Math.floor((s * width) / 2), 0, 4) * 3);
    if (hp > height - lip) {
      color = isLeft ? mat.leafLeft : mat.leafRight;
      f *= 1 + (hash(lx, ly, 5) - 0.5) * 0.16;
    } else {
      f *= 1 + (hash(lx, ly, 6) - 0.5) * 0.14;
      if (hash(lx, ly, 7) > 0.965) f *= 1.22;
    }
  } else if (mat.id === 'metal') {
    // Placa con degradé vertical, un reflejo, remaches en las esquinas y
    // juntas cada 32 px en lo alto (el pilar).
    f *= 0.9 + 0.16 * (hp / Math.max(1, height));
    if (isLeft && s > 0.18 && s < 0.27) f *= 1.2;
    if (!isLeft && s > 0.64 && s < 0.7) f *= 1.08;
    if (hp > 1.5 && hp < height - 1.5 && hp % 32 < 1) f *= 0.74;
    // Remaches solo en las cajas: en una cara triangular quedaban flotando.
    if (['cube', 'pillar'].includes(shapeId) && width >= 20 && height >= 16) {
      const ax = s * width;
      for (const rx of [4, width - 5]) {
        for (const ry of [4, height - 5]) {
          if (Math.abs(ax - rx) < 1 && Math.abs(hp - ry) < 1) f *= 1.45;
          else if (Math.abs(ax - rx) < 1 && Math.abs(hp - (ry - 1)) < 1) f *= 0.7;
        }
      }
    }
  }

  // Comunes a todos: oclusion junto al piso, borde de arriba que agarra la luz
  // y la arista del frente (donde se juntan las dos caras) un poco mas clara.
  if (hp < 6) f *= 0.84 + 0.16 * (hp / 6);
  if (hp > height - 1.2) f *= 1.12;
  if ((isLeft && s > 0.965) || (!isLeft && s < 0.035)) f *= 1.1;
  return mul(color, f);
}

function topColor(mat, info) {
  const { u, v, lx, ly, small } = info;
  let color = mat.top;
  let f = 1;

  if (mat.id === 'stone') {
    f *= 1 + (hash(lx, ly, 11) - 0.5) * 0.09;
    // Cuatro losas en las tapas grandes.
    if (!small && (Math.abs(u - 0.5) < 0.025 || Math.abs(v - 0.5) < 0.025)) f *= 0.84;
  } else if (mat.id === 'wood') {
    // Cuatro tablas a lo largo de u.
    if ((v * 4) % 1 < 0.07 && v > 0.05 && v < 0.95) f *= 0.72;
    f *= 0.93 + hash(Math.floor(u * 20), Math.floor(v * 4), 12) * 0.12;
  } else if (mat.id === 'grass') {
    f *= 1 + (hash(lx, ly, 13) - 0.5) * 0.16;
    const tuft = hash(lx, ly, 14);
    if (tuft > 0.93) f *= 1.2;
    else if (tuft < 0.05) f *= 0.8;
  } else if (mat.id === 'metal') {
    f *= ly % 2 === 0 ? 1.03 : 0.98;
    if (Math.abs(u - v) < 0.06 && u + v > 0.6) f *= 1.12;
  }

  // El borde del frente de la tapa, el que mira a la luz, se aclara.
  if (u > 0.95 || v > 0.95) f *= 1.1;
  return mul(color, f);
}

/** Brillo de una superficie curva a partir de su normal, con la luz arriba a la izquierda. */
function lambert(nx, ny, nz) {
  const light = [-0.52, -0.58, 0.63];
  const length = Math.hypot(...light);
  return Math.max(0, (nx * light[0] + ny * light[1] + nz * light[2]) / length);
}

function curvedColor(mat, info) {
  const { light, lx, ly, leaf, specular, hp, height } = info;
  let base = leaf && mat.leafLeft ? mat.leafLeft : mat.left;
  let f = band(0.5 + 0.72 * light, 6);

  if (mat.id === 'stone') {
    f *= 1 + (hash(lx, ly, 21) - 0.5) * 0.1;
    if (height >= 24 && hp > 1.5 && hp < height - 1.5 && hp % 12 < 1) f *= 0.8;
  } else if (mat.id === 'wood') {
    f *= 0.92 + hash(lx, Math.floor(ly / 6), 22) * 0.12;
  } else if (mat.id === 'grass') {
    if (leaf) {
      f *= 1 + (hash(lx, ly, 23) - 0.5) * 0.22;
      if (hash(lx, ly, 24) > 0.94) f *= 1.18;
    } else {
      const lip = 3 + Math.floor(hash(lx >> 1, 0, 25) * 3);
      if (hp > height - lip) base = mat.leafLeft;
      f *= 1 + (hash(lx, ly, 26) - 0.5) * 0.14;
    }
  } else if (mat.id === 'metal') {
    f *= 1 + specular * 0.9;
  }
  if (hp !== undefined && hp < 5) f *= 0.86 + 0.14 * (hp / 5);
  return mul(base, f);
}

// --- Dibujo de cada figura --------------------------------------------------

function drawShape(def, cellX, cellY) {
  const mat = def.material;
  const rx = HALF_W * def.width;
  const ry = HALF_H * def.width;
  const height = CUBE * def.height;

  const cx = cellX + CELL_W / 2;
  const cy = cellY + GROUND_Y;
  const local = (x, y) => ({ lx: x - cellX, ly: y - cellY });

  // Rombo de la base, en sentido horario desde la punta de arriba.
  const T = { x: cx, y: cy - ry };
  const R = { x: cx + rx, y: cy };
  const B = { x: cx, y: cy + ry };
  const L = { x: cx - rx, y: cy };
  const up = (p, h = height) => ({ x: p.x, y: p.y - h });

  /** Shader de una cara vertical que apoya en el segmento a -> b. */
  const sideShader = (face, a, b, faceHeight = () => height) => (x, y) => {
    const s = Math.min(1, Math.max(0, (x + 0.5 - a.x) / (b.x - a.x)));
    const base = a.y + s * (b.y - a.y);
    return sideColor(mat, def.shape, face, {
      s,
      hp: base - (y + 0.5),
      height: faceHeight(s),
      width: Math.abs(b.x - a.x),
      ...local(x, y),
    });
  };

  /** Shader de una tapa con forma de rombo cuya punta de arriba es top. */
  const topShader = (topPoint, small) => (x, y) => {
    const dx = (x + 0.5 - topPoint.x) / rx;
    const dy = (y + 0.5 - topPoint.y) / ry;
    return topColor(mat, { u: (dx + dy) / 2, v: (dy - dx) / 2, small, ...local(x, y) });
  };

  /** Shader del cuerpo de una figura de revolucion: ancho a la altura y, y alto total. */
  const bodyShader = (halfWidthAt, leaf = false, tilt = 0) => (x, y) => {
    const half = Math.max(0.5, halfWidthAt(y + 0.5));
    const nx = Math.max(-1, Math.min(1, (x + 0.5 - cx) / half));
    const nz = Math.sqrt(Math.max(0, 1 - nx * nx));
    const light = lambert(nx, -tilt, nz);
    const specular = Math.pow(light, 18);
    return curvedColor(mat, { light, specular, leaf, hp: cy - (y + 0.5), height, ...local(x, y) });
  };

  // Sombra en el piso para las figuras que no llenan su casilla: sin ella
  // parecen flotar. Alpha bajo, asi el contorno no la trata como figura.
  if (def.width < 1) {
    fillEllipse(cx + 3, cy + 1, rx * 1.05, ry * 1.05, [20, 18, 16, 56]);
  }

  switch (def.shape) {
    // Cubo, losa y pilar son la misma construccion con distinto alto y ancho:
    // dos caras verticales al frente y la tapa encima.
    case 'cube':
    case 'slab':
    case 'pillar':
      fillPolygon([L, B, up(B), up(L)], sideShader('left', L, B));
      fillPolygon([B, R, up(R), up(B)], sideShader('right', B, R));
      fillPolygon([up(T), up(R), up(B), up(L)], topShader(up(T), def.shape === 'pillar'));
      break;

    case 'pyramid': {
      const apex = { x: cx, y: cy - height };
      // El alto de cada cara baja hacia las puntas: a la mitad es el total.
      const rise = (s) => height * (1 - Math.abs(s - 1));
      const fall = (s) => height * (1 - s);
      if (mat.id === 'grass') {
        // Pasto: una loma, verde entero.
        fillPolygon([L, B, apex], (x, y) => curvedColor(mat, { light: 0.62, specular: 0, leaf: true, ...local(x, y) }));
        fillPolygon([B, R, apex], (x, y) => curvedColor(mat, { light: 0.3, specular: 0, leaf: true, ...local(x, y) }));
      } else {
        fillPolygon([L, B, apex], sideShader('left', L, B, rise));
        fillPolygon([B, R, apex], sideShader('right', B, R, fall));
      }
      break;
    }

    // Rampa: al ras en la arista de adelante (B-L) y elevada en la de atras
    // (T-R). La cara inclinada es el plano por el que se sube; lleva escalones
    // (o tablas, o pasto) en filas horizontales.
    case 'ramp':
      fillPolygon([L, B, up(R), up(T)], (x, y) => {
        const { lx, ly } = local(x, y);
        const color = topColor(mat, { u: 0.5, v: 0.5, small: true, lx, ly });
        const step = mat.id === 'grass' ? 1 : ly % 6 === 0 ? 0.8 : 1;
        return mul(color, 0.95 * step);
      });
      fillPolygon([B, R, up(R)], sideShader('right', B, R, (s) => height * s));
      break;

    // Las redondas se arman por capas: base, cuerpo, tapa. La mitad inferior de
    // la elipse de la base asoma bajo el cuerpo y da la curvatura de apoyo.
    case 'cylinder': {
      const body = bodyShader(() => rx);
      fillEllipse(cx, cy, rx, ry, body);
      fillPolygon(
        [
          { x: cx - rx, y: cy - height }, { x: cx + rx, y: cy - height },
          { x: cx + rx, y: cy }, { x: cx - rx, y: cy },
        ],
        body,
      );
      // Tapa: anillos en la madera (un tronco), placa en el metal, pasto, piedra.
      fillEllipse(cx, cy - height, rx, ry, (x, y) => {
        const du = (x + 0.5 - cx) / rx;
        const dv = (y + 0.5 - (cy - height)) / ry;
        const r = Math.hypot(du, dv);
        let color = topColor(mat, { u: 0.5 + du * 0.45, v: 0.5 + dv * 0.45, small: true, ...local(x, y) });
        if (mat.id === 'wood' && (r * 4) % 1 < 0.2) color = mul(color, 0.8);
        if (r > 0.86) color = mul(color, 1.08);
        return color;
      });
      break;
    }

    case 'cone': {
      const apexY = cy - height;
      const halfAt = (y) => rx * Math.min(1, Math.max(0, (y - apexY) / (cy - apexY)));
      const body = bodyShader(halfAt, mat.id === 'grass', 0.35);
      fillEllipse(cx, cy, rx, ry, bodyShader(() => rx, mat.id === 'grass', 0.35));
      fillPolygon([{ x: cx - rx, y: cy }, { x: cx + rx, y: cy }, { x: cx, y: apexY }], body);
      break;
    }

    // La esfera se sombrea con su normal y en pocos escalones: asi el volumen
    // se lee como curva y no como un disco con un brillo pegado encima.
    case 'sphere': {
      const radius = rx;
      const center = { x: cx, y: cy - radius * 0.85 };
      fillEllipse(center.x, center.y, radius, radius, (x, y) => {
        const nx = (x + 0.5 - center.x) / radius;
        const ny = (y + 0.5 - center.y) / radius;
        const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
        const light = lambert(nx, ny, nz);
        return curvedColor(mat, {
          light,
          specular: Math.pow(light, 24),
          leaf: mat.id === 'grass',
          ...local(x, y),
        });
      });
      break;
    }

    default:
      throw new Error('Figura sin dibujo: ' + def.shape);
  }

  outlineCell(cellX, cellY);
}

// --- Codificacion PNG (sin dependencias) ------------------------------------
//
// Un PNG minimo es: firma + IHDR + IDAT + IEND. Cada chunk lleva su longitud,
// su tipo, sus datos y un CRC32. Se escribe a mano para que generar el sheet no
// meta una dependencia de npm en un repo que hoy no tiene ninguna para esto.

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8 bits por canal
  ihdr[9] = 6; // color type 6 = RGBA
  // compresion 0, filtro 0, entrelazado 0 -> los tres bytes ya en cero

  // Cada scanline va precedida por su byte de filtro. Se usa 0 (sin filtro):
  // son imagenes chicas y de colores planos, y el filtrado no compensa la
  // complejidad extra aca.
  const raw = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 4);
    raw[rowStart] = 0;
    rgba.subarray(y * width * 4, (y + 1) * width * 4).forEach((byte, i) => {
      raw[rowStart + 1 + i] = byte;
    });
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// --- Corrida ----------------------------------------------------------------

const cells = VARIANTS.map((def, index) => {
  const cellX = (index % COLS) * (CELL_W + GUTTER);
  const cellY = Math.floor(index / COLS) * (CELL_H + GUTTER);
  drawShape(def, cellX, cellY);
  return { ...def, x: cellX, y: cellY };
});

const png = encodePng(SHEET_W, SHEET_H, pixels);
const pngPath = join(ROOT, 'assets', 'textures', 'shapes.png');
mkdirSync(dirname(pngPath), { recursive: true });
writeFileSync(pngPath, png);

const tsPath = join(ROOT, 'editor', 'src', 'app', 'core', 'shape-sheet.ts');
const entries = cells
  .map(
    (cell) =>
      `  {\n` +
      `    id: '${cell.id}',\n` +
      `    label: '${cell.label}',\n` +
      `    height: ${cell.height},\n` +
      `    sourceRect: { x: ${cell.x}, y: ${cell.y}, width: ${CELL_W}, height: ${CELL_H} },\n` +
      `    groundOffset: ${GROUND_OFFSET},\n` +
      `    footprint: ${cell.width},\n` +
      `    shape: '${cell.shape}',\n` +
      `    material: '${cell.material.id}',\n` +
      `    materialLabel: '${cell.material.label}',\n` +
      `  },`,
  )
  .join('\n');

writeFileSync(
  tsPath,
  `// GENERADO POR tools/gen-shape-sprites.mjs -- NO EDITAR A MANO.
//
// Los mismos pixeles que assets/textures/shapes.png, embebidos para que el
// editor dibuje exactamente lo que va a dibujar el runtime. Para cambiar una
// figura se edita SHAPES en el generador y se lo vuelve a correr, que reescribe
// el PNG y este archivo de una sola pasada.

/** Ruta de la textura tal como va en el nivel (relativa a assets/). */
export const SHAPE_TEXTURE = 'textures/shapes.png';

/** Medidas del sheet, para recortar una celda por CSS en la paleta. */
export const SHAPE_SHEET_WIDTH = ${SHEET_W};
export const SHAPE_SHEET_HEIGHT = ${SHEET_H};

/** El sheet embebido, para dibujar en el canvas del editor. */
export const SHAPE_SHEET_DATA_URL =
  'data:image/png;base64,${png.toString('base64')}';

export interface ShapeCell {
  id: string;
  label: string;
  /** Alto en cubos. Informativo: el runtime solo usa el sourceRect. */
  height: number;
  /** Recorte dentro del sheet, tal cual va en el "sourceRect" del nivel. */
  sourceRect: { x: number; y: number; width: number; height: number };
  /**
   * Cuanto baja el sprite respecto de la regla de entidad del runtime, para
   * que el rombo de su base apoye en la casilla. Va tal cual en el
   * "groundOffset" del nivel; ver el calculo en el generador.
   */
  groundOffset: number;
  /**
   * Ancho de la base en celdas: 1 llena la casilla, 0.42 es la base angosta
   * del pilar. Es la huella con la que la figura choca, y de aca sale el
   * "collider" que el editor le pone al colocarla (ver shapeCollider).
   */
  footprint: number;
  /** La figura sin material (cube, cone...): las variantes la comparten. */
  shape: string;
  /** Material del dibujo; las figuras de siempre son de piedra. */
  material: 'stone' | 'wood' | 'grass' | 'metal';
  materialLabel: string;
}

export const SHAPE_CELLS: readonly ShapeCell[] = [
${entries}
];
`,
);

console.log('PNG   ' + pngPath + '  (' + SHEET_W + 'x' + SHEET_H + ', ' + png.length + ' bytes)');
console.log('TS    ' + tsPath);
for (const cell of cells) {
  console.log(
    '  ' + cell.id.padEnd(16) + ' recorte ' + `${cell.x},${cell.y} ${CELL_W}x${CELL_H}`,
  );
}
