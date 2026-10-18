import { GridConfig, Level, LevelEntity } from '../models/level.model';
import { elbowRoute, routeFloor } from './dungeon-layout';
import { CanvasScene, IsoCanvasRenderer, VIEW_TOP_MARGIN } from './iso-canvas-renderer';
import { IsoProjection } from './iso-projection';
import { SHAPE_TEXTURE } from './iso-shapes';
import { CANVAS_PALETTES } from './themes';

const PALETTE = CANVAS_PALETTES.honeycomb;
const GRID: GridConfig = { width: 10, height: 8, tileWidth: 64, tileHeight: 32 };

/** Una llamada al contexto 2D, con el estado que tenia en ese momento. */
interface Call {
  op: string;
  args: unknown[];
  fillStyle: unknown;
  strokeStyle: unknown;
  globalAlpha: unknown;
  lineWidth: unknown;
}

/**
 * Contexto 2D de mentira: anota cada metodo que se llama y cada propiedad que
 * se asigna, en orden. jsdom no trae canvas, y asi se puede mirar QUE se dibuja.
 */
function recordingContext() {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    lineWidth: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    imageSmoothingEnabled: true,
  };
  const record = (op: string, args: unknown[]) =>
    calls.push({
      op,
      args,
      fillStyle: state['fillStyle'],
      strokeStyle: state['strokeStyle'],
      globalAlpha: state['globalAlpha'],
      lineWidth: state['lineWidth'],
    });
  const ctx = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== 'string') {
          return undefined;
        }
        if (prop in state) {
          return state[prop];
        }
        if (prop === 'measureText') {
          return (text: string) => ({ width: text.length * 6 });
        }
        return (...args: unknown[]) => record(prop, args);
      },
      set(_target, prop, value) {
        state[String(prop)] = value;
        record('set:' + String(prop), [value]);
        return true;
      },
    },
  );
  return { ctx, calls };
}

function fakeCanvas(ctx: unknown) {
  return { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
}

/** Imagen ya cargada, con nombre para reconocerla en las llamadas. */
function fakeImage(name: string, width = 32, height = 48): HTMLImageElement {
  return { name, naturalWidth: width, naturalHeight: height } as unknown as HTMLImageElement;
}

function entity(id: string, col: number, row: number, changes: Partial<LevelEntity> = {}): LevelEntity {
  return {
    id,
    type: 'player',
    position: { col, row },
    texture: 'textures/' + id + '.png',
    sourceRect: { x: 0, y: 0, width: 32, height: 48 },
    ...changes,
  };
}

function level(changes: Partial<Level> = {}): Level {
  return { name: 'prueba', grid: { ...GRID }, entities: [], events: [], ...changes };
}

function scene(changes: Partial<CanvasScene> & { lvl?: Level } = {}): CanvasScene {
  const { lvl, ...rest } = changes;
  const current = lvl ?? level();
  return {
    size: () => ({ w: 800, h: 600 }),
    pan: () => ({ x: 0, y: 0 }),
    zoom: () => 1,
    level: () => current,
    selectedId: () => null,
    selectedIds: () => new Set<string>(),
    hovered: () => null,
    showGrid: () => true,
    gridOnTop: () => false,
    showColliders: () => false,
    roomDraft: () => null,
    roomDrag: () => null,
    tunnelTrace: () => null,
    shapeSheet: () => null,
    palette: () => PALETTE,
    marquee: () => null,
    sprite: () => null,
    hoveredEntityId: () => null,
    ...rest,
  };
}

/** Un sprite por textura: cada entidad se reconoce por el nombre de su imagen. */
const spriteByTexture = (texture: string) => fakeImage(texture);

function draw(sc: CanvasScene) {
  const { ctx, calls } = recordingContext();
  const canvas = fakeCanvas(ctx);
  new IsoCanvasRenderer().draw(canvas, sc);
  return { calls, canvas };
}

const named = (call: Call) => (call.args[0] as { name?: string } | undefined)?.name;
const drawnImages = (calls: Call[]) => calls.filter((call) => call.op === 'drawImage').map(named);
const ofOp = (calls: Call[], op: string) => calls.filter((call) => call.op === op);

/** El punto del canvas donde cae una celda, con la misma cuenta que el motor. */
function canvasPoint(sc: CanvasScene, col: number, row: number) {
  const renderer = new IsoCanvasRenderer();
  const origin = renderer.origin(sc.size(), sc.pan());
  const grid = sc.level().grid;
  const point = new IsoProjection(grid.tileWidth, grid.tileHeight).gridToScreen({ col, row });
  return { x: origin.x + point.x * sc.zoom(), y: origin.y + point.y * sc.zoom() };
}

const click = (x: number, y: number) => ({ clientX: x, clientY: y }) as MouseEvent;
const RECT = { left: 0, top: 0 } as DOMRect;

describe('encuadre y caja del sprite', () => {
  const renderer = new IsoCanvasRenderer();

  it('la celda 0,0 cae al centro horizontal y bajo el margen de arriba, mas el pan', () => {
    expect(renderer.origin({ w: 800, h: 600 }, { x: 0, y: 0 })).toEqual({ x: 400, y: VIEW_TOP_MARGIN });
    expect(renderer.origin({ w: 800, h: 600 }, { x: 10, y: -5 })).toEqual({ x: 410, y: VIEW_TOP_MARGIN - 5 });
  });

  it('el sprite se centra en x y apoya su borde de abajo en el punto de la celda', () => {
    expect(renderer.spriteBox(entity('a', 0, 0), { x: 100, y: 200 }, 1)).toEqual({ x: 84, y: 152, w: 32, h: 48 });
  });

  it('span, escala, zoom y groundOffset se multiplican como en el motor', () => {
    const big = entity('a', 0, 0, { span: 2, scale: 1.5, groundOffset: 8 });
    // 2 de span x 1.5 de escala x 2 de zoom = 6 veces el recorte.
    expect(renderer.spriteBox(big, { x: 100, y: 200 }, 2)).toEqual({ x: 4, y: -40, w: 192, h: 288 });
  });

  it('un span invalido no achica el sprite', () => {
    expect(renderer.spriteBox(entity('a', 0, 0, { span: 0 }), { x: 0, y: 0 }, 1).w).toBe(32);
  });

  it('el color de cada tipo sale de su personaje o de su arquetipo, y lo desconocido cae al gris', () => {
    expect(renderer.entityColor('player')).toBe('#3fb8a9');
    expect(renderer.entityColor('enemy')).toBe('#e0605a');
    expect(renderer.entityColor('cube')).toBe('#b3a998');
    expect(renderer.entityColor('cosa_inventada')).toBe('#8f8a80');
  });
});

describe('de un clic a una celda', () => {
  const renderer = new IsoCanvasRenderer();

  it('clickear el centro de una casilla devuelve esa casilla, con zoom y pan', () => {
    const sc = scene({ zoom: () => 2, pan: () => ({ x: 30, y: -20 }) });
    for (const [col, row] of [[0, 0], [3, 2], [9, 7], [5, 0], [0, 7]]) {
      const point = canvasPoint(sc, col, row);
      expect(renderer.coordAt(click(point.x, point.y), RECT, sc)).toEqual({ col, row });
    }
  });

  it('un punto cerca del borde del rombo sigue siendo de la misma casilla', () => {
    const sc = scene({ zoom: () => 1.5 });
    const center = canvasPoint(sc, 4, 4);
    const halfW = (GRID.tileWidth / 2) * 1.5;
    const halfH = (GRID.tileHeight / 2) * 1.5;
    for (const [dx, dy] of [[0.8 * halfW, 0], [-0.8 * halfW, 0], [0, 0.8 * halfH], [0, -0.8 * halfH]]) {
      expect(renderer.coordAt(click(center.x + dx, center.y + dy), RECT, sc)).toEqual({ col: 4, row: 4 });
    }
  });

  it('descuenta la posicion del canvas en la ventana', () => {
    const sc = scene();
    const point = canvasPoint(sc, 2, 3);
    const rect = { left: 120, top: 45 } as DOMRect;
    expect(renderer.coordAt(click(point.x + 120, point.y + 45), rect, sc)).toEqual({ col: 2, row: 3 });
  });

  it('fuera de la grilla devuelve una celda fuera de rango, sin recortarla', () => {
    const sc = scene();
    const point = canvasPoint(sc, -2, 0);
    expect(renderer.coordAt(click(point.x, point.y), RECT, sc)).toEqual({ col: -2, row: 0 });
  });
});

describe('de un clic a una entidad', () => {
  const renderer = new IsoCanvasRenderer();
  // "b" esta delante de "a" y su sprite tapa la parte de abajo del de "a".
  const lvl = level({ entities: [entity('b', 3, 3), entity('a', 2, 2)] });

  it('en un solapamiento gana el sprite que se ve encima', () => {
    const sc = scene({ lvl });
    const anchorB = canvasPoint(sc, 3, 3);
    expect(renderer.entityAt(click(anchorB.x, anchorB.y - 40), RECT, sc)).toBe('b');
  });

  it('la parte que sobresale arriba sigue siendo de la de atras', () => {
    const sc = scene({ lvl });
    const anchorA = canvasPoint(sc, 2, 2);
    expect(renderer.entityAt(click(anchorA.x, anchorA.y - 40), RECT, sc)).toBe('a');
  });

  it('un clic en el vacio no elige nada', () => {
    const sc = scene({ lvl });
    expect(renderer.entityAt(click(5, 5), RECT, sc)).toBeNull();
    expect(renderer.entityAt(click(400, 100), RECT, scene())).toBeNull();
  });

  it('respeta el zoom: la caja crece con el', () => {
    const sc = scene({ lvl: level({ entities: [entity('a', 2, 2)] }), zoom: () => 3 });
    const anchor = canvasPoint(sc, 2, 2);
    // A zoom 3 el sprite mide 96x144: 140 px arriba del ancla sigue adentro.
    expect(renderer.entityAt(click(anchor.x, anchor.y - 140), RECT, sc)).toBe('a');
    expect(renderer.entityAt(click(anchor.x, anchor.y - 150), RECT, sc)).toBeNull();
  });
});

describe('seleccionar area', () => {
  const renderer = new IsoCanvasRenderer();
  const lvl = level({ entities: [entity('a', 0, 0), entity('b', 6, 6)] });

  it('alcanza con tocar el sprite para elegirlo', () => {
    const sc = scene({ lvl });
    const a = canvasPoint(sc, 0, 0);
    // Un rectangulo que solo roza la esquina de abajo a la derecha del sprite.
    expect(renderer.entitiesInRect({ x0: a.x + 15, y0: a.y - 1, x1: a.x + 40, y1: a.y + 30 }, sc)).toEqual(['a']);
  });

  it('da lo mismo desde que esquina se arrastre', () => {
    const sc = scene({ lvl });
    const all = { x0: 0, y0: 0, x1: 800, y1: 600 };
    expect(renderer.entitiesInRect(all, sc)).toEqual(['a', 'b']);
    expect(renderer.entitiesInRect({ x0: 800, y0: 600, x1: 0, y1: 0 }, sc)).toEqual(['a', 'b']);
  });

  it('un area vacia no elige nada', () => {
    expect(renderer.entitiesInRect({ x0: 0, y0: 500, x1: 20, y1: 600 }, scene({ lvl }))).toEqual([]);
  });
});

describe('dibujo del viewport', () => {
  it('con el canvas en 0 no dibuja nada', () => {
    const getContext = vi.fn();
    const canvas = { width: 7, height: 7, getContext } as unknown as HTMLCanvasElement;
    new IsoCanvasRenderer().draw(canvas, scene({ size: () => ({ w: 0, h: 300 }) }));
    expect(getContext).not.toHaveBeenCalled();
    expect(canvas.width).toBe(7);
  });

  it('sin contexto 2D ajusta el tamano y no rompe', () => {
    const canvas = fakeCanvas(null);
    expect(() => new IsoCanvasRenderer().draw(canvas, scene())).not.toThrow();
    expect(canvas.width).toBe(800);
    expect(canvas.height).toBe(600);
  });

  it('lo primero es apagar el suavizado y pintar el fondo del tema', () => {
    const { calls } = draw(scene());
    expect(calls[0]).toMatchObject({ op: 'set:imageSmoothingEnabled', args: [false] });
    const firstFill = ofOp(calls, 'fillRect')[0];
    expect(firstFill.args).toEqual([0, 0, 800, 600]);
    expect(firstFill.fillStyle).toBe(PALETTE.background);
  });

  it('las entidades se dibujan de atras hacia adelante por la profundidad del bloque', () => {
    const lvl = level({
      entities: [entity('lejos', 5, 5), entity('cerca', 0, 0), entity('medio', 2, 3)],
    });
    const { calls } = draw(scene({ lvl, sprite: spriteByTexture }));
    expect(drawnImages(calls)).toEqual(['textures/cerca.png', 'textures/medio.png', 'textures/lejos.png']);
  });

  it('una figura grande se ordena por el centro de su bloque, no por su esquina', () => {
    // El bloque de 3 en 0,0 tiene el centro en 1,1: va despues de la de 1,0.
    const lvl = level({ entities: [entity('grande', 0, 0, { span: 3 }), entity('chica', 1, 0)] });
    const { calls } = draw(scene({ lvl, sprite: spriteByTexture }));
    expect(drawnImages(calls)).toEqual(['textures/chica.png', 'textures/grande.png']);
  });

  it('el sprite cae en el mismo lugar que calcula el motor', () => {
    const lvl = level({ entities: [entity('a', 2, 1)] });
    const { calls } = draw(scene({ lvl, zoom: () => 2, sprite: spriteByTexture }));
    const call = ofOp(calls, 'drawImage')[0];
    // Celda 2,1 -> (32, 48) iso; a zoom 2 y con el origen en (400, 60): ancla en (464, 156).
    expect(call.args.slice(1)).toEqual([0, 0, 32, 48, 432, 60, 64, 96]);
  });

  it('las figuras usan el sheet de figuras y no piden la textura al proyecto', () => {
    const sprite = vi.fn(() => null);
    const sheet = fakeImage('sheet', 512, 512);
    const lvl = level({ entities: [entity('cubo', 1, 1, { type: 'cube', texture: SHAPE_TEXTURE })] });
    const { calls } = draw(scene({ lvl, sprite, shapeSheet: () => sheet }));
    expect(drawnImages(calls)).toEqual(['sheet']);
    expect(sprite).not.toHaveBeenCalledWith(SHAPE_TEXTURE);
  });

  it('sin sprite queda un marcador punteado en el color del tipo', () => {
    const lvl = level({ entities: [entity('malo', 1, 1, { type: 'enemy' })] });
    const { calls } = draw(scene({ lvl }));
    expect(drawnImages(calls)).toEqual([]);
    const marker = ofOp(calls, 'strokeRect').find((call) => call.strokeStyle === '#e0605a');
    expect(marker).toBeDefined();
    const dashBefore = calls.slice(0, calls.indexOf(marker!)).filter((call) => call.op === 'setLineDash').at(-1);
    expect(dashBefore?.args).toEqual([[3, 3]]);
  });

  it('una entidad oculta al empezar se dibuja a medias y con contorno punteado', () => {
    const lvl = level({ entities: [entity('puerta', 1, 1, { hidden: true }), entity('visible', 4, 4)] });
    const { calls } = draw(scene({ lvl, sprite: spriteByTexture }));
    const [door, other] = ofOp(calls, 'drawImage');
    expect(named(door)).toBe('textures/puerta.png');
    expect(door.globalAlpha).toBe(0.4);
    expect(other.globalAlpha).toBe(1);
    expect(ofOp(calls, 'strokeRect').filter((call) => call.strokeStyle === PALETTE.hiddenOutline)).toHaveLength(1);
  });

  it('la activa lleva el acento pleno y el resto de la seleccion el apagado', () => {
    const lvl = level({ entities: [entity('a', 1, 1), entity('b', 4, 4), entity('c', 6, 6)] });
    const sc = scene({ lvl, selectedIds: () => new Set(['a', 'b']), selectedId: () => 'b' });
    const { calls } = draw(sc);
    const outlines = ofOp(calls, 'strokeRect').filter(
      (call) => call.strokeStyle === PALETTE.active || call.strokeStyle === PALETTE.selected,
    );
    const renderer = new IsoCanvasRenderer();
    const boxOf = (id: string, col: number, row: number) => {
      const box = renderer.spriteBox(entity(id, col, row), canvasPoint(sc, col, row), 1);
      return [box.x - 2, box.y - 2, box.w + 4, box.h + 4];
    };
    expect(outlines.map((call) => [call.strokeStyle, call.args])).toEqual([
      [PALETTE.selected, boxOf('a', 1, 1)],
      [PALETTE.active, boxOf('b', 4, 4)],
    ]);
    // El ancla: miel en la activa, el gris del ancla en la otra.
    const anchors = ofOp(calls, 'fillRect').filter((call) => call.args[2] === 3 && call.args[3] === 3);
    expect(anchors.map((call) => call.fillStyle)).toEqual([PALETTE.anchor, PALETTE.active]);
  });

  it('el nombre y el tipo solo aparecen en la entidad bajo el puntero o elegida', () => {
    const lvl = level({ entities: [entity('heroe', 1, 1), entity('jefe', 4, 4, { type: 'enemy' })] });
    const hovered = draw(scene({ lvl, hoveredEntityId: () => 'heroe' })).calls;
    const texts = ofOp(hovered, 'fillText').map((call) => call.args[0]);
    expect(texts).toContain('heroe · Jugador');
    expect(texts).not.toContain('jefe · Enemigo');
    const tag = ofOp(hovered, 'fillText').find((call) => call.args[0] === 'heroe · Jugador');
    expect(tag?.fillStyle).toBe(PALETTE.tagText);

    const quiet = draw(scene({ lvl })).calls;
    expect(ofOp(quiet, 'fillText').some((call) => /^(heroe|jefe) /.test(String(call.args[0])))).toBe(false);
  });

  it('las salas y las zonas muestran su nombre', () => {
    const lvl = level({
      rooms: [{ id: 'sala_1', col: 1, row: 1, width: 3, height: 3 }],
      zones: [{ id: 'trampa', col: 2, row: 2, width: 2, height: 2 }],
    });
    const texts = ofOp(draw(scene({ lvl })).calls, 'fillText').map((call) => call.args[0]);
    expect(texts).toContain('sala_1');
    expect(texts).toContain('zona trampa');
  });

  it('sin grilla no hay lineas de division ni ejes', () => {
    const { calls } = draw(scene({ showGrid: () => false }));
    const strokes = ofOp(calls, 'stroke').map((call) => call.strokeStyle);
    expect(strokes).not.toContain(PALETTE.gridUnder);
    expect(strokes).not.toContain(PALETTE.gridOver);
    expect(strokes).not.toContain('rgba(197, 79, 79, 0.85)');
  });

  it('la grilla de una sola forma lleva una linea por borde, no una por celda', () => {
    const { calls } = draw(scene());
    const strokeIndex = calls.findIndex((call) => call.op === 'stroke' && call.strokeStyle === PALETTE.gridUnder);
    expect(strokeIndex).toBeGreaterThan(-1);
    const lastBegin = calls.slice(0, strokeIndex).map((call) => call.op).lastIndexOf('beginPath');
    const moves = calls.slice(lastBegin, strokeIndex).filter((call) => call.op === 'moveTo');
    // (ancho + 1) lineas de columna y (alto + 1) de fila.
    expect(moves).toHaveLength(GRID.width + 1 + GRID.height + 1);
  });

  it('con la grilla encima, se dibuja despues de las entidades y mas gruesa con el zoom', () => {
    const lvl = level({ entities: [entity('a', 1, 1)] });
    const atZoom = (zoom: number) => {
      const { calls } = draw(scene({ lvl, zoom: () => zoom, gridOnTop: () => true, sprite: spriteByTexture }));
      const over = calls.findIndex((call) => call.op === 'stroke' && call.strokeStyle === PALETTE.gridOver);
      const sprite = calls.findIndex((call) => call.op === 'drawImage');
      expect(calls.some((call) => call.op === 'stroke' && call.strokeStyle === PALETTE.gridUnder)).toBe(false);
      expect(over).toBeGreaterThan(sprite);
      return calls[over].lineWidth;
    };
    expect(atZoom(1)).toBe(2);
    expect(atZoom(6)).toBe(3);
    expect(atZoom(16)).toBe(4);
  });

  it('un nivel sin tiles muestra las paredes del borde solo si declara la textura de pared', () => {
    const grid = { ...GRID, width: 4, height: 4 };
    const wallFills = (lvl: Level) =>
      ofOp(draw(scene({ lvl })).calls, 'fill').filter((call) => call.fillStyle === PALETTE.wallFill);
    expect(wallFills(level({ grid }))).toHaveLength(0);
    const withWall = level({
      grid,
      visuals: { wall: { texture: 'textures/wall.png', sourceRect: { x: 0, y: 0, width: 32, height: 32 } } },
    });
    // El anillo del borde de una grilla de 4x4: 12 celdas.
    expect(wallFills(withWall)).toHaveLength(12);
  });

  it('con tiles se dibujan sus paredes aunque no haya textura de pared', () => {
    const lvl = level({
      tiles: [
        { col: 0, row: 0, wall: true },
        { col: 1, row: 0, floor: true },
        { col: 2, row: 0, floor: false },
      ],
    });
    const { calls } = draw(scene({ lvl }));
    expect(ofOp(calls, 'fill').filter((call) => call.fillStyle === PALETTE.wallFill)).toHaveLength(1);
    // Con mapa de celdas, lo que no es piso es vacio: el fondo de la grilla va oscuro.
    const fills = ofOp(calls, 'fill');
    expect(fills[0].fillStyle).toBe(PALETTE.void);
    // Y encima, el piso de las celdas que lo tienen (las que no dicen floor:false).
    expect(fills.filter((call) => call.fillStyle === PALETTE.floor)).toHaveLength(2);
  });

  it('sin tiles la grilla es un solo piso liso', () => {
    const fills = ofOp(draw(scene()).calls, 'fill');
    expect(fills[0].fillStyle).toBe(PALETTE.floor);
  });

  describe('piso con textura', () => {
    const floor = { texture: 'textures/floor.png', sourceRect: { x: 0, y: 0, width: 64, height: 64 } };
    const grid = { ...GRID, width: 3, height: 3 };
    const images: Record<string, HTMLImageElement> = {
      'textures/floor.png': fakeImage('floor', 128, 128),
      'textures/metal.png': fakeImage('metal', 32, 32),
      'textures/alta.png': fakeImage('alta', 32, 64),
    };
    const sprite = (texture: string) => images[texture] ?? null;

    it('cada casilla lleva la del nivel con su recorte, y la pintada la imagen entera', () => {
      const lvl = level({ grid, visuals: { floor }, floorPaint: [{ col: 1, row: 1, texture: 'textures/metal.png' }] });
      const sc = scene({ lvl, sprite });
      const floors = ofOp(draw(sc).calls, 'drawImage');
      expect(floors.map(named).filter((name) => name === 'floor')).toHaveLength(8);
      const metal = floors.find((call) => named(call) === 'metal')!;
      const center = canvasPoint(sc, 1, 1);
      // La imagen entera, al ancho de la casilla y centrada en su punto.
      expect(metal.args.slice(1)).toEqual([0, 0, 32, 32, center.x - 32, center.y - 32, 64, 64]);
      const level0 = floors.find((call) => named(call) === 'floor')!;
      expect(level0.args.slice(1, 5)).toEqual([0, 0, 64, 64]);
    });

    it('una baldosa mas alta que ancha se apoya en el vertice de abajo de la casilla', () => {
      const lvl = level({ grid, floorPaint: [{ col: 0, row: 0, texture: 'textures/alta.png' }] });
      const sc = scene({ lvl, sprite });
      const tall = ofOp(draw(sc).calls, 'drawImage').find((call) => named(call) === 'alta')!;
      const point = canvasPoint(sc, 0, 0);
      // 32x64 al ancho de 64: 128 de alto, con el pie medio tile debajo del punto.
      expect(tall.args.slice(5)).toEqual([point.x - 32, point.y + 16 - 128, 64, 128]);
    });

    it('una imagen que todavia no cargo deja la casilla con el piso liso', () => {
      const lvl = level({ grid, visuals: { floor } });
      expect(ofOp(draw(scene({ lvl })).calls, 'drawImage')).toHaveLength(0);
    });

    it('no pinta piso en las celdas de tiles que no lo tienen', () => {
      const lvl = level({
        grid,
        visuals: { floor },
        tiles: [
          { col: 0, row: 0, floor: true },
          { col: 1, row: 0, floor: false, wall: true },
        ],
      });
      expect(ofOp(draw(scene({ lvl, sprite })).calls, 'drawImage')).toHaveLength(1);
    });

    it('el piso va antes que las paredes, y tambien se ve sin grilla', () => {
      const lvl = level({ grid, visuals: { floor, wall: floor } });
      for (const showGrid of [true, false]) {
        const { calls } = draw(scene({ lvl, sprite, showGrid: () => showGrid }));
        const firstFloor = calls.findIndex((call) => call.op === 'drawImage');
        const firstWall = calls.findIndex((call) => call.op === 'fill' && call.fillStyle === PALETTE.wallFill);
        expect(firstFloor).toBeGreaterThan(-1);
        expect(firstFloor).toBeLessThan(firstWall);
      }
    });
  });

  it('la celda bajo el cursor se resalta solo si esta dentro de la grilla', () => {
    const hoverFills = (col: number, row: number) =>
      ofOp(draw(scene({ hovered: () => ({ col, row }) })).calls, 'fill').filter(
        (call) => call.fillStyle === PALETTE.hoverFill,
      );
    expect(hoverFills(3, 3)).toHaveLength(1);
    expect(hoverFills(-1, 0)).toHaveLength(0);
    expect(hoverFills(GRID.width, 0)).toHaveLength(0);
    expect(hoverFills(0, GRID.height)).toHaveLength(0);
  });

  it('el resaltado del cursor va debajo de las entidades', () => {
    const lvl = level({ entities: [entity('a', 3, 3)] });
    const { calls } = draw(scene({ lvl, hovered: () => ({ col: 3, row: 3 }), sprite: spriteByTexture }));
    const hover = calls.findIndex((call) => call.op === 'fill' && call.fillStyle === PALETTE.hoverFill);
    expect(hover).toBeLessThan(calls.findIndex((call) => call.op === 'drawImage'));
  });

  it('el trazado de un tunel muestra el mismo piso que va a quedar, hasta el cursor', () => {
    const trace = { from: 'a', start: { col: 1, row: 1 }, points: [{ col: 4, row: 1 }], width: 2 };
    const hovered = { col: 4, row: 4 };
    const { calls } = draw(scene({ tunnelTrace: () => trace, hovered: () => hovered }));
    const expected = routeFloor(elbowRoute([trace.start, ...trace.points, hovered]), trace.width);
    expect(ofOp(calls, 'fill').filter((call) => call.fillStyle === 'rgba(127, 201, 127, 0.22)')).toHaveLength(
      expected.length,
    );
    // Una marca por punto puesto a mano, sin contar el cursor.
    expect(ofOp(calls, 'fillRect').filter((call) => call.fillStyle === '#7fc97f')).toHaveLength(2);
  });

  it('las vistas previas de salas aparecen solo si hay algo que mostrar', () => {
    const ghosts = (sc: CanvasScene) =>
      ofOp(draw(sc).calls, 'fill').filter((call) => call.fillStyle === 'rgba(127, 201, 127, 0.12)');
    expect(ghosts(scene())).toHaveLength(0);
    expect(ghosts(scene({ roomDraft: () => ({ col: 1, row: 1, width: 3, height: 2 }) }))).toHaveLength(1);
    expect(
      ghosts(scene({ roomDrag: () => ({ kind: 'create', start: { col: 4, row: 4 }, end: { col: 1, row: 2 } }) })),
    ).toHaveLength(1);
    const move = {
      kind: 'move' as const,
      id: 'sala_1',
      grab: { col: 2, row: 2 },
      origin: { col: 1, row: 1 },
      delta: { col: 2, row: 0 },
    };
    // Mover una sala que ya no existe no dibuja nada.
    expect(ghosts(scene({ roomDrag: () => move }))).toHaveLength(0);
    const lvl = level({ rooms: [{ id: 'sala_1', col: 1, row: 1, width: 2, height: 2 }] });
    expect(ghosts(scene({ lvl, roomDrag: () => move }))).toHaveLength(1);
  });

  it('la sala que se arrastra se muestra en su lugar nuevo', () => {
    const lvl = level({ rooms: [{ id: 'sala_1', col: 1, row: 1, width: 2, height: 2 }] });
    const move = {
      kind: 'move' as const,
      id: 'sala_1',
      grab: { col: 2, row: 2 },
      origin: { col: 1, row: 1 },
      delta: { col: 3, row: 1 },
    };
    const sc = scene({ lvl, roomDrag: () => move });
    const { calls } = draw(sc);
    const ghost = calls.findIndex((call) => call.op === 'fill' && call.fillStyle === 'rgba(127, 201, 127, 0.12)');
    const start = calls.slice(0, ghost).filter((call) => call.op === 'moveTo').at(-1)!;
    const corner = canvasPoint(sc, 4, 2);
    expect(start.args).toEqual([corner.x, corner.y - GRID.tileHeight / 2]);
  });

  it('el rectangulo de seleccionar area se normaliza aunque se arrastre al reves', () => {
    const { calls } = draw(scene({ marquee: () => ({ x0: 300, y0: 250, x1: 100, y1: 50 }) }));
    const fill = ofOp(calls, 'fillRect').find((call) => call.fillStyle === PALETTE.marqueeFill);
    expect(fill?.args).toEqual([100, 50, 200, 200]);
  });

  describe('colisiones', () => {
    const wall = entity('muro', 2, 2, { wall: true });
    const solid = entity('caja', 4, 4, { collider: { width: 64, height: 32, solid: true } });
    const round = entity('barril', 6, 6, { collider: { width: 64, height: 32, solid: true, shape: 'ellipse' } });
    const sensor = entity('sensor', 1, 5, { collider: { width: 20, height: 10 } });
    const lvl = level({ entities: [wall, solid, round, sensor] });

    it('no se ven si no estan encendidas ni la entidad esta elegida', () => {
      const strokes = ofOp(draw(scene({ lvl })).calls, 'stroke').map((call) => call.strokeStyle);
      expect(strokes).not.toContain('#c05050');
      expect(strokes).not.toContain('#e0c04a');
    });

    it('encendidas se ven todas, cada una con su color', () => {
      const { calls } = draw(scene({ lvl, showColliders: () => true }));
      const walls = ofOp(calls, 'stroke').filter((call) => call.strokeStyle === '#c05050');
      expect(walls).toHaveLength(1);
      expect(walls[0].lineWidth).toBe(2);
      expect(ofOp(calls, 'stroke').filter((call) => call.strokeStyle === '#e0c04a')).toHaveLength(2);
    });

    it('una base redonda se traza como elipse y una cuadrada como rombo', () => {
      const { calls } = draw(scene({ lvl: level({ entities: [round] }), showColliders: () => true }));
      const at = calls.findIndex((call) => call.op === 'stroke' && call.strokeStyle === '#e0c04a');
      const begin = calls.slice(0, at).map((call) => call.op).lastIndexOf('beginPath');
      expect(calls.slice(begin, at).filter((call) => call.op === 'lineTo')).toHaveLength(31);

      const box = draw(scene({ lvl: level({ entities: [solid] }), showColliders: () => true })).calls;
      const boxAt = box.findIndex((call) => call.op === 'stroke' && call.strokeStyle === '#e0c04a');
      const boxBegin = box.slice(0, boxAt).map((call) => call.op).lastIndexOf('beginPath');
      expect(box.slice(boxBegin, boxAt).filter((call) => call.op === 'lineTo')).toHaveLength(3);
    });

    it('un sensor se dibuja con la caja en pixeles que usa el motor, colgando del punto', () => {
      const sc = scene({ lvl: level({ entities: [sensor] }), showColliders: () => true, zoom: () => 2 });
      const box = ofOp(draw(sc).calls, 'strokeRect').find((call) => call.strokeStyle === '#6b9e3f');
      const point = canvasPoint(sc, 1, 5);
      expect(box?.args).toEqual([point.x, point.y, 40, 20]);
    });

    it('en la entidad elegida se ven apagadas', () => {
      const { calls } = draw(scene({ lvl: level({ entities: [wall] }), selectedIds: () => new Set(['muro']) }));
      const stroke = ofOp(calls, 'stroke').find((call) => call.strokeStyle === '#c05050');
      expect(stroke?.globalAlpha).toBe(0.6);
      expect(stroke?.lineWidth).toBe(1);
    });
  });

  it('el gizmo de ejes y las medidas del nivel van al final, en la esquina de arriba a la derecha', () => {
    const { calls } = draw(scene());
    const texts = ofOp(calls, 'fillText');
    expect(texts.slice(-3).map((call) => call.args[0])).toEqual(['C', 'F', '10 x 8  ·  64x32 px']);
    expect(texts.at(-1)?.args[1]).toBe(800 - 18);
    // El brazo de las columnas apunta abajo a la derecha, como crece la columna.
    const arcs = ofOp(calls, 'arc');
    expect(arcs).toHaveLength(2);
    const [colTip, rowTip] = arcs.map((call) => call.args as number[]);
    expect(colTip[0]).toBeGreaterThan(800 - 48);
    expect(rowTip[0]).toBeLessThan(800 - 48);
    expect(colTip[1]).toBeCloseTo(rowTip[1]);
  });
});
