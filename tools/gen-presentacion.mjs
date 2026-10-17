// =============================================================================
// Genera los tres niveles de la presentacion
// =============================================================================
//
//   Presentacion_1_Basico     La granja al amanecer: suelo, figuras, decorado,
//                             camara y color de fondo.
//   Presentacion_2_Medio      La biblioteca sellada: objetos para juntar,
//                             inventario y un puzzle con eventos.
//   Presentacion_3_Avanzado   Las ruinas de la mazmorra: salas unidas por
//                             tuneles, personajes, combate y eventos encadenados.
//
// Solo usa lo que el editor y el motor ya soportan: ningun campo nuevo en el
// JSON. Cada nivel se valida contra schema/level.schema.json antes de escribirse.
//
// LAS PIEZAS. Los packs "Isometric Miniature" de Kenney (ver
// tools/import-kenney.mjs) vienen a 256 px por casilla. Los niveles usan
// casillas de 128x64, asi que de cada pieza que se usa se escribe una copia a
// la MITAD, promediando de a 2x2 pixeles: escalada por el motor, que no
// suaviza, se veria serruchada. Las copias van a assets/textures/presentacion/.
// Las figuras del editor (shapes.png) se usan a escala 2, que en pixel art
// queda nitida.
//
// Las salas y los tuneles se pasan a "tiles" con la MISMA funcion que usa el
// editor (editor/src/app/core/dungeon-layout.ts), empaquetada con esbuild.
//
// Uso:  node tools/gen-presentacion.mjs [--workspace <carpeta del editor>]
//       (por defecto, Documentos/HoneyComb)
// =============================================================================

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const workspaceArg = argv.indexOf('--workspace');
const WORKSPACE =
  workspaceArg >= 0 ? argv[workspaceArg + 1] : join(process.env.USERPROFILE ?? process.env.HOME ?? '', 'Documents', 'HoneyComb');
const TEXTURES = join(WORKSPACE, 'assets', 'textures');
const DERIVED = join(TEXTURES, 'presentacion');
const LEVELS = join(WORKSPACE, 'levels');

const TILE_W = 128;
const TILE_H = 64;

// =============================================================================
// PNG: leer, escalar y escribir, sin dependencias
// =============================================================================

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

/** Decodifica un PNG de 8 bits por canal (gris, RGB, paleta, gris+alfa o RGBA) a RGBA. */
function decodePng(buffer) {
  let position = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let palette = null;
  let transparency = null;
  const data = [];
  while (position < buffer.length) {
    const length = buffer.readUInt32BE(position);
    const type = buffer.toString('ascii', position + 4, position + 8);
    const chunk = buffer.subarray(position + 8, position + 8 + length);
    position += 12 + length;
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0);
      height = chunk.readUInt32BE(4);
      if (chunk[8] !== 8 || chunk[12] !== 0) throw new Error('PNG no soportado (profundidad o entrelazado)');
      colorType = chunk[9];
    } else if (type === 'PLTE') palette = chunk;
    else if (type === 'tRNS') transparency = chunk;
    else if (type === 'IDAT') data.push(chunk);
    else if (type === 'IEND') break;
  }
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data));
  const rgba = Buffer.alloc(width * height * 4);
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const current = Buffer.alloc(stride);
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? current[i - channels] : 0;
      const b = previous[i];
      const c = i >= channels ? previous[i - channels] : 0;
      const x = line[i];
      current[i] =
        filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c);
    }
    for (let x = 0; x < width; x += 1) {
      const out = (y * width + x) * 4;
      const at = x * channels;
      if (colorType === 6) current.copy(rgba, out, at, at + 4);
      else if (colorType === 2) {
        rgba[out] = current[at];
        rgba[out + 1] = current[at + 1];
        rgba[out + 2] = current[at + 2];
        rgba[out + 3] = 255;
      } else if (colorType === 3) {
        const index = current[at];
        rgba[out] = palette[index * 3];
        rgba[out + 1] = palette[index * 3 + 1];
        rgba[out + 2] = palette[index * 3 + 2];
        rgba[out + 3] = transparency && index < transparency.length ? transparency[index] : 255;
      } else {
        const gray = current[at];
        rgba[out] = gray;
        rgba[out + 1] = gray;
        rgba[out + 2] = gray;
        rgba[out + 3] = colorType === 4 ? current[at + 1] : 255;
      }
    }
    previous = current;
  }
  return { width, height, data: rgba };
}

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

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** RGBA a PNG, con el filtro Sub en cada fila (las piezas pesan bastante menos). */
function encodePng({ width, height, data }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (stride + 1)] = 1;
    for (let i = 0; i < stride; i += 1) {
      const value = data[y * stride + i];
      const left = i >= 4 ? data[y * stride + i - 4] : 0;
      raw[y * (stride + 1) + 1 + i] = (value - left) & 0xff;
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A la mitad, promediando 2x2 con alfa premultiplicado: sin halos oscuros en los bordes. */
function half(image) {
  const width = Math.floor(image.width / 2);
  const height = Math.floor(image.height / 2);
  const data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const at = ((y * 2 + dy) * image.width + (x * 2 + dx)) * 4;
        const alpha = image.data[at + 3];
        r += image.data[at] * alpha;
        g += image.data[at + 1] * alpha;
        b += image.data[at + 2] * alpha;
        a += alpha;
      }
      const out = (y * width + x) * 4;
      if (a > 0) {
        data[out] = Math.round(r / a);
        data[out + 1] = Math.round(g / a);
        data[out + 2] = Math.round(b / a);
        data[out + 3] = Math.round(a / 4);
      }
    }
  }
  return { width, height, data };
}

function crop(image, rect) {
  const data = Buffer.alloc(rect.width * rect.height * 4);
  for (let y = 0; y < rect.height; y += 1) {
    image.data.copy(data, y * rect.width * 4, ((rect.y + y) * image.width + rect.x) * 4, ((rect.y + y) * image.width + rect.x + rect.width) * 4);
  }
  return { width: rect.width, height: rect.height, data };
}

/** Deja solo el rombo inscripto: lo de afuera (caras laterales) estorbaria al teselar. */
function maskDiamond(image) {
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      const dx = Math.abs(x + 0.5 - image.width / 2) / (image.width / 2);
      const dy = Math.abs(y + 0.5 - image.height / 2) / (image.height / 2);
      if (dx + dy > 1.02) image.data[(y * image.width + x) * 4 + 3] = 0;
    }
  }
  return image;
}

/** Primera fila con algo opaco: el vertice de arriba de un tile de piso. */
function topOpaqueRow(image) {
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (image.data[(y * image.width + x) * 4 + 3] > 40) return y;
    }
  }
  return 0;
}

// =============================================================================
// Piezas
// =============================================================================

mkdirSync(DERIVED, { recursive: true });
mkdirSync(LEVELS, { recursive: true });

// La hoja de figuras nueva (con madera, pasto y metal) tiene que estar en la
// carpeta del editor: es la que carga el motor.
copyFileSync(join(ROOT, 'assets', 'textures', 'shapes.png'), join(TEXTURES, 'shapes.png'));

const shapeSource = readFileSync(join(ROOT, 'editor', 'src', 'app', 'core', 'shape-sheet.ts'), 'utf8');
const SHAPE_CELLS = new Map(
  [
    ...shapeSource.matchAll(
      /id: '(\w+)',[\s\S]*?sourceRect: \{ x: (\d+), y: (\d+), width: (\d+), height: (\d+) \},\s*groundOffset: (\d+),\s*footprint: ([\d.]+),/g,
    ),
  ].map((m) => [m[1], { x: +m[2], y: +m[3], width: +m[4], height: +m[5], groundOffset: +m[6], footprint: +m[7] }]),
);

const derived = new Map();

/** Una pieza de Kenney a la mitad, escrita una sola vez. Devuelve su ruta y su imagen. */
function piece(name) {
  if (!derived.has(name)) {
    const image = half(decodePng(readFileSync(join(TEXTURES, name + '.png'))));
    writeFileSync(join(DERIVED, name + '.png'), encodePng(image));
    derived.set(name, { texture: 'textures/presentacion/' + name + '.png', image });
  }
  return derived.get(name);
}

// Todas las piezas de Kenney comparten el mismo encuadre: el centro de la tapa
// de un tile de piso cae 42 px sobre el borde de abajo de la copia (428 de 512
// en el original). Usar el MISMO apoyo para todas las deja alineadas entre si,
// como en las escenas de ejemplo del pack.
const KENNEY_GROUND = 42;

/** El rombo de arriba de un tile de piso de Kenney, como textura de piso del nivel. */
function kenneyFloor(name) {
  const { image } = piece(name);
  const top = topOpaqueRow(image);
  const tile = maskDiamond(crop(image, { x: 0, y: top, width: TILE_W, height: TILE_H }));
  const out = 'piso_' + name;
  writeFileSync(join(DERIVED, out + '.png'), encodePng(tile));
  return { texture: 'textures/presentacion/' + out + '.png', sourceRect: { x: 0, y: 0, width: TILE_W, height: TILE_H } };
}

/**
 * Pasto para el piso, dibujado aca y no recortado de la losa: la losa tiene un
 * borde iluminado y contorno, y teselada marcaba una cuadricula. Mismos verdes
 * que las figuras de pasto, en bloques de 2x2 pixeles (el pixel art a escala 2).
 */
function grassFloor() {
  const image = { width: TILE_W, height: TILE_H, data: Buffer.alloc(TILE_W * TILE_H * 4) };
  const hash = (x, y, seed) => {
    let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 2246822519);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  for (let y = 0; y < TILE_H; y += 1) {
    for (let x = 0; x < TILE_W; x += 1) {
      const bx = x >> 1;
      const by = y >> 1;
      let f = 1 + (hash(bx, by, 1) - 0.5) * 0.14;
      const tuft = hash(bx, by, 2);
      if (tuft > 0.94) f *= 1.16;
      else if (tuft < 0.05) f *= 0.84;
      const at = (y * TILE_W + x) * 4;
      image.data[at] = Math.min(255, Math.round(118 * f));
      image.data[at + 1] = Math.min(255, Math.round(178 * f));
      image.data[at + 2] = Math.min(255, Math.round(74 * f));
      image.data[at + 3] = 255;
    }
  }
  maskDiamond(image);
  writeFileSync(join(DERIVED, 'piso_pasto.png'), encodePng(image));
  return { texture: 'textures/presentacion/piso_pasto.png', sourceRect: { x: 0, y: 0, width: TILE_W, height: TILE_H } };
}

// =============================================================================
// Entidades
// =============================================================================

/** Una pieza de Kenney como entidad. */
function kenney(id, name, col, row, extra = {}) {
  const { texture, image } = piece(name);
  return {
    id,
    type: 'prop',
    position: { col, row },
    texture,
    sourceRect: { x: 0, y: 0, width: image.width, height: image.height },
    groundOffset: KENNEY_GROUND,
    ...extra,
  };
}

/** Una figura del editor, a escala 2 para casillas de 128x64. */
function shape(id, shapeId, col, row, extra = {}) {
  const cell = SHAPE_CELLS.get(shapeId);
  if (!cell) throw new Error('Figura desconocida: ' + shapeId);
  return {
    id,
    type: shapeId,
    position: { col, row },
    texture: 'textures/shapes.png',
    sourceRect: { x: cell.x, y: cell.y, width: cell.width, height: cell.height },
    groundOffset: cell.groundOffset,
    scale: 2,
    ...extra,
  };
}

/** Collider solido del tamaño de N casillas (el motor lo mide en celdas). */
const solid = (cells = 1) => ({ width: TILE_W * cells, height: TILE_H * cells, solid: true });

/** El aventurero mirando a la camara (d3). */
function adventurer(id, col, row, extra = {}) {
  return kenney(id, 'personaje_aventurero_quieto_d3', col, row, {
    collider: { width: 32, height: 32 },
    ...extra,
  });
}

/**
 * Los muros del fondo de una sala, con la cara decorada hacia la camara:
 * E sobre el borde de atras a la izquierda, S sobre el de atras a la derecha.
 * choose(i) elige la pieza de cada tramo, para alternar muros, ventanas y
 * estanterias. skip deja huecos (puertas, tuneles).
 */
function backWalls(prefix, room, choose, skip = () => false) {
  const out = [];
  for (let row = room.row; row < room.row + room.height; row += 1) {
    if (skip(room.col, row)) continue;
    out.push(kenney(`${prefix}_izq_${row}`, choose(row - room.row, 'E') + '_E', room.col, row));
  }
  for (let col = room.col; col < room.col + room.width; col += 1) {
    if (skip(col, room.row)) continue;
    out.push(kenney(`${prefix}_der_${col}`, choose(col - room.col, 'S') + '_S', col, room.row));
  }
  return out;
}

// =============================================================================
// Mapa: la misma funcion del editor
// =============================================================================

const require = createRequire(join(ROOT, 'editor', 'package.json'));
const esbuild = require('esbuild');
const bundled = join(tmpdir(), 'honeycomb-dungeon-layout.mjs');
esbuild.buildSync({
  entryPoints: [join(ROOT, 'editor', 'src', 'app', 'core', 'dungeon-layout.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  outfile: bundled,
  logLevel: 'silent',
});
const { buildLayout } = await import(pathToFileURL(bundled).href);

function mapOf(rooms, tunnels = []) {
  return buildLayout({ width: 1, height: 1 }, rooms, tunnels, []);
}

// =============================================================================
// Validacion
// =============================================================================

const Ajv = require('ajv');
const ajv = new Ajv({ allErrors: true, strict: false });
const validate = ajv.compile(JSON.parse(readFileSync(join(ROOT, 'schema', 'level.schema.json'), 'utf8')));

function writeLevel(fileName, level) {
  const ids = new Set();
  for (const entity of level.entities) {
    if (ids.has(entity.id)) throw new Error(fileName + ': id repetido ' + entity.id);
    ids.add(entity.id);
  }
  if (!validate(level)) {
    console.error(fileName + ' no valida contra el schema:');
    for (const error of validate.errors) console.error('  ' + error.instancePath + ' ' + error.message);
    process.exit(1);
  }
  writeFileSync(join(LEVELS, fileName), JSON.stringify(level, null, 2) + '\n');
  console.log('OK  ' + fileName + '  (' + level.entities.length + ' entidades, ' + level.events.length + ' eventos)');
}

// =============================================================================
// 1. La granja al amanecer
// =============================================================================
{
  const campo = { id: 'campo', col: 1, row: 1, width: 12, height: 9 };
  const layout = mapOf([campo]);
  const entities = [];

  // Cerca en los dos bordes de atras, salvo donde va el cobertizo.
  const shed = (col, row) => col <= 3 && row <= 3;
  for (let row = campo.row; row < campo.row + campo.height; row += 1) {
    if (!shed(campo.col, row)) entities.push(kenney(`cerca_izq_${row}`, 'estructura_granja_fenceLow_E', campo.col, row));
  }
  for (let col = campo.col; col < campo.col + campo.width; col += 1) {
    if (!shed(col, campo.row)) entities.push(kenney(`cerca_der_${col}`, 'estructura_granja_fenceLow_S', col, campo.row));
  }

  // Cobertizo en la esquina de atras: paredes de madera en sus cuatro lados,
  // puerta abierta hacia el camino y una ventana al costado.
  entities.push(
    kenney('cobertizo_atras_1', 'muro_granja_woodWall_E', 1, 1),
    kenney('cobertizo_atras_2', 'muro_granja_woodWallWindow_E', 1, 2),
    kenney('cobertizo_atras_3', 'muro_granja_woodWall_E', 1, 3),
    kenney('cobertizo_fondo_0', 'muro_granja_woodWall_S', 1, 1),
    kenney('cobertizo_fondo_1', 'muro_granja_woodWall_S', 2, 1),
    kenney('cobertizo_fondo_2', 'muro_granja_woodWall_S', 3, 1),
    kenney('fardos_dentro', 'objeto_granja_hayBalesStacked_S', 2, 2),
    kenney('sacos_dentro', 'objeto_granja_sacksCrate_S', 3, 2),
    kenney('cobertizo_frente_1', 'muro_granja_woodWall_N', 1, 3),
    kenney('cobertizo_puerta', 'muro_granja_woodWallDoorOpen_N', 2, 3),
    kenney('cobertizo_frente_3', 'muro_granja_woodWall_N', 3, 3),
    kenney('cobertizo_lado_1', 'muro_granja_woodWall_W', 3, 1),
    kenney('cobertizo_ventana', 'muro_granja_woodWallWindow_W', 3, 2),
  );

  // Camino de tierra en diagonal, de la entrada del campo a la puerta.
  const path = [
    [7, 9], [6, 8], [6, 7], [5, 6], [4, 6], [4, 5], [3, 4], [2, 4],
  ];
  path.forEach(([col, row], index) => entities.push(kenney(`camino_${index + 1}`, 'suelo_granja_dirt_S', col, row)));

  // Huerto de maiz cercado a la derecha.
  const huerto = { col: 8, row: 3, width: 4, height: 4 };
  for (let col = huerto.col; col < huerto.col + huerto.width; col += 1) {
    for (let row = huerto.row; row < huerto.row + huerto.height; row += 1) {
      const kind = (col + row) % 3 === 0 ? 'naturaleza_granja_cornDouble_S' : (col + row) % 3 === 1 ? 'naturaleza_granja_corn_S' : 'naturaleza_granja_cornYoung_S';
      entities.push(kenney(`huerto_tierra_${col}_${row}`, 'suelo_granja_dirtFarmland_S', col, row));
      entities.push(kenney(`maiz_${col}_${row}`, kind, col, row, { type: 'decoracion' }));
    }
  }
  for (let col = huerto.col; col < huerto.col + huerto.width; col += 1) {
    entities.push(kenney(`cerca_huerto_frente_${col}`, col === 9 ? 'estructura_granja_fenceLowBroken_N' : 'estructura_granja_fenceLow_N', col, huerto.row + huerto.height - 1));
  }
  for (let row = huerto.row; row < huerto.row + huerto.height; row += 1) {
    entities.push(kenney(`cerca_huerto_izq_${row}`, 'estructura_granja_fenceLow_E', huerto.col, row));
  }

  // Granero al aire libre junto al cobertizo.
  entities.push(
    kenney('fardos_1', 'objeto_granja_hayBales_S', 5, 2, { collider: solid() }),
    kenney('fardos_2', 'objeto_granja_hay_S', 6, 2),
    kenney('saco_1', 'objeto_granja_sack_S', 4, 2),
    kenney('cajas_1', 'objeto_mazmorra_woodenCrates_S', 5, 1, { collider: solid() }),
    kenney('barril_1', 'objeto_mazmorra_barrel_S', 4, 1, { collider: solid() }),
    shape('tronco_1', 'cylinder_wood', 7, 1, { scale: 1.4, collider: solid() }),
  );

  // Arboles y arbustos (figuras de pasto) enmarcando las esquinas de adelante.
  entities.push(
    shape('pino_1', 'cone_grass', 1, 8, { scale: 2.2 }),
    shape('pino_2', 'cone_grass', 2, 9, { scale: 1.8 }),
    shape('pino_3', 'cone_grass', 1, 6, { scale: 1.6 }),
    shape('arbusto_1', 'sphere_grass', 3, 9, { scale: 1.4 }),
    shape('arbusto_2', 'sphere_grass', 12, 9, { scale: 1.6 }),
    shape('pino_4', 'cone_grass', 12, 7, { scale: 2 }),
    shape('arbusto_3', 'sphere_grass', 11, 9, { scale: 1.2 }),
    shape('piedra_1', 'sphere', 10, 8, { scale: 0.8 }),
  );

  entities.push(adventurer('player_1', 5, 7, { type: 'player', stats: { health: 100, damage: 10, speed: 3 } }));

  writeLevel('Presentacion_1_Basico.json', {
    name: 'La granja al amanecer',
    backgroundColor: { r: 156, g: 198, b: 226 },
    camera: { mode: 'fixed', zoom: 0.85 },
    grid: { width: layout.width, height: layout.height, tileWidth: TILE_W, tileHeight: TILE_H },
    visuals: { floor: grassFloor() },
    tiles: layout.tiles,
    rooms: [campo],
    entities,
    events: [],
  });
}

// =============================================================================
// 2. La biblioteca sellada
// =============================================================================
{
  const biblioteca = { id: 'biblioteca', col: 1, row: 3, width: 10, height: 8 };
  const salida = { id: 'salida', col: 6, row: 1, width: 1, height: 2 };
  const layout = mapOf([biblioteca, salida]);
  const entities = [];

  // Muros de piedra con estanterias empotradas, y la reja en el medio del fondo.
  const gate = (col, row) => col === 6 && row === biblioteca.row;
  entities.push(
    ...backWalls(
      'muro',
      biblioteca,
      (i, side) => (i % 3 === 1 ? 'muro_biblioteca_wallBooks' : side === 'E' && i % 4 === 3 ? 'muro_mazmorra_stoneWallWindow' : 'muro_mazmorra_stoneWall'),
      gate,
    ),
  );
  entities.push(
    kenney('reja', 'muro_mazmorra_stoneWallGateBars_S', 6, biblioteca.row, { collider: solid() }),
    kenney('reja_abierta', 'muro_mazmorra_stoneWallGateOpen_S', 6, biblioteca.row, { hidden: true }),
  );

  // Alfombra de la reja hacia adelante, por el pasillo central.
  for (let row = biblioteca.row + 1; row < biblioteca.row + biblioteca.height; row += 1) {
    const end = row === biblioteca.row + biblioteca.height - 1;
    entities.push(kenney(`alfombra_${row}`, end ? 'suelo_biblioteca_floorCarpetEnd_E' : 'suelo_biblioteca_floorCarpet_E', 6, row));
  }

  // Estanterias contra el muro de la izquierda, mesas largas a los lados del pasillo.
  entities.push(
    kenney('estante_1', 'objeto_biblioteca_bookcaseWideBooks_E', 2, 5, { collider: solid() }),
    kenney('estante_2', 'objeto_biblioteca_bookcaseBooksLadder_E', 2, 6, { collider: solid() }),
    kenney('estante_3', 'objeto_biblioteca_bookcaseWideBooks_E', 2, 8, { collider: solid() }),
    kenney('estante_4', 'objeto_biblioteca_bookcaseWideBooks_S', 3, 4, { collider: solid() }),
    kenney('estante_5', 'objeto_biblioteca_bookcaseWideBooksLadder_S', 9, 4, { collider: solid() }),
    kenney('estante_6', 'objeto_biblioteca_bookcaseGlass_S', 8, 4, { collider: solid() }),
    kenney('mesa_1', 'objeto_biblioteca_longTableDecoratedChairs_N', 4, 7, { collider: solid() }),
    kenney('mesa_2', 'objeto_biblioteca_longTableDecoratedChairsBooks_N', 8, 7, { collider: solid() }),
    kenney('mesa_redonda', 'objeto_mazmorra_tableRoundItemsChairs_S', 9, 9, { collider: solid() }),
    kenney('atril', 'objeto_biblioteca_bookStand_S', 5, 4),
    kenney('vela_1', 'objeto_biblioteca_candleStandDouble_S', 4, 4),
    kenney('vela_2', 'objeto_biblioteca_candleStandDouble_S', 7, 4),
    kenney('vela_3', 'objeto_biblioteca_candleStand_S', 3, 10),
    kenney('vela_4', 'objeto_biblioteca_candleStand_S', 10, 7),
    kenney('vitrina_1', 'objeto_biblioteca_displayCaseBooks_S', 10, 5, { collider: solid() }),
    kenney('sillon', 'objeto_biblioteca_libraryChair_S', 4, 9),
    kenney('pila_libros', 'objeto_biblioteca_bookcaseFallen_S', 2, 10),
  );

  // La espada (en su vitrina) y tres bolsas de monedas escondidas entre los muebles.
  const items = [
    {
      id: 'espada',
      name: 'Espada',
      kind: 'weapon',
      texture: piece('objeto_biblioteca_displayCaseSword_S').texture,
      sourceRect: { x: 0, y: 0, width: 128, height: 256 },
      scale: 0.4,
      weapon: { category: 'melee', attack: { pattern: 'cone', damage: 12, cooldown: 0.4, range: 1.6, angle: 100 } },
    },
    {
      id: 'moneda',
      name: 'Bolsa de monedas',
      kind: 'coin',
      texture: piece('objeto_granja_sack_S').texture,
      sourceRect: { x: 0, y: 0, width: 128, height: 256 },
      scale: 0.5,
      value: 1,
    },
  ];
  entities.push(
    kenney('espada_1', 'objeto_biblioteca_displayCaseSword_S', 10, 9, { type: 'item', item: 'espada', collider: { width: 48, height: 48 } }),
    kenney('moneda_1', 'objeto_granja_sack_S', 3, 7, { type: 'item', item: 'moneda', scale: 0.7, collider: { width: 32, height: 32 } }),
    kenney('moneda_2', 'objeto_granja_sack_S', 10, 6, { type: 'item', item: 'moneda', scale: 0.7, collider: { width: 32, height: 32 } }),
    kenney('moneda_3', 'objeto_granja_sack_S', 6, 5, { type: 'item', item: 'moneda', scale: 0.7, collider: { width: 32, height: 32 } }),
  );

  entities.push(
    adventurer('player_1', 6, 9, {
      type: 'player',
      stats: { health: 100, damage: 10, speed: 3 },
      inventory: { slots: 2, coins: 0, items: [], onFull: 'manual_replace' },
      mobility: { dash: { distance: 2.5, duration: 0.18, cooldown: 0.8, iframes: 0.25 } },
    }),
  );

  writeLevel('Presentacion_2_Medio.json', {
    name: 'La biblioteca sellada',
    backgroundColor: { r: 20, g: 14, b: 24 },
    camera: { mode: 'follow', zoom: 1.2, smoothing: 0.15, deadzone: { width: 80, height: 60 }, clampToLevel: true },
    grid: { width: layout.width, height: layout.height, tileWidth: TILE_W, tileHeight: TILE_H },
    visuals: { floor: kenneyFloor('suelo_mazmorra_planks_S') },
    tiles: layout.tiles,
    rooms: [biblioteca, salida],
    zones: [{ id: 'puerta', col: 6, row: 1, width: 1, height: 1 }],
    items,
    entities,
    events: [
      {
        trigger: { type: 'on_items_collected', params: { item: 'moneda', count: 3 } },
        actions: [
          { type: 'hide_entity', params: { entity: 'reja' } },
          { type: 'show_entity', params: { entity: 'reja_abierta' } },
          { type: 'show_message', params: { text: 'La puerta secreta se abrió.' } },
        ],
      },
      {
        trigger: { type: 'on_player_enter_zone', params: { zone: 'puerta' } },
        actions: [
          { type: 'load_level', params: { level: 'Presentacion_3_Avanzado.json', message: 'Bajas a las ruinas...' } },
        ],
      },
    ],
  });
}

// =============================================================================
// 3. Las ruinas de la mazmorra
// =============================================================================
{
  const entrada = { id: 'entrada', col: 1, row: 2, width: 7, height: 7 };
  const salon = { id: 'salon', col: 11, row: 2, width: 9, height: 8 };
  const camara = { id: 'camara', col: 23, row: 3, width: 8, height: 7 };
  const tunnels = [
    { id: 'tunel_1', from: 'entrada', to: 'salon', width: 2, fromSide: 'right', toSide: 'left' },
    { id: 'tunel_2', from: 'salon', to: 'camara', width: 2, fromSide: 'right', toSide: 'left' },
  ];
  const layout = mapOf([entrada, salon, camara], tunnels);
  const floor = new Set(layout.tiles.filter((tile) => tile.floor !== false).map((tile) => tile.col + ',' + tile.row));
  const entities = [];

  // Muros de fondo de cada sala, con aberturas donde llegan los tuneles.
  const ruin = (i) => (i % 5 === 2 ? 'muro_mazmorra_stoneWallAged' : i % 7 === 4 ? 'muro_mazmorra_stoneWallBroken' : 'muro_mazmorra_stoneWall');
  for (const room of [entrada, salon, camara]) {
    const opening = (col, row) =>
      (col === room.col && floor.has(col - 1 + ',' + row)) || (row === room.row && floor.has(col + ',' + (row - 1)));
    entities.push(...backWalls('muro_' + room.id, room, ruin, opening));
  }

  // Reja entre el salon y la camara: las dos celdas del tunel justo al salir del salon.
  const gateCol = salon.col + salon.width;
  const gateRows = [...floor].map((key) => key.split(',').map(Number)).filter(([col]) => col === gateCol).map(([, row]) => row);
  gateRows.forEach((row, index) => {
    entities.push(kenney(`reja_${index + 1}`, 'muro_mazmorra_stoneWallGateBars_E', gateCol, row, { collider: solid() }));
  });

  // Entrada: escaleras al fondo, barriles, cajas y columnas.
  entities.push(
    kenney('escalera', 'estructura_mazmorra_stairs_S', 3, 2, { collider: solid() }),
    kenney('columna_1', 'muro_mazmorra_stoneColumn_S', 2, 4, { collider: solid() }),
    kenney('columna_2', 'muro_mazmorra_stoneColumn_S', 6, 4, { collider: solid() }),
    kenney('barriles_1', 'objeto_mazmorra_barrelsStacked_S', 2, 7, { collider: solid() }),
    kenney('barril_1', 'objeto_mazmorra_barrel_S', 3, 8, { collider: solid() }),
    kenney('cajas_1', 'objeto_mazmorra_woodenCrates_S', 6, 8, { collider: solid() }),
    kenney('mesa_rota', 'objeto_mazmorra_tableChairsBroken_S', 5, 6),
    kenney('cofre_entrada', 'objeto_mazmorra_chestOpen_S', 6, 3),
    kenney('parche_entrada_1', 'suelo_mazmorra_dirtTiles_S', 4, 7),
    kenney('parche_entrada_2', 'suelo_mazmorra_stoneMissingTiles_S', 3, 5),
  );

  // Salon de los guardianes: tres orbes de metal y una piramide de piedra.
  const guardian = (id, shapeId, col, row, scale) =>
    shape(id, shapeId, col, row, {
      type: 'enemy',
      scale,
      collider: { width: 48, height: 48 },
      stats: { health: 30, damage: 6, speed: 1.6 },
    });
  entities.push(
    guardian('guardian_1', 'sphere_metal', 14, 4, 1.5),
    guardian('guardian_2', 'sphere_metal', 17, 6, 1.5),
    guardian('guardian_3', 'pyramid', 15, 8, 1.6),
    kenney('soportes_1', 'muro_mazmorra_woodenSupportsBeam_S', 12, 3),
    kenney('soportes_2', 'muro_mazmorra_woodenSupports_S', 18, 3),
    kenney('pila_madera', 'objeto_mazmorra_woodenPile_S', 19, 8),
    shape('bloque_1', 'cube', 12, 9, { collider: solid() }),
    shape('bloque_2', 'slab', 13, 9),
    kenney('barriles_salon', 'objeto_mazmorra_barrels_S', 19, 4, { collider: solid() }),
    kenney('cajas_salon', 'objeto_mazmorra_woodenCrate_S', 12, 7, { collider: solid() }),
    kenney('parche_salon_1', 'suelo_mazmorra_stoneUneven_S', 15, 5),
    kenney('parche_salon_2', 'suelo_mazmorra_stoneUneven_S', 16, 5),
    kenney('parche_salon_3', 'suelo_mazmorra_stoneMissingTiles_S', 13, 5),
    kenney('parche_salon_4', 'suelo_mazmorra_dirt_S', 17, 8),
    kenney('columna_salon', 'muro_mazmorra_stoneColumn_S', 18, 7, { collider: solid() }),
  );

  // Camara del jefe: el coloso de metal, columnas y el cofre que aparece al final.
  entities.push(
    shape('coloso', 'pillar_metal', 27, 6, {
      type: 'enemy',
      boss: true,
      scale: 2.6,
      collider: { width: 64, height: 64 },
      stats: { health: 160, damage: 12, speed: 1.2 },
    }),
    kenney('columna_3', 'muro_mazmorra_stoneColumnWood_S', 24, 4, { collider: solid() }),
    kenney('columna_4', 'muro_mazmorra_stoneColumnWood_S', 30, 4, { collider: solid() }),
    kenney('columna_5', 'muro_mazmorra_stoneColumn_S', 24, 9, { collider: solid() }),
    kenney('columna_6', 'muro_mazmorra_stoneColumn_S', 30, 9, { collider: solid() }),
    kenney('cofre', 'objeto_mazmorra_chestClosed_S', 27, 8, { hidden: true, collider: { width: 64, height: 64 } }),
    kenney('brasero_1', 'objeto_biblioteca_candleStandDouble_S', 25, 5),
    kenney('brasero_2', 'objeto_biblioteca_candleStandDouble_S', 29, 5),
    kenney('brasero_3', 'objeto_biblioteca_candleStandDouble_S', 25, 8),
    kenney('brasero_4', 'objeto_biblioteca_candleStandDouble_S', 29, 8),
    kenney('alfombra_jefe_1', 'suelo_biblioteca_floorCarpet_N', 25, 6),
    kenney('alfombra_jefe_2', 'suelo_biblioteca_floorCarpet_N', 26, 6),
    kenney('parche_camara_1', 'suelo_mazmorra_stoneMissingTiles_S', 28, 7),
    kenney('barriles_camara', 'objeto_mazmorra_barrelsStacked_S', 30, 6, { collider: solid() }),
  );

  const items = [
    {
      id: 'espada',
      name: 'Espada',
      kind: 'weapon',
      texture: piece('objeto_biblioteca_displayCaseSword_S').texture,
      sourceRect: { x: 0, y: 0, width: 128, height: 256 },
      scale: 0.4,
      weapon: {
        category: 'melee',
        attack: { pattern: 'cone', damage: 12, cooldown: 0.4, range: 1.6, angle: 100 },
        ability: {
          name: 'Giro cargado',
          hitsRequired: 3,
          activation: 'auto',
          resetAfter: 3,
          attack: { pattern: 'area', damage: 25, cooldown: 0.6, range: 2.2 },
        },
      },
    },
  ];

  entities.push(
    adventurer('player_1', 4, 5, {
      type: 'player',
      stats: { health: 120, damage: 10, speed: 3 },
      inventory: { slots: 3, coins: 0, items: ['espada'], onFull: 'manual_replace' },
      mobility: {
        dash: { distance: 3, duration: 0.18, cooldown: 0.8, iframes: 0.25 },
        defense: { reduction: 0.5, speedMultiplier: 0.5 },
      },
    }),
  );

  writeLevel('Presentacion_3_Avanzado.json', {
    name: 'Las ruinas de la mazmorra',
    backgroundColor: { r: 12, g: 16, b: 26 },
    camera: { mode: 'follow', zoom: 1.1, smoothing: 0.18, deadzone: { width: 100, height: 70 }, clampToLevel: true },
    grid: { width: layout.width, height: layout.height, tileWidth: TILE_W, tileHeight: TILE_H },
    visuals: { floor: kenneyFloor('suelo_mazmorra_stone_S') },
    tiles: layout.tiles,
    rooms: [entrada, salon, camara],
    tunnels,
    items,
    entities,
    events: [
      {
        trigger: { type: 'on_zone_cleared', params: { zone: 'salon' } },
        actions: [
          ...gateRows.map((_, index) => ({ type: 'hide_entity', params: { entity: `reja_${index + 1}` } })),
          { type: 'show_message', params: { text: '¡Los guardianes cayeron! La reja se abrió.' } },
        ],
      },
      {
        trigger: { type: 'on_player_enter_zone', params: { zone: 'camara' } },
        conditions: [{ type: 'flag_is_not_set', params: { flag: 'jefe_visto' } }],
        actions: [
          { type: 'show_message', params: { text: '¡El Coloso despierta!' } },
          { type: 'set_flag', params: { flag: 'jefe_visto' } },
        ],
      },
      {
        trigger: { type: 'on_boss_defeated', params: {} },
        actions: [
          { type: 'set_flag', params: { flag: 'jefe_vencido' } },
          { type: 'show_entity', params: { entity: 'cofre' } },
          { type: 'show_message', params: { text: 'Apareció un cofre en el centro de la cámara.' } },
        ],
      },
      {
        trigger: { type: 'on_collision', params: { entityA: 'player_1', entityB: 'cofre' } },
        conditions: [{ type: 'flag_is_set', params: { flag: 'jefe_vencido' } }],
        actions: [
          { type: 'load_level', params: { level: 'Presentacion_1_Basico.json', message: '¡Victoria! Fin de la demostración.' } },
        ],
      },
    ],
  });
}

console.log('Piezas reducidas en ' + DERIVED + ': ' + derived.size);
