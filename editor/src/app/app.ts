// =============================================================================
// HoneyComb Engine - Editor (componente raiz)
// =============================================================================
//
// El editor es, casi entero, un solo componente. Es una decision deliberada
// para el prototipo: la ventana es una unica pantalla con areas fijas
// (outliner, recursos, viewport, propiedades, eventos) que comparten el mismo
// nivel abierto, y partirla en componentes solo agregaria capas de
// @Input/@Output para pasar el mismo estado de un lado a otro.
//
// La excepcion son los DIALOGOS GRANDES (dialogs/): objetos y armas,
// personajes, convertidor, puzzle, grilla, tunel, pasar de nivel y la
// configuracion del juego. Son
// componentes aparte por PESO, no por estado: se cargan con @defer la primera
// vez que se abren, y uno que no se usa en la sesion no se carga nunca. El
// estado sigue siendo de App y de sus controladores; el dialogo solo tiene el
// markup (ver dialogs/dialog-base.ts). Por eso app.scss no esta encapsulado:
// es el tema de toda la ventana, dialogos incluidos.
//
// La ventana se arma como la de un motor de juegos: barra de herramientas
// arriba con Ejecutar al centro, la escena a la izquierda, el viewport al medio,
// el inspector a la derecha y un dock abajo con los recursos para colocar, los
// eventos, la consola y el visor de archivos. El viewport se navega con rueda
// (zoom al cursor), boton medio (desplazar) e Inicio (encuadrar). El tema visual
// vive entero en app.scss; los iconos, en ui/icon.ts.
//
// App es el SHELL: el estado que es de la ventana entera, la superficie de
// comandos (barra de menus y atajos) y el cableado. Lo demas vive afuera:
//
//   services/    el estado: el nivel abierto, la seleccion, el disco, el
//                catalogo de eventos, las bibliotecas del proyecto
//   core/        logica pura, sin Angular y con tests; core/iso-projection.ts
//                es el espejo de IsoGridSystem en C++, y su proyeccion tiene
//                que ser identica a la del runtime
//   */*.controller.ts  cada area del editor; su markup esta en app.html, o
//                en dialogs/ si es uno de los dialogos grandes
//
// Los controladores de la escena forman capas, y las dependencias van en un
// solo sentido -- de la entrada hacia el dominio, nunca al reves:
//
//   viewport/       camara, gestos sobre el canvas, drops, redibujo
//      |
//      v
//   entities/       colocar, celda ocupada, tamano, colision, pared, grupo
//   map/            salas, tuneles y zonas
//      |
//      v
//   selection/  palette/  inspector/      que esta elegido y como se edita
//
// Alrededor: project/ (el nivel como documento y el explorador de la carpeta
// del editor), game/ (la configuracion del juego: game.json), characters/, textures/ y combat/ (las bibliotecas del proyecto
// y sus ventanas; en textures/ tambien el convertidor de imagenes y las
// miniaturas bajo demanda), events/ (el panel Eventos y el dialogo de pasar de
// nivel), dialogs/ (el markup de los dialogos grandes), ui/ (paneles y el
// dialogo de pedir un nombre), sprites/ (la herramienta de sprites, que ocupa
// el area central en lugar del viewport cuando se la elige), debug/ (la pestaña
// JSON: el nivel en vivo, tal como se guarda).
//
// Deshacer y rehacer del nivel estan en services/level-history.service.ts:
// miran el nivel y anotan cada version, asi que ningun controlador los llama.
//
// Todo lo que toca el disco pasa por services/project.service.ts -> preload.js
// -> ipc/ (proceso principal), siempre dentro de la carpeta del editor (ver
// ipc/project-root.js).
//
// El dibujo y la proyeccion pantalla<->celda estan en core/iso-canvas-renderer.ts.
// =============================================================================

import {
  Component,
  ElementRef,
  ViewEncapsulation,
  computed,
  effect,
  forwardRef,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

import { CHARACTERS } from './core/characters';
import { CAMERA_CULL_MARGIN_MAX } from './core/camera';
import { CharacterPresetService } from './services/character-preset.service';
import type { ProjectNode } from './electron-api';
import { MenuBar, MenuDef, MenuLeaf } from './menu-bar/menu-bar';
import {
  SHAPES,
  SHAPE_SHEET_DATA_URL,
  SHAPE_SHEET_HEIGHT,
  SHAPE_SHEET_WIDTH,
  ShapeDef,
} from './core/iso-shapes';
import { EDITOR_HOST } from './dialogs/dialog-base';
import { RoomDialog } from './dialogs/room-dialog';
import { TunnelDialog } from './dialogs/tunnel-dialog';
import { CharactersDialog } from './dialogs/characters-dialog';
import { ItemEditorDialog } from './dialogs/item-editor-dialog';
import { TransitionDialog } from './dialogs/transition-dialog';
import { ConverterDialog } from './dialogs/converter-dialog';
import { PuzzleDialog } from './dialogs/puzzle-dialog';
import { GameConfigDialog } from './dialogs/game-config-dialog';
import { GameConfigController } from './game/game-config.controller';
import { GameConfigService } from './services/game-config.service';
import { CombatInspectorController } from './combat/combat-inspector.controller';
import { ItemEditorController } from './combat/item-editor.controller';
import { PuzzleController } from './combat/puzzle.controller';
import { ExplorerController } from './project/explorer.controller';
import { MapController } from './map/map.controller';
import { FloorController } from './map/floor.controller';
import { CharactersController } from './characters/characters.controller';
import { EventsController, StepKind } from './events/events.controller';
import { TexturesController } from './textures/textures.controller';
import { TextureThumbDirective } from './textures/texture-thumb.directive';
import { ImageConverterController } from './textures/image-converter.controller';
import { BackgroundPickerController } from './inspector/background-picker.controller';
import { PanelsController } from './ui/panels.controller';
import { NamePromptController } from './ui/name-prompt.controller';
import { Cell, Icon, IconSprite } from './ui/icon';
import type { IconName } from './ui/icons.generated';
import { entityKindStyle } from './core/entity-kinds';
import { CatalogService } from './services/catalog.service';
import { ItemLibraryService } from './services/item-library.service';
import { LevelService } from './services/level.service';
import { LevelHistoryService } from './services/level-history.service';
import { SelectionService } from './services/selection.service';
import { ProjectService } from './services/project.service';
import { JsonViewController } from './debug/json-view.controller';
import { SelectionController } from './selection/selection.controller';
import { PaletteController, Tool } from './palette/palette.controller';
import { InspectorController } from './inspector/inspector.controller';
import { EntityOpsController } from './entities/entity-ops.controller';
import { ViewportController } from './viewport/viewport.controller';
import { ProjectController } from './project/project.controller';
import { EngineController } from './project/engine.controller';
import { TransitionController } from './events/transition.controller';
import { ItemsPanelController } from './combat/items-panel.controller';
import { ThemeService } from './services/theme.service';
import { THEMES } from './core/themes';
import { SPRITE_TOOLS, SpriteEditorController } from './sprites/sprite-editor.controller';
import { SpriteEditor } from './sprites/sprite-editor';
import { textureName } from './core/sprite-style';
import { LevelEntity } from './models/level.model';

/**
 * Pestaña del dock de abajo, como el cajón de contenido de un motor: "layout"
 * son los recursos para colocar (figuras, personajes, objetos, texturas), y las
 * otras el editor de eventos, la consola, el visor de archivos y el JSON del
 * nivel en vivo. El nombre interno "layout" quedo de cuando esa pestaña dejaba
 * el viewport a todo alto.
 */
type Workspace = 'layout' | 'eventos' | 'salida' | 'archivo' | 'json';

/** Categoria del explorador de recursos del dock. */
type AssetTab = 'figuras' | 'personajes' | 'objetos' | 'texturas';

/**
 * Pestana del editor de propiedades (la columna de iconos a su izquierda, como
 * en Blender). "objeto" muestra la entidad seleccionada; "escena", el nivel y
 * su grilla. Antes las propiedades del nivel solo se veian deseleccionando
 * todo, que es justo lo que esta separacion evita.
 */
type InspectorTab = 'objeto' | 'escena';

/**
 * Que editor ocupa el area de arriba a la izquierda. Es el mismo mecanismo que
 * el selector de tipo de editor de Blender: el area no cambia de lugar ni de
 * tamano, cambia lo que muestra. "escena" es el outliner de entidades;
 * "proyecto", el organizador de archivos de la carpeta abierta.
 */
type LeftEditor = 'escena' | 'proyecto';

/**
 * Lo que muestra el area central: el viewport del nivel ("mapa") o la
 * herramienta de sprites. Es el mismo mecanismo que LeftEditor: el area no se
 * mueve, cambia lo que tiene adentro. Los costados y el dock siguen siendo los
 * del nivel.
 */
type CenterMode = 'mapa' | 'sprites';

// Umbral de la matriz de riesgos ("Degradacion de Rendimiento por Usuario"):
// el editor avisa antes de que la escena comprometa los FPS del runtime.
const ENTITY_WARN_THRESHOLD = 150;

/** Nombre de cada herramienta en el menu Editar > Herramienta. */
const TOOL_LABELS: Record<Tool, string> = {
  select: 'Seleccionar',
  marquee: 'Seleccionar área',
  place: 'Colocar entidad',
  floor: 'Alternar piso',
  wall: 'Alternar pared',
  room: 'Dibujar sala',
  tunnel: 'Trazar túnel',
};

/** Nombre de cada pestaña del dock, en el dock y en el menu Ver > Panel inferior. */
const WORKSPACE_LABELS: Record<Workspace, string> = {
  layout: 'Recursos',
  eventos: 'Eventos',
  salida: 'Consola',
  // No "Archivo": se confundia con el menu Archivo. Muestra el archivo elegido
  // en Proyecto, sin editarlo.
  archivo: 'Vista previa',
  // El nivel tal como se guarda, en vivo: para depurar (ver debug/json-view.controller.ts).
  json: 'JSON',
};

/**
 * Icono, atajo y explicacion de cada herramienta de la barra. Los atajos son
 * los numeros 1 a 7, en el mismo orden en que se ven: no chocan con ningun otro
 * atajo del editor (X borra, Shift+D duplica, los demas llevan Ctrl).
 */
const TOOL_BUTTONS: readonly { id: Tool; icon: IconName; key: string; hint: string }[] = [
  { id: 'select', icon: 'mouse-pointer-2', key: '1', hint: 'Seleccionar: clic para elegir, arrastrar para mover' },
  { id: 'marquee', icon: 'mouse-pointer-square-dashed', key: '2', hint: 'Seleccionar área: arrastra un rectángulo para elegir varios a la vez' },
  { id: 'place', icon: 'stamp', key: '3', hint: 'Colocar: pone lo elegido en Recursos (figura, personaje, objeto o textura)' },
  { id: 'floor', icon: 'grid-2x2', key: '4', hint: 'Piso: una celda sin suelo no se puede pisar' },
  { id: 'wall', icon: 'brick-wall', key: '5', hint: 'Pared: bloquea el paso en esa celda' },
  { id: 'room', icon: 'square-dashed', key: '6', hint: 'Sala: arrastra sobre el vacío para dibujar una nueva, o dentro de una para moverla' },
  { id: 'tunnel', icon: 'route', key: '7', hint: 'Túnel: trázalo a mano, de una sala a otra' },
];

/** Categorias del explorador de recursos, en el orden en que se usan al armar un nivel. */
const ASSET_TABS: readonly { id: AssetTab; label: string; icon: IconName }[] = [
  { id: 'figuras', label: 'Figuras', icon: 'cuboid' },
  { id: 'personajes', label: 'Personajes', icon: 'users' },
  { id: 'objetos', label: 'Objetos', icon: 'package' },
  { id: 'texturas', label: 'Texturas', icon: 'image' },
];

/** Pestañas del dock con su icono. */
const DOCK_TABS: readonly { id: Workspace; icon: IconName }[] = [
  { id: 'layout', icon: 'shapes' },
  { id: 'eventos', icon: 'zap' },
  { id: 'salida', icon: 'terminal' },
  { id: 'archivo', icon: 'file-text' },
  { id: 'json', icon: 'file-json' },
];

/** Cuanto mueve cada flecha del teclado, en celdas de la grilla. */
const ARROW_NUDGES: Record<string, { col: number; row: number }> = {
  ArrowRight: { col: 1, row: 0 },
  ArrowLeft: { col: -1, row: 0 },
  ArrowDown: { col: 0, row: 1 },
  ArrowUp: { col: 0, row: -1 },
};

@Component({
  selector: 'app-root',
  // Los dialogos de dialogs/ solo se usan dentro de @defer en app.html: el
  // compilador los saca del bundle principal y los carga aparte.
  imports: [
    MenuBar,
    NgTemplateOutlet,
    Icon,
    Cell,
    IconSprite,
    TextureThumbDirective,
    RoomDialog,
    TunnelDialog,
    CharactersDialog,
    ItemEditorDialog,
    TransitionDialog,
    ConverterDialog,
    PuzzleDialog,
    GameConfigDialog,
    SpriteEditor,
  ],
  // Los dialogos llegan a App por este token (ver dialogs/dialog-base.ts).
  providers: [{ provide: EDITOR_HOST, useExisting: forwardRef(() => App) }],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  // Sin encapsular: app.scss es el tema de TODO el editor, y los dialogos de
  // dialogs/ son componentes aparte. Encapsulado, Angular le agregaba a cada
  // regla un atributo propio de App, y nada de lo que dibuja otro componente
  // las recibia. App es la raiz, asi que sus estilos ya eran de toda la
  // ventana; ahora tambien en el DOM (ver la cabecera de app.scss).
  encapsulation: ViewEncapsulation.None,
  // Los atajos se escuchan en window y no en el canvas: en Blender funcionan
  // con el puntero sobre cualquier editor, no solo sobre el viewport, y ademas
  // el canvas no tiene foco propio (habria que darle tabindex y pedirlo a mano).
  // El tema va como atributo en app-root: app.scss redefine los colores por
  // [data-theme], y los dialogos, que se dibujan adentro, lo heredan.
  host: {
    '(window:keydown)': 'onKeyDown($event)',
    '(window:beforeunload)': 'onBeforeUnload($event)',
    '[attr.data-theme]': 'theme.theme()',
  },
})
export class App {
  // --- Servicios ------------------------------------------------------------

  readonly project = inject(ProjectService);
  readonly theme = inject(ThemeService);

  readonly levels = inject(LevelService);

  readonly selection = inject(SelectionService);

  readonly catalog = inject(CatalogService);

  readonly presetsService = inject(CharacterPresetService);

  readonly itemLibrary = inject(ItemLibraryService);

  /** Deshacer y rehacer del nivel. Ver services/level-history.service.ts. */
  readonly history = inject(LevelHistoryService);

  /** La configuracion del juego (game.json): las variables, para los eventos. */
  readonly gameConfig = inject(GameConfigService);

  // --- Estado del shell -----------------------------------------------------
  //
  // Lo que es del editor entero y no de un area: la barra de estado, la marca de
  // cambios sin guardar, que workspace y que pestana del inspector estan al
  // frente. Lo leen casi todos los controladores, por eso vive aca.

  /** preload.js solo existe bajo Electron; con "ng serve" la UI corre sin acceso a disco. */
  readonly hasFileSystem = typeof window !== 'undefined' && 'honeycombProject' in window;

  /** preload.js expone el control de la ventana solo bajo Electron. */
  readonly hasWindowApi = typeof window !== 'undefined' && 'honeycombWindow' in window;

  readonly status = signal('Listo. Abre una carpeta de proyecto, o crea un nivel y usa Guardar como.');

  /** Hay cambios sin guardar. Lo enciende cualquier edicion; solo save() lo apaga. */
  readonly dirty = signal(false);

  readonly log = signal<string[]>([]);

  readonly workspace = signal<Workspace>('layout');

  readonly assetTab = signal<AssetTab>('figuras');

  readonly inspectorTab = signal<InspectorTab>('objeto');

  readonly leftEditor = signal<LeftEditor>('escena');

  readonly centerMode = signal<CenterMode>('mapa');

  // --- El canvas ------------------------------------------------------------
  //
  // El viewChild tiene que declararse en el componente: el compilador de Angular
  // solo reconoce las queries de senal aca. El viewport lo recibe como funcion.

  private readonly viewport = viewChild<ElementRef<HTMLCanvasElement>>('viewport');

  // --- Vistas derivadas del nivel abierto -----------------------------------

  // computed() y no getters: asi Angular sabe exactamente de que dependen y
  // solo recalcula (y redibuja el canvas) cuando eso cambia de verdad.
  readonly entities = computed(() => this.levels.level().entities);

  /** Consulta rapida para el outliner y el canvas, que preguntan una vez por entidad. */
  readonly entityIds = computed(() => this.entities().map((entity) => entity.id));

  readonly grid = computed(() => this.levels.level().grid);

  /** El objeto ACTIVO: el ultimo seleccionado, el unico que muestra el inspector. */
  readonly selected = this.levels.selectedEntity;

  /** Todos los seleccionados. Sobre estos actuan las operaciones de grupo. */
  readonly selectedIds = this.selection.selectedEntityIds;

  readonly selectionCount = computed(() => this.selectedIds().length);

  readonly tileEditCount = computed(() => this.levels.level().tileEdits?.length ?? 0);

  readonly overBudget = computed(() => this.entities().length > ENTITY_WARN_THRESHOLD);

  // --- Controladores --------------------------------------------------------
  //
  // Cada area del editor vive en su controlador (ver la cabecera del archivo).
  // El ORDEN de declaracion importa: los campos se inicializan en orden, y los
  // que reciben otros controladores ya construidos -- view, proj -- van despues
  // de ellos. Si se rompe, TypeScript lo marca (TS2729).

  /**
   * La disposicion de la ventana: anchos, paneles escondidos y paneles
   * plegados. Ver ui/panels.controller.ts. La plantilla lo usa directamente
   * como "panels.X"; aca solo se lo toca desde las acciones que llevan a un
   * panel concreto.
   */
  readonly panels: PanelsController = new PanelsController();

  /** El dialogo de "escribi un nombre" (Guardar como, Nueva carpeta). Ver ui/name-prompt.controller.ts. */
  readonly prompt: NamePromptController = new NamePromptController();

  /**
   * El explorador de archivos del proyecto. Ver project/explorer.controller.ts.
   * Lo que no decide el (abrir un nivel, elegir una textura) se le pasa por
   * constructor, porque toca partes del editor que el explorador no conoce.
   */
  readonly explorer: ExplorerController = new ExplorerController(
    (message) => this.note(message),
    (error) => this.describe(error),
    (node) => this.openProjectLevel(node),
    (name) => this.palette.selectTexture(name),
    () => this.showDock('archivo'),
    (request) => this.prompt.ask(request),
  );

  readonly chars: CharactersController = new CharactersController(
    (message) => this.note(message),
    (error) => this.describe(error),
    () => this.proj.refreshProject(),
    () => this.tex.textureAssets(),
    this.hasFileSystem,
  );

  /** El selector de color del fondo. Ver inspector/background-picker.controller.ts. */
  /** La biblioteca de texturas del proyecto. Ver textures/textures.controller.ts. */
  readonly tex: TexturesController = new TexturesController(
    (path) => this.explorer.reloadDir(path),
    () => this.showAssets('texturas'),
  );

  /** Herramientas > Convertidor de imagenes. Ver textures/image-converter.controller.ts. */
  readonly converter: ImageConverterController = new ImageConverterController({
    note: (message) => this.note(message),
    describe: (error) => this.describe(error),
    refreshProject: () => this.proj.refreshProject(),
    reloadLibrary: () => this.tex.reloadLibrary(),
    tileWidth: () => this.grid().tileWidth,
    hasFileSystem: this.hasFileSystem,
  });

  /**
   * Herramientas > Herramienta de sprites: pixel art con capas y cuadros en el
   * area central. Ver sprites/sprite-editor.controller.ts.
   */
  readonly sprite: SpriteEditorController = new SpriteEditorController({
    note: (message) => this.note(message),
    describe: (error) => this.describe(error),
    ask: (request) => this.prompt.ask(request),
    // Sin desplegar Recursos: le quitaria alto al lienzo, y el mensaje ya dice donde quedo.
    reloadLibrary: () => this.tex.reloadLibrary(false),
    invalidateTextures: () => this.tex.invalidate(),
    tile: () => ({ width: this.grid().tileWidth, height: this.grid().tileHeight }),
    hasFileSystem: this.hasFileSystem,
  });

  /** Como se muestran los objetos. Ver combat/items-panel.controller.ts. */
  readonly items: ItemsPanelController = new ItemsPanelController(
    () => this.tex.textureAssets(),
    () => this.combat.options(),
    // Con el tamano real aunque la miniatura todavia no hubiera cargado: las
    // texturas se cargan bajo demanda (ver TexturesController).
    (name, asset) =>
      asset
        ? this.itemEditor.setTexture(name, asset)
        : void this.tex.ensureAsset(name).then((loaded) => this.itemEditor.setTexture(name, loaded ?? undefined)),
  );

  readonly itemEditor: ItemEditorController = new ItemEditorController(
    (message) => this.note(message),
    () => this.dirty.set(true),
  );

  /** Los gestos de seleccion. Ver selection/selection.controller.ts. */
  readonly sel: SelectionController = new SelectionController(() => this.inspectorTab.set('objeto'));

  /** Herramienta activa y que se va a colocar. Ver palette/palette.controller.ts. */
  readonly palette: PaletteController = new PaletteController(
    (message) => this.note(message),
    (id) => this.chars.allPresets().find((preset) => preset.id === id),
    (kind) => this.chars.kindHint(kind),
    () => this.map.tunnelTrace.set(null),
  );

  /** Los formularios del inspector. Ver inspector/inspector.controller.ts. */
  readonly inspector: InspectorController = new InspectorController(
    () => this.dirty.set(true),
    (message) => this.note(message),
    (texture) => this.tex.textureAssets()[textureName(texture)] ?? null,
  );

  /** El selector de imagen de Apariencia, desplegado o no. */
  readonly texturePickerOpen = signal(false);

  /** El selector de color de fondo completo (cuadro, tono y RGB), desplegado o no. */
  readonly colorPickerOpen = signal(false);

  /**
   * Cambia de pestaña en el inspector y vuelve arriba: las dos comparten el
   * mismo contenedor, y sin esto la otra se abria a la altura del scroll de la
   * anterior, con su primer panel fuera de la vista.
   */
  showInspectorTab(tab: InspectorTab, body: HTMLElement): void {
    this.inspectorTab.set(tab);
    body.scrollTop = 0;
  }

  /** Flechas izquierda y derecha entre las dos pestañas del inspector, como en cualquier lista de pestañas. */
  onInspectorTabsKey(event: KeyboardEvent, body: HTMLElement): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    const next: InspectorTab = this.inspectorTab() === 'objeto' ? 'escena' : 'objeto';
    this.showInspectorTab(next, body);
    document.getElementById('inspector-tab-' + next)?.focus();
  }

  /**
   * true si la entidad apunta a una imagen que no esta en assets/textures/.
   * Solo con el proyecto en disco: en el navegador no hay biblioteca que mirar.
   */
  textureMissing(entity: LevelEntity): boolean {
    if (!this.hasFileSystem || this.inspector.usesShapeSheet(entity)) {
      return false;
    }
    const name = textureName(entity.texture);
    return !name || !this.tex.textures().includes(name);
  }

  /** Nombre de archivo de la imagen de una entidad, sin la carpeta. */
  textureLabel(entity: LevelEntity): string {
    return textureName(entity.texture) || 'sin imagen';
  }

  readonly bg: BackgroundPickerController = new BackgroundPickerController(() => this.dirty.set(true));

  /**
   * Todo lo que modifica entidades: colocar, celda ocupada, tamano, colision,
   * pared y operaciones de grupo. Ver entities/entity-ops.controller.ts.
   */
  readonly entityOps: EntityOpsController = new EntityOpsController({
    note: (message) => this.note(message),
    markDirty: () => this.dirty.set(true),
    selectEntity: (id) => this.sel.selectEntity(id),
    findPreset: (id) => this.chars.allPresets().find((preset) => preset.id === id),
    activeShape: () => this.palette.activeShape(),
    activeTexture: () => this.palette.activeTexture(),
  });

  /**
   * Salas y tuneles del mapa. Ver map/map.controller.ts. Las herramientas
   * reciben la celda ya proyectada porque el controlador no sabe de canvas.
   */
  readonly map: MapController = new MapController(
    (message) => this.note(message),
    () => this.dirty.set(true),
    () => this.view.frameAll(),
    (tool) => this.palette.tool.set(tool),
    (cell) => this.view.hovered.set(cell),
    () => this.showGridProperties(),
  );

  /**
   * La textura del piso: todo el nivel, una sala o tunel, o casilla por
   * casilla, desde Recursos › Texturas. Ver map/floor.controller.ts.
   */
  readonly floor: FloorController = new FloorController({
    note: (message) => this.note(message),
    markDirty: () => this.dirty.set(true),
    palette: this.palette,
    tex: this.tex,
  });

  /**
   * El viewport: camara, gestos sobre el canvas, drops y redibujo. Ver
   * viewport/viewport.controller.ts. Va despues de los controladores que usa
   * porque los recibe ya construidos.
   */
  readonly view: ViewportController = new ViewportController({
    viewport: () => this.viewport(),
    note: (message) => this.note(message),
    markDirty: () => this.dirty.set(true),
    showObjectTab: () => this.inspectorTab.set('objeto'),
    palette: this.palette,
    entityOps: this.entityOps,
    map: this.map,
    sel: this.sel,
    chars: this.chars,
    tex: this.tex,
    floor: this.floor,
  });

  readonly ev: EventsController = new EventsController(
    (message) => this.note(message),
    () => this.dirty.set(true),
    (itemId) => this.combat.use(itemId),
  );

  /** El dialogo "Pasar a otro nivel". Ver events/transition.controller.ts. */
  readonly transition: TransitionController = new TransitionController(
    (message) => this.note(message),
    () => this.dirty.set(true),
    () => this.proj.levelFiles(),
    () => this.showDock('eventos'),
  );

  readonly combat: CombatInspectorController = new CombatInspectorController(() => this.dirty.set(true));

  readonly puzzle: PuzzleController = new PuzzleController(
    (message) => this.note(message),
    () => this.dirty.set(true),
    () => this.showDock('eventos'),
  );

  /**
   * Con que motor se ejecuta: Debug (desarrollo, con F3) o Release
   * (optimizado). Ver project/engine.controller.ts.
   */
  readonly engine: EngineController = new EngineController({
    note: (message) => this.note(message),
    status: (message) => this.status.set(message),
    log: (line) => this.log.update((entries) => [...entries.slice(-200), line]),
    hasFileSystem: this.hasFileSystem,
  });

  /**
   * El nivel como documento: abrir, crear, guardar, ejecutar. Ver
   * project/project.controller.ts.
   */
  readonly proj: ProjectController = new ProjectController({
    note: (message) => this.note(message),
    describe: (error) => this.describe(error),
    dirty: this.dirty,
    hasFileSystem: this.hasFileSystem,
    explorer: this.explorer,
    tex: this.tex,
    view: this.view,
    ev: this.ev,
    prompt: this.prompt,
    engine: this.engine,
  });

  /**
   * Archivo › Configuración del juego…: ventana, portada, pantallas, HUD y
   * variables de la partida, en game.json. Ver game/game-config.controller.ts.
   */
  readonly game: GameConfigController = new GameConfigController({
    note: (message) => this.note(message),
    describe: (error) => this.describe(error),
    hasFileSystem: this.hasFileSystem,
    levelFiles: () => this.proj.levelFiles(),
    textureAssets: () => this.tex.textureAssets(),
    ask: (request) => this.prompt.ask(request),
  });

  /** La pestaña JSON del panel de abajo. Ver debug/json-view.controller.ts. */
  readonly json: JsonViewController = new JsonViewController((message) => this.note(message));

  constructor() {
    // La carpeta del editor se abre sola al arrancar: ya no hay que elegir
    // ninguna (ver ipc/project-root.js).
    void this.proj.openWorkspace();
    // Para marcar en la barra el motor que todavia no esta compilado.
    void this.engine.refresh();

    // Sin cambios pendientes = el nivel de ahora es el del disco (se guardo o
    // se abrio). El historial lo recuerda para que deshacer hasta ahi apague
    // el aviso de "Sin guardar".
    effect(() => {
      if (!this.dirty()) {
        untracked(() => this.history.markClean());
      }
    });
  }

  // --- Deshacer y rehacer -----------------------------------------------------
  //
  // Los mismos botones, menu y atajos para las dos areas centrales: en Sprites
  // deshacen el dibujo, en el mapa el nivel.

  readonly canUndo = computed(() => (this.centerMode() === 'sprites' ? this.sprite.canUndo() : this.history.canUndo()));

  readonly canRedo = computed(() => (this.centerMode() === 'sprites' ? this.sprite.canRedo() : this.history.canRedo()));

  /** "Deshacer: mover player_1", para el boton y el menu Editar. */
  readonly undoText = computed(() => {
    const label = this.centerMode() === 'mapa' ? this.history.undoLabel() : '';
    return 'Deshacer' + (label ? ': ' + label : '');
  });

  readonly redoText = computed(() => {
    const label = this.centerMode() === 'mapa' ? this.history.redoLabel() : '';
    return 'Rehacer' + (label ? ': ' + label : '');
  });

  undo(): void {
    if (this.centerMode() === 'sprites') {
      this.sprite.undo();
      return;
    }
    const label = this.history.undo();
    if (label === null) {
      this.note('No hay nada que deshacer.');
      return;
    }
    this.dirty.set(!this.history.isClean());
    this.note('Deshecho: ' + label + '.');
  }

  redo(): void {
    if (this.centerMode() === 'sprites') {
      this.sprite.redo();
      return;
    }
    const label = this.history.redo();
    if (label === null) {
      this.note('No hay nada que rehacer.');
      return;
    }
    this.dirty.set(!this.history.isClean());
    this.note('Rehecho: ' + label + '.');
  }

  // --- Datos para la plantilla ----------------------------------------------
  //
  // Constantes y estilos que la plantilla necesita tal cual.

  readonly shapes = SHAPES;

  /** Los materiales de las figuras, en el orden del sheet: piedra (las de siempre) primero. */
  readonly shapeMaterials = [...new Map(SHAPES.map((shape) => [shape.material, shape.materialLabel])).entries()].map(
    ([id, label]) => ({ id, label }),
  );

  /** Material elegido en Recursos › Figuras: la paleta muestra solo esas. */
  readonly shapeMaterial = signal<string>('stone');

  readonly visibleShapes = computed(() => SHAPES.filter((shape) => shape.material === this.shapeMaterial()));

  readonly characters = CHARACTERS;

  readonly toolButtons = TOOL_BUTTONS;

  readonly toolLabels = TOOL_LABELS;

  readonly spriteTools = SPRITE_TOOLS;

  readonly assetTabs = ASSET_TABS;

  readonly dockTabs = DOCK_TABS;

  /** Tope del campo "Casillas de margen" de Nivel › Avanzado. */
  readonly cullMarginMax = CAMERA_CULL_MARGIN_MAX;

  readonly workspaceLabels = WORKSPACE_LABELS;

  /** Nombre, icono y color del tipo de una entidad (ver core/entity-kinds.ts). */
  readonly kindOf = entityKindStyle;

  /** Cuantas cosas hay en cada categoria de recursos, para su contador. */
  assetCount(tab: AssetTab): number {
    switch (tab) {
      case 'figuras':
        return this.shapes.length;
      case 'personajes':
        return this.chars.allPresets().length;
      case 'objetos':
        return this.itemLibrary.items().length;
      case 'texturas':
        return this.tex.textures().length;
    }
  }

  /**
   * Estilo de una miniatura de la paleta: recorta la celda de la figura del
   * sheet embebido y la escala a la mitad.
   *
   * Es un recorte del sheet real y no un icono aparte, para que la paleta no
   * pueda mostrar una cosa y el viewport otra. La escala 0.5 es exacta (mitad
   * justa de cada pixel), asi que con image-rendering: pixelated se ve nitida.
   */
  thumbStyle(shape: ShapeDef): Record<string, string> {
    const scale = 0.5;
    return {
      'background-image': `url(${SHAPE_SHEET_DATA_URL})`,
      'background-size': `${SHAPE_SHEET_WIDTH * scale}px ${SHAPE_SHEET_HEIGHT * scale}px`,
      'background-position': `${-shape.sourceRect.x * scale}px ${-shape.sourceRect.y * scale}px`,
      width: `${shape.sourceRect.width * scale}px`,
      height: `${shape.sourceRect.height * scale}px`,
    };
  }

  // --- Barra de menus -------------------------------------------------------
  //
  // Toda la barra se describe aca como dato; el componente MenuBar solo la
  // dibuja. Es un computed y no un arreglo fijo porque tiene partes vivas: las
  // marcas (barra lateral, grilla, herramienta), las opciones que se apagan sin
  // seleccion, y la lista de niveles del proyecto.
  //
  // Es, junto con los atajos de teclado, la superficie de comandos del editor: su
  // trabajo es referenciar a todos los demas, y por eso vive en App. "Generar"
  // (generacion procedural con semilla) todavia se muestra como "Proximamente":
  // se ve lo que va a haber y donde, sin opciones que parezcan andar y no hagan
  // nada.

  readonly menus = computed<MenuDef[]>(() => {
    const separator: MenuLeaf = { kind: 'separator' };
    const nothingSelected = this.selectionCount() === 0;

    return [
      {
        id: 'archivo',
        label: 'Archivo',
        items: [
          { kind: 'action', label: 'Nuevo nivel…', shortcut: 'Ctrl+N', run: () => this.proj.newLevel() },
          { kind: 'action', label: 'Abrir nivel…', shortcut: 'Ctrl+O', run: () => void this.proj.openLevelFile() },
          {
            kind: 'submenu',
            label: 'Abrir nivel del proyecto',
            emptyLabel: 'Sin proyecto abierto, o sin niveles en levels/',
            items: this.proj.levelFiles().map((file) => ({
              kind: 'action' as const,
              label: file,
              checked: this.levels.fileName() === file,
              run: () => void this.proj.loadLevel(file),
            })),
          },
          separator,
          { kind: 'action', label: 'Configuración del juego…', run: () => void this.game.open() },
          { kind: 'action', label: 'Exportar juego…', run: () => void this.proj.exportGame() },
          separator,
          { kind: 'action', label: 'Mostrar carpeta del editor', run: () => void this.proj.revealWorkspace() },
          { kind: 'action', label: 'Cambiar carpeta del editor…', run: () => void this.proj.changeWorkspace() },
          separator,
          {
            kind: 'action',
            // El punto es el aviso de cambios sin guardar, que antes iba en el
            // boton "Guardar *" del topbar.
            label: this.dirty() ? 'Guardar  ●' : 'Guardar',
            shortcut: 'Ctrl+S',
            run: () => void this.proj.save(),
          },
          { kind: 'action', label: 'Guardar como…', shortcut: 'Ctrl+Shift+S', run: () => void this.proj.saveAs() },
          separator,
          {
            kind: 'action',
            label: 'Importar imágenes…',
            disabled: this.converter.busy(),
            run: () => void this.converter.openAndAdd('files'),
          },
          separator,
          { kind: 'action', label: 'Salir', run: () => window.close() },
        ],
      },
      {
        id: 'editar',
        label: 'Editar',
        items: [
          {
            kind: 'action',
            label: this.undoText(),
            shortcut: 'Ctrl+Z',
            disabled: !this.canUndo(),
            run: () => this.undo(),
          },
          {
            kind: 'action',
            label: this.redoText(),
            shortcut: 'Ctrl+Y',
            disabled: !this.canRedo(),
            run: () => this.redo(),
          },
          separator,
          { kind: 'action', label: 'Duplicar', shortcut: 'Shift+D', disabled: nothingSelected, run: () => this.entityOps.duplicateSelected() },
          { kind: 'action', label: 'Eliminar', shortcut: 'X', disabled: nothingSelected, run: () => this.entityOps.deleteSelected() },
          separator,
          {
            kind: 'action',
            label: 'Seleccionar todo',
            shortcut: 'Ctrl+A',
            disabled: this.entities().length === 0,
            run: () => this.sel.selectAllEntities(),
          },
          { kind: 'action', label: 'Deseleccionar', disabled: nothingSelected, run: () => this.sel.selectEntity(null) },
          separator,
          {
            kind: 'submenu',
            label: 'Herramienta',
            emptyLabel: '',
            items: TOOL_BUTTONS.map((tool) => ({
              kind: 'action' as const,
              label: TOOL_LABELS[tool.id],
              shortcut: tool.key,
              checked: this.palette.tool() === tool.id,
              run: () => this.palette.setTool(tool.id),
            })),
          },
        ],
      },
      {
        id: 'ver',
        label: 'Ver',
        items: [
          { kind: 'action', label: 'Escena', shortcut: 'Ctrl+B', checked: this.panels.sidebarVisible(), run: () => this.panels.toggleSidebar() },
          { kind: 'action', label: 'Inspector', checked: this.panels.inspectorVisible(), run: () => this.panels.toggleInspector() },
          { kind: 'action', label: 'Panel inferior', shortcut: 'Ctrl+J', checked: this.panels.dockOpen(), run: () => this.panels.toggleDock() },
          {
            kind: 'submenu',
            label: 'Pestaña del panel inferior',
            emptyLabel: '',
            items: DOCK_TABS.map(({ id: workspace }) => ({
              kind: 'action' as const,
              label: WORKSPACE_LABELS[workspace],
              checked: this.workspace() === workspace,
              run: () => this.showDock(workspace),
            })),
          },
          separator,
          { kind: 'action', label: 'Grilla', checked: this.view.showGrid(), run: () => this.view.toggleGrid() },
          { kind: 'action', label: 'Colisiones', checked: this.view.showColliders(), run: () => this.view.toggleColliders() },
          { kind: 'action', label: 'Encuadrar todo', shortcut: 'Inicio', run: () => this.view.frameAll() },
          separator,
          {
            kind: 'submenu',
            label: 'Tema',
            emptyLabel: '',
            items: THEMES.map((theme) => ({
              kind: 'action' as const,
              label: theme.label,
              checked: this.theme.theme() === theme.id,
              run: () => this.theme.set(theme.id),
            })),
          },
          separator,
          { kind: 'action', label: 'Recargar ventana', shortcut: 'Ctrl+R', run: () => this.reloadWindow() },
          {
            kind: 'action',
            label: 'Herramientas de desarrollo',
            shortcut: 'Ctrl+Shift+I',
            disabled: !this.hasWindowApi,
            run: () => this.toggleDevTools(),
          },
        ],
      },
      {
        id: 'personajes',
        label: 'Personajes',
        items: [
          { kind: 'action', label: 'Configurar personajes…', run: () => this.chars.openCharacterEditor() },
          separator,
          ...CHARACTERS.map((def) => ({
            kind: 'action' as const,
            label: 'Nuevo ' + def.label.toLowerCase() + '…',
            run: () => this.chars.openCharacterEditor(def.id),
          })),
          separator,
          {
            kind: 'submenu',
            label: 'Editar un personaje guardado',
            emptyLabel: 'Todavía no hay personajes guardados',
            items: this.presetsService.presets().map((preset) => ({
              kind: 'action' as const,
              label: preset.name + '  ·  ' + this.chars.kindLabel(preset.kind),
              run: () => this.chars.editCharacterPreset(preset.id),
            })),
          },
        ],
      },
      {
        id: 'combate',
        label: 'Combate',
        items: [
          { kind: 'action', label: 'Objetos y armas…', run: () => this.itemEditor.open() },
          separator,
          {
            kind: 'action',
            label: 'Nueva arma cuerpo a cuerpo…',
            run: () => this.itemEditor.open({ kind: 'weapon', category: 'melee' }),
          },
          {
            kind: 'action',
            label: 'Nueva arma a distancia…',
            run: () => this.itemEditor.open({ kind: 'weapon', category: 'ranged' }),
          },
          { kind: 'action', label: 'Nueva curación…', run: () => this.itemEditor.open({ kind: 'healing' }) },
          { kind: 'action', label: 'Nueva moneda…', run: () => this.itemEditor.open({ kind: 'coin' }) },
          {
            kind: 'submenu',
            label: 'Editar un objeto guardado',
            emptyLabel: 'Todavía no hay objetos en items.json',
            items: this.itemLibrary.items().map((item) => ({
              kind: 'action' as const,
              label: item.name + '  ·  ' + this.items.itemKindLabel(item),
              run: () => this.itemEditor.open({ editId: item.id }),
            })),
          },
          separator,
          { kind: 'action', label: 'Puzzle de sala…', run: () => this.puzzle.open() },
          { kind: 'action', label: 'Agregar zona de puzzle', run: () => this.map.addZone() },
          { kind: 'action', label: 'Ver eventos del nivel', run: () => this.showDock('eventos') },
        ],
      },
      {
        id: 'mapa',
        label: 'Mapa',
        items: [
          { kind: 'action', label: 'Agregar sala al mapa…', run: () => this.map.openRoomDialog() },
          {
            kind: 'action',
            label: 'Dibujar sala en el viewport',
            checked: this.palette.tool() === 'room',
            run: () => this.palette.setTool('room'),
          },
          separator,
          {
            kind: 'action',
            label: 'Conectar salas con un túnel…',
            disabled: this.map.rooms().length < 2,
            run: () => this.map.openTunnelDialog(),
          },
          {
            kind: 'action',
            label: 'Trazar túnel a mano',
            checked: this.palette.tool() === 'tunnel',
            disabled: this.map.rooms().length < 2,
            run: () => this.palette.setTool('tunnel'),
          },
          {
            kind: 'action',
            label: 'Tamaño de las conexiones…',
            disabled: this.map.tunnels().length === 0,
            run: () => this.showMapPanel(),
          },
          separator,
          { kind: 'action', label: 'Salas y túneles del nivel', run: () => this.showMapPanel() },
          { kind: 'action', label: 'Propiedades de la grilla', run: () => this.showGridProperties() },
        ],
      },
      {
        id: 'niveles',
        label: 'Niveles',
        items: [
          { kind: 'action', label: 'Pasar a otro nivel…', run: () => this.transition.openTransitionDialog() },
          { kind: 'action', label: 'Ver eventos del nivel', run: () => this.showDock('eventos') },
        ],
      },
      {
        id: 'generar',
        label: 'Generar',
        items: [
          {
            kind: 'soon',
            label: 'Generar nivel aleatorio…',
            hint: 'Colocar paredes y salas de forma procedural sobre el mapa.',
          },
          {
            kind: 'soon',
            label: 'Semilla de generación…',
            hint: 'El número que hace que la misma generación salga igual cada vez.',
          },
        ],
      },
      {
        id: 'herramientas',
        label: 'Herramientas',
        items: [
          {
            kind: 'action',
            label: 'Herramienta de sprites',
            checked: this.centerMode() === 'sprites',
            run: () => this.setCenterMode(this.centerMode() === 'sprites' ? 'mapa' : 'sprites'),
          },
          {
            kind: 'action',
            label: 'Editar la textura elegida en sprites',
            disabled: !this.palette.activeTexture() || this.sprite.busy(),
            run: () => this.editTextureInSprites(this.palette.activeTexture()),
          },
          separator,
          // Una sola entrada: agregar imagenes o los JPG del proyecto se hace
          // desde la ventana del convertidor.
          { kind: 'action', label: 'Convertidor de imágenes…', run: () => this.converter.open() },
        ],
      },
      {
        id: 'ejecutar',
        label: 'Ejecutar',
        items: [
          {
            kind: 'action',
            label:
              (this.engine.start() === 'title' ? 'Ejecutar desde la portada' : 'Ejecutar el nivel') +
              ' (' + this.engine.label(this.engine.mode()) + ')',
            shortcut: 'F5',
            disabled: this.engine.building() !== null,
            run: () => void this.proj.run(),
          },
          {
            kind: 'action',
            // El otro arranque, sin cambiar el selector: probar el nivel sin
            // pasar por la portada, o ver la portada sin dejarla elegida.
            label: this.engine.otherStart() === 'title' ? 'Ejecutar desde la portada' : 'Ejecutar el nivel directo',
            shortcut: 'Shift+F5',
            disabled: this.engine.building() !== null,
            run: () => void this.proj.run(this.engine.otherStart()),
          },
          { kind: 'action', label: 'Configuración del juego…', run: () => void this.game.open() },
          {
            kind: 'action',
            label: 'Exportar juego…',
            disabled: this.engine.building() !== null || !this.hasFileSystem,
            run: () => void this.proj.exportGame(),
          },
          separator,
          // Donde arranca con Ejecutar y F5: lo mismo que el selector de la barra.
          ...this.engine.starts.map((start) => ({
            kind: 'action' as const,
            label: start.id === 'title' ? 'Arrancar en la portada: el juego terminado' : 'Arrancar en el nivel: para probar',
            checked: this.engine.start() === start.id,
            run: () => this.engine.setStart(start.id),
          })),
          separator,
          // Con que motor: la version de desarrollo (con F3) o la optimizada.
          ...this.engine.modes.map((mode) => ({
            kind: 'action' as const,
            label:
              'Motor ' + mode.label + (mode.id === 'debug' ? ': desarrollo, con F3' : ': optimizado') +
              (this.engine.isMissing(mode.id) ? ' (sin compilar)' : ''),
            checked: this.engine.mode() === mode.id,
            run: () => this.engine.setMode(mode.id),
          })),
          separator,
          ...this.engine.modes.map((mode) => ({
            kind: 'action' as const,
            label:
              this.engine.building() === mode.id
                ? 'Compilando motor ' + mode.label + '… ' + this.engine.progress()
                : 'Compilar motor ' + mode.label,
            disabled: this.engine.building() !== null || !this.hasFileSystem,
            run: () => void this.engine.build(mode.id),
          })),
        ],
      },
    ];
  });

  /** Recarga la interfaz. Si hay cambios sin guardar pregunta antes, porque recargar los pierde. */
  reloadWindow(): void {
    const unsaved = [this.dirty() ? 'el nivel' : '', this.sprite.dirty() ? 'el sprite' : ''].filter(Boolean).join(' y ');
    if (unsaved && !window.confirm(`Hay cambios sin guardar en ${unsaved}. ¿Recargar igual y perderlos?`)) {
      return;
    }
    // Ya se pregunto: que onBeforeUnload no lo vuelva a hacer con el dialogo del sistema.
    this.leaving = true;
    window.location.reload();
  }

  /** true cuando la salida ya se confirmo aca (recargar): no se pregunta dos veces. */
  private leaving = false;

  /**
   * Cerrar la ventana (o recargarla con F5 del navegador, o el dev server) con
   * cambios sin guardar. Desde aca no se puede preguntar: el navegador solo
   * deja CANCELAR la salida. Al cancelarla, main.js recibe 'will-prevent-unload'
   * y ahi muestra el dialogo del sistema con "Salir sin guardar" y "Cancelar".
   */
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.leaving) {
      return;
    }
    if (this.dirty() || this.sprite.dirty() || this.game.dirty()) {
      event.preventDefault();
      // Lo que Chromium mira todavia para decidir que hay que preguntar.
      event.returnValue = '';
    }
  }

  /** Como estaban los paneles en el mapa, para devolverlos al volver de Sprites. */
  private mapPanels: { sidebar: boolean; inspector: boolean; dock: boolean } | null = null;

  /**
   * Cambia lo que muestra el area central.
   *
   * Sprites se queda con el cuerpo entero: la escena, el inspector y Recursos
   * son del nivel y ahi solo le quitarian lugar al lienzo. Se esconden al
   * entrar (siguen a mano en sus botones y en Ctrl+B / Ctrl+J) y vuelven como
   * estaban al volver al mapa. Al salir tambien se corta la animacion y el
   * trazo a medias; el sprite queda abierto para cuando se vuelva.
   */
  setCenterMode(mode: CenterMode): void {
    if (mode === this.centerMode()) {
      return;
    }
    if (mode === 'sprites') {
      this.mapPanels = {
        sidebar: this.panels.sidebarVisible(),
        inspector: this.panels.inspectorVisible(),
        dock: this.panels.dockOpen(),
      };
      this.panels.sidebarVisible.set(false);
      this.panels.inspectorVisible.set(false);
      this.panels.dockOpen.set(false);
    } else {
      this.sprite.stopPlayback();
      this.sprite.cancelStroke();
      this.sprite.spaceHeld.set(false);
      if (this.mapPanels) {
        this.panels.sidebarVisible.set(this.mapPanels.sidebar);
        this.panels.inspectorVisible.set(this.mapPanels.inspector);
        this.panels.dockOpen.set(this.mapPanels.dock);
        this.mapPanels = null;
      }
    }
    this.centerMode.set(mode);
  }

  /** Abre una textura del proyecto en la herramienta de sprites (Recursos › Texturas o el menu Herramientas). */
  editTextureInSprites(name: string | null): void {
    if (!name) {
      return;
    }
    this.setCenterMode('sprites');
    void this.sprite.openTexture(name);
  }

  toggleDevTools(): void {
    if (this.hasWindowApi) {
      void window.honeycombWindow.toggleDevTools();
    }
  }

  // --- Atajos de teclado ----------------------------------------------------
  //
  // Los globales viven aca y no en el viewport: Ctrl+S o Ctrl+N no son del
  // canvas. Es la otra mitad de la superficie de comandos.

  /**
   * Atajos de teclado, con el mismo reparto que Blender:
   *   Inicio    encuadrar todo         Supr / X   borrar el objeto activo
   *   Shift+D   duplicar               Ctrl+S     guardar
   *   Ctrl+Z    deshacer               Ctrl+Y     rehacer
   *
   * El primer if es la parte importante: si el foco esta en un campo de texto
   * el atajo no corre. Sin eso, escribir una "x" en el id de una entidad la
   * borraria.
   */
  onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target?.isContentEditable) {
      return;
    }
    // Un dialogo abierto se lleva todos los atajos: solo responde a Escape.
    if (this.proj.showNewLevelDialog()) {
      if (event.key === 'Escape') {
        this.proj.cancelNewLevel();
      }
      return;
    }
    if (this.entityOps.pendingPlacement()) {
      if (event.key === 'Escape') {
        this.entityOps.cancelPending();
      }
      return;
    }
    // El dialogo de nombre va primero: puede abrirse ENCIMA de otro (Guardar
    // como desde el convertidor, por ejemplo) y Escape tiene que cerrar este.
    if (this.prompt.request()) {
      if (event.key === 'Escape') {
        this.prompt.cancel();
      }
      return;
    }
    if (this.converter.isOpen()) {
      if (event.key === 'Escape') {
        this.converter.close();
      }
      return;
    }
    if (this.game.draft()) {
      if (event.key === 'Escape') {
        this.game.close();
      }
      return;
    }
    if (this.map.roomDraft() || this.map.tunnelDraft() || this.chars.characterEditor() || this.transition.transitionDraft()) {
      if (event.key === 'Escape') {
        this.map.cancelRoomDialog();
        this.map.cancelTunnelDialog();
        this.chars.closeCharacterEditor();
        this.transition.cancelTransitionDialog();
      }
      return;
    }
    // Un tunel a medio trazar se lleva Escape (abandonarlo) y Retroceso
    // (deshacer el ultimo punto). El resto de las teclas sigue funcionando: se
    // puede hacer zoom o encuadrar sin perder el trazado.
    if (this.map.tunnelTrace()) {
      if (event.key === 'Escape') {
        this.map.tunnelTrace.set(null);
        this.note('Trazado de túnel cancelado.');
        return;
      }
      if (event.key === 'Backspace') {
        event.preventDefault();
        this.map.tunnelTrace.update((trace) => (trace ? { ...trace, points: trace.points.slice(0, -1) } : trace));
        return;
      }
    }

    // El menu del clic derecho es un dialogo mas: mientras esta abierto, las
    // teclas no le llegan a la escena (una X borraria la entidad que se esta
    // editando), y Escape lo cierra.
    if (this.view.contextMenu()) {
      if (event.key === 'Escape') {
        this.view.closeContextMenu();
      }
      return;
    }

    // En la herramienta de sprites las teclas son primero las suyas (ver
    // SpriteEditorController.onKeyDown): Ctrl+S guarda el sprite, Ctrl+Z
    // deshace un trazo, B es el lapiz. Lo que no toma sigue abajo, pero solo
    // los atajos de la ventana: los del nivel no tienen nada que tocar ahi.
    if (this.centerMode() === 'sprites' && this.sprite.onKeyDown(event)) {
      event.preventDefault();
      return;
    }

    // Ctrl+Z deshace y Ctrl+Y (o Ctrl+Shift+Z) rehace, las mismas teclas que
    // en Sprites. Con el foco en un campo no se llega hasta aca (ver el primer
    // if): ahi Ctrl+Z deshace lo escrito en el campo, como en cualquier lado.
    const key = event.key.toLowerCase();
    if (event.ctrlKey && (key === 'z' || key === 'y')) {
      event.preventDefault();
      if (key === 'y' || event.shiftKey) {
        this.redo();
      } else {
        this.undo();
      }
      return;
    }

    if (event.ctrlKey && event.key.toLowerCase() === 's') {
      event.preventDefault();
      // Ctrl+Shift+S fuerza el dialogo aunque ya se sepa donde va el archivo.
      void (event.shiftKey ? this.proj.saveAs() : this.proj.save());
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      void this.proj.openLevelFile();
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      this.proj.newLevel();
      return;
    }
    // Estos dos los daba el menu nativo de Electron, que se quito para que no
    // hubiera dos barras de menus. Siguen funcionando igual desde aca.
    if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      this.toggleDevTools();
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'r') {
      event.preventDefault();
      this.reloadWindow();
      return;
    }
    // Ctrl+B esconde la barra lateral y Ctrl+J el panel de abajo, los mismos
    // atajos que en VS Code.
    if (event.ctrlKey && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      this.panels.toggleSidebar();
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'j') {
      event.preventDefault();
      this.panels.toggleDock();
      return;
    }
    // F5: ejecutar, como en cualquier entorno de desarrollo, arrancando donde
    // diga el selector de la barra (el nivel o la portada). Shift+F5: en el otro.
    if (event.key === 'F5') {
      event.preventDefault();
      void this.proj.run(event.shiftKey ? this.engine.otherStart() : this.engine.start());
      return;
    }
    // De aca para abajo, todo es sobre las entidades del viewport.
    if (this.centerMode() === 'sprites') {
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      this.sel.selectAllEntities();
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      this.view.frameAll();
      return;
    }
    // 1 a 7: las herramientas de la barra, en el orden en que se ven.
    if (!event.ctrlKey && !event.altKey && !event.metaKey) {
      const tool = TOOL_BUTTONS.find((button) => button.key === event.key);
      if (tool) {
        event.preventDefault();
        this.palette.setTool(tool.id);
        return;
      }
    }
    // Las flechas mueven la seleccion entera una celda. Es la unica forma de
    // mover varias entidades juntas (ver nudgeSelection).
    //
    // Sin nada seleccionado NO se las toca: asi siguen sirviendo para
    // desplazarse por el visor de archivos o por la consola de abajo.
    const nudge = ARROW_NUDGES[event.key];
    if (nudge && this.selectionCount() > 0) {
      event.preventDefault();
      this.entityOps.nudgeSelection(nudge.col, nudge.row);
      return;
    }
    if (event.key === 'Delete' || event.key.toLowerCase() === 'x') {
      this.entityOps.deleteSelected();
      return;
    }
    if (event.shiftKey && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      this.entityOps.duplicateSelected();
      return;
    }
    // Escape suelta la seleccion, como en cualquier editor.
    if (event.key === 'Escape' && this.selectionCount() > 0) {
      this.selection.clear();
    }
  }

  // --- Navegacion del shell -------------------------------------------------
  //
  // Llevar al usuario a un panel o a un archivo: lo que mueve el foco entre
  // areas del editor, y por eso no es de ninguna de ellas.

  /** Abre el panel de propiedades en la pestaña de escena, donde estan las medidas de la grilla. */
  showGridProperties(): void {
    this.panels.inspectorVisible.set(true);
    this.inspectorTab.set('escena');
    // El tamaño de casilla vive en Avanzado, plegado de entrada.
    this.panels.expand('level-advanced');
  }

  /** Abre Propiedades en la pestaña de escena con el panel Mapa desplegado. */
  showMapPanel(): void {
    this.showGridProperties();
    this.panels.expand('map');
  }

  /** Cambia lo que muestra la columna izquierda: la escena o los archivos del proyecto. */
  setLeftEditor(editor: LeftEditor): void {
    this.leftEditor.set(editor);
  }

  /** Lleva el dock a una pestaña y lo despliega si estaba plegado. */
  showDock(workspace: Workspace): void {
    this.workspace.set(workspace);
    this.panels.dockOpen.set(true);
  }

  /**
   * Clic en una pestaña del dock. La que ya esta al frente pliega o despliega
   * el dock, como en los paneles de cualquier motor; otra lo trae al frente.
   */
  onDockTab(workspace: Workspace): void {
    if (this.workspace() === workspace) {
      this.panels.toggleDock();
    } else {
      this.showDock(workspace);
    }
  }

  /** Muestra una categoria de Recursos (por ejemplo, Texturas despues de importar). */
  showAssets(tab: AssetTab): void {
    this.assetTab.set(tab);
    this.showDock('layout');
  }

  /** Un paso de zoom hacia adentro (+1) o hacia afuera (-1), entre los de la escala fija. */
  stepZoom(direction: 1 | -1): void {
    // Los botones de zoom de la barra son del area central: en Sprites, del lienzo.
    if (this.centerMode() === 'sprites') {
      this.sprite.zoomAt(direction);
      return;
    }
    const current = this.view.zoom();
    const steps = [...this.view.zoomSteps];
    const next = direction > 0 ? steps.find((step) => step > current) : steps.reverse().find((step) => step < current);
    if (next !== undefined) {
      this.view.setZoom(next);
    }
  }

  /**
   * Abre un nivel elegido en el organizador. Es lo mismo que hace el
   * desplegable de la topbar, pero para un archivo que puede estar en una
   * subcarpeta de levels/.
   */
  private async openProjectLevel(node: ProjectNode): Promise<void> {
    if (!this.proj.confirmDiscard()) {
      return;
    }
    try {
      const level = await this.project.readLevelAt(node.path);
      // Solo un nivel que este JUSTO en levels/ se adopta con su nombre de
      // archivo: es lo unico que le permite a Guardar volver a escribirlo sin
      // preguntar (ver levels.save()).
      const direct = /^levels\/[^/]+$/i.test(node.path) ? node.name : null;
      this.levels.adopt(level, direct);

      const root = this.project.projectRoot();
      // Ruta absoluta para Ejecutar: el motor lee el nivel del disco.
      this.proj.lastSavedPath.set(root ? root.replace(/[\\/]$/, '') + '/' + node.path : null);
      this.dirty.set(false);
      this.view.frameAll();
      this.note('Nivel "' + node.path + '" abierto (' + this.entities().length + ' entidades).');
    } catch (error) {
      this.note('No se pudo abrir ' + node.path + ': ' + this.describe(error));
    }
  }

  // --- Utilidades de plantilla ----------------------------------------------
  //
  // Las plantillas de Angular no pueden hacer casts, asi que sacar el valor de
  // un evento de input necesita un helper por tipo. Nombres cortos porque
  // aparecen en cada binding del HTML.

  str(event: Event): string {
    return (event.target as HTMLInputElement).value;
  }

  /**
   * El desplegable de niveles de la barra. Si no se abrio (se cancelo por
   * cambios sin guardar, o fallo la lectura) se vuelve a mostrar el nivel que
   * sigue abierto: el <select> ya cambio solo, y el binding [value] no lo
   * corrige porque el nivel abierto no cambio.
   */
  async pickLevel(event: Event): Promise<void> {
    const select = event.target as HTMLSelectElement;
    if (!(await this.proj.loadLevel(select.value))) {
      select.value = this.levels.fileName() ?? '';
    }
  }

  int(event: Event): number {
    // Todo en enteros: un sprite en x=10.5 sale borroso o con tearing.
    return Math.round(Number((event.target as HTMLInputElement).value)) || 0;
  }

  /** Con decimales: escala, segundos por cuadro, velocidad. */
  num(event: Event): number {
    return Number((event.target as HTMLInputElement).value) || 0;
  }

  checked(event: Event): boolean {
    return (event.target as HTMLInputElement).checked;
  }

  /** El valor de la opcion "+ Nueva variable…" de los desplegables de variables de los eventos. */
  readonly newVariableOption = '__nueva_variable__';

  /**
   * Un desplegable de variable de un evento. La ultima opcion crea una variable
   * nueva en game.json y la deja elegida; si se cancela, el desplegable vuelve
   * a la que tenia.
   */
  async chooseVariableParam(
    kind: StepKind,
    eventIndex: number,
    stepIndex: number,
    key: string,
    event: Event,
    current: string,
  ): Promise<void> {
    const select = event.target as HTMLSelectElement;
    if (select.value !== this.newVariableOption) {
      this.ev.updateStepParam(kind, eventIndex, stepIndex, key, select.value);
      return;
    }
    select.value = current;
    const name = await this.game.createVariable();
    if (name) {
      this.ev.updateStepParam(kind, eventIndex, stepIndex, key, name);
    }
  }

  /** Vuelve un <select> de "+ Agregar…" a su opcion vacia despues de usarlo. */
  resetSelect(event: Event): void {
    (event.target as HTMLSelectElement).value = '';
  }

  // --- Avisos ---------------------------------------------------------------

  private note(message: string): void {
    this.status.set(message);
    this.log.update((entries) => [...entries.slice(-40), message]);
  }

  /** Texto legible de cualquier cosa que llegue por un catch (no siempre es un Error). */
  private describe(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    // Electron envuelve los errores del proceso principal en "Error invoking
    // remote method 'canal': Error: ...". Lo que sirve es lo de despues: los
    // handlers de ipc/ ya lo escriben para que se entienda.
    return message.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '');
  }
}
