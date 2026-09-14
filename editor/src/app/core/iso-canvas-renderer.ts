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

import { characterOf } from './characters';
import { blockCenter, entitySpan } from './entity-blocks';
import { roomCenter, rectBetween } from './dungeon-layout';
import { GridCoord, IsoProjection } from './iso-projection';
import { shapeOf } from './iso-shapes';
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
  tunnelTrace(): { from: string; points: GridCoord[] } | null;
  shapeSheet(): HTMLImageElement | null;
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
   * El aspecto sigue al viewport 3D de Blender a proposito: gris neutro sin
   * tinte, lineas de grilla apenas mas claras que el fondo, y los dos ejes del
   * mundo en rojo y verde. Ese codigo de color es el mismo que usa Blender
   * (X rojo, Y verde) y aca sirve igual: dice de un vistazo hacia donde crecen
   * la columna y la fila, que en isometrico no es obvio.
   *
   * Las entidades se dibujan como rectangulos de color y no con su textura
   * real: el editor no carga las imagenes del proyecto todavia. El color por
   * tipo alcanza para componer la escena, y el ancla marca donde va a apoyarse
   * de verdad en el runtime.
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

    // Fondo del viewport: el gris de Blender en modo solido, sin nada de azul.
    ctx.fillStyle = '#393939';
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
      ctx.fillStyle = level.tiles ? '#262626' : '#333333';
      ctx.fill();
      if (level.tiles) {
        ctx.fillStyle = '#333333';
        for (const tile of level.tiles) {
          if (tile.floor !== false) {
            diamond(tile);
            ctx.fill();
          }
        }
      }

      // Debajo: un pelo mas claras que el suelo, como las de Blender. Encima se
      // dibujan despues de las entidades (ver el final de draw()).
      if (!scene.gridOnTop()) {
        gridLines('#4a4a4a');
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
    if (level.tiles) {
      ctx.lineWidth = 1;
      for (const tile of level.tiles) {
        if (tile.wall) {
          diamond(tile);
          ctx.fillStyle = 'rgba(176, 106, 70, 0.55)';
          ctx.fill();
          ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
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
      ctx.strokeStyle = 'rgba(92, 138, 208, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = '600 11px Inter, "Segoe UI", sans-serif';
      ctx.fillStyle = '#a9c4ec';
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
      ctx.fillStyle = 'rgba(224, 160, 60, 0.07)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(224, 160, 60, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.font = '600 11px Inter, "Segoe UI", sans-serif';
      ctx.fillStyle = '#f0c07a';
      ctx.textAlign = 'center';
      ctx.fillText('◇ ' + zone.id, corners[0].x, corners[0].y + 32);
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
    const traceStart = trace ? level.rooms?.find((room) => room.id === trace.from) : undefined;
    if (trace && traceStart) {
      // Con codos en L, como lo va a armar el mapa, y siguiendo al cursor hasta
      // la celda que se esta apuntando.
      const points = [roomCenter(traceStart), ...trace.points, ...(hovered ? [hovered] : [])];
      const first = project(points[0]);
      ctx.beginPath();
      ctx.moveTo(first.x, first.y);
      for (let index = 1; index < points.length; index += 1) {
        const bend = project({ col: points[index].col, row: points[index - 1].row });
        const next = project(points[index]);
        ctx.lineTo(bend.x, bend.y);
        ctx.lineTo(next.x, next.y);
      }
      ctx.strokeStyle = 'rgba(127, 201, 127, 0.95)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.fillStyle = '#7fc97f';
      for (const point of trace.points) {
        const { x, y } = project(point);
        ctx.fillRect(x - 3, y - 3, 6, 6);
      }
    }

    // Celda bajo el cursor. Se valida el rango: fuera de la grilla no se
    // resalta nada, que es la pista visual de que ahi no se puede colocar.
    if (hovered && iso.isValidCoord(hovered, grid.width, grid.height)) {
      diamond(hovered);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Mismo criterio de profundidad que ZSortSystem::Flush(): menor Y primero.
    const ordered = [...level.entities].sort(
      // Por el centro del bloque, que es el sortPosition del motor.
      (a, b) => iso.gridToScreen(blockCenter(a)).y - iso.gridToScreen(blockCenter(b)).y,
    );

    const selectedIds = scene.selectedIds();

    for (const entity of ordered) {
      const { x, y } = project(blockCenter(entity));
      // Dos estados distintos, como en Blender: "seleccionada" (contorno mas
      // apagado) y "activa" (la ultima que se toco, en naranja pleno). Con una
      // seleccion de varias, sin esa diferencia no se sabria cual es la que
      // esta mostrando el inspector.
      const isSelected = selectedIds.has(entity.id);
      const isActive = entity.id === selectedId;

      // Una primitiva de bloqueo se dibuja como solido isometrico; el resto,
      // Caja del sprite en pantalla, con la MISMA regla que main.cpp:
      // centrado en X sobre el punto de la celda, borde inferior en ese punto,
      // y groundOffset bajandolo. Antes el editor lo dibujaba con la esquina
      // superior izquierda en el punto, que no es lo que hace el motor: una
      // entidad se veia en un lugar en el editor y en otro en el juego.
      const box = this.spriteBox(entity, { x, y }, zoom);

      // Si es una primitiva del sheet se dibuja el sprite REAL; asi el editor
      // muestra exactamente los pixeles que va a mostrar el juego. Lo demas
      // sigue siendo un rectangulo de color, porque el editor todavia no carga
      // las texturas del proyecto desde el disco.
      // Oculta al empezar (una puerta de puzzle): se dibuja a medias, porque
      // en el juego no se ve hasta que un evento la muestra.
      ctx.globalAlpha = entity.hidden ? 0.4 : 1;
      const sheet = scene.shapeSheet();
      const def = shapeOf(entity);

      if (def && sheet) {
        const src = def.sourceRect;
        ctx.drawImage(sheet, src.x, src.y, src.width, src.height, box.x, box.y, box.w, box.h);
      } else {
        ctx.fillStyle = this.entityColor(entity.type);
        ctx.fillRect(box.x, box.y, box.w, box.h);
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.55)';
        ctx.lineWidth = 1;
        ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
      }
      ctx.globalAlpha = 1;
      if (entity.hidden) {
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = 'rgba(240, 192, 122, 0.9)';
        ctx.lineWidth = 1;
        ctx.strokeRect(box.x - 1, box.y - 1, box.w + 2, box.h + 2);
        ctx.setLineDash([]);
      }
      // Corona sobre un jefe: es lo que en el juego tiene la barra de vida grande.
      if (entity.boss) {
        ctx.font = Math.max(11, 8 * zoom) + 'px sans-serif';
        ctx.fillStyle = '#ffd66e';
        ctx.textAlign = 'center';
        ctx.fillText('♛', box.x + box.w / 2, box.y - 3);
        ctx.textAlign = 'left';
      }

      // Collider: se ve que es una caja logica y no arte. Va en el punto de la
      // celda y no en la caja del sprite, porque es ahi donde lo encola el
      // motor (ver el Submit a CollisionSystem en main.cpp).
      //
      // Una PARED (solid) va en linea llena y roja; un sensor, punteado y
      // verde. Son dos comportamientos opuestos -- uno frena al jugador y el
      // otro no -- y sin distinguirlos hay que abrir el inspector de cada
      // entidad para saber cual es cual.
      if (scene.showColliders() && entity.collider) {
        const solid = entity.collider.solid === true;
        ctx.strokeStyle = solid ? '#c05050' : '#6b9e3f';
        ctx.lineWidth = solid ? 1.5 : 1;

        if (solid) {
          // Lo que BLOQUEA es una caja en celdas: main.cpp divide el collider
          // por el tamano del tile y compara contra la casilla. En pantalla esa
          // caja es un rombo sobre el piso, y es el que se dibuja. Antes era un
          // rectangulo colgando del punto de la celda, que no coincidia con lo
          // que frena al jugador: un cubo y un pilar se veian con la misma
          // colision aunque bloquean superficies muy distintas.
          const halfCols = entity.collider.width / grid.tileWidth / 2;
          const halfRows = entity.collider.height / grid.tileHeight / 2;
          const { col, row } = blockCenter(entity);
          const corners = [
            project({ col: col - halfCols, row: row - halfRows }),
            project({ col: col + halfCols, row: row - halfRows }),
            project({ col: col + halfCols, row: row + halfRows }),
            project({ col: col - halfCols, row: row + halfRows }),
          ];
          ctx.beginPath();
          ctx.moveTo(corners[0].x, corners[0].y);
          for (const corner of corners.slice(1)) {
            ctx.lineTo(corner.x, corner.y);
          }
          ctx.closePath();
          ctx.fillStyle = 'rgba(192, 80, 80, 0.18)';
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

      // Contorno naranja, igual que el de Blender: un halo oscuro por fuera
      // para que se lea sobre cualquier color de relleno, y el naranja pegado
      // al sprite. El objeto activo lo lleva pleno; el resto de la seleccion,
      // en un tono mas apagado.
      if (isSelected) {
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.5)';
        ctx.strokeRect(box.x - 2, box.y - 2, box.w + 4, box.h + 4);
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = isActive ? '#ff8b1f' : '#b06a26';
        ctx.strokeRect(box.x - 2, box.y - 2, box.w + 4, box.h + 4);
      }

      // Ancla real del runtime: la punta superior del rombo (origin {0,0}).
      ctx.fillStyle = isActive ? '#ff8b1f' : 'rgba(255, 255, 255, 0.55)';
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);

      // El id solo desde 2x: mas chico, las etiquetas se pisan entre si y
      // ensucian mas de lo que ayudan.
      if (zoom >= 2) {
        ctx.font = '10px Inter, "Segoe UI", sans-serif';
        ctx.fillStyle = isSelected ? '#ffd0a0' : 'rgba(230, 230, 230, 0.6)';
        ctx.fillText(entity.id, box.x, box.y - 6);
      }
    }

    // Encima: despues de las entidades, en azul claro como el acento de Godot.
    // Opaco y con grosor que crece con el zoom: una linea de 1px se pierde
    // entre los bordes oscuros del pixel art cuando se acerca la vista, y con
    // transparencia se mezclaba con el sprite.
    if (scene.showGrid() && scene.gridOnTop()) {
      gridLines('#70bafa', Math.min(4, Math.max(2, zoom * 0.5)));
    }

    this.drawAxisGizmo(ctx, size, iso, grid);
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
      ctx.font = '600 9px Inter, "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, tipX, tipY + 0.5);
      // Se restauran los defaults: el resto de draw() dibuja texto alineado a
      // la izquierda y da por hecho ese estado.
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
    };

    arm(colDir, '#c54f4f', 'C');
    arm(rowDir, '#709e3c', 'F');

    // Medidas del nivel bajo el gizmo, como el texto de estadisticas del
    // viewport de Blender.
    ctx.font = '10px Inter, "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(230, 230, 230, 0.45)';
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
   * suyo, asi que el color del viewport y el del icono del panel Personajes no
   * pueden separarse. Los tipos son texto libre en el schema: lo que no
   * reconoce nadie cae al azul por defecto, sin romper nada.
   */
  entityColor(type: string): string {
    const character = characterOf({ type });
    if (character) {
      return character.color;
    }
    return type === 'obstacle' ? '#c05050' : '#4772b3';
  }}
