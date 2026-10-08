// =============================================================================
// HoneyComb Engine - Editor (componente raiz)
// =============================================================================
//
// Todo el editor vive en un solo componente. Es una decision deliberada para el
// prototipo: la ventana es una unica pantalla con areas fijas (outliner,
// recursos, viewport, propiedades, eventos) que comparten el mismo nivel
// abierto, y partirla en componentes solo agregaria capas de @Input/@Output
// para pasar el mismo estado de un lado a otro.
//
// La interfaz esta modelada sobre la de Blender: areas con cabecera propia
// separadas por un surco, pestanas de workspace que cambian que editores estan
// abiertos, propiedades en paneles plegables, y navegacion del viewport con
// rueda (zoom al cursor), boton medio (desplazar) e Inicio (encuadrar). El tema
// visual vive entero en app.scss.
//
// App es el SHELL: el estado que es de la ventana entera, la superficie de
// comandos (barra de menus y atajos) y el cableado. Lo demas vive afuera:
//
//   services/    el estado: el nivel abierto, la seleccion, el disco, el
//                catalogo de eventos, las bibliotecas del proyecto
//   core/        logica pura, sin Angular y con tests; core/iso-projection.ts
//                es el espejo de IsoGridSystem en C++, y su proyeccion tiene
//                que ser identica a la del runtime
//   */*.controller.ts  cada area del editor, con su markup todavia en
//                app.html para compartir los estilos de App
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
// Alrededor: project/ (el nivel como documento y el explorador), characters/,
// textures/ y combat/ (las bibliotecas del proyecto y sus ventanas), events/
// (el panel Eventos y el dialogo de pasar de nivel), ui/ (paneles).
//
// El dibujo y la proyeccion pantalla<->celda estan en core/iso-canvas-renderer.ts.
// =============================================================================

import {
  Component,
  ElementRef,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';

import { CHARACTERS } from './core/characters';
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
import { AttackPreviewDirective } from './combat/attack-preview.directive';
import { CombatInspectorController } from './combat/combat-inspector.controller';
import { ItemEditorController } from './combat/item-editor.controller';
import { PuzzleController } from './combat/puzzle.controller';
import { ExplorerController } from './project/explorer.controller';
import { MapController } from './map/map.controller';
import { CharactersController } from './characters/characters.controller';
import { EventsController } from './events/events.controller';
import { TexturesController } from './textures/textures.controller';
import { BackgroundPickerController } from './inspector/background-picker.controller';
import { PanelsController } from './ui/panels.controller';
import { CatalogService } from './services/catalog.service';
import { ItemLibraryService } from './services/item-library.service';
import { LevelService } from './services/level.service';
import { SelectionService } from './services/selection.service';
import { ProjectService } from './services/project.service';
import { SelectionController } from './selection/selection.controller';
import { PaletteController, Tool } from './palette/palette.controller';
import { InspectorController } from './inspector/inspector.controller';
import { EntityOpsController } from './entities/entity-ops.controller';
import { ViewportController } from './viewport/viewport.controller';
import { ProjectController } from './project/project.controller';
import { TransitionController } from './events/transition.controller';
import { ItemsPanelController } from './combat/items-panel.controller';

/**
 * Espacio de trabajo activo, al estilo de las workspaces de Blender: la pestana
 * de arriba no cambia de pantalla, cambia QUE editores estan abiertos. En
 * "layout" el viewport se queda con todo el alto; las otras dos abren el editor
 * de abajo con eventos o con la consola.
 */
type Workspace = 'layout' | 'eventos' | 'salida' | 'archivo';

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

// Umbral de la matriz de riesgos ("Degradacion de Rendimiento por Usuario"):
// el editor avisa antes de que la escena comprometa los FPS del runtime.
const ENTITY_WARN_THRESHOLD = 150;

/** Nombre de cada herramienta en el menu Editar > Herramienta. */
const TOOL_LABELS: Record<Tool, string> = {
  select: 'Seleccionar',
  place: 'Colocar entidad',
  floor: 'Alternar piso',
  wall: 'Alternar pared',
  room: 'Dibujar grilla',
  tunnel: 'Trazar túnel',
};

/** Nombre de cada espacio de trabajo en el menu Ver > Espacio de trabajo. */
const WORKSPACE_LABELS: Record<Workspace, string> = {
  layout: 'Layout',
  eventos: 'Eventos',
  salida: 'Salida',
  archivo: 'Archivo',
};

/** Cuanto mueve cada flecha del teclado, en celdas de la grilla. */
const ARROW_NUDGES: Record<string, { col: number; row: number }> = {
  ArrowRight: { col: 1, row: 0 },
  ArrowLeft: { col: -1, row: 0 },
  ArrowDown: { col: 0, row: 1 },
  ArrowUp: { col: 0, row: -1 },
};

@Component({
  selector: 'app-root',
  imports: [MenuBar, NgTemplateOutlet, AttackPreviewDirective],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  // Los atajos se escuchan en window y no en el canvas: en Blender funcionan
  // con el puntero sobre cualquier editor, no solo sobre el viewport, y ademas
  // el canvas no tiene foco propio (habria que darle tabindex y pedirlo a mano).
  host: { '(window:keydown)': 'onKeyDown($event)' },
})
export class App {
  // --- Servicios ------------------------------------------------------------

  readonly project = inject(ProjectService);

  readonly levels = inject(LevelService);

  readonly selection = inject(SelectionService);

  readonly catalog = inject(CatalogService);

  readonly presetsService = inject(CharacterPresetService);

  readonly itemLibrary = inject(ItemLibraryService);

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

  readonly inspectorTab = signal<InspectorTab>('objeto');

  readonly leftEditor = signal<LeftEditor>('escena');

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
    () => this.workspace.set('archivo'),
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
    (message) => this.note(message),
    (error) => this.describe(error),
    () => this.proj.refreshProject(),
    (path) => this.explorer.reloadDir(path),
    (id) => this.panels.expand(id),
    () => this.grid(),
    this.hasFileSystem,
  );

  /** Como se muestran los objetos. Ver combat/items-panel.controller.ts. */
  readonly items: ItemsPanelController = new ItemsPanelController(
    () => this.tex.textureAssets(),
    () => this.combat.options(),
    (name, asset) => this.itemEditor.setTexture(name, asset),
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
  readonly inspector: InspectorController = new InspectorController(() => this.dirty.set(true));

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
    () => this.workspace.set('eventos'),
  );

  readonly combat: CombatInspectorController = new CombatInspectorController(() => this.dirty.set(true));

  readonly puzzle: PuzzleController = new PuzzleController(
    (message) => this.note(message),
    () => this.dirty.set(true),
    () => this.workspace.set('eventos'),
  );

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
  });

  // --- Datos para la plantilla ----------------------------------------------
  //
  // Constantes y estilos que la plantilla necesita tal cual.

  readonly shapes = SHAPES;

  readonly characters = CHARACTERS;

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
          { kind: 'action', label: 'Abrir carpeta de proyecto…', run: () => void this.proj.openProject() },
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
            label: 'Importar texturas…',
            disabled: this.tex.importing(),
            run: () => void this.tex.importTextures(),
          },
          separator,
          { kind: 'action', label: 'Salir', run: () => window.close() },
        ],
      },
      {
        id: 'editar',
        label: 'Editar',
        items: [
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
            items: (['select', 'place', 'floor', 'wall', 'room', 'tunnel'] as const).map((tool) => ({
              kind: 'action' as const,
              label: TOOL_LABELS[tool],
              checked: this.palette.tool() === tool,
              run: () => this.palette.setTool(tool),
            })),
          },
        ],
      },
      {
        id: 'ver',
        label: 'Ver',
        items: [
          { kind: 'action', label: 'Barra lateral', shortcut: 'Ctrl+B', checked: this.panels.sidebarVisible(), run: () => this.panels.toggleSidebar() },
          { kind: 'action', label: 'Panel de propiedades', checked: this.panels.inspectorVisible(), run: () => this.panels.toggleInspector() },
          {
            kind: 'submenu',
            label: 'Espacio de trabajo',
            emptyLabel: '',
            items: (['layout', 'eventos', 'salida', 'archivo'] as const).map((workspace) => ({
              kind: 'action' as const,
              label: WORKSPACE_LABELS[workspace],
              checked: this.workspace() === workspace,
              run: () => this.workspace.set(workspace),
            })),
          },
          separator,
          { kind: 'action', label: 'Grilla', checked: this.view.showGrid(), run: () => this.view.toggleGrid() },
          { kind: 'action', label: 'Colisiones', checked: this.view.showColliders(), run: () => this.view.toggleColliders() },
          { kind: 'action', label: 'Encuadrar todo', shortcut: 'Inicio', run: () => this.view.frameAll() },
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
              label: this.items.itemGlyph(item) + '  ' + item.name,
              run: () => this.itemEditor.open({ editId: item.id }),
            })),
          },
          separator,
          { kind: 'action', label: 'Puzzle de sala…', run: () => this.puzzle.open() },
          { kind: 'action', label: 'Agregar zona de puzzle', run: () => this.map.addZone() },
          { kind: 'action', label: 'Ver eventos del nivel', run: () => this.workspace.set('eventos') },
        ],
      },
      {
        id: 'mapa',
        label: 'Mapa',
        items: [
          { kind: 'action', label: 'Agregar grilla al mapa…', run: () => this.map.openRoomDialog() },
          {
            kind: 'action',
            label: 'Dibujar grilla en el viewport',
            checked: this.palette.tool() === 'room',
            run: () => this.palette.setTool('room'),
          },
          separator,
          {
            kind: 'action',
            label: 'Conectar grillas con un túnel…',
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
          { kind: 'action', label: 'Grillas y túneles del nivel', run: () => this.showMapPanel() },
          { kind: 'action', label: 'Propiedades de la grilla', run: () => this.showGridProperties() },
        ],
      },
      {
        id: 'niveles',
        label: 'Niveles',
        items: [
          { kind: 'action', label: 'Pasar a otro nivel…', run: () => this.transition.openTransitionDialog() },
          { kind: 'action', label: 'Ver eventos del nivel', run: () => this.workspace.set('eventos') },
        ],
      },
      {
        id: 'generar',
        label: 'Generar',
        items: [
          {
            kind: 'soon',
            label: 'Generar nivel aleatorio…',
            hint: 'Colocar paredes y grillas de forma procedural sobre el mapa.',
          },
          {
            kind: 'soon',
            label: 'Semilla de generación…',
            hint: 'El número que hace que la misma generación salga igual cada vez.',
          },
        ],
      },
      {
        id: 'ejecutar',
        label: 'Ejecutar',
        items: [{ kind: 'action', label: 'Ejecutar nivel', shortcut: 'F5', run: () => void this.proj.run() }],
      },
    ];
  });

  /** Recarga la interfaz. Si hay cambios sin guardar pregunta antes, porque recargar los pierde. */
  reloadWindow(): void {
    if (this.dirty() && !window.confirm('Hay cambios sin guardar en el nivel. ¿Recargar igual y perderlos?')) {
      return;
    }
    window.location.reload();
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
    // Ctrl+B esconde la barra lateral, el mismo atajo que en VS Code.
    if (event.ctrlKey && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      this.panels.toggleSidebar();
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      this.sel.selectAllEntities();
      return;
    }
    // F5: probar el nivel, como en cualquier entorno de desarrollo.
    if (event.key === 'F5') {
      event.preventDefault();
      void this.proj.run();
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      this.view.frameAll();
      return;
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
  }

  /** Abre Propiedades en la pestaña de escena con el panel Mapa desplegado. */
  showMapPanel(): void {
    this.showGridProperties();
    this.panels.expand('map');
  }

  /** Cambia el editor del area de arriba a la izquierda, y la despliega si estaba plegada. */
  setLeftEditor(editor: LeftEditor): void {
    this.leftEditor.set(editor);
    this.panels.expand('side-main');
  }

  /**
   * Abre un nivel elegido en el organizador. Es lo mismo que hace el
   * desplegable de la topbar, pero para un archivo que puede estar en una
   * subcarpeta de levels/.
   */
  private async openProjectLevel(node: ProjectNode): Promise<void> {
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
    return error instanceof Error ? error.message : String(error);
  }
}
