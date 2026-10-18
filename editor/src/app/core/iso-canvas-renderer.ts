// =============================================================================
// HoneyComb Engine - Editor (dibujo del viewport isometrico)
// =============================================================================
//
// Todo lo que sabe convertir el nivel abierto en pixeles del canvas, y lo que
// sabe hacer el camino inverso (de un click a una celda o a una entidad).
//
// Estaba dentro de App, pero no tiene nada de Angular: no toca el DOM salvo el
// propio <canvas>, no inyecta servicios y no depende del ciclo de vida del
// componente. Separado, App se queda con la interaccion y esto se puede probar
// contra un contexto 2D de mentira.
//
// Tres transformaciones entre el mundo y la pantalla, y siempre en este orden:
//
//   celda (col,row)  --IsoProjection.gridToScreen-->  pixeles isometricos
//                    --* zoom-->                      pixeles escalados
//                    --+ origin()-->                  pixeles del canvas
//
// coordAt() y entityAt() hacen exactamente el camino inverso. Si se toca una
// de las tres, hay que tocar las tres.
//
// El dibujo replica la proyeccion del runtime (engine/main.cpp) a proposito:
// ese paralelismo es lo que garantiza que lo que se ve en el editor coincida
// con lo que termina dibujando el juego.
// =============================================================================

import { iconImage } from './cell-image';
import { characterOf } from './characters';
import { entityKindStyle } from './entity-kinds';
import { blockCenter, entitySpan } from './entity-blocks';
import { elbowRoute, legacyTiles, rectBetween, routeFloor } from './dungeon-layout';
import { floorOverrides } from './floors';
import { GridCoord, IsoProjection } from './iso-projection';
import { usesShapeSheet } from './iso-shapes';
import { CanvasPalette } from './themes';
import { GridConfig, Level, LevelEntity } from '../models/level.model';

/** Margen desde el borde de arriba del canvas hasta la celda (0,0), sin pan. */
export const VIEW_TOP_MARGIN = 60;

export interface CanvasSize {
  w: number;
  h: number;
}

export interface CanvasPoint {
  x: number;
  y: number;
}

/**
 * Lo que el renderer necesita mirar para dibujar un frame.
 *
 * Son FUNCIONES y no valores porque del otro lado son signals de Angular: App
 * pasa los signals tal cual (`zoom: this.zoom`) sin envolver nada, y el
 * renderer los lee cuando dibuja. Aca no se importa nada de Angular; cualquier
 * funcion sin argumentos sirve, y por eso un test puede pasar `() => 3`.
 */
export interface CanvasScene {
  size(): CanvasSize;
  pan(): CanvasPoint;
  zoom(): number;
  level(): Level;
  /** La entidad ACTIVA: la ultima tocada, la que muestra el inspector. */
  selectedId(): string | null;
  /** Todas las seleccionadas, la activa incluida. */
  selectedIds(): ReadonlySet<string>;
  hovered(): GridCoord | null;
  showGrid(): boolean;
  gridOnTop(): boolean;
  showColliders(): boolean;
  roomDraft(): { col: number; row: number; width: number; height: number } | null;
  roomDrag():
    | { kind: 'create'; start: GridCoord; end: GridCoord }
    | { kind: 'move'; id: string; grab: GridCoord; origin: GridCoord; delta: GridCoord }
    | null;
  tunnelTrace(): { from: string; start: GridCoord; points: GridCoord[]; width: number } | null;
  shapeSheet(): HTMLImageElement | null;
  /** Colores del tema actual (ver services/theme.service.ts). */
  palette(): CanvasPalette;
  /** Rectangulo de Seleccionar area en curso, en pixeles del canvas; null si no hay. */
  marquee(): CanvasRect | null;
  /** La imagen del proyecto para una textura, si ya esta cargada (ver viewport/sprite-cache.ts). */
  sprite(texture: string): HTMLImageElement | null;
  /** La entidad bajo el puntero, para mostrar su nombre. */
  hoveredEntityId(): string | null;
}

/** Rectangulo entre dos esquinas cualesquiera, en pixeles del canvas. */
export interface CanvasRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export class IsoCanvasRenderer {

  /** Punto del canvas donde cae la celda (0,0): centro horizontal, margen arriba, mas el pan. */
  origin(size: CanvasSize, pan: CanvasPoint): CanvasPoint {
    // Mismo encuadre que main.cpp: centro horizontal y un margen superior.
    return { x: size.w / 2 + pan.x, y: VIEW_TOP_MARGIN + pan.y };
  }

  /** Celda de la grilla bajo el cursor. Puede quedar fuera de rango: quien llama valida. */
  coordAt(event: MouseEvent, rect: DOMRect, scene: CanvasScene): GridCoord {
    const grid = scene.level().grid;
    // clientX/Y son relativos a la ventana: hay que restar la posicion del
    // canvas y el origen, y dividir por el zoom, en ese orden.
    const origin = this.origin(scene.size(), scene.pan());
    const zoom = scene.zoom();
    const iso = new IsoProjection(grid.tileWidth, grid.tileHeight);
    return iso.screenToGrid({
      x: (event.clientX - rect.left - origin.x) / zoom,
      // El medio tile extra invierte el centrado del rombo: screenToGrid trata
      // el punto de la celda como su esquina de arriba, y las celdas se dibujan
      // centradas en el (ver diamond()). Sin esto, apuntar al medio de una
      // casilla devolveria la de atras.
      y: (event.clientY - rect.top - origin.y) / zoom + grid.tileHeight / 2,
    });
  }

  /**
   * Hit-test sobre el rectangulo real del sprite, no sobre la celda: un sprite
   * alto sobresale de su rombo, y hay que poder clickear la parte que se ve.
   * Devuelve el id de la entidad clickeada, o null si no hay ninguna.
   */
  entityAt(event: MouseEvent, rect: DOMRect, scene: CanvasScene): string | null {
    const origin = this.origin(scene.size(), scene.pan());
    const zoom = scene.zoom();
    const grid = scene.level().grid;
    const iso = new IsoProjection(grid.tileWidth, grid.tileHeight);
    const x = (event.clientX - rect.left - origin.x) / zoom;
    const y = (event.clientY - rect.top - origin.y) / zoom;

    // De adelante hacia atras (orden inverso al de draw()), para que en un
    // solapamiento gane el sprite que se ve encima: es el que el usuario
    // creyo estar clickeando.
    const ordered = [...scene.level().entities].sort(
      (a, b) => iso.gridToScreen(blockCenter(b)).y - iso.gridToScreen(blockCenter(a)).y,
    );
    for (const entity of ordered) {
      // La misma caja que usa draw(), a zoom 1 (x e y ya vienen sin zoom). Si
      // el hit-test calculara la suya por separado, clickear una entidad
      // seleccionaria otra cosa en cuanto una de las dos formulas cambiara.
      const box = this.spriteBox(entity, iso.gridToScreen(blockCenter(entity)), 1);

      if (x >= box.x && x <= box.x + box.w && y >= box.y && y <= box.y + box.h) {
        return entity.id;
      }
    }
    return null;
  }

  /**
   * Las entidades cuyo sprite toca el rectangulo (en pixeles del canvas): lo
   * que elige Seleccionar area. Alcanza con tocarlo, como en los editores
   * graficos: obligar a encerrar el sprite entero hace fallar al que arrastra
   * un rectangulo justo.
   */
  entitiesInRect(area: CanvasRect, scene: CanvasScene): string[] {
    const origin = this.origin(scene.size(), scene.pan());
    const zoom = scene.zoom();
    const grid = scene.level().grid;
    const iso = new IsoProjection(grid.tileWidth, grid.tileHeight);
    // Al espacio sin zoom de spriteBox, como en entityAt.
    const left = (Math.min(area.x0, area.x1) - origin.x) / zoom;
    const right = (Math.max(area.x0, area.x1) - origin.x) / zoom;
    const top = (Math.min(area.y0, area.y1) - origin.y) / zoom;
    const bottom = (Math.max(area.y0, area.y1) - origin.y) / zoom;

    return scene
      .level()
      .entities.filter((entity) => {
        const box = this.spriteBox(entity, iso.gridToScreen(blockCenter(entity)), 1);
        return box.x <= right && box.x + box.w >= left && box.y <= bottom && box.y + box.h >= top;
      })
      .map((entity) => entity.id);
  }

  /**
   * Donde cae el sprite de una entidad en pantalla. Es la traduccion EXACTA de
   * lo que hace engine/main.cpp al encolar una entidad:
   *
   *     drawPosition = { ancla.x - ancho/2,  ancla.y - alto + groundOffset }
   *
   * Vive en un solo metodo, y no repetida en el dibujo y en el hit-test, para
   * que no puedan divergir entre si -- ni de la formula del motor, que es la
   * unica que manda: si el editor la calcula distinto, el nivel se ve de una
   * forma al disenarlo y de otra al jugarlo.
   *
   * "anchor" ya viene en pixeles de canvas (proyectado y con zoom aplicado);
   * el tamano y el offset se escalan aca.
   */
  spriteBox(
    entity: LevelEntity,
    anchor: { x: number; y: number },
    zoom: number,
  ): { x: number; y: number; w: number; h: number } {
    // Con span, el motor agranda el sprite y su groundOffset span veces, y
    // "anchor" ya tiene que ser el centro del bloque (ver blockCenter).
    // Y lo mismo con la escala del personaje, igual que main.cpp.
    const scale = entitySpan(entity) * (entity.scale ?? 1) * zoom;
    const w = entity.sourceRect.width * scale;
    const h = entity.sourceRect.height * scale;
    return {
      x: anchor.x - w / 2,
      y: anchor.y - h + (entity.groundOffset ?? 0) * scale,
      w,
      h,
    };
  }

  /**
   * Redibuja el viewport entero. Lo dispara el effect() del constructor cada
   * vez que cambia algo que se ve; no hay bucle de animacion.
   *
   * Orden de dibujado (de atras hacia adelante):
   *   fondo -> grilla -> ejes -> tiles -> celda bajo el cursor
   *         -> entidades por profundidad -> gizmo y textos de overlay
   *
   * El aspecto es el grafito calido del resto de la ventana: lineas de grilla
   * apenas mas claras que el piso, y los dos ejes del mundo en rojo y verde
   * (el codigo de color de los editores 3D, X rojo e Y verde), que dicen de un
   * vistazo hacia donde crecen la columna y la fila, algo que en isometrico no
   * es obvio. La seleccion va en el acento del tema, como en los paneles.
   *
   * Las entidades con sprite se dibujan con su sprite y nada mas: el sprite
   * es la señal, y el nombre y el tipo van en texto, en una etiqueta que solo
   * aparece al pasar el mouse o al elegirlas. Las que no tienen sprite (o
   * todavia no se cargo) llevan un marcador punteado con el icono de su tipo.
   */
  draw(canvas: HTMLCanvasElement, scene: CanvasScene): void {
    const size = scene.size();
    // Antes del primer ResizeObserver el canvas mide 0: no hay nada que dibujar.
    if (size.w === 0 || size.h === 0) {
      return;
    }

    // Asignar width/height (aunque no cambien) resetea el canvas: es la forma
    // mas barata de limpiarlo, y ademas sincroniza el buffer con el tamano CSS.
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }
    // Sin interpolacion: es la mitad de lo que hace ver pixel art como pixel art.
    ctx.imageSmoothingEnabled = false;

    const level = scene.level();
    const grid = level.grid;
    const zoom = scene.zoom();
    const origin = this.origin(size, scene.pan());
    const iso = new IsoProjection(grid.tileWidth, grid.tileHeight);
    const selectedId = scene.selectedId();
    const hovered = scene.hovered();
    const palette = scene.palette();

    // Fondo del viewport: el gris del tema, un escalon por debajo del piso,
    // para que el pixel art sea lo mas vivo de la pantalla.
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, size.w, size.h);

    const halfW = (grid.tileWidth / 2) * zoom;
    const halfH = (grid.tileHeight / 2) * zoom;
    const fullH = grid.tileHeight * zoom;

    /** Pasa una celda a pixeles del canvas (su punto de apoyo, el del motor). */
    const project = (coord: GridCoord) => {
      const point = iso.gridToScreen(coord);
      return { x: origin.x + point.x * zoom, y: origin.y + point.y * zoom };
    };

    /**
     * Una ESQUINA de la grilla, para el contorno y las lineas de division.
     *
     * Como las celdas van centradas en su punto (ver diamond()), sus esquinas
     * caen en col-0.5 / row-0.5, y proyectar eso da exactamente el mismo punto
     * medio tile mas arriba. De ahi el "- halfH".
     */
    const gridPoint = (coord: GridCoord) => {
      const point = project(coord);
      return { x: point.x, y: point.y - halfH };
    };

    // Traza el rombo de una celda (sin pintarlo): quien llama decide si lo
    // rellena, lo bordea o las dos cosas. Los cuatro puntos van desde la punta
    // superior, en sentido horario.
    // El rombo va CENTRADO en el punto de la celda, no colgando de el. Es lo
    // que hace el motor con el tile de piso (lo centra: ver el Submit del piso
    // en main.cpp), y es lo que hace que una figura -- que apoya el centro de
    // su base en ese punto -- se vea parada sobre su casilla y no medio tile
    // por encima. Antes el editor lo dibujaba medio tile mas abajo que el
    // juego.
    const diamond = (coord: GridCoord) => {
      const { x, y } = project(coord);
      ctx.beginPath();
      ctx.moveTo(x, y - halfH);
      ctx.lineTo(x + halfW, y);
      ctx.lineTo(x, y + halfH);
      ctx.lineTo(x - halfW, y);
      ctx.closePath();
    };

    // Lineas de division. Se dibujan como dos familias de rectas completas y no
    // rombo a rombo -- una linea por borde en vez de una por celda, sin trazos
    // repetidos que se ven mas gruesos al superponerse.
    const gridLines = (color: string, width = 1) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      for (let col = 0; col <= grid.width; col += 1) {
        const from = gridPoint({ col, row: 0 });
        const to = gridPoint({ col, row: grid.height });
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
      }
      for (let row = 0; row <= grid.height; row += 1) {
        const from = gridPoint({ col: 0, row });
        const to = gridPoint({ col: grid.width, row });
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
      }
      ctx.stroke();
    };

    // Piso con textura, como lo dibuja el motor: en cada celda de piso, la
    // textura que le toca por sus capas (nivel, sala o tunel, casilla: ver
    // core/floors.ts), al ancho de la casilla y centrada en su punto. Una
    // imagen que todavia no cargo deja esa celda con el piso liso de siempre.
    const floorVisual = level.visuals?.floor;
    const overrides = floorOverrides(level);
    const drawFloorTextures = () => {
      if (!floorVisual && overrides.size === 0) {
        return;
      }
      const cellsWithFloor: GridCoord[] = level.tiles
        ? level.tiles.filter((tile) => tile.floor !== false)
        : Array.from({ length: grid.width * grid.height }, (_, i) => ({
            col: i % grid.width,
            row: Math.floor(i / grid.width),
          }));
      for (const cell of cellsWithFloor) {
        const override = overrides.get(cell.col + ',' + cell.row);
        const texture = override ?? floorVisual?.texture;
        const image = texture ? scene.sprite(texture) : null;
        if (!image) {
          continue;
        }
        // La del nivel trae su recorte; las de las capas son la imagen entera.
        const src = override || !floorVisual
          ? { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight }
          : floorVisual.sourceRect;
        if (src.width <= 0 || src.height <= 0) {
          continue;
        }
        const width = grid.tileWidth * zoom;
        const height = src.height * (grid.tileWidth / src.width) * zoom;
        const { x, y } = project(cell);
        // La misma regla que GameSession::PrepareLevel: ancha o cuadrada, centrada
        // en la casilla; mas alta que ancha (un lienzo alto con la baldosa abajo,
        // como las piezas de Kenney), apoyada en el vertice de abajo de la casilla.
        const top = height > width ? y + (grid.tileHeight / 2) * zoom - height : y - height / 2;
        ctx.drawImage(image, src.x, src.y, src.width, src.height, x - width / 2, top, width, height);
      }
    };

    if (!scene.showGrid()) {
      drawFloorTextures();
    }

    if (scene.showGrid()) {
      // El suelo de la grilla es una sola forma plana, no un damero: Blender no
      // alterna el color de sus cuadros, y el damero competia con el arte.
      ctx.beginPath();
      const corners: GridCoord[] = [
        { col: 0, row: 0 },
        { col: grid.width, row: 0 },
        { col: grid.width, row: grid.height },
        { col: 0, row: grid.height },
      ];
      corners.forEach((corner, index) => {
        const { x, y } = gridPoint(corner);
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.closePath();
      // Con un mapa de celdas ("tiles"), lo que no es piso es VACIO: el motor
      // no deja pisarlo ni lo dibuja. Se pinta mas oscuro, y encima solo las
      // celdas de piso con el gris de siempre, para que la forma de las salas
      // y de los tuneles se lea de un vistazo.
      ctx.fillStyle = level.tiles ? palette.void : palette.floor;
      ctx.fill();
      if (level.tiles) {
        ctx.fillStyle = palette.floor;
        for (const tile of level.tiles) {
          if (tile.floor !== false) {
            diamond(tile);
            ctx.fill();
          }
        }
      }
      drawFloorTextures();

      // Debajo: un pelo mas claras que el piso. Encima se dibujan despues de
      // las entidades (ver el final de draw()).
      if (!scene.gridOnTop()) {
        gridLines(palette.gridUnder);
      }

      // Los dos ejes que salen de la celda (0,0), con el color de Blender:
      // rojo el que hace crecer la columna, verde el que hace crecer la fila.
      // Van despues de la grilla para quedar por encima de ella.
      const zero = gridPoint({ col: 0, row: 0 });
      ctx.lineWidth = 1.5;

      ctx.strokeStyle = 'rgba(197, 79, 79, 0.85)';
      ctx.beginPath();
      ctx.moveTo(zero.x, zero.y);
      const colEnd = gridPoint({ col: grid.width, row: 0 });
      ctx.lineTo(colEnd.x, colEnd.y);
      ctx.stroke();

      ctx.strokeStyle = 'rgba(112, 158, 60, 0.85)';
      ctx.beginPath();
      ctx.moveTo(zero.x, zero.y);
      const rowEnd = gridPoint({ col: 0, row: grid.height });
      ctx.lineTo(rowEnd.x, rowEnd.y);
      ctx.stroke();
    }

    // Paredes: la celda entera rellena. Antes era una franja chica en el medio,
    // que servia para ver una pared suelta pero no para leer el contorno de una
    // sala o de un tunel, que es lo que importa al armar un mapa.
    //
    // Sin "tiles" (un nivel recien creado) el motor igual pone pared en todo el
    // borde de la grilla, siempre que el nivel declare la textura de pared: se
    // dibujan esas mismas, para que el editor muestre lo que se va a jugar.
    const wallTiles = level.tiles ?? (level.visuals?.wall ? legacyTiles(grid) : []);
    if (wallTiles.length > 0) {
      ctx.lineWidth = 1;
      for (const tile of wallTiles) {
        if (tile.wall) {
          diamond(tile);
          ctx.fillStyle = palette.wallFill;
          ctx.fill();
          ctx.strokeStyle = palette.wallStroke;
          ctx.stroke();
        }
      }
    }

    // Contorno y nombre de cada grilla del mapa, en punteado azul: son una
    // ayuda del editor, no algo que se vea en el juego. El nombre va en la
    // esquina de arriba porque es el que se usa al conectar tuneles.
    for (const room of level.rooms ?? []) {
      const corners = [
        gridPoint({ col: room.col, row: room.row }),
        gridPoint({ col: room.col + room.width, row: room.row }),
        gridPoint({ col: room.col + room.width, row: room.row + room.height }),
        gridPoint({ col: room.col, row: room.row + room.height }),
      ];
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (const corner of corners.slice(1)) {
        ctx.lineTo(corner.x, corner.y);
      }
      ctx.closePath();
      ctx.strokeStyle = 'rgba(200, 190, 172, 0.85)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = '600 12px "Chakra Petch", "Segoe UI", sans-serif';
      ctx.fillStyle = '#e2d9c9';
      ctx.textAlign = 'center';
      ctx.fillText(room.id, corners[0].x, corners[0].y + 18);
      ctx.textAlign = 'left';
    }

    // Zonas de puzzle: en ambar y con otro punteado, para no confundirlas con
    // las grillas. Tampoco se ven en el juego; las leen los eventos.
    for (const zone of level.zones ?? []) {
      const corners = [
        gridPoint({ col: zone.col, row: zone.row }),
        gridPoint({ col: zone.col + zone.width, row: zone.row }),
        gridPoint({ col: zone.col + zone.width, row: zone.row + zone.height }),
        gridPoint({ col: zone.col, row: zone.row + zone.height }),
      ];
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (const corner of corners.slice(1)) {
        ctx.lineTo(corner.x, corner.y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(111, 196, 214, 0.07)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(111, 196, 214, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = '600 12px "Chakra Petch", "Segoe UI", sans-serif';
      ctx.fillStyle = '#9fdcea';
      ctx.textAlign = 'center';
      ctx.fillText('zona ' + zone.id, corners[0].x, corners[0].y + 32);
      ctx.textAlign = 'left';
    }

    // --- Vistas previas de las herramientas de mapa ------------------------
    // En verde y punteado: todavia no son parte del nivel. Muestran donde va a
    // quedar una grilla antes de confirmarla, y por donde va un tunel mientras
    // se lo traza.
    const ghostRect = (col: number, row: number, width: number, height: number) => {
      const corners = [
        gridPoint({ col, row }),
        gridPoint({ col: col + width, row }),
        gridPoint({ col: col + width, row: row + height }),
        gridPoint({ col, row: row + height }),
      ];
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (const corner of corners.slice(1)) {
        ctx.lineTo(corner.x, corner.y);
      }
      ctx.closePath();
      ctx.fillStyle = 'rgba(127, 201, 127, 0.12)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(127, 201, 127, 0.95)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    };

    const roomDraft = scene.roomDraft();
    if (roomDraft) {
      ghostRect(roomDraft.col, roomDraft.row, roomDraft.width, roomDraft.height);
    }

    const roomDrag = scene.roomDrag();
    if (roomDrag?.kind === 'create') {
      const area = rectBetween(roomDrag.start, roomDrag.end);
      ghostRect(area.col, area.row, area.width, area.height);
    } else if (roomDrag?.kind === 'move') {
      const moving = level.rooms?.find((room) => room.id === roomDrag.id);
      if (moving) {
        ghostRect(
          roomDrag.origin.col + roomDrag.delta.col,
          roomDrag.origin.row + roomDrag.delta.row,
          moving.width,
          moving.height,
        );
      }
    }

    const trace = scene.tunnelTrace();
    if (trace) {
      // Desde la celda de arranque, por los puntos marcados y hasta el cursor,
      // con las MISMAS funciones que arman el tunel al terminar (elbowRoute y
      // routeFloor en core/dungeon-layout.ts): lo que se ve es lo que queda,
      // piso y ancho incluidos.
      const route = elbowRoute([trace.start, ...trace.points, ...(hovered ? [hovered] : [])]);
      ctx.fillStyle = 'rgba(127, 201, 127, 0.22)';
      for (const cell of routeFloor(route, trace.width)) {
        diamond(cell);
        ctx.fill();
      }

      const first = project(route[0]);
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (const cell of route.slice(1)) {
        const next = project(cell);
        ctx.lineTo(next.x, next.y);
      }
      ctx.strokeStyle = 'rgba(127, 201, 127, 0.95)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#7fc97f';
      for (const point of [trace.start, ...trace.points]) {
        const { x, y } = project(point);
        ctx.fillRect(x - 3, y - 3, 6, 6);
      }
    }

    // Celda bajo el cursor. Se valida el rango: fuera de la grilla no se
    // resalta nada, que es la pista visual de que ahi no se puede colocar.
    if (hovered && iso.isValidCoord(hovered, grid.width, grid.height)) {
      diamond(hovered);
      ctx.fillStyle = palette.hoverFill;
      ctx.fill();
      ctx.strokeStyle = palette.hoverStroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Mismo criterio de profundidad que ZSortSystem::Flush(): menor Y primero.
    const ordered = [...level.entities].sort(
      // Por el centro del bloque, que es el sortPosition del motor.
      (a, b) => iso.gridToScreen(blockCenter(a)).y - iso.gridToScreen(blockCenter(b)).y,
    );

    const selectedIds = scene.selectedIds();
    const hoveredId = scene.hoveredEntityId();
    const tags: { text: string; x: number; y: number }[] = [];

    for (const entity of ordered) {
      const { x, y } = project(blockCenter(entity));
      // Dos estados distintos: "seleccionada" (contorno mas apagado) y
      // "activa" (la ultima que se toco, en miel plena). Con una
      // seleccion de varias, sin esa diferencia no se sabria cual es la que
      // esta mostrando el inspector.
      const isSelected = selectedIds.has(entity.id);
      const isActive = entity.id === selectedId;

      // Caja del sprite en pantalla, con la MISMA regla que main.cpp:
      // centrado en X sobre el punto de la celda, borde inferior en ese punto,
      // y groundOffset bajandolo. Antes el editor lo dibujaba con la esquina
      // superior izquierda en el punto, que no es lo que hace el motor: una
      // entidad se veia en un lugar en el editor y en otro en el juego.
      const box = this.spriteBox(entity, { x, y }, zoom);

      // LA REGLA: si la entidad tiene sprite, el sprite es la señal. Se dibuja
      // solo el sprite, con los mismos pixeles que va a mostrar el juego, sin
      // rectangulo de color ni celda encima. El tipo va en texto, en la
      // etiqueta que aparece al pasar el mouse o al elegirla (mas abajo).
      //
      // Sprite es: el recorte del sheet de figuras, o la imagen del proyecto
      // si ya se pudo cargar (ver viewport/sprite-cache.ts). Sin ninguna de
      // las dos queda un marcador discreto: contorno punteado en el color del
      // tipo y su icono chico, que sigue distinguiendo el tipo por la forma.
      //
      // Oculta al empezar (una puerta de puzzle): se dibuja a medias, porque
      // en el juego no se ve hasta que un evento la muestra.
      ctx.globalAlpha = entity.hidden ? 0.4 : 1;
      const sheet = scene.shapeSheet();
      const image = usesShapeSheet(entity.texture) ? sheet : scene.sprite(entity.texture);

      if (image) {
        const src = entity.sourceRect;
        ctx.drawImage(image, src.x, src.y, src.width, src.height, box.x, box.y, box.w, box.h);
      } else {
        const kind = entityKindStyle(entity.type);
        const color = this.entityColor(entity.type);
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.strokeStyle = color;
        ctx.strokeRect(Math.round(box.x) + 0.5, Math.round(box.y) + 0.5, Math.round(box.w) - 1, Math.round(box.h) - 1);
        ctx.setLineDash([]);
        const icon = iconImage(kind.icon, color);
        if (icon) {
          const side = Math.min(14, Math.max(9, Math.min(box.w, box.h) * 0.6));
          ctx.drawImage(icon, box.x + box.w / 2 - side / 2, box.y + box.h / 2 - side / 2, side, side);
        }
      }
      ctx.globalAlpha = 1;
      if (entity.hidden) {
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = palette.hiddenOutline;
        ctx.lineWidth = 1;
        ctx.strokeRect(box.x - 1, box.y - 1, box.w + 2, box.h + 2);
        ctx.setLineDash([]);
      }
      // Corona sobre un jefe: es lo que en el juego tiene la barra de vida grande.
      const crown = entity.boss ? iconImage('crown', '#f7c766') : null;
      if (crown) {
        const side = Math.max(14, 7 * zoom);
        ctx.drawImage(crown, box.x + box.w / 2 - side / 2, box.y - side - 2, side, side);
      }

      // Lo que bloquea, sobre el piso y en celdas (como lo mide Movement.cpp):
      //   Pared    -> el bloque de celdas entero, en rojo.
      //   Colision -> solo la huella del collider (rombo o elipse), en ambar.
      //   Sensor   -> caja punteada verde: no frena, solo dispara on_collision.
      // Se ven las de la entidad elegida, finas y apagadas; con "Colisiones"
      // encendido, las de todas y marcadas, para revisar el nivel entero.
      const showAll = scene.showColliders();
      if (showAll || isSelected) {
        const { col: centerCol, row: centerRow } = blockCenter(entity);
        const tracePath = (points: GridCoord[]) => {
          ctx.beginPath();
          points.map(project).forEach((point, index) =>
            index === 0 ? ctx.moveTo(point.x, point.y) : ctx.lineTo(point.x, point.y),
          );
          ctx.closePath();
        };
        ctx.globalAlpha = showAll ? 1 : 0.6;
        if (entity.wall) {
          const half = entitySpan(entity) / 2;
          tracePath([
            { col: centerCol - half, row: centerRow - half },
            { col: centerCol + half, row: centerRow - half },
            { col: centerCol + half, row: centerRow + half },
            { col: centerCol - half, row: centerRow + half },
          ]);
          ctx.fillStyle = showAll ? 'rgba(192, 80, 80, 0.28)' : 'rgba(192, 80, 80, 0.12)';
          ctx.fill();
          ctx.strokeStyle = '#c05050';
          ctx.lineWidth = showAll ? 2 : 1;
          ctx.stroke();
        }
        if (entity.collider) {
          const solid = entity.collider.solid === true;
          ctx.strokeStyle = solid ? '#e0c04a' : '#6b9e3f';
          ctx.lineWidth = solid && showAll ? 1.5 : 1;

          if (solid) {
            const halfCols = entity.collider.width / grid.tileWidth / 2;
            const halfRows = entity.collider.height / grid.tileHeight / 2;
            if (entity.collider.shape === 'ellipse') {
              const steps = 32;
              tracePath(
                Array.from({ length: steps }, (_, i) => {
                  const angle = (i / steps) * Math.PI * 2;
                  return { col: centerCol + Math.cos(angle) * halfCols, row: centerRow + Math.sin(angle) * halfRows };
                }),
              );
            } else {
              tracePath([
                { col: centerCol - halfCols, row: centerRow - halfRows },
                { col: centerCol + halfCols, row: centerRow - halfRows },
                { col: centerCol + halfCols, row: centerRow + halfRows },
                { col: centerCol - halfCols, row: centerRow + halfRows },
              ]);
            }
            ctx.fillStyle = showAll ? 'rgba(224, 192, 74, 0.2)' : 'rgba(224, 192, 74, 0.08)';
            ctx.fill();
            ctx.stroke();
          } else {
            // Un sensor no bloquea: solo dispara on_collision, y el motor lo
            // detecta con OTRA caja, en pixeles y colgando del punto de la celda
            // (el Submit a CollisionSystem en main.cpp). Esa es la que se dibuja.
            ctx.setLineDash([3, 3]);
            ctx.strokeRect(x, y, entity.collider.width * zoom, entity.collider.height * zoom);
            ctx.setLineDash([]);
          }
        }
        ctx.globalAlpha = 1;
      }

      // Contorno de miel: un halo oscuro por fuera para que se lea sobre
      // cualquier sprite, y la miel pegada a el. El objeto activo lo lleva
      // pleno; el resto de la seleccion, en un tono mas apagado.
      if (isSelected) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = palette.halo;
        ctx.strokeRect(box.x - 2, box.y - 2, box.w + 4, box.h + 4);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = isActive ? palette.active : palette.selected;
        ctx.strokeRect(box.x - 2, box.y - 2, box.w + 4, box.h + 4);

        // Ancla real del runtime: el punto de la celda donde apoya. Solo en lo
        // elegido: en todas era un punto mas de ruido.
        ctx.fillStyle = isActive ? palette.active : palette.anchor;
        ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
      }

      // Nombre y tipo: solo al pasar el mouse o con la entidad elegida. Se
      // dibujan despues de todas las entidades, para que ninguna los tape.
      if (isSelected || entity.id === hoveredId) {
        tags.push({ text: entity.id + ' · ' + entityKindStyle(entity.type).label, x: box.x + box.w / 2, y: box.y });
      }
    }

    // Etiquetas de nombre y tipo: una pastilla chica y sobria sobre el sprite.
    ctx.font = '11px "Chakra Petch", "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    for (const tag of tags) {
      const width = ctx.measureText(tag.text).width + 12;
      const height = 18;
      const left = Math.round(tag.x - width / 2);
      const top = Math.round(tag.y - height - 6);
      ctx.fillStyle = palette.tagBg;
      ctx.beginPath();
      ctx.roundRect(left, top, width, height, 4);
      ctx.fill();
      ctx.strokeStyle = palette.tagLine;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = palette.tagText;
      ctx.fillText(tag.text, left + 6, top + height / 2 + 0.5);
    }
    ctx.textBaseline = 'alphabetic';

    // Encima: despues de las entidades, en el tono de contraste del tema. Opaco
    // y con grosor que crece con el zoom: una linea de 1px se pierde entre los
    // bordes oscuros del pixel art cuando se acerca la vista, y con
    // transparencia se mezclaba con el sprite.
    if (scene.showGrid() && scene.gridOnTop()) {
      gridLines(palette.gridOver, Math.min(4, Math.max(2, zoom * 0.5)));
    }

    // Seleccionar area: el rectangulo que se esta arrastrando, encima de todo
    // lo del nivel. Borde punteado en el acento, como el marco de un editor
    // grafico, y un relleno apenas visible para leer el area.
    const marquee = scene.marquee();
    if (marquee) {
      const x = Math.min(marquee.x0, marquee.x1);
      const y = Math.min(marquee.y0, marquee.y1);
      const w = Math.abs(marquee.x1 - marquee.x0);
      const h = Math.abs(marquee.y1 - marquee.y0);
      ctx.fillStyle = palette.marqueeFill;
      ctx.fillRect(x, y, w, h);
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = palette.active;
      ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
      ctx.setLineDash([]);
    }

    this.drawAxisGizmo(ctx, size, iso, grid, palette);
  }

  /**
   * Gizmo de navegacion de la esquina superior derecha, el mismo que Blender
   * pone en su viewport 3D: dos brazos con una bolita en la punta, en la
   * direccion REAL de cada eje segun la proyeccion isometrica del nivel.
   *
   * No es decoracion: como la proyeccion depende de tileWidth/tileHeight, la
   * inclinacion de los ejes cambia con la grilla, y el gizmo lo muestra.
   */
  private drawAxisGizmo(
    ctx: CanvasRenderingContext2D,
    size: { w: number; h: number },
    iso: IsoProjection,
    grid: GridConfig,
    palette: CanvasPalette,
  ): void {
    const radius = 30;
    const cx = size.w - radius - 18;
    const cy = radius + 18;

    // Direccion unitaria de cada eje en pantalla: se proyecta un paso de una
    // celda y se normaliza, asi el gizmo tiene siempre el mismo tamano aunque
    // el tile mida 64x32 o 32x32.
    const unit = (coord: GridCoord) => {
      const point = iso.gridToScreen(coord);
      const length = Math.hypot(point.x, point.y) || 1;
      return { x: point.x / length, y: point.y / length };
    };
    const colDir = unit({ col: 1, row: 0 });
    const rowDir = unit({ col: 0, row: 1 });

    const arm = (dir: { x: number; y: number }, color: string, label: string) => {
      const tipX = cx + dir.x * radius;
      const tipY = cy + dir.y * radius;

      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(tipX, tipY, 8, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#101010';
      ctx.font = '600 11px "Chakra Petch", "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, tipX, tipY + 0.5);
      // Se restauran los defaults: el resto de draw() dibuja texto alineado a
      // la izquierda y da por hecho ese estado.
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    };

    // Rojo y verde claros: la letra oscura encima da 5:1 o mas.
    arm(colDir, '#e0605a', 'C');
    arm(rowDir, '#79b84a', 'F');

    // Medidas del nivel bajo el gizmo, como el texto de estadisticas del
    // viewport de Blender.
    ctx.font = '11px "Chakra Petch", "Segoe UI", sans-serif';
    ctx.fillStyle = palette.stats;
    ctx.textAlign = 'right';
    ctx.fillText(
      grid.width + ' x ' + grid.height + '  ·  ' + grid.tileWidth + 'x' + grid.tileHeight + ' px',
      size.w - 18,
      cy + radius + 22,
    );
    ctx.textAlign = 'left';
  }

  /**
   * Color de relleno por tipo de entidad. Los arquetipos de la paleta traen el
   * suyo, asi que el color del viewport y el de la celda de los paneles no
   * pueden separarse (ver core/entity-kinds.ts). Los tipos son texto libre en
   * el schema: lo que no reconoce nadie cae a un gris neutro, sin romper nada.
   */
  entityColor(type: string): string {
    const character = characterOf({ type });
    if (character) {
      return character.color;
    }
    return entityKindStyle(type).color;
  }}
