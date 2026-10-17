import { computed, inject, signal } from '@angular/core';

import {
  IsoAnchor,
  PixelPoint,
  Rgba,
  SPRITE_FRAMES_MAX,
  SPRITE_LAYERS_MAX,
  SpriteDoc,
  TRANSPARENT,
  addFrame,
  addLayer,
  blankPixels,
  celOf,
  compositeFrame,
  createDoc,
  docFromImage,
  duplicateLayer,
  flipPixels,
  floodFill,
  hexToRgba,
  linePoints,
  moveFrame,
  moveLayer,
  paintPixel,
  patchLayer,
  pixelAt,
  rectPoints,
  removeFrame,
  removeLayer,
  rgbaToHex,
  setCel,
  snapLineEnd,
  splitIntoFrames,
  stampBrush,
  stripPixels,
  uniqueColors,
} from '../core/sprite-doc';
import { readSpriteFrames, withSpriteFrames } from '../core/sprite-frames';
import { decodeImage } from '../core/texture-fit';
import { ProjectService } from '../services/project.service';
import type { IconName } from '../ui/icons.generated';
import type { NamePromptRequest } from '../ui/name-prompt.controller';

/**
 * Herramientas de dibujo. Los atajos son los de Aseprite, para que quien venga
 * de ahi no tenga que aprender otros.
 */
export type SpriteTool = 'pencil' | 'eraser' | 'bucket' | 'picker' | 'line' | 'rect';

export const SPRITE_TOOLS: readonly { id: SpriteTool; icon: IconName; key: string; label: string; hint: string }[] = [
  { id: 'pencil', icon: 'pencil', key: 'B', label: 'Lápiz', hint: 'Lápiz: el clic izquierdo pinta con el color principal y el derecho con el secundario' },
  { id: 'eraser', icon: 'eraser', key: 'E', label: 'Borrador', hint: 'Borrador: deja los píxeles transparentes' },
  { id: 'bucket', icon: 'paint-bucket', key: 'G', label: 'Balde', hint: 'Balde: rellena el área contigua del mismo color' },
  { id: 'picker', icon: 'pipette', key: 'I', label: 'Gotero', hint: 'Gotero: toma el color de un píxel (también Alt + clic con cualquier herramienta)' },
  { id: 'line', icon: 'slash', key: 'L', label: 'Línea', hint: 'Línea: arrastra de punta a punta. Con Shift va a 2:1, la diagonal isométrica' },
  { id: 'rect', icon: 'square', key: 'U', label: 'Rectángulo', hint: 'Rectángulo: arrastra de una esquina a la otra. Con Shift sale lleno' },
];

/**
 * DB16 de DawnBringer, la paleta de 16 colores mas usada en pixel art: es la
 * de entrada, hasta que se arme otra.
 */
export const DEFAULT_PALETTE: readonly string[] = [
  '#140c1c', '#442434', '#30346d', '#4e4a4e', '#854c30', '#346524', '#d04648', '#757161',
  '#597dce', '#d27d2c', '#8595a1', '#6daa2c', '#d2aa99', '#6dc2ca', '#dad45e', '#deeed6',
];

/** Zoom en enteros, como el del viewport: un zoom fraccionario reparte mal los pixeles. */
const ZOOM_STEPS = [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64];
const HISTORY_LIMIT = 100;
const BRUSH_MAX = 16;
const PALETTE_MAX = 64;
const PALETTE_KEY = 'honeycomb.spritePalette';
/** El mismo minimo que "Segundos por cuadro" en el inspector. */
const FRAME_DURATION_MIN = 0.05;
const FRAME_DURATION_MAX = 2;

/** La paleta guardada en este equipo. Sin almacenamiento (tests, modo privado) queda la de entrada. */
function storedPalette(): string[] {
  try {
    const list: unknown = JSON.parse(globalThis.localStorage?.getItem(PALETTE_KEY) ?? 'null');
    if (Array.isArray(list) && list.length > 0 && list.every((color) => typeof color === 'string' && hexToRgba(color))) {
      return list.slice(0, PALETTE_MAX);
    }
  } catch {
    // Un valor roto vale lo mismo que ninguno.
  }
  return [...DEFAULT_PALETTE];
}

function storePalette(palette: readonly string[]): void {
  try {
    globalThis.localStorage?.setItem(PALETTE_KEY, JSON.stringify(palette));
  } catch {
    // Sin almacenamiento la paleta vale para esta sesion y nada mas.
  }
}

/** "casa.png" -> "casa". El nombre que se muestra al guardar va sin extension: siempre es PNG. */
function withoutPng(name: string): string {
  return name.replace(/\.png$/i, '');
}

function samePixels(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a === b) {
    return true;
  }
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/** Los pixeles RGBA de una imagen ya decodificada. */
function readPixels(image: HTMLImageElement): Uint8ClampedArray {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('el navegador no dio un contexto 2D para leer la imagen');
  }
  ctx.drawImage(image, 0, 0);
  return ctx.getImageData(0, 0, canvas.width, canvas.height).data;
}

/** Los cuadros del sprite uno al lado del otro, como PNG en base64. */
function encodePng(doc: SpriteDoc): string {
  const strip = stripPixels(doc);
  const canvas = document.createElement('canvas');
  canvas.width = strip.width;
  canvas.height = strip.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('el navegador no dio un contexto 2D para armar el PNG');
  }
  const image = ctx.createImageData(strip.width, strip.height);
  image.data.set(strip.pixels);
  ctx.putImageData(image, 0, 0);
  return canvas.toDataURL('image/png').slice('data:image/png;base64,'.length);
}

/** Lo que la herramienta de sprites necesita del editor. */
export interface SpriteEditorDeps {
  note: (message: string) => void;
  describe: (error: unknown) => string;
  /** El dialogo de pedir un nombre (ver ui/name-prompt.controller.ts). */
  ask: (request: NamePromptRequest) => Promise<string | null>;
  /** Relee assets/textures/: la textura guardada tiene que aparecer en Recursos. */
  reloadLibrary: () => Promise<void>;
  /** Descarta miniaturas y sprites en memoria: una textura que ya existia cambio por dentro. */
  invalidateTextures: () => void;
  /** La casilla del nivel abierto: la guia isometrica y los tamaños de arranque salen de ahi. */
  tile: () => { width: number; height: number };
  hasFileSystem: boolean;
}

/** El trazo en curso, entre apretar y soltar el boton. */
interface Stroke {
  tool: SpriteTool;
  color: Rgba;
  layerId: string;
  frameIndex: number;
  /** El cel antes de empezar. La linea y el rectangulo se redibujan desde aca en cada movimiento. */
  original: Uint8ClampedArray;
  /** La copia de trabajo: es lo que se ve mientras se dibuja, y lo que se guarda al soltar. */
  pixels: Uint8ClampedArray;
  start: PixelPoint;
  last: PixelPoint;
}

/**
 * La herramienta de sprites: un editor de pixel art como Aseprite, en el area
 * central del editor (Herramientas > Herramienta de sprites, o Sprites en la
 * barra de herramientas). Se dibuja con capas y cuadros, se retoca una textura
 * del proyecto, y lo que se guarda va como PNG a assets/textures/, listo para
 * usar en Recursos > Texturas.
 *
 * Aca esta el estado y lo que hace cada accion. El documento y el dibujo son
 * logica pura en core/sprite-doc.ts; el lienzo, la barra de cuadros y el panel
 * de color y capas, en sprites/sprite-editor.ts. El estado vive en App y no en
 * ese componente para que pasar al mapa y volver no pierda el sprite.
 */
export class SpriteEditorController {
  private readonly project = inject(ProjectService);

  // --- Documento --------------------------------------------------------------

  readonly doc = signal<SpriteDoc | null>(null);

  /** La textura de assets/textures/ que ya escribio este sprite. Null = nunca se guardo: Guardar pide el nombre. */
  readonly fileName = signal<string | null>(null);

  /** La textura de la que salio, si se abrio una. La original no se pisa sin preguntar. */
  readonly sourceName = signal<string | null>(null);

  readonly dirty = signal(false);

  /** La pantalla de arranque (nuevo o abrir) a la vista, aunque haya un sprite abierto. */
  readonly startOpen = signal(false);

  /** Esperando el disco (abrir o guardar). */
  readonly busy = signal(false);

  readonly activeLayerId = signal('');

  readonly activeFrame = signal(0);

  readonly activeLayer = computed(() => this.doc()?.layers.find((layer) => layer.id === this.activeLayerId()) ?? null);

  // --- Herramienta y color ------------------------------------------------------

  readonly tool = signal<SpriteTool>('pencil');

  readonly primary = signal<Rgba>(hexToRgba(DEFAULT_PALETTE[0])!);

  readonly secondary = signal<Rgba>(hexToRgba(DEFAULT_PALETTE[15])!);

  readonly primaryHex = computed(() => rgbaToHex(this.primary()));

  readonly secondaryHex = computed(() => rgbaToHex(this.secondary()));

  /** Lado del pincel del lapiz, el borrador, la linea y el borde del rectangulo. */
  readonly brushSize = signal(1);

  readonly palette = signal<string[]>(storedPalette());

  // --- Ayudas del lienzo --------------------------------------------------------

  readonly showPixelGrid = signal(true);

  readonly showIsoGuide = signal(true);

  readonly isoAnchor = signal<IsoAnchor>('pies');

  /** El cuadro anterior, transparente, debajo del actual: para animar sin saltos. */
  readonly onionSkin = signal(false);

  // --- Animacion ----------------------------------------------------------------

  readonly playing = signal(false);

  /** Segundos por cuadro en la vista previa: el mismo "frameDuration" que se le pone a la entidad. */
  readonly frameDuration = signal(0.12);

  // --- Vista --------------------------------------------------------------------

  /** Pixeles de pantalla por pixel del sprite. */
  readonly zoom = signal(8);

  readonly zoomLabel = computed(() => this.zoom() * 100 + '%');

  /** Donde cae la esquina de arriba a la izquierda del sprite, en pixeles del lienzo. */
  readonly offset = signal<PixelPoint>({ x: 0, y: 0 });

  /** Lo que mide el lienzo (lo informa el componente). */
  readonly hostSize = signal({ w: 0, h: 0 });

  /** El pixel bajo el cursor, para la barra de estado del lienzo y la vista del pincel. */
  readonly hoverPixel = signal<PixelPoint | null>(null);

  /** Espacio apretado: arrastrar desplaza el lienzo, como en Aseprite. */
  readonly spaceHeld = signal(false);

  /** Tamaños de arranque a partir de la casilla del nivel abierto. */
  readonly presets = computed(() => {
    const tile = this.deps.tile();
    return [
      { label: 'Casilla', width: tile.width, height: tile.height, hint: 'Un tile de piso' },
      { label: 'Bloque', width: tile.width, height: tile.width, hint: 'Un cubo que llena la casilla' },
      { label: 'Personaje', width: Math.round(tile.width / 2), height: Math.round((tile.width * 3) / 4), hint: 'Una figura parada en la casilla' },
    ];
  });

  // --- Trazo e historial --------------------------------------------------------

  private stroke: Stroke | null = null;

  /** Sube con cada pixel del trazo: los pixeles cambian por dentro, y el lienzo tiene que enterarse. */
  private readonly strokeVersion = signal(0);

  /** El gotero arrastrando: sigue tomando color mientras se mueve. */
  private picking: 'primary' | 'secondary' | null = null;

  private past: SpriteDoc[] = [];
  private future: SpriteDoc[] = [];
  private readonly historyVersion = signal(0);

  readonly canUndo = computed(() => this.historyVersion() >= 0 && this.past.length > 0);
  readonly canRedo = computed(() => this.historyVersion() >= 0 && this.future.length > 0);

  /** Encuadrar en cuanto el lienzo tenga tamaño (un sprite recien abierto). */
  private fitPending = false;

  private playTimer: ReturnType<typeof setInterval> | null = null;

  /** El cuadro al frente, con sus capas visibles compuestas y el trazo en curso encima. */
  readonly composite = computed(() => {
    const doc = this.doc();
    this.strokeVersion();
    if (!doc) {
      return null;
    }
    const frame = this.activeFrame();
    const stroke = this.stroke;
    return compositeFrame(
      doc,
      frame,
      stroke && stroke.frameIndex === frame ? { layerId: stroke.layerId, pixels: stroke.pixels } : undefined,
    );
  });

  /** El cuadro anterior para el papel cebolla, o null si no se muestra. */
  readonly onionComposite = computed(() => {
    const doc = this.doc();
    if (!doc || !this.onionSkin() || doc.frames.length < 2 || this.playing()) {
      return null;
    }
    const previous = (this.activeFrame() - 1 + doc.frames.length) % doc.frames.length;
    return compositeFrame(doc, previous);
  });

  /** Nombre que se muestra arriba del lienzo. */
  readonly title = computed(() => this.fileName() ?? (this.sourceName() ? `${this.sourceName()} (copia)` : 'Sprite sin guardar'));

  constructor(private readonly deps: SpriteEditorDeps) {}

  // --- Abrir y crear ------------------------------------------------------------

  private confirmDiscard(): boolean {
    return !this.dirty() || window.confirm('El sprite tiene cambios sin guardar. ¿Descartarlos?');
  }

  /** Muestra la pantalla de nuevo o abrir. El sprite abierto sigue ahi hasta que se cree o abra otro. */
  showStart(): void {
    this.stopPlayback();
    this.startOpen.set(true);
  }

  /** Vuelve al sprite abierto desde la pantalla de arranque. */
  closeStart(): void {
    if (this.doc()) {
      this.startOpen.set(false);
    }
  }

  newSprite(width: number, height: number): void {
    if (!this.confirmDiscard()) {
      return;
    }
    const doc = createDoc(width, height);
    this.load(doc, null);
    this.deps.note(`Sprite nuevo de ${doc.width}×${doc.height}.`);
  }

  /**
   * Abre una textura del proyecto para retocarla. "frames" la parte en cuadros
   * iguales (una tira de animacion); con 1, se usan los que la imagen dice
   * tener si la guardo esta herramienta (ver core/sprite-frames.ts). Se guarda
   * como textura nueva: la original solo se pisa si se elige su mismo nombre y
   * se confirma.
   */
  async openTexture(name: string, frames = 1): Promise<void> {
    if (!this.deps.hasFileSystem) {
      this.deps.note('Abrir texturas necesita el editor de escritorio: en el navegador no hay carpeta del proyecto.');
      return;
    }
    if (!this.confirmDiscard()) {
      return;
    }
    this.busy.set(true);
    try {
      const data = await this.project.readFileData('assets/textures/' + name);
      if (data.kind !== 'image') {
        throw new Error(data.kind === 'binary' && data.reason === 'too-large' ? 'pesa demasiado' : 'no es una imagen');
      }
      const image = await decodeImage(data.dataUrl);
      const strip = frames > 1 ? null : readSpriteFrames(data.dataUrl);
      const doc = docFromImage(readPixels(image), image.naturalWidth, image.naturalHeight, strip?.frames ?? frames);
      this.load(doc, name);
      if (strip) {
        this.frameDuration.set(strip.frameDuration);
      }
      const detail = doc.frames.length > 1 ? `${doc.frames.length} cuadros de ${doc.width}×${doc.height}` : `${doc.width}×${doc.height}`;
      this.deps.note(`Abierta ${name} (${detail}). Al guardar se pide un nombre: la original no se toca.`);
    } catch (error) {
      this.deps.note(`No se pudo abrir ${name}: ${this.deps.describe(error)}`);
    } finally {
      this.busy.set(false);
    }
  }

  private load(doc: SpriteDoc, sourceName: string | null): void {
    this.stopPlayback();
    this.cancelStroke();
    this.doc.set(doc);
    this.activeLayerId.set(doc.layers[doc.layers.length - 1].id);
    this.activeFrame.set(0);
    this.past = [];
    this.future = [];
    this.historyVersion.update((version) => version + 1);
    this.fileName.set(null);
    this.sourceName.set(sourceName);
    this.dirty.set(false);
    this.startOpen.set(false);
    // Un sprite del tamaño exacto de la casilla es un tile de piso, que el
    // motor centra en la celda. Lo demas, como lo apoya el motor al ponerlo de
    // entidad: el borde de abajo en el centro de la casilla, sin bajada.
    const tile = this.deps.tile();
    this.isoAnchor.set(doc.width === tile.width && doc.height === tile.height ? 'centro' : 'pies');
    this.requestFit();
  }

  // --- Guardar ------------------------------------------------------------------

  /** Ctrl+S: al mismo archivo si ya se guardo, o pide el nombre. */
  async save(): Promise<void> {
    const name = this.fileName();
    if (name) {
      await this.write(name, true);
    } else {
      await this.saveAs();
    }
  }

  async saveAs(): Promise<void> {
    const doc = this.doc();
    if (!doc || this.busy()) {
      return;
    }
    if (!this.deps.hasFileSystem) {
      this.deps.note('Guardar sprites necesita el editor de escritorio: en el navegador no hay carpeta del proyecto.');
      return;
    }
    const source = this.sourceName();
    const suggested = this.fileName() ?? (source ? withoutPng(source) + '-editado' : 'sprite');
    const answer = await this.deps.ask({
      title: 'Guardar sprite',
      label: 'Nombre de la textura',
      value: withoutPng(suggested),
      confirmLabel: 'Guardar',
      hint:
        doc.frames.length > 1
          ? `Va a assets/textures/ como PNG, con los ${doc.frames.length} cuadros uno al lado del otro. Las capas ocultas no se guardan.`
          : 'Va a assets/textures/ como PNG. Las capas ocultas no se guardan.',
    });
    if (answer) {
      await this.write(withoutPng(answer) + '.png', false);
    }
  }

  private async write(name: string, overwrite: boolean): Promise<void> {
    const doc = this.doc();
    if (!doc || this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      // Los cuadros van dentro del PNG: al elegirlo para un personaje o una
      // entidad, el editor los pone solo (ver core/sprite-frames.ts).
      const png = withSpriteFrames(encodePng(doc), { frames: doc.frames.length, frameDuration: this.frameDuration() });
      let result = await this.project.writeTexture(name, png, overwrite);
      let replaced = overwrite;
      if (result.status === 'exists') {
        const confirmed = window.confirm(
          `Ya existe ${result.target} en assets/textures/. ¿Reemplazarla? Las entidades que la usan van a cambiar con ella.`,
        );
        if (!confirmed) {
          this.deps.note('No se guardó el sprite: elige otro nombre con Guardar como.');
          return;
        }
        result = await this.project.writeTexture(result.target, png, true);
        replaced = true;
      }
      this.fileName.set(result.target);
      this.dirty.set(false);
      // Una textura que ya existia cambio por dentro: las miniaturas y los
      // sprites del viewport que la tenian en memoria quedaron viejos.
      if (replaced) {
        this.deps.invalidateTextures();
      }
      await this.deps.reloadLibrary();
      this.deps.note(
        doc.frames.length > 1
          ? `Guardado assets/textures/${result.target}: ${doc.frames.length} cuadros de ${doc.width}×${doc.height}. ` +
              `Al elegirlo para un personaje o una entidad se anima solo, a ${this.frameDuration()} s por cuadro.`
          : `Guardado assets/textures/${result.target} (${doc.width}×${doc.height}).`,
      );
    } catch (error) {
      this.deps.note('No se pudo guardar el sprite: ' + this.deps.describe(error));
    } finally {
      this.busy.set(false);
    }
  }

  // --- Historial ----------------------------------------------------------------

  /** Cambia el documento y guarda el anterior para deshacer. */
  private commit(next: SpriteDoc): void {
    const current = this.doc();
    if (!current || next === current) {
      return;
    }
    this.past.push(current);
    if (this.past.length > HISTORY_LIMIT) {
      this.past.shift();
    }
    this.future = [];
    this.doc.set(next);
    this.dirty.set(true);
    this.historyVersion.update((version) => version + 1);
    this.clampSelection();
  }

  undo(): void {
    this.cancelStroke();
    const previous = this.past.pop();
    const current = this.doc();
    if (!previous || !current) {
      return;
    }
    this.future.push(current);
    this.restore(previous);
  }

  redo(): void {
    this.cancelStroke();
    const next = this.future.pop();
    const current = this.doc();
    if (!next || !current) {
      return;
    }
    this.past.push(current);
    this.restore(next);
  }

  private restore(doc: SpriteDoc): void {
    const resized = doc.width !== this.doc()?.width || doc.height !== this.doc()?.height;
    this.doc.set(doc);
    this.dirty.set(true);
    this.historyVersion.update((version) => version + 1);
    this.clampSelection();
    if (resized) {
      this.requestFit();
    }
  }

  /** Despues de deshacer o sacar algo, la capa y el cuadro elegidos tienen que seguir existiendo. */
  private clampSelection(): void {
    const doc = this.doc();
    if (!doc) {
      return;
    }
    if (!doc.layers.some((layer) => layer.id === this.activeLayerId())) {
      this.activeLayerId.set(doc.layers[doc.layers.length - 1].id);
    }
    if (this.activeFrame() >= doc.frames.length) {
      this.activeFrame.set(doc.frames.length - 1);
    }
  }

  // --- Dibujo -------------------------------------------------------------------

  /** Apretar sobre el lienzo, en pixeles del sprite. El boton elige el color: principal o secundario. */
  pointerDown(point: PixelPoint, button: 'primary' | 'secondary', mods: { shift: boolean; alt: boolean }): void {
    const doc = this.doc();
    if (!doc) {
      return;
    }
    this.stopPlayback();
    const tool = mods.alt ? 'picker' : this.tool();
    if (tool === 'picker') {
      this.picking = button;
      this.pick(point, button);
      return;
    }
    const layer = this.activeLayer();
    if (!layer) {
      return;
    }
    if (!layer.visible) {
      this.deps.note(`La capa «${layer.name}» está oculta: muéstrala para pintar en ella.`);
      return;
    }
    const color = tool === 'eraser' ? TRANSPARENT : button === 'primary' ? this.primary() : this.secondary();
    const frameIndex = this.activeFrame();
    const original = celOf(doc, doc.frames[frameIndex], layer.id);

    if (tool === 'bucket') {
      const pixels = original.slice();
      if (floodFill(pixels, doc.width, doc.height, point.x, point.y, color)) {
        this.commit(setCel(doc, frameIndex, layer.id, pixels));
      }
      return;
    }

    this.stroke = { tool, color, layerId: layer.id, frameIndex, original, pixels: original.slice(), start: point, last: point };
    this.paintStroke(point, mods.shift);
  }

  pointerMove(point: PixelPoint, mods: { shift: boolean }): void {
    if (this.picking) {
      this.pick(point, this.picking);
      return;
    }
    if (this.stroke) {
      this.paintStroke(point, mods.shift);
    }
  }

  /** Soltar: el trazo pasa al documento (y al historial) si cambio algo. */
  pointerUp(): void {
    this.picking = null;
    const stroke = this.stroke;
    if (!stroke) {
      return;
    }
    this.stroke = null;
    const doc = this.doc();
    if (doc && !samePixels(stroke.original, stroke.pixels)) {
      this.commit(setCel(doc, stroke.frameIndex, stroke.layerId, stroke.pixels));
    }
    this.strokeVersion.update((version) => version + 1);
  }

  /** Abandona el trazo sin guardarlo (Escape, o deshacer en medio de uno). */
  cancelStroke(): void {
    this.picking = null;
    if (this.stroke) {
      this.stroke = null;
      this.strokeVersion.update((version) => version + 1);
    }
  }

  private paintStroke(point: PixelPoint, shift: boolean): void {
    const stroke = this.stroke;
    const doc = this.doc();
    if (!stroke || !doc) {
      return;
    }
    const { width, height } = doc;
    const size = this.brushSize();
    const stamp = (p: PixelPoint) => stampBrush(stroke.pixels, width, height, p.x, p.y, size, stroke.color);
    switch (stroke.tool) {
      case 'pencil':
      case 'eraser':
        // De a una linea desde el punto anterior: un movimiento rapido del
        // mouse salta pixeles, y el trazo no puede quedar punteado.
        linePoints(stroke.last.x, stroke.last.y, point.x, point.y).forEach(stamp);
        break;
      case 'line': {
        stroke.pixels.set(stroke.original);
        const end = shift ? snapLineEnd(stroke.start, point) : point;
        linePoints(stroke.start.x, stroke.start.y, end.x, end.y).forEach(stamp);
        break;
      }
      case 'rect':
        stroke.pixels.set(stroke.original);
        if (shift) {
          for (const p of rectPoints(stroke.start.x, stroke.start.y, point.x, point.y, true)) {
            paintPixel(stroke.pixels, width, height, p.x, p.y, stroke.color);
          }
        } else {
          rectPoints(stroke.start.x, stroke.start.y, point.x, point.y, false).forEach(stamp);
        }
        break;
    }
    stroke.last = point;
    this.strokeVersion.update((version) => version + 1);
  }

  /** Gotero: el color que se ve en ese pixel (todas las capas visibles), opaco. */
  private pick(point: PixelPoint, button: 'primary' | 'secondary'): void {
    const doc = this.doc();
    const composite = this.composite();
    if (!doc || !composite || point.x < 0 || point.y < 0 || point.x >= doc.width || point.y >= doc.height) {
      return;
    }
    const color = pixelAt(composite, doc.width, point.x, point.y);
    if (color.a === 0) {
      return;
    }
    (button === 'primary' ? this.primary : this.secondary).set({ ...color, a: 255 });
  }

  setTool(tool: SpriteTool): void {
    this.tool.set(tool);
  }

  setBrushSize(size: number): void {
    this.brushSize.set(Math.min(BRUSH_MAX, Math.max(1, Math.round(size) || 1)));
  }

  stepBrush(delta: number): void {
    this.setBrushSize(this.brushSize() + delta);
  }

  // --- Color --------------------------------------------------------------------

  setColor(which: 'primary' | 'secondary', hex: string): void {
    const color = hexToRgba(hex);
    if (color) {
      (which === 'primary' ? this.primary : this.secondary).set(color);
    }
  }

  swapColors(): void {
    const primary = this.primary();
    this.primary.set(this.secondary());
    this.secondary.set(primary);
  }

  private setPalette(palette: string[]): void {
    this.palette.set(palette);
    storePalette(palette);
  }

  /** Suma el color principal a la paleta, si no estaba. */
  addToPalette(): void {
    const hex = this.primaryHex();
    if (this.palette().includes(hex)) {
      return;
    }
    if (this.palette().length >= PALETTE_MAX) {
      this.deps.note(`La paleta ya tiene ${PALETTE_MAX} colores: quita alguno antes de sumar otro.`);
      return;
    }
    this.setPalette([...this.palette(), hex]);
  }

  removeFromPalette(hex: string): void {
    this.setPalette(this.palette().filter((color) => color !== hex));
  }

  resetPalette(): void {
    this.setPalette([...DEFAULT_PALETTE]);
  }

  /** La paleta pasa a ser los colores del sprite: lo util al retocar una textura que ya tiene los suyos. */
  paletteFromSprite(): void {
    const doc = this.doc();
    const colors = doc ? uniqueColors(doc, PALETTE_MAX) : [];
    if (colors.length === 0) {
      this.deps.note('El sprite todavía no tiene colores para armar la paleta.');
      return;
    }
    this.setPalette(colors);
    this.deps.note(`Paleta con los ${colors.length} colores del sprite.`);
  }

  // --- Capas --------------------------------------------------------------------

  selectLayer(layerId: string): void {
    this.cancelStroke();
    this.activeLayerId.set(layerId);
  }

  addLayer(): void {
    const doc = this.doc();
    if (!doc) {
      return;
    }
    if (doc.layers.length >= SPRITE_LAYERS_MAX) {
      this.deps.note(`Un sprite tiene como mucho ${SPRITE_LAYERS_MAX} capas.`);
      return;
    }
    const { doc: next, layerId } = addLayer(doc, this.activeLayerId());
    this.commit(next);
    this.activeLayerId.set(layerId);
  }

  duplicateLayer(): void {
    const doc = this.doc();
    if (!doc) {
      return;
    }
    if (doc.layers.length >= SPRITE_LAYERS_MAX) {
      this.deps.note(`Un sprite tiene como mucho ${SPRITE_LAYERS_MAX} capas.`);
      return;
    }
    const { doc: next, layerId } = duplicateLayer(doc, this.activeLayerId());
    this.commit(next);
    this.activeLayerId.set(layerId);
  }

  removeLayer(): void {
    const doc = this.doc();
    if (!doc) {
      return;
    }
    if (doc.layers.length <= 1) {
      this.deps.note('Es la única capa: un sprite necesita al menos una.');
      return;
    }
    // Queda elegida la de abajo (o la nueva de abajo de todo).
    const index = doc.layers.findIndex((layer) => layer.id === this.activeLayerId());
    const below = doc.layers[Math.max(0, index - 1)].id;
    this.commit(removeLayer(doc, this.activeLayerId()));
    this.activeLayerId.set(below === this.activeLayerId() ? this.doc()!.layers[0].id : below);
  }

  moveLayer(delta: number): void {
    const doc = this.doc();
    if (doc) {
      this.commit(moveLayer(doc, this.activeLayerId(), delta));
    }
  }

  toggleLayerVisible(layerId: string): void {
    const doc = this.doc();
    const layer = doc?.layers.find((candidate) => candidate.id === layerId);
    if (doc && layer) {
      this.commit(patchLayer(doc, layerId, { visible: !layer.visible }));
    }
  }

  async renameLayer(layerId: string): Promise<void> {
    const layer = this.doc()?.layers.find((candidate) => candidate.id === layerId);
    if (!layer) {
      return;
    }
    const name = await this.deps.ask({ title: 'Renombrar capa', label: 'Nombre', value: layer.name, confirmLabel: 'Renombrar' });
    const doc = this.doc();
    if (name && doc && name !== layer.name) {
      this.commit(patchLayer(doc, layerId, { name }));
    }
  }

  /** Espeja la capa elegida en el cuadro al frente. Sirve para sacar la vista opuesta de una pieza isometrica. */
  flip(axis: 'horizontal' | 'vertical'): void {
    const doc = this.doc();
    if (!doc) {
      return;
    }
    const frame = this.activeFrame();
    const cel = celOf(doc, doc.frames[frame], this.activeLayerId());
    this.commit(setCel(doc, frame, this.activeLayerId(), flipPixels(cel, doc.width, doc.height, axis)));
  }

  /** Supr: vacia la capa elegida en el cuadro al frente. */
  clearCel(): void {
    const doc = this.doc();
    if (!doc) {
      return;
    }
    const frame = this.activeFrame();
    const cel = celOf(doc, doc.frames[frame], this.activeLayerId());
    if (cel.some((byte) => byte !== 0)) {
      this.commit(setCel(doc, frame, this.activeLayerId(), blankPixels(doc.width, doc.height)));
    }
  }

  // --- Cuadros ------------------------------------------------------------------

  selectFrame(index: number): void {
    const doc = this.doc();
    if (!doc) {
      return;
    }
    this.stopPlayback();
    this.cancelStroke();
    this.activeFrame.set(Math.min(doc.frames.length - 1, Math.max(0, index)));
  }

  /** El cuadro anterior o el siguiente, dando la vuelta. */
  stepFrame(delta: number): void {
    const doc = this.doc();
    if (!doc) {
      return;
    }
    this.cancelStroke();
    this.activeFrame.set((this.activeFrame() + delta + doc.frames.length) % doc.frames.length);
  }

  addFrame(copy: boolean): void {
    const doc = this.doc();
    if (!doc) {
      return;
    }
    if (doc.frames.length >= SPRITE_FRAMES_MAX) {
      this.deps.note(`Un sprite tiene como mucho ${SPRITE_FRAMES_MAX} cuadros.`);
      return;
    }
    this.stopPlayback();
    const { doc: next, index } = addFrame(doc, this.activeFrame(), copy);
    this.commit(next);
    this.activeFrame.set(index);
  }

  removeFrame(): void {
    const doc = this.doc();
    if (!doc) {
      return;
    }
    if (doc.frames.length <= 1) {
      this.deps.note('Es el único cuadro: un sprite necesita al menos uno.');
      return;
    }
    this.stopPlayback();
    this.commit(removeFrame(doc, this.activeFrame()));
  }

  moveFrame(delta: number): void {
    const doc = this.doc();
    const index = this.activeFrame();
    if (!doc) {
      return;
    }
    const next = moveFrame(doc, index, delta);
    if (next !== doc) {
      this.commit(next);
      this.activeFrame.set(index + delta);
    }
  }

  /** Una imagen abierta que en realidad era una tira: la parte en cuadros iguales. */
  async splitFrames(): Promise<void> {
    const doc = this.doc();
    if (!doc || doc.frames.length !== 1) {
      return;
    }
    const answer = await this.deps.ask({
      title: 'Separar en cuadros',
      label: 'Cuantos cuadros',
      value: '2',
      confirmLabel: 'Separar',
      hint: `La imagen se parte a lo ancho en partes iguales: ${doc.width} px tiene que dividirse justo.`,
    });
    const current = this.doc();
    if (!answer || !current) {
      return;
    }
    const split = splitIntoFrames(current, Number(answer));
    if (!split) {
      this.deps.note(`${current.width} px de ancho no se dividen en ${answer} cuadros iguales.`);
      return;
    }
    this.commit(split);
    this.activeFrame.set(0);
    this.requestFit();
  }

  togglePlay(): void {
    if (this.playing()) {
      this.stopPlayback();
      return;
    }
    const doc = this.doc();
    if (!doc || doc.frames.length < 2) {
      this.deps.note('Para ver la animación hacen falta al menos dos cuadros.');
      return;
    }
    this.cancelStroke();
    this.playing.set(true);
    this.restartTimer();
  }

  stopPlayback(): void {
    if (this.playTimer !== null) {
      clearInterval(this.playTimer);
      this.playTimer = null;
    }
    this.playing.set(false);
  }

  setFrameDuration(seconds: number): void {
    const value = Math.min(FRAME_DURATION_MAX, Math.max(FRAME_DURATION_MIN, seconds || FRAME_DURATION_MIN));
    this.frameDuration.set(Math.round(value * 1000) / 1000);
    if (this.playing()) {
      this.restartTimer();
    }
  }

  private restartTimer(): void {
    if (this.playTimer !== null) {
      clearInterval(this.playTimer);
    }
    this.playTimer = setInterval(() => this.stepFrame(1), this.frameDuration() * 1000);
  }

  // --- Vista --------------------------------------------------------------------

  setHostSize(width: number, height: number): void {
    this.hostSize.set({ w: width, h: height });
    if (this.fitPending) {
      this.fit();
    }
  }

  private requestFit(): void {
    this.fitPending = true;
    this.fit();
  }

  /** Inicio: el sprite entero y centrado, al zoom entero mas grande que entra. */
  fit(): void {
    const doc = this.doc();
    const { w, h } = this.hostSize();
    if (!doc || w === 0 || h === 0) {
      return;
    }
    this.fitPending = false;
    const fitting = Math.min((w * 0.8) / doc.width, (h * 0.8) / doc.height);
    const zoom = [...ZOOM_STEPS].reverse().find((step) => step <= fitting) ?? ZOOM_STEPS[0];
    this.zoom.set(zoom);
    this.offset.set({ x: Math.round((w - doc.width * zoom) / 2), y: Math.round((h - doc.height * zoom) / 2) });
  }

  /**
   * Un paso de zoom, dejando quieto el punto del lienzo que esta bajo "anchor"
   * (el cursor con la rueda; el centro con los botones).
   */
  zoomAt(direction: number, anchor?: PixelPoint): void {
    const current = this.zoom();
    const next =
      direction > 0
        ? ZOOM_STEPS.find((step) => step > current) ?? current
        : [...ZOOM_STEPS].reverse().find((step) => step < current) ?? current;
    if (next === current) {
      return;
    }
    const { w, h } = this.hostSize();
    const point = anchor ?? { x: w / 2, y: h / 2 };
    const offset = this.offset();
    this.offset.set({
      x: Math.round(point.x - ((point.x - offset.x) * next) / current),
      y: Math.round(point.y - ((point.y - offset.y) * next) / current),
    });
    this.zoom.set(next);
  }

  panBy(dx: number, dy: number): void {
    this.offset.update((offset) => ({ x: offset.x + dx, y: offset.y + dy }));
  }

  // --- Teclado ------------------------------------------------------------------

  /**
   * Los atajos de la herramienta. App se los pasa cuando el area central
   * muestra los sprites; devuelve true si la tecla era de aca.
   */
  onKeyDown(event: KeyboardEvent): boolean {
    const key = event.key.toLowerCase();
    if (event.ctrlKey || event.metaKey) {
      if (key === 's') {
        void (event.shiftKey ? this.saveAs() : this.save());
        return true;
      }
      if (key === 'z') {
        if (event.shiftKey) {
          this.redo();
        } else {
          this.undo();
        }
        return true;
      }
      if (key === 'y') {
        this.redo();
        return true;
      }
      return false;
    }
    // Alt + clic es el gotero: la tecla sola no hace nada.
    if (event.altKey) {
      return false;
    }
    if (key === ' ') {
      this.spaceHeld.set(true);
      return true;
    }
    const tool = SPRITE_TOOLS.find((candidate) => candidate.key.toLowerCase() === key);
    if (tool) {
      this.setTool(tool.id);
      return true;
    }
    switch (event.key) {
      case 'x':
      case 'X':
        this.swapColors();
        return true;
      case '[':
        this.stepBrush(-1);
        return true;
      case ']':
        this.stepBrush(1);
        return true;
      case '+':
      case '=':
        this.zoomAt(1);
        return true;
      case '-':
        this.zoomAt(-1);
        return true;
      case 'Home':
        this.fit();
        return true;
      case ',':
        this.stepFrame(-1);
        return true;
      case '.':
        this.stepFrame(1);
        return true;
      case 'Enter':
        this.togglePlay();
        return true;
      case 'Delete':
        this.clearCel();
        return true;
      case 'Escape':
        if (this.stroke || this.picking) {
          this.cancelStroke();
        } else {
          this.closeStart();
        }
        return true;
    }
    return false;
  }

  onKeyUp(event: KeyboardEvent): void {
    if (event.key === ' ') {
      this.spaceHeld.set(false);
    }
  }
}
