import { DestroyRef, ElementRef, computed, effect, inject, signal } from '@angular/core';

import { CharactersController } from '../characters/characters.controller';
import { EntityOpsController } from '../entities/entity-ops.controller';
import { MapController } from '../map/map.controller';
import { PaletteController } from '../palette/palette.controller';
import { SelectionController } from '../selection/selection.controller';
import { ItemLibraryService } from '../services/item-library.service';
import { LevelService } from '../services/level.service';
import { SelectionService } from '../services/selection.service';
import { TexturesController } from '../textures/textures.controller';
import { roomAt, tunnelAt } from '../core/dungeon-layout';
import { blocksOverlap, entitySpan } from '../core/entity-blocks';
import { CanvasPoint, CanvasScene, IsoCanvasRenderer, VIEW_TOP_MARGIN } from '../core/iso-canvas-renderer';
import { GridCoord, IsoProjection } from '../core/iso-projection';
import { SHAPE_SHEET_DATA_URL, ShapeId, shapeDef } from '../core/iso-shapes';
import { GridPosition } from '../models/level.model';

// Presets de zoom de la barra: enteros, porque en pixel art un zoom fraccionario
// reparte mal los pixeles del sprite (unos de 1px y otros de 2px) y arruina la
// lectura de la imagen.
const ZOOM_STEPS = [1, 2, 3, 4, 6, 8];

// La rueda, en cambio, hace zoom continuo como el de Blender: encuadrar es una
// accion de navegacion, no de encuadre final, y saltar de 3x a 4x de golpe hace
// perder el punto que se estaba mirando. Los presets de arriba siguen ahi para
// volver a un entero exacto cuando importa ver los pixeles.
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 16;
/** Factor por muesca de rueda. ~1.15 da la misma sensacion de "arrastre" que Blender. */
const ZOOM_WHEEL_FACTOR = 1.15;

/**
 * Pixeles que puede moverse el cursor entre apretar y soltar sin dejar de
 * contar como un click. Separa "click derecho" (abre el menu) de "arrastre con
 * el derecho" (mueve la camara); con 0 el menu no abriria nunca, porque un
 * mouse siempre se corre uno o dos pixeles al hacer click.
 */
const CLICK_SLOP = 4;

/** Proporcion del viewport que ocupa la grilla al encuadrarla con Inicio. */
const FRAME_FILL = 0.82;
/** Recorte de respaldo cuando no se pudo averiguar el tamano real de la imagen. */
const FALLBACK_SOURCE_RECT = { x: 0, y: 0, width: 16, height: 16 };

/**
 * Lo que el viewport recibe del editor.
 *
 * El viewport es la capa de ENTRADA: traduce punteros, rueda, arrastres y
 * drops a llamadas sobre los controladores de abajo. Por eso depende de varios
 * -- es su trabajo -- y ninguno depende de el. La direccion es una sola:
 *
 *   ViewportController  ->  EntityOps, Map, Palette, Selection, ...  ->  servicios
 *
 * "viewport" es el viewChild del <canvas>. Tiene que declararse en App: el
 * compilador de Angular solo reconoce las queries de senal en la clase del
 * componente. Llega aca como funcion para leerlo cuando haga falta.
 */
export interface ViewportDeps {
  viewport: () => ElementRef<HTMLCanvasElement> | undefined;
  note: (message: string) => void;
  markDirty: () => void;
  /** Seleccionar o agarrar algo trae al frente su inspector: lo decide App. */
  showObjectTab: () => void;
  palette: PaletteController;
  entityOps: EntityOpsController;
  map: MapController;
  sel: SelectionController;
  chars: CharactersController;
  tex: TexturesController;
}

/**
 * El viewport isometrico: la camara (zoom, pan, encuadre), los gestos sobre el
 * canvas (click, arrastre, Ctrl+arrastre, pintar figuras, menu contextual), lo
 * que se suelta encima (texturas, figuras, personajes, objetos), y el redibujo.
 *
 * El dibujo y la proyeccion estan en core/iso-canvas-renderer.ts, que no sabe
 * de Angular; esto es lo que lo conecta con el estado del editor. Los atajos de
 * teclado globales NO estan aca: Ctrl+S o Ctrl+N no son del viewport, y viven en
 * App con el resto de la superficie de comandos.
 */
export class ViewportController {
  private readonly levels = inject(LevelService);
  private readonly selection = inject(SelectionService);
  private readonly itemLibrary = inject(ItemLibraryService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly viewport: ViewportDeps['viewport'];
  private readonly note: ViewportDeps['note'];
  private readonly markDirty: ViewportDeps['markDirty'];
  private readonly showObjectTab: ViewportDeps['showObjectTab'];
  private readonly palette: PaletteController;
  private readonly entityOps: EntityOpsController;
  private readonly map: MapController;
  private readonly sel: SelectionController;
  private readonly chars: CharactersController;
  private readonly tex: TexturesController;

  private readonly entities = computed(() => this.levels.level().entities);
  private readonly grid = computed(() => this.levels.level().grid);

  /** Observa el contenedor del canvas para saber cuanto mide. Ver el constructor. */
  private observer?: ResizeObserver;

  constructor(deps: ViewportDeps) {
    this.viewport = deps.viewport;
    this.note = deps.note;
    this.markDirty = deps.markDirty;
    this.showObjectTab = deps.showObjectTab;
    this.palette = deps.palette;
    this.entityOps = deps.entityOps;
    this.map = deps.map;
    this.sel = deps.sel;
    this.chars = deps.chars;
    this.tex = deps.tex;

    // El canvas no tiene tamano propio: lo estira el layout de CSS. Para
    // dibujar hay que saber cuantos pixeles ocupa realmente, y eso solo se
    // sabe midiendo. Se observa el contenedor y no el canvas mismo para no
    // entrar en un bucle (dibujar cambia el tamano del canvas -> reobservar).
    effect(() => {
      const ref = this.viewport();
      // El effect se reevalua varias veces; el observer se instala una sola.
      // La guarda de "typeof ResizeObserver" es para los tests, igual que la
      // de "typeof Image" de abajo: jsdom no lo implementa, y sin observer el
      // canvas simplemente se queda en 0x0 y no se dibuja.
      if (!ref || this.observer || typeof ResizeObserver === 'undefined') {
        return;
      }
      const host = ref.nativeElement.parentElement;
      if (!host) {
        return;
      }
      this.observer = new ResizeObserver((entries) => {
        const rect = entries[0].contentRect;
        this.canvasSize.set({ w: Math.floor(rect.width), h: Math.floor(rect.height) });
      });
      this.observer.observe(host);
    });

    // Redibuja cuando cambia algo que se ve: nivel, zoom, pan, seleccion.
    // No hace falta enumerar de que depende: draw() lee los signals y Angular
    // registra solo esas dependencias. Tampoco hay bucle de render corriendo
    // al pedo -- se dibuja cuando algo cambio, y nada mas.
    effect(() => this.draw());

    // Decodifica el sheet de primitivas una sola vez. Al resolverse, el signal
    // dispara el effect() de arriba y el viewport se redibuja ya con los
    // sprites. La guarda de "typeof Image" es para los tests, que corren en
    // jsdom sin decodificador de imagenes.
    if (typeof Image !== 'undefined') {
      const sheet = new Image();
      sheet.onload = () => this.shapeSheet.set(sheet);
      sheet.src = SHAPE_SHEET_DATA_URL;
    }

    // El ResizeObserver sobrevive al componente si no se lo desconecta.
    this.destroyRef.onDestroy(() => this.observer?.disconnect());
  }

  /** Trazo en curso de figuras pintadas arrastrando (ver startShapeStroke). */
  private shapeStroke: { shape: ShapeId; start: GridCoord; last: GridCoord; placed: number } | null = null;

  readonly zoom = signal(3);

  readonly showGrid = signal(true);

  readonly showColliders = signal(true);

  /** Lineas de la grilla por encima de las entidades (como F1 en el runtime) o debajo. */
  readonly gridOnTop = signal(false);

  /** Desplazamiento de camara en pixeles de pantalla (boton medio o shift-arrastre). */
  readonly pan = signal({ x: 0, y: 0 });

  /** Celda bajo el cursor, para resaltarla. Null cuando el mouse sale del canvas. */
  readonly hovered = signal<GridCoord | null>(null);

  readonly zoomSteps = ZOOM_STEPS;

  /** Zoom en porcentaje para la barra de estado, como el de Blender. */
  readonly zoomLabel = computed(() => Math.round(this.zoom() * 100) + '%');

  /**
   * El sheet ya decodificado, listo para dibujar en el canvas. Es null hasta
   * que la imagen termina de cargar (unos milisegundos: son datos embebidos,
   * no una descarga), y por eso es un signal -- al resolverse dispara el
   * effect() que redibuja, sin necesidad de un bucle de render.
   */
  private readonly shapeSheet = signal<HTMLImageElement | null>(null);

  /** Tamano real del canvas en pixeles. Lo mantiene al dia el ResizeObserver. */
  private readonly canvasSize = signal({ w: 0, h: 0 });

  /**
   * Hay un arrastre de camara en curso. Es un signal y no un campo suelto
   * porque la plantilla lo lee para cambiar el cursor a "mano cerrada"; se
   * escribe dos veces por gesto (al apretar y al soltar), no en cada
   * movimiento, asi que no cuesta nada.
   */
  readonly panning = signal(false);

  /** Punto donde empezo el arrastre + pan que habia entonces, para calcular el delta. */
  private dragOrigin = { x: 0, y: 0, panX: 0, panY: 0 };

  /** Boton que inicio el gesto en curso, para saber al soltar que hacer con el. */
  private pressedButton: number | null = null;

  /**
   * Arrastre con Ctrl+clic en curso: la celda donde empezo, la posicion
   * original de cada entidad que se lleva, y el desplazamiento ya aplicado.
   */
  private moveDrag: {
    startCell: GridCoord;
    originals: Map<string, GridPosition>;
    delta: GridPosition;
  } | null = null;

  /** Hay entidades agarradas con Ctrl; la plantilla cambia el cursor a "mano cerrada". */
  readonly moving = signal(false);

  /**
   * Id de la entidad cuyo menu del clic derecho esta abierto. Null cuando no
   * hay ninguno. El menu va centrado en la ventana, asi que no guarda posicion.
   */
  readonly contextMenu = signal<string | null>(null);

  /** La entidad del menu abierto, resuelta; undefined si se borro mientras tanto. */
  readonly contextMenuEntity = computed(() => {
    const id = this.contextMenu();
    return id ? this.entities().find((entity) => entity.id === id) : undefined;
  });

  setZoom(step: number): void {
    this.zoom.set(this.clampZoom(step));
  }

  private clampZoom(value: number): number {
    return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
  }

  /**
   * Zoom con la rueda, anclado al cursor: el punto de la escena que esta bajo
   * el mouse se queda EXACTAMENTE donde esta, y todo lo demas se acerca o se
   * aleja alrededor de el. Es lo que hace Blender con "Zoom to Mouse Position"
   * y es la diferencia entre encuadrar de una o pelearse con el paneo despues
   * de cada muesca.
   *
   * La cuenta: si un punto del mundo esta en worldX = (mouseX - originX) / zoom,
   * para que no se mueva al pasar de "old" a "next" el origen tiene que
   * correrse worldX * (old - next). Como origin() es pan mas una constante,
   * ese mismo delta se le aplica al pan.
   */
  onWheel(event: WheelEvent): void {
    // Sin esto Electron desplaza el contenedor y el zoom se pierde.
    event.preventDefault();

    const ref = this.viewport();
    if (!ref) {
      return;
    }

    const old = this.zoom();
    const next = this.clampZoom(
      event.deltaY < 0 ? old * ZOOM_WHEEL_FACTOR : old / ZOOM_WHEEL_FACTOR,
    );
    // Ya estamos en un extremo del rango: no hay nada que recalcular.
    if (next === old) {
      return;
    }

    const rect = ref.nativeElement.getBoundingClientRect();
    const origin = this.origin();
    const worldX = (event.clientX - rect.left - origin.x) / old;
    const worldY = (event.clientY - rect.top - origin.y) / old;

    const pan = this.pan();
    this.pan.set({
      x: pan.x + worldX * (old - next),
      y: pan.y + worldY * (old - next),
    });
    this.zoom.set(next);
  }

  /**
   * Encuadra la grilla entera en el viewport, como el Inicio de Blender. Se
   * calcula el rectangulo que ocupa la grilla ya proyectada (incluyendo el alto
   * del rombo de la ultima fila) y se elige el zoom que lo hace entrar con
   * margen, dejandolo centrado.
   */
  frameAll(): void {
    const size = this.canvasSize();
    const grid = this.grid();
    if (size.w === 0 || size.h === 0) {
      return;
    }

    const halfW = grid.tileWidth / 2;
    const halfH = grid.tileHeight / 2;
    // Extremos de la proyeccion isometrica: la columna crece hacia la derecha y
    // la fila hacia la izquierda, asi que el ancho lo dan las dos esquinas
    // laterales y el alto va de la punta de (0,0) a la base de la ultima celda.
    const minX = -grid.height * halfW;
    const maxX = grid.width * halfW;
    const minY = 0;
    const maxY = (grid.width - 1 + grid.height - 1) * halfH + grid.tileHeight;

    const zoom = this.clampZoom(
      Math.min((size.w * FRAME_FILL) / (maxX - minX), (size.h * FRAME_FILL) / (maxY - minY)),
    );
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    // origin() = (w/2 + panX, VIEW_TOP_MARGIN + panY); se despeja el pan que
    // deja el centro de la grilla en el centro del canvas.
    this.zoom.set(zoom);
    this.pan.set({
      x: -centerX * zoom,
      y: size.h / 2 - VIEW_TOP_MARGIN - centerY * zoom,
    });
  }

  toggleGrid(): void {
    this.showGrid.update((value) => !value);
  }

  /** Elegir donde van las lineas es querer verlas: con la grilla oculta, se muestra. */
  setGridOnTop(onTop: boolean): void {
    this.gridOnTop.set(onTop);
    this.showGrid.set(true);
  }

  toggleColliders(): void {
    this.showColliders.update((value) => !value);
  }

  onPointerDown(event: PointerEvent): void {
    // Dos formas de desplazar la vista: boton medio (el de Blender) y boton
    // derecho (la mas comoda con mouse de dos botones o trackpad).
    //
    // Antes tambien paneaba el shift-arrastre. Se quito porque Shift pasa a ser
    // el modificador de seleccion multiple, que es lo que espera cualquiera que
    // venga de un editor grafico; los otros dos gestos siguen cubriendo el
    // paneo de sobra.
    if (event.button === 1 || event.button === 2) {
      this.panning.set(true);
      // Un click derecho puede terminar en dos cosas distintas segun si el
      // cursor se movio o no: arrastrar la camara, o abrir el menu de la
      // entidad. Se guarda el boton para decidirlo recien al soltar.
      this.pressedButton = event.button;
      this.contextMenu.set(null);
      const pan = this.pan();
      this.dragOrigin = { x: event.clientX, y: event.clientY, panX: pan.x, panY: pan.y };
      // Con captura, el arrastre sigue funcionando aunque el cursor se vaya
      // fuera del canvas; sin ella, el paneo se corta al pasar sobre un panel.
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }

    // Solo el boton izquierdo edita.
    if (event.button !== 0) {
      return;
    }
    // Cualquier click izquierdo cierra el menu abierto, como en cualquier
    // programa: el menu no debe sobrevivir a la siguiente accion.
    this.contextMenu.set(null);

    // Ctrl+clic sobre una entidad la agarra para moverla, sea cual sea la
    // herramienta activa: con "colocar" encendida, un clic normal crearia otra
    // entidad, y justo lo que se quiere es reacomodar la que ya esta. Sobre el
    // vacio no hace nada, para no colocar ni deseleccionar por accidente.
    if (event.ctrlKey) {
      const grabbed = this.entityAt(event);
      if (grabbed) {
        this.startMove(grabbed, event);
      }
      return;
    }

    const activeTool = this.palette.tool();
    if (activeTool === 'room') {
      this.map.roomToolDown(event, this.coordAt(event));
      return;
    }
    if (activeTool === 'tunnel') {
      this.map.tunnelToolClick(event, this.coordAt(event));
      return;
    }
    if (activeTool === 'place') {
      const character = this.palette.activeCharacter();
      const item = this.palette.activeItem();
      const shape = this.palette.activeShape();
      if (shape && (this.palette.paintShapes() || event.shiftKey)) {
        this.startShapeStroke(event, shape);
      } else if (character) {
        this.entityOps.placeCharacter(this.coordAt(event), character);
      } else if (item) {
        this.entityOps.placeItem(this.coordAt(event), item);
      } else {
        this.entityOps.placeEntity(this.coordAt(event));
      }
    } else if (activeTool === 'floor' || activeTool === 'wall') {
      const cell = this.coordAt(event);
      const grid = this.grid();
      if (!new IsoProjection(grid.tileWidth, grid.tileHeight).isValidCoord(cell, grid.width, grid.height)) {
        return;
      }
      this.levels.toggleTile(cell.col, cell.row, activeTool);
      this.markDirty();
    } else {
      // Shift suma a la seleccion en vez de reemplazarla; sin modificador,
      // clickear elige una sola y el vacio deselecciona todo. (Ctrl ya no suma
      // en el viewport: es el gesto de mover, ver arriba.)
      this.sel.selectEntity(this.entityAt(event), event.shiftKey);
    }
  }

  onPointerMove(event: PointerEvent): void {
    if (this.moveDrag) {
      this.updateMove(event);
      return;
    }
    if (this.shapeStroke) {
      this.continueShapeStroke(event);
      return;
    }
    if (this.map.roomDrag()) {
      this.map.roomToolMove(event, this.coordAt(event));
      return;
    }
    if (this.panning()) {
      this.pan.set({
        x: this.dragOrigin.panX + (event.clientX - this.dragOrigin.x),
        y: this.dragOrigin.panY + (event.clientY - this.dragOrigin.y),
      });
      return;
    }
    this.hovered.set(this.coordAt(event));
  }

  onPointerUp(event: PointerEvent): void {
    if (this.moveDrag) {
      this.finishMove(event);
      return;
    }
    if (this.shapeStroke) {
      this.finishShapeStroke(event);
      return;
    }
    if (this.map.roomDrag()) {
      this.map.roomToolUp(event, this.coordAt(event));
      return;
    }
    if (this.panning()) {
      this.panning.set(false);
      (event.target as HTMLElement).releasePointerCapture(event.pointerId);

      // Boton derecho SIN arrastre = click derecho: abre el menu de la entidad
      // que este debajo. El umbral es lo que separa las dos acciones; sin el,
      // el menu aparecería al final de cada paneo, que es exactamente lo que
      // arruina el gesto de arrastrar con el derecho.
      const moved =
        Math.abs(event.clientX - this.dragOrigin.x) +
        Math.abs(event.clientY - this.dragOrigin.y);
      if (this.pressedButton === 2 && moved <= CLICK_SLOP) {
        this.openContextMenu(event);
      }
    }
    this.pressedButton = null;
  }

  /**
   * Abre el menu contextual sobre la entidad que este bajo el cursor. Sobre
   * espacio vacio no abre nada: un menu sin destino solo estorba.
   */
  private openContextMenu(event: PointerEvent): void {
    const id = this.entityAt(event);
    if (!id) {
      this.contextMenu.set(null);
      // Sin entidad debajo, el clic derecho configura la parte del mapa que
      // haya ahi: la grilla si cae adentro de una, o el tunel que pasa por esa
      // celda. Es el "menu del tunel" que se abre donde se lo ve.
      const cell = this.coordAt(event);
      const room = roomAt(this.map.rooms(), cell);
      if (room) {
        this.map.editRoom(room.id);
        return;
      }
      const tunnel = tunnelAt(this.map.rooms(), this.map.tunnels(), cell);
      if (tunnel) {
        this.map.editTunnel(tunnel.id);
      }
      return;
    }
    this.sel.selectEntity(id);
    this.contextMenu.set(id);
  }

  closeContextMenu(): void {
    this.contextMenu.set(null);
  }

  // --- Mover con Ctrl+arrastrar ---------------------------------------------
  //
  // Ctrl+clic sobre una entidad la agarra y arrastrando se la lleva de celda
  // en celda. Si la agarrada ya estaba seleccionada junto con otras, se mueve
  // la seleccion entera, que es la operacion de grupo que uno espera. Al
  // soltar sobre celdas ocupadas se pregunta, igual que al colocar.

  private startMove(id: string, event: PointerEvent): void {
    if (!this.sel.isEntitySelected(id)) {
      this.selection.selectEntity(id);
    }
    this.showObjectTab();

    const originals = new Map<string, GridPosition>();
    for (const entity of this.entities()) {
      if (this.sel.isEntitySelected(entity.id)) {
        originals.set(entity.id, { ...entity.position });
      }
    }

    this.moveDrag = { startCell: this.coordAt(event), originals, delta: { col: 0, row: 0 } };
    this.moving.set(true);
    // Con captura, el arrastre sigue aunque el cursor pase sobre un panel.
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  private updateMove(event: PointerEvent): void {
    const drag = this.moveDrag;
    if (!drag) {
      return;
    }
    const cell = this.coordAt(event);
    this.hovered.set(cell);

    // El desplazamiento se limita para que NINGUN bloque del grupo se salga de
    // la grilla. Aplastar contra el borde solo a los que se salen deformaria el
    // grupo: dejaria de tener la forma con la que se lo agarro.
    const grid = this.grid();
    let col = cell.col - drag.startCell.col;
    let row = cell.row - drag.startCell.row;
    for (const [id, origin] of drag.originals) {
      const span = entitySpan(this.entities().find((entity) => entity.id === id) ?? {});
      col = Math.min(Math.max(col, -origin.col), grid.width - span - origin.col);
      row = Math.min(Math.max(row, -origin.row), grid.height - span - origin.row);
    }

    if (col === drag.delta.col && row === drag.delta.row) {
      return; // sigue en la misma celda: no hay nada que redibujar
    }
    drag.delta = { col, row };
    for (const [id, origin] of drag.originals) {
      this.levels.updateEntity(id, { position: { col: origin.col + col, row: origin.row + row } });
    }
  }

  private finishMove(event: PointerEvent): void {
    const drag = this.moveDrag;
    if (!drag) {
      return;
    }
    this.moveDrag = null;
    this.moving.set(false);
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);

    // Se solto donde se agarro: no hubo movimiento, y no hay nada que guardar.
    if (drag.delta.col === 0 && drag.delta.row === 0) {
      return;
    }

    const moved = new Set(drag.originals.keys());
    const movedEntities = this.entities().filter((entity) => moved.has(entity.id));
    const occupants = this.entities().filter(
      (other) => !moved.has(other.id) && movedEntities.some((entity) => blocksOverlap(entity, other)),
    );
    if (occupants.length > 0) {
      this.entityOps.pendingPlacement.set({
        kind: 'move',
        movedIds: [...moved],
        originals: drag.originals,
        occupants,
      });
      return;
    }

    this.markDirty();
    if (movedEntities.length === 1) {
      const { col, row } = movedEntities[0].position;
      this.note('"' + movedEntities[0].id + '" movida a ' + col + ',' + row + '.');
    } else {
      this.note(movedEntities.length + ' entidades movidas.');
    }
  }

  /**
   * El menu contextual del navegador se cancela SIEMPRE sobre el canvas: el
   * boton derecho ahi es desplazar la vista, y si el menu apareciera al soltar
   * cortaria el gesto justo al terminarlo.
   */
  onContextMenu(event: MouseEvent): void {
    event.preventDefault();
  }

  onPointerLeave(): void {
    this.hovered.set(null);
  }

  /**
   * Importa una carpeta de imagenes como texturas: las copia a assets/textures/
   * del proyecto AJUSTADAS a lo que el motor puede dibujar dentro de una celda
   * (ver core/texture-fit.ts) y las deja listas en Recursos.
   *
   * Se copian y no se referencian donde estaban porque el nivel guarda rutas
   * relativas a assets/: una textura de afuera saldria en negro al ejecutar.
   *
   * Ya no exige abrir un proyecto antes. Si falta, el proceso principal lo
   * deduce -- o lo pregunta en el mismo gesto -- y aca solo hay que ponerse al
   * dia con la raiz que devuelve.
   */
  private dropTexture(event: DragEvent, name: string): void {
    const asset = this.tex.textureAssets()[name];
    const sourceRect =
      asset && asset.width > 0
        ? { x: 0, y: 0, width: asset.width, height: asset.height }
        : { ...FALLBACK_SOURCE_RECT };

    const targetId = this.entityAt(event);
    if (targetId) {
      this.levels.updateEntity(targetId, { texture: 'textures/' + name, sourceRect });
      this.sel.selectEntity(targetId);
      this.markDirty();
      this.note('"' + targetId + '" ahora usa ' + name + '.');
      return;
    }

    const coord = this.coordAt(event);
    const grid = this.grid();
    if (!new IsoProjection(grid.tileWidth, grid.tileHeight).isValidCoord(coord, grid.width, grid.height)) {
      return;
    }
    this.entityOps.commitPlacement({
      id: this.entityOps.nextId('entidad'),
      type: 'prop',
      position: { col: coord.col, row: coord.row },
      // Prefijo "textures/": las rutas del nivel son relativas a assets/.
      texture: 'textures/' + name,
      sourceRect,
    });
  }

  // --- Pintar figuras arrastrando --------------------------------------------
  //
  // Con "Pintar figuras arrastrando" (panel Figuras) o con Shift, mantener el
  // clic y pasar por las casillas deja la figura elegida en cada una. Las
  // casillas ocupadas se SALTAN sin preguntar: el dialogo de celda ocupada en
  // medio de un trazo lo cortaria en cada casilla.

  private startShapeStroke(event: PointerEvent, shape: ShapeId): void {
    const cell = this.coordAt(event);
    this.shapeStroke = { shape, start: cell, last: cell, placed: 0 };
    // Con captura el trazo sigue aunque el cursor pase sobre un panel.
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
    this.paintShapeAt(cell);
  }

  private continueShapeStroke(event: PointerEvent): void {
    const stroke = this.shapeStroke;
    const cell = this.coordAt(event);
    this.hovered.set(cell);
    if (!stroke || (cell.col === stroke.last.col && cell.row === stroke.last.row)) {
      return;
    }
    // Un movimiento rapido salta casillas entre dos eventos: se recorre la
    // linea entera desde la ultima para no dejar huecos en el trazo.
    const from = stroke.last;
    const steps = Math.max(Math.abs(cell.col - from.col), Math.abs(cell.row - from.row));
    for (let step = 1; step <= steps; step++) {
      this.paintShapeAt({
        col: Math.round(from.col + ((cell.col - from.col) * step) / steps),
        row: Math.round(from.row + ((cell.row - from.row) * step) / steps),
      });
    }
    stroke.last = cell;
  }

  private finishShapeStroke(event: PointerEvent): void {
    const stroke = this.shapeStroke;
    this.shapeStroke = null;
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
    if (!stroke) {
      return;
    }
    const stayed = stroke.last.col === stroke.start.col && stroke.last.row === stroke.start.row;
    if (stayed && stroke.placed === 0) {
      // Un clic suelto sobre una casilla ocupada (o fuera de la grilla) no es
      // un trazo: se resuelve como siempre, con el dialogo o el aviso.
      this.entityOps.placeEntity(stroke.start, stroke.shape);
    } else if (stroke.placed > 1) {
      this.note(stroke.placed + ' figuras colocadas.');
    }
  }

  /** Coloca la figura del trazo si la casilla esta en la grilla y libre. */
  private paintShapeAt(cell: GridCoord): void {
    const def = this.shapeStroke ? shapeDef(this.shapeStroke.shape) : undefined;
    const grid = this.grid();
    if (!this.shapeStroke || !def || !new IsoProjection(grid.tileWidth, grid.tileHeight).isValidCoord(cell, grid.width, grid.height)) {
      return;
    }
    const entity = this.entityOps.shapeEntity(cell, def);
    if (this.entities().some((other) => blocksOverlap(other, entity))) {
      return;
    }
    this.entityOps.addPlaced(entity);
    this.shapeStroke.placed++;
  }

  // --- Arrastrar una primitiva al viewport ----------------------------------
  //
  // Se usa el drag & drop nativo del navegador y no un arrastre a mano con
  // pointer events: el nativo ya trae el fantasma del elemento pegado al
  // cursor, el cursor de "copiar" y la cancelacion con Escape, que es
  // exactamente lo que se espera de este gesto.

  onShapeDragStart(event: DragEvent, id: ShapeId): void {
    event.dataTransfer?.setData('text/honeycomb-shape', id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copy';
    }
  }

  /** Idem para los personajes (el id de un tipo base o de uno configurado), con su propio tipo de dato. */
  onCharacterDragStart(event: DragEvent, id: string): void {
    event.dataTransfer?.setData('text/honeycomb-character', id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copy';
    }
  }

  /**
   * Sin preventDefault() el canvas NO es un destino valido y el drop nunca
   * llega. De paso se resalta la celda de destino, para poder apuntar.
   */
  onCanvasDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'copy';
    }
    this.hovered.set(this.coordAt(event));
  }

  onCanvasDrop(event: DragEvent): void {
    event.preventDefault();

    const textureName = event.dataTransfer?.getData('text/honeycomb-texture');
    if (textureName) {
      this.dropTexture(event, textureName);
      return;
    }

    const characterId = event.dataTransfer?.getData('text/honeycomb-character');
    if (characterId && this.chars.allPresets().some((preset) => preset.id === characterId)) {
      this.entityOps.placeCharacter(this.coordAt(event), characterId);
      return;
    }

    const itemId = event.dataTransfer?.getData('text/honeycomb-item');
    if (itemId && this.itemLibrary.find(itemId)) {
      this.entityOps.placeItem(this.coordAt(event), itemId);
      return;
    }

    const id = event.dataTransfer?.getData('text/honeycomb-shape');
    // Puede caer aca cualquier cosa arrastrada desde fuera del editor.
    if (!id || !shapeDef(id)) {
      return;
    }
    this.entityOps.placeEntity(this.coordAt(event), id as ShapeId);
  }

  onCanvasDragLeave(): void {
    this.hovered.set(null);
  }

  private readonly renderer = new IsoCanvasRenderer();

  /**
   * Lo que el renderer mira para dibujar. Se le pasan los signals TAL CUAL, sin
   * copiar valores: se leen en el momento del dibujo, asi que esto no hay que
   * rearmarlo en cada frame. Va declarado aca abajo, y no arriba con el resto
   * del estado, porque los campos de clase se inicializan en orden y todos los
   * signals que nombra tienen que existir ya.
   */
  private readonly scene: CanvasScene = {
    size: () => this.canvasSize(),
    pan: () => this.pan(),
    zoom: () => this.zoom(),
    level: () => this.levels.level(),
    selectedId: () => this.selection.selectedEntityId(),
    selectedIds: () => this.sel.selectedSet(),
    hovered: () => this.hovered(),
    showGrid: () => this.showGrid(),
    gridOnTop: () => this.gridOnTop(),
    showColliders: () => this.showColliders(),
    roomDraft: () => this.map.roomDraft(),
    roomDrag: () => this.map.roomDrag(),
    tunnelTrace: () => this.map.tunnelTrace(),
    shapeSheet: () => this.shapeSheet(),
  };

  /** Punto del canvas donde cae la celda (0,0). */
  private origin(): CanvasPoint {
    return this.renderer.origin(this.canvasSize(), this.pan());
  }

  /** Celda de la grilla bajo el cursor. Puede quedar fuera de rango: quien llama valida. */
  private coordAt(event: MouseEvent): GridCoord {
    const ref = this.viewport();
    if (!ref) {
      return { col: 0, row: 0 };
    }
    return this.renderer.coordAt(event, ref.nativeElement.getBoundingClientRect(), this.scene);
  }

  /** Id de la entidad clickeada, o null si no hay ninguna. */
  private entityAt(event: MouseEvent): string | null {
    const ref = this.viewport();
    if (!ref) {
      return null;
    }
    return this.renderer.entityAt(event, ref.nativeElement.getBoundingClientRect(), this.scene);
  }

  /**
   * Redibuja el viewport entero. Lo dispara el effect() del constructor cada
   * vez que cambia algo que se ve; no hay bucle de animacion.
   */
  private draw(): void {
    const ref = this.viewport();
    if (!ref) {
      return;
    }
    this.renderer.draw(ref.nativeElement, this.scene);
  }
}
