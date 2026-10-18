// =============================================================================
// Ayudantes de las pruebas de rendimiento y de estres del editor (perf/).
// =============================================================================
//
// Solo TypeScript puro: nada de Vitest ni de Node. Este archivo cae dentro del
// tsconfig de la app (src/**/*.ts), y el build de produccion lo compila aunque
// nadie lo importe; por eso lo que necesita Node (escribir el JSON con los
// numeros, medir el heap) vive en los .spec.ts, que solo ve el tsconfig de las
// pruebas.
//
// Que hay aca:
//   - estadisticas (mediana y percentil 95) y un medidor con calentamiento;
//   - un contexto 2D falso que HACE las llamadas (las cuenta) pero no pinta;
//   - generadores de niveles deterministas: N entidades, un mapa de salas y
//     tuneles, N eventos, una grilla de lado L.
//
// LIMITE DE LO QUE MIDE: jsdom no tiene canvas. El contexto falso cuesta lo
// que cuesta llamar a sus metodos, no lo que cuesta rasterizar. El costo de
// pintar de verdad se mide aparte, en Electron (ver scripts/perf-editor.js).

import { buildLayout } from '../core/dungeon-layout';
import { CanvasScene } from '../core/iso-canvas-renderer';
import { SHAPES, SHAPE_TEXTURE } from '../core/iso-shapes';
import { CANVAS_PALETTES } from '../core/themes';
import { EventDefinition, Level, LevelEntity, MapRoom, MapTunnel } from '../models/level.model';

// --- Estadisticas --------------------------------------------------------------

export interface Stats {
  n: number;
  median: number;
  p95: number;
  mean: number;
  min: number;
  max: number;
}

/** Percentil por rango mas cercano: con 40 muestras, el p95 es la 38. */
function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) {
    return NaN;
  }
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

/** Redondea a centesimas de milisegundo: mas decimales son ruido del reloj. */
export function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function stats(samples: readonly number[]): Stats {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    n: sorted.length,
    median: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    mean: round(sorted.length ? sum / sorted.length : NaN),
    min: round(sorted[0] ?? NaN),
    max: round(sorted.at(-1) ?? NaN),
  };
}

/**
 * Corre fn "warmup" veces sin anotar (para que el JIT compile y las caches se
 * llenen) y despues "iterations" veces anotando cada duracion en ms.
 * fn recibe el numero de iteracion, para que cada paso pueda ser distinto.
 */
export function measure(fn: (i: number) => void, iterations: number, warmup = 5): number[] {
  for (let i = 0; i < warmup; i += 1) {
    fn(i);
  }
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    fn(warmup + i);
    samples.push(performance.now() - start);
  }
  return samples;
}

/**
 * Deja correr el bucle de eventos (una tarea nueva). Entre dos movimientos del
 * mouse de verdad siempre pasa: cada evento llega en su propia tarea. Sin esto,
 * cientos de eventos seguidos en la misma tarea hacen que Angular corte con
 * NG0103 ("no se pudo estabilizar"), algo que con un mouse real no pasa.
 */
export function nextTask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Como measure(), pero dejando correr el bucle de eventos entre iteraciones (fuera del tiempo medido). */
export async function measureAsync(fn: (i: number) => void, iterations: number, warmup = 5): Promise<number[]> {
  for (let i = 0; i < warmup; i += 1) {
    fn(i);
    await nextTask();
  }
  const samples: number[] = [];
  for (let i = 0; i < iterations; i += 1) {
    const start = performance.now();
    fn(warmup + i);
    samples.push(performance.now() - start);
    await nextTask();
  }
  return samples;
}

/** Una sola medicion, en ms. */
export function time<T>(fn: () => T): { ms: number; value: T } {
  const start = performance.now();
  const value = fn();
  return { ms: performance.now() - start, value };
}

// --- Contexto 2D falso ---------------------------------------------------------

/**
 * Contexto 2D que recibe todas las llamadas del renderer y solo las cuenta.
 * No es un Proxy (como el de iso-canvas-renderer.spec.ts) a proposito: un
 * Proxy agrega su propio costo a cada llamada, y aca se mide tiempo.
 */
export class CountingContext2D {
  calls = 0;
  drawImages = 0;
  fillStyle: unknown = '';
  strokeStyle: unknown = '';
  globalAlpha = 1;
  lineWidth = 1;
  font = '';
  textAlign = 'left';
  textBaseline = 'alphabetic';
  imageSmoothingEnabled = true;

  beginPath(): void { this.calls++; }
  closePath(): void { this.calls++; }
  moveTo(_x: number, _y: number): void { this.calls++; }
  lineTo(_x: number, _y: number): void { this.calls++; }
  arc(..._args: number[]): void { this.calls++; }
  roundRect(..._args: number[]): void { this.calls++; }
  fill(): void { this.calls++; }
  stroke(): void { this.calls++; }
  fillRect(..._args: number[]): void { this.calls++; }
  strokeRect(..._args: number[]): void { this.calls++; }
  clearRect(..._args: number[]): void { this.calls++; }
  setLineDash(_dash: number[]): void { this.calls++; }
  fillText(_text: string, _x: number, _y: number): void { this.calls++; }
  measureText(text: string): { width: number } {
    this.calls++;
    return { width: text.length * 6 };
  }
  drawImage(..._args: unknown[]): void {
    this.calls++;
    this.drawImages++;
  }
  save(): void { this.calls++; }
  restore(): void { this.calls++; }

  reset(): void {
    this.calls = 0;
    this.drawImages = 0;
  }
}

/** Un canvas de mentira que entrega siempre el mismo contexto falso. */
export function countingCanvas(ctx: CountingContext2D): HTMLCanvasElement {
  return { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
}

/** Una imagen "ya cargada" para el sheet de figuras o las texturas del proyecto. */
export function loadedImage(width = 64, height = 64): HTMLImageElement {
  return { naturalWidth: width, naturalHeight: height, width, height } as unknown as HTMLImageElement;
}

export interface SceneOptions {
  size?: { w: number; h: number };
  zoom?: number;
  selectedId?: string | null;
  hovered?: { col: number; row: number } | null;
  /** Con imagenes: el sheet y las texturas cargadas, como en Electron con disco. */
  withImages?: boolean;
  showGrid?: boolean;
}

/** Una escena fija para llamar al renderer sin Angular. */
export function sceneFor(level: () => Level, options: SceneOptions = {}): CanvasScene {
  const image = options.withImages === false ? null : loadedImage();
  const selected = new Set(options.selectedId ? [options.selectedId] : []);
  return {
    size: () => options.size ?? { w: 900, h: 520 },
    pan: () => ({ x: 0, y: 0 }),
    zoom: () => options.zoom ?? 1,
    level,
    selectedId: () => options.selectedId ?? null,
    selectedIds: () => selected,
    hovered: () => options.hovered ?? null,
    showGrid: () => options.showGrid ?? true,
    gridOnTop: () => false,
    showColliders: () => false,
    roomDraft: () => null,
    roomDrag: () => null,
    tunnelTrace: () => null,
    shapeSheet: () => image,
    palette: () => CANVAS_PALETTES.honeycomb,
    marquee: () => null,
    sprite: () => image,
    hoveredEntityId: () => null,
  };
}

// --- Generadores de niveles ----------------------------------------------------

/** PRNG chico y determinista (mulberry32): el mismo nivel en cada corrida. */
export function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Los mismos visuals que pone LevelService a un nivel nuevo. */
export function defaultVisuals(): NonNullable<Level['visuals']> {
  return {
    floor: { texture: 'textures/floor.png', sourceRect: { x: 0, y: 0, width: 64, height: 64 } },
    wall: { texture: 'textures/wall.png', sourceRect: { x: 0, y: 0, width: 32, height: 32 } },
  };
}

/** Lado de grilla para N entidades con la mitad de las casillas ocupadas. */
export function gridSideFor(entities: number): number {
  return Math.max(16, Math.ceil(Math.sqrt(entities * 2)));
}

/**
 * Una entidad de la mezcla tipica de un nivel: mayoria de figuras del sheet,
 * enemigos y props con textura propia y collider, algunos objetos, y unas
 * pocas ocultas o jefes (que dibujan algo extra).
 */
function mixedEntity(index: number, col: number, row: number, random: () => number): LevelEntity {
  const roll = random();
  const position = { col, row };
  if (roll < 0.6) {
    const shape = SHAPES[index % SHAPES.length];
    return {
      id: shape.id + '_' + index,
      type: shape.id,
      position,
      texture: SHAPE_TEXTURE,
      sourceRect: { ...shape.sourceRect },
      groundOffset: shape.groundOffset,
    };
  }
  if (roll < 0.85) {
    return {
      id: 'enemy_' + index,
      type: 'enemy',
      position,
      texture: 'textures/player2.png',
      sourceRect: { x: 0, y: 0, width: 16, height: 16 },
      scale: 2,
      collider: { width: 16, height: 16, solid: true },
      stats: { health: 30, damage: 10, speed: 1.5 },
      boss: roll > 0.84,
    };
  }
  if (roll < 0.95) {
    return {
      id: 'prop_' + index,
      type: 'prop',
      position,
      texture: 'textures/wall.png',
      sourceRect: { x: 0, y: 0, width: 32, height: 32 },
      wall: true,
      hidden: roll > 0.93,
    };
  }
  return {
    id: 'item_' + index,
    type: 'pickup',
    position,
    texture: 'textures/player.png',
    sourceRect: { x: 0, y: 0, width: 16, height: 16 },
  };
}

/**
 * Un nivel con N entidades en casillas distintas, sobre una grilla con la
 * mitad ocupada (o la que se pida). La primera entidad es siempre un jugador
 * en el centro: es la que arrastran las pruebas.
 */
export function levelWithEntities(count: number, options: { side?: number; seed?: number; events?: number } = {}): Level {
  const side = options.side ?? gridSideFor(count);
  const random = rng(options.seed ?? 7);
  const cells = side * side;
  if (count > cells) {
    throw new Error('No entran ' + count + ' entidades en una grilla de ' + side + 'x' + side);
  }
  // Casillas mezcladas (Fisher-Yates parcial) sin repetir.
  const order = Array.from({ length: cells }, (_, i) => i);
  const center = Math.floor(side / 2) * side + Math.floor(side / 2);
  [order[0], order[center]] = [order[center], order[0]];
  for (let i = 1; i < count; i += 1) {
    const j = i + Math.floor(random() * (cells - i));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const entities: LevelEntity[] = [];
  for (let i = 0; i < count; i += 1) {
    const col = order[i] % side;
    const row = Math.floor(order[i] / side);
    entities.push(
      i === 0
        ? {
            id: 'player_1',
            type: 'player',
            position: { col, row },
            texture: 'textures/player.png',
            sourceRect: { x: 0, y: 0, width: 16, height: 16 },
            scale: 2,
            collider: { width: 16, height: 16 },
            stats: { health: 100, damage: 10, speed: 3 },
          }
        : mixedEntity(i, col, row, random),
    );
  }
  const level: Level = {
    name: 'perf_' + count,
    grid: { width: side, height: side, tileWidth: 64, tileHeight: 32 },
    entities,
    events: [],
    visuals: defaultVisuals(),
  };
  if (options.events) {
    level.events = eventsFor(options.events, entities.map((entity) => entity.id));
  }
  return level;
}

/**
 * N eventos con la forma de los que arma el panel: un disparador con una
 * entidad, una condicion, y dos acciones (una con entidad).
 */
export function eventsFor(count: number, entityIds: readonly string[]): EventDefinition[] {
  const pick = (i: number) => entityIds[i % Math.max(1, entityIds.length)] ?? 'player_1';
  return Array.from({ length: count }, (_, i) => ({
    trigger: { type: 'on_entity_destroyed', params: { entity: pick(i) } },
    conditions: [{ type: 'flag_is_set', params: { flag: 'marca_' + (i % 10) } }],
    actions: [
      { type: 'show_entity', params: { entity: pick(i + 1) } },
      { type: 'play_sound', params: { soundPath: 'sounds/aviso.ogg' } },
    ],
  }));
}

/**
 * Un mapa de "count" salas de size x size en filas, separadas por 4 casillas,
 * con un tunel entre cada sala y la de su derecha (y la de abajo al final de
 * cada fila). Trae "tiles" ya calculados con buildLayout, como lo deja
 * LevelService despues de cada cambio del mapa.
 */
export function levelWithRooms(count: number, size = 8, entities = 0): Level {
  const perRow = Math.max(1, Math.ceil(Math.sqrt(count)));
  const gap = 4;
  const rooms: MapRoom[] = [];
  for (let i = 0; i < count; i += 1) {
    rooms.push({
      id: 'sala_' + (i + 1),
      col: 1 + (i % perRow) * (size + gap),
      row: 1 + Math.floor(i / perRow) * (size + gap),
      width: size,
      height: size,
    });
  }
  const tunnels: MapTunnel[] = [];
  for (let i = 0; i < count; i += 1) {
    const right = i + 1;
    if (right < count && right % perRow !== 0) {
      tunnels.push({ id: 'tunel_' + (tunnels.length + 1), from: rooms[i].id, to: rooms[right].id, width: 2 });
    }
    const below = i + perRow;
    if (i % perRow === perRow - 1 && below < count) {
      tunnels.push({ id: 'tunel_' + (tunnels.length + 1), from: rooms[i].id, to: rooms[below].id, width: 2 });
    }
  }
  const grid = { width: 10, height: 10, tileWidth: 64, tileHeight: 32 };
  const layout = buildLayout(grid, rooms, tunnels, []);
  const level: Level = {
    name: 'perf_salas_' + count,
    grid: { ...grid, width: layout.width, height: layout.height },
    entities: [],
    events: [],
    visuals: defaultVisuals(),
    rooms,
    tunnels,
    tileEdits: [],
    tiles: layout.tiles,
  };
  if (entities > 0) {
    // Las entidades van dentro de las salas, de a una por casilla.
    const random = rng(11);
    const list: LevelEntity[] = [];
    for (let i = 0; i < entities; i += 1) {
      const room = rooms[i % rooms.length];
      const slot = Math.floor(i / rooms.length);
      if (slot >= size * size) {
        break;
      }
      list.push(mixedEntity(i, room.col + (slot % size), room.row + Math.floor(slot / size), random));
    }
    level.entities = list;
  }
  return level;
}

/** Una sola sala de side x side: el mapa mas grande posible con una sola pieza. */
export function levelWithOneRoom(side: number): Level {
  const room: MapRoom = { id: 'sala_1', col: 1, row: 1, width: side, height: side };
  const grid = { width: 10, height: 10, tileWidth: 64, tileHeight: 32 };
  const layout = buildLayout(grid, [room], [], []);
  return {
    name: 'perf_sala_' + side,
    grid: { ...grid, width: layout.width, height: layout.height },
    entities: [],
    events: [],
    visuals: defaultVisuals(),
    rooms: [room],
    tunnels: [],
    tileEdits: [],
    tiles: layout.tiles,
  };
}

/** Una grilla sola de side x side, sin salas ni tiles: el nivel recien creado, mas grande. */
export function plainGrid(side: number, entities = 0): Level {
  const level = entities > 0 ? levelWithEntities(entities, { side }) : null;
  return {
    name: 'perf_grilla_' + side,
    grid: { width: side, height: side, tileWidth: 64, tileHeight: 32 },
    entities: level?.entities ?? [],
    events: [],
    visuals: defaultVisuals(),
  };
}

/** Donde cae en el canvas el punto de una casilla, con el mismo calculo que el renderer. */
export function cellToCanvas(
  cell: { col: number; row: number },
  level: Level,
  origin: { x: number; y: number },
  zoom: number,
): { x: number; y: number } {
  const halfW = level.grid.tileWidth / 2;
  const halfH = level.grid.tileHeight / 2;
  return {
    x: origin.x + (cell.col - cell.row) * halfW * zoom,
    y: origin.y + (cell.col + cell.row) * halfH * zoom,
  };
}
