import { WritableSignal, computed, inject, signal } from '@angular/core';

import { EventsController } from '../events/events.controller';
import { ItemLibraryService } from '../services/item-library.service';
import { CatalogService } from '../services/catalog.service';
import { CharacterPresetService } from '../services/character-preset.service';
import { LevelService } from '../services/level.service';
import { ProjectService } from '../services/project.service';
import { TexturesController } from '../textures/textures.controller';
import { ViewportController } from '../viewport/viewport.controller';
import { ExplorerController } from './explorer.controller';
import { DEFAULT_STARTER_TEXTURE } from '../entities/entity-ops.controller';
import { GridConfig } from '../models/level.model';

/** Plantillas del dialogo "nivel nuevo": vacio, con jugador, o escena de prueba. */
export type NewLevelTemplate = 'empty' | 'player' | 'test-scene';

/** Lo que el ciclo de vida del documento recibe del editor. */
export interface ProjectDeps {
  note: (message: string) => void;
  describe: (error: unknown) => string;
  /** Hay cambios sin guardar. Guardar lo apaga; abrir o crear un nivel tambien. */
  dirty: WritableSignal<boolean>;
  /** false cuando el editor corre en un navegador sin Electron (sin disco). */
  hasFileSystem: boolean;
  explorer: ExplorerController;
  tex: TexturesController;
  view: ViewportController;
  ev: EventsController;
}

/**
 * El NIVEL COMO DOCUMENTO: abrir la carpeta del proyecto, abrir, crear,
 * guardar, guardar como y ejecutar en el runtime.
 *
 * Es lo que en cualquier editor de documentos es el menu Archivo. Sabe de
 * rutas y de disco (via ProjectService), y de dejar el resto del editor al dia
 * despues de cada operacion: releer la carpeta levels/ en el explorador,
 * encuadrar el nivel recien abierto, apagar la marca de cambios sin guardar.
 * Lo que hay DENTRO del nivel no es asunto suyo.
 */
export class ProjectController {
  private readonly project = inject(ProjectService);
  private readonly levels = inject(LevelService);
  private readonly catalog = inject(CatalogService);
  private readonly itemLibrary = inject(ItemLibraryService);
  private readonly presetsService = inject(CharacterPresetService);

  private readonly note: ProjectDeps['note'];
  private readonly describe: ProjectDeps['describe'];
  private readonly dirty: WritableSignal<boolean>;
  private readonly hasFileSystem: boolean;
  private readonly explorer: ExplorerController;
  private readonly tex: TexturesController;
  private readonly view: ViewportController;
  private readonly ev: EventsController;

  private readonly entities = computed(() => this.levels.level().entities);

  constructor(deps: ProjectDeps) {
    this.note = deps.note;
    this.describe = deps.describe;
    this.dirty = deps.dirty;
    this.hasFileSystem = deps.hasFileSystem;
    this.explorer = deps.explorer;
    this.tex = deps.tex;
    this.view = deps.view;
    this.ev = deps.ev;
  }

  readonly levelFiles = signal<string[]>([]);

  /** Ultima ruta usada al guardar por dialogo; se propone en el siguiente. */
  readonly lastSavedPath = signal<string | null>(null);

  readonly showNewLevelDialog = signal(false);

  readonly newLevelName = signal('nuevo_nivel');

  readonly newLevelWidth = signal(10);

  readonly newLevelHeight = signal(10);

  readonly newLevelTileWidth = signal(64);

  readonly newLevelTileHeight = signal(32);

  readonly newLevelTemplate = signal<NewLevelTemplate>('empty');

  async openProject(): Promise<void> {
    if (!this.hasFileSystem) {
      this.note('Sin acceso a disco. Abre el editor con "npm run electron".');
      return;
    }
    const opened = await this.project.openProjectFolder();
    if (!opened) {
      return;
    }
    await this.refreshProject();
  }

  /**
   * Relee del disco todo lo que depende del proyecto abierto: niveles,
   * texturas y catalogo de eventos. Los dos try van separados a proposito:
   * un proyecto sin event_catalog.json sigue siendo editable (solo queda sin
   * panel de eventos), asi que ese fallo no debe tapar el listado de niveles.
   */
  async refreshProject(): Promise<void> {
    try {
      this.levelFiles.set(await this.project.listLevels());
      this.tex.textures.set(await this.project.listTextures());
      // Sin await: las miniaturas van apareciendo solas, y abrir el proyecto no
      // tiene por que esperar a que se procese una carpeta de 150 imagenes.
      void this.tex.loadTextureThumbnails();
      // El explorador arranca con la raiz y nada desplegado, como VS Code.
      await this.explorer.loadRoot();
      this.note('Proyecto abierto: ' + this.project.projectRoot());
    } catch (error) {
      this.note('No se pudo leer el proyecto: ' + this.describe(error));
    }

    try {
      await this.catalog.load();
      const total = this.ev.triggers().length + this.ev.conditions().length + this.ev.actions().length;
      this.note('Catalogo de eventos cargado (' + total + ' bloques).');
    } catch {
      this.note('No se encontro schema/event_catalog.json: el panel de eventos queda vacio.');
    }

    // Tercer try aparte por lo mismo: un characters.json roto deja la paleta
    // solo con los tipos base, pero no impide editar el nivel.
    try {
      await this.presetsService.load();
    } catch (error) {
      this.note('No se pudieron leer los personajes configurados: ' + this.describe(error));
    }

    // Y la biblioteca de objetos, por lo mismo: sin ella se sigue editando, solo
    // que la paleta Objetos queda vacia.
    try {
      await this.itemLibrary.load();
    } catch (error) {
      this.note('No se pudo leer items.json: ' + this.describe(error));
    }
  }

  /**
   * Abre un nivel eligiendo el archivo con el dialogo del sistema.
   *
   * A diferencia del desplegable de niveles, esto no exige tener un proyecto
   * abierto ni que el archivo viva en levels/: se puede abrir un .json de
   * donde sea y verlo dibujado.
   */
  async openLevelFile(): Promise<void> {
    if (!this.hasFileSystem) {
      this.note('Sin acceso a disco. Abre el editor con "npm run electron".');
      return;
    }
    try {
      const opened = await this.project.openLevelFile();
      if (!opened) {
        return; // el usuario cancelo el dialogo
      }

      // Si resulta estar dentro de levels/ del proyecto abierto, se adopta con
      // su nombre: aparece en el desplegable y guardar no vuelve a preguntar.
      const inLevels = this.levelsFolderFile(opened.path);
      this.levels.adopt(opened.level, inLevels);
      this.lastSavedPath.set(opened.path);
      this.dirty.set(false);
      this.view.frameAll();
      this.note('Abierto ' + opened.path + ' (' + this.entities().length + ' entidades).');
    } catch (error) {
      this.note('No se pudo abrir: ' + this.describe(error));
    }
  }

  /** Abre un nivel del proyecto y recentra la camara sobre el. */
  async loadLevel(fileName: string): Promise<void> {
    try {
      await this.levels.load(fileName);
      this.dirty.set(false);
      // Sin recentrar, un nivel chico abierto despues de uno grande podria
      // quedar fuera de la vista o entrar con un zoom que no le corresponde.
      this.view.frameAll();
      this.note('Nivel "' + fileName + '" cargado (' + this.entities().length + ' entidades).');
    } catch (error) {
      this.note('Error al cargar ' + fileName + ': ' + this.describe(error));
    }
  }

  /** Abre el dialogo de nivel nuevo, con los valores siempre en su default. */
  newLevel(): void {
    this.newLevelName.set('nuevo_nivel');
    this.newLevelWidth.set(10);
    this.newLevelHeight.set(10);
    this.newLevelTileWidth.set(64);
    this.newLevelTileHeight.set(32);
    this.newLevelTemplate.set('empty');
    this.showNewLevelDialog.set(true);
  }

  cancelNewLevel(): void {
    this.showNewLevelDialog.set(false);
  }

  /** El <select> del dialogo devuelve string; se valida antes de aceptarlo. */
  setNewLevelTemplate(value: string): void {
    if (value === 'empty' || value === 'player' || value === 'test-scene') {
      this.newLevelTemplate.set(value);
    }
  }

  /**
   * Crea el nivel EN MEMORIA (no toca el disco hasta que se guarde) y le
   * aplica la plantilla elegida.
   */
  confirmNewLevel(): void {
    const name = this.newLevelName().trim() || 'nuevo_nivel';
    // Todo entero y >= 1: el schema exige enteros positivos, y el usuario
    // puede haber dejado el campo vacio o con decimales.
    const grid: GridConfig = {
      width: Math.max(1, Math.round(this.newLevelWidth())),
      height: Math.max(1, Math.round(this.newLevelHeight())),
      tileWidth: Math.max(1, Math.round(this.newLevelTileWidth())),
      tileHeight: Math.max(1, Math.round(this.newLevelTileHeight())),
    };

    this.levels.createNew(name, grid);
    this.addStarterEntities(this.newLevelTemplate(), grid);
    this.showNewLevelDialog.set(false);
    this.dirty.set(true);
    this.view.frameAll();
    this.note('Nivel nuevo en memoria. Revisa la escena y usa Guardar.');
  }

  /**
   * Puebla un nivel recien creado segun la plantilla:
   *   empty      - nada
   *   player     - solo el jugador ("player_1", el id que busca main.cpp)
   *   test-scene - jugador + un obstaculo, para probar colision al toque
   *
   * Las posiciones pasan por Math.min contra el tamano de la grilla: en un
   * nivel de 1x1 todo tiene que caber igual.
   */
  private addStarterEntities(template: NewLevelTemplate, grid: GridConfig): void {
    if (template === 'empty') {
      return;
    }

    const texture = this.tex.textures()[0] ?? DEFAULT_STARTER_TEXTURE;

    const sourceRect = { x: 0, y: 0, width: 16, height: 16 };
    this.levels.addEntity({
      id: 'player_1',
      type: 'player',
      position: {
        col: Math.min(1, grid.width - 1),
        row: Math.min(2, grid.height - 1),
      },
      texture: 'textures/' + texture,
      sourceRect,
      collider: { width: 16, height: 16 },
    });

    if (template === 'test-scene') {
      this.levels.addEntity({
        id: 'target_1',
        type: 'obstacle',
        position: {
          col: Math.min(3, grid.width - 1),
          row: Math.min(2, grid.height - 1),
        },
        texture: 'textures/' + texture,
        sourceRect: { ...sourceRect },
        collider: { width: 16, height: 16 },
      });
    }
  }

  /** Guarda el nivel en levels/ y refresca el listado (puede ser uno nuevo). */
  /**
   * Guarda el nivel. Se comporta como el Guardar de cualquier programa: si ya
   * se sabe donde va el archivo, lo escribe sin preguntar; si todavia no, abre
   * el dialogo de Guardar como.
   *
   * Antes exigia tener una carpeta de proyecto abierta y, si no la habia, no
   * hacia nada mas que avisar: no habia forma de guardar un nivel recien
   * creado sin montar antes un proyecto entero.
   */
  async save(): Promise<void> {
    if (!this.hasFileSystem) {
      this.note('Sin acceso a disco. Abre el editor con "npm run electron".');
      return;
    }

    // Sin proyecto abierto, o con un nivel que nunca se guardo, no hay ruta
    // conocida: hay que preguntarla.
    if (!this.project.projectRoot() || !this.levels.fileName()) {
      await this.saveAs();
      return;
    }

    try {
      await this.levels.save();
      this.dirty.set(false);
      this.levelFiles.set(await this.project.listLevels());
      await this.explorer.reloadDir('levels');
      this.note('Guardado en levels/' + this.levels.fileName());
    } catch (error) {
      this.note('Error al guardar: ' + this.describe(error));
    }
  }

  /**
   * Guardar como: abre el dialogo del sistema para elegir carpeta y nombre.
   *
   * Se puede usar sin proyecto abierto, que es el punto: un nivel suelto se
   * guarda donde uno quiera, igual que un documento.
   */
  async saveAs(): Promise<void> {
    if (!this.hasFileSystem) {
      this.note('Sin acceso a disco. Abre el editor con "npm run electron".');
      return;
    }

    // Se propone la ultima ruta usada; si no hay, el nombre del nivel.
    const suggested = this.lastSavedPath() ?? this.levels.level().name + '.json';

    try {
      const path = await this.project.saveLevelAs(suggested, this.levels.level());
      if (!path) {
        return; // el usuario cancelo el dialogo
      }
      await this.afterSavedTo(path);
    } catch (error) {
      this.note('Error al guardar: ' + this.describe(error));
    }
  }

  /**
   * Deja el editor al dia despues de guardar por dialogo.
   *
   * Si el archivo cayo dentro de levels/ del proyecto abierto, se adopta como
   * el nivel actual: aparece en el desplegable y los guardados siguientes ya no
   * vuelven a preguntar. Si cayo fuera, se recuerda la ruta para proponerla la
   * proxima vez, pero se sigue preguntando -- escribir fuera del proyecto sin
   * dialogo requeriria abrirle al editor todo el disco, y no vale la pena.
   */
  private async afterSavedTo(path: string): Promise<void> {
    this.dirty.set(false);
    this.lastSavedPath.set(path);

    const inLevels = this.levelsFolderFile(path);
    if (inLevels) {
      this.levels.fileName.set(inLevels);
      this.levelFiles.set(await this.project.listLevels());
      await this.explorer.reloadDir('levels');
    }
    this.note('Guardado en ' + path);
  }

  /**
   * Nombre del archivo si "path" esta justo dentro de levels/ del proyecto
   * abierto; null en cualquier otro caso.
   *
   * Se compara en minusculas y con barras normales porque en Windows la misma
   * carpeta llega escrita de varias formas (mayusculas distintas, / o \).
   */
  private levelsFolderFile(path: string): string | null {
    const root = this.project.projectRoot();
    if (!root) {
      return null;
    }
    const normalize = (value: string) => value.replace(/\\/g, '/').toLowerCase();
    const prefix = normalize(root).replace(/\/$/, '') + '/levels/';
    const target = normalize(path);
    if (!target.startsWith(prefix)) {
      return null;
    }
    const rest = target.slice(prefix.length);
    // Solo el nivel de arriba de levels/: una subcarpeta no la lista el editor.
    return rest.includes('/') ? null : path.slice(path.length - rest.length);
  }

  /**
   * Ruta absoluta del archivo del nivel abierto, o null si todavia no se
   * guardo en ningun lado.
   *
   * Hay dos formas de saberla: si el nivel vive en el proyecto, se arma con la
   * raiz mas levels/<archivo>; si se abrio o guardo con el dialogo del
   * sistema, es la ruta que quedo de ahi.
   */
  private currentLevelPath(): string | null {
    const root = this.project.projectRoot();
    const fileName = this.levels.fileName();
    if (root && fileName) {
      return root.replace(/[\\/]$/, '') + '/levels/' + fileName;
    }
    return this.lastSavedPath();
  }

  /**
   * Lanza el motor con el nivel abierto: el equivalente a correr a mano
   * engine\build\engine.exe con la ruta del nivel.
   *
   * Guarda antes de lanzar. No es una comodidad: el motor lee el nivel del
   * DISCO, asi que sin guardar correria la version anterior y uno estaria
   * probando algo distinto de lo que tiene en pantalla.
   */
  async run(): Promise<void> {
    if (!this.hasFileSystem) {
      this.note('Sin acceso a disco. Abre el editor con "npm run electron".');
      return;
    }

    if (this.dirty() || !this.currentLevelPath()) {
      await this.save(); // puede abrir el dialogo si el nivel es nuevo
    }

    const levelPath = this.currentLevelPath();
    // Si sigue sin ruta o con cambios, el guardado se cancelo.
    if (!levelPath || this.dirty()) {
      this.note('Guarda el nivel antes de ejecutarlo.');
      return;
    }

    const result = await this.project.runLevel(levelPath);
    this.note(
      result.ok
        ? 'Ejecutando ' + levelPath
        : result.error ?? 'No se pudo ejecutar el motor.',
    );
  }
}
