import { WritableSignal, computed, inject, signal } from '@angular/core';

import { EventsController } from '../events/events.controller';
import { ItemLibraryService } from '../services/item-library.service';
import { CatalogService } from '../services/catalog.service';
import { CharacterPresetService } from '../services/character-preset.service';
import { LevelService } from '../services/level.service';
import { ProjectService } from '../services/project.service';
import { TexturesController } from '../textures/textures.controller';
import { ViewportController } from '../viewport/viewport.controller';
import { EngineController } from './engine.controller';
import { ExplorerController } from './explorer.controller';
import { DEFAULT_STARTER_TEXTURE } from '../entities/entity-ops.controller';
import { GridConfig } from '../models/level.model';
import { levelFileName } from '../core/file-names';
import type { LevelImport } from '../electron-api';
import { NamePromptController } from '../ui/name-prompt.controller';

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
  /** Pide el nombre en Guardar como, sin el dialogo del sistema. */
  prompt: NamePromptController;
  /** Con que motor se ejecuta (Debug o Release), y compilarlo si falta. */
  engine: EngineController;
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
  private readonly prompt: NamePromptController;
  private readonly engine: EngineController;

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
    this.prompt = deps.prompt;
    this.engine = deps.engine;
  }

  readonly levelFiles = signal<string[]>([]);

  /**
   * Ruta absoluta del nivel abierto cuando NO esta justo en levels/ (uno de
   * una subcarpeta, abierto desde el explorador). Es la que usa Ejecutar.
   */
  readonly lastSavedPath = signal<string | null>(null);

  readonly showNewLevelDialog = signal(false);

  readonly newLevelName = signal('nuevo_nivel');

  readonly newLevelWidth = signal(10);

  readonly newLevelHeight = signal(10);

  readonly newLevelTileWidth = signal(64);

  readonly newLevelTileHeight = signal(32);

  readonly newLevelTemplate = signal<NewLevelTemplate>('empty');

  /**
   * Abre la carpeta del editor al arrancar. Ya no hay que elegir ninguna: es
   * siempre la misma (ver ipc/project-root.js), y la primera vez se crea con
   * una copia de los niveles y recursos del repositorio.
   */
  async openWorkspace(): Promise<void> {
    if (!this.hasFileSystem) {
      return;
    }
    try {
      const info = await this.project.workspaceInfo();
      await this.refreshProject();
      if (info.seeded.length > 0) {
        this.note(
          'Carpeta del editor creada en ' + info.root + '. Se copiaron del repositorio: ' +
            info.seeded.join(', ') + '.',
        );
      }
    } catch (error) {
      this.note('No se pudo preparar la carpeta del editor: ' + this.describe(error));
    }
  }

  /**
   * Elige otra carpeta del editor. El nivel abierto se cierra: su archivo es
   * de la carpeta anterior, y guardarlo despues escribiria en la nueva algo que
   * apunta a texturas que alli no estan.
   */
  async changeWorkspace(): Promise<void> {
    if (!this.hasFileSystem) {
      this.note('Sin acceso a disco. Abre el editor con "npm run electron".');
      return;
    }
    if (this.dirty() && !window.confirm('Hay cambios sin guardar en el nivel. ¿Cambiar de carpeta igual y perderlos?')) {
      return;
    }
    try {
      const root = await this.project.changeWorkspace();
      if (!root) {
        return;
      }
      this.levels.createNew('nuevo_nivel');
      this.lastSavedPath.set(null);
      this.dirty.set(false);
      await this.refreshProject();
      this.view.frameAll();
    } catch (error) {
      this.note('No se pudo cambiar la carpeta del editor: ' + this.describe(error));
    }
  }

  /** Abre la carpeta del editor en el explorador del sistema. */
  async revealWorkspace(): Promise<void> {
    if (!this.hasFileSystem) {
      return;
    }
    try {
      await this.project.revealWorkspace();
    } catch (error) {
      this.note('No se pudo abrir la carpeta: ' + this.describe(error));
    }
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
      // Las miniaturas no se cargan aca: cada una se pide cuando aparece en
      // pantalla (ver TextureThumbDirective). Solo se descarta lo que hubiera
      // de antes, que puede ser de otra carpeta.
      this.tex.invalidate();
      // El explorador arranca con la raiz y nada desplegado, como VS Code.
      await this.explorer.loadRoot();
      this.note('Carpeta del editor: ' + this.project.projectRoot());
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
   * El dialogo arranca en levels/. Un .json de fuera de la carpeta del editor
   * se IMPORTA: el proceso principal lo copia a levels/ con sus texturas y
   * sonidos, y lo que se abre es la copia. Asi todo lo que se guarde despues
   * queda en la carpeta del editor, y el original no se toca.
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

      // Uno que esta justo en levels/ se adopta con su nombre: aparece en el
      // desplegable y guardar no vuelve a preguntar. Uno de una subcarpeta se
      // abre igual, pero Guardar pide nombre y lo escribe en levels/.
      const direct = /^levels\/[^/]+$/i.test(opened.relativePath)
        ? opened.relativePath.slice('levels/'.length)
        : null;
      this.levels.adopt(opened.level, direct);
      this.lastSavedPath.set(this.absolutePath(opened.relativePath));
      this.dirty.set(false);
      this.view.frameAll();

      if (opened.imported) {
        await this.afterImport(opened.imported);
      } else {
        this.note('Abierto ' + opened.relativePath + ' (' + this.entities().length + ' entidades).');
      }
    } catch (error) {
      this.note('No se pudo abrir: ' + this.describe(error));
    }
  }

  /** Deja al dia la lista de niveles y las texturas despues de importar un nivel, y cuenta que paso. */
  private async afterImport(imported: LevelImport): Promise<void> {
    this.levelFiles.set(await this.project.listLevels());
    await this.explorer.reloadDir('levels');
    if (imported.copied > 0) {
      await this.tex.reloadLibrary();
    }
    const parts = ['Nivel importado a levels/' + imported.fileName + ' (el original no se tocó)'];
    if (imported.copied > 0) {
      parts.push(imported.copied + ' recursos copiados');
    }
    if (imported.kept > 0) {
      parts.push(imported.kept + ' ya estaban en la carpeta del editor');
    }
    if (imported.missing.length > 0) {
      const names = imported.missing.slice(0, 3).join(', ') + (imported.missing.length > 3 ? '…' : '');
      parts.push(imported.missing.length + ' no se encontraron (' + names + ')');
    }
    this.note(parts.join('; ') + '.');
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
    // Un nivel nuevo no tiene archivo: Ejecutar no puede caer en el anterior.
    this.lastSavedPath.set(null);
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

  /**
   * Guarda el nivel en levels/ de la carpeta del editor. Si ya tiene archivo lo
   * escribe sin preguntar; si no (uno nuevo, o uno abierto de una subcarpeta),
   * pide el nombre con Guardar como.
   */
  async save(): Promise<void> {
    if (!this.hasFileSystem) {
      this.note('Sin acceso a disco. Abre el editor con "npm run electron".');
      return;
    }
    if (!this.levels.fileName()) {
      await this.saveAs();
      return;
    }
    await this.writeLevel();
  }

  /**
   * Guardar como: pide un nombre y guarda en levels/ de la carpeta del editor.
   *
   * Antes abria el dialogo del sistema, que dejaba guardar en cualquier parte
   * (Descargas, el escritorio...) y un nivel guardado afuera perdia sus
   * texturas en el runtime, que las busca relativas al nivel. Ahora el nivel
   * siempre queda junto a sus assets.
   */
  async saveAs(): Promise<void> {
    if (!this.hasFileSystem) {
      this.note('Sin acceso a disco. Abre el editor con "npm run electron".');
      return;
    }

    const current = this.levels.fileName();
    const answer = await this.prompt.ask({
      title: 'Guardar nivel como',
      label: 'Nombre',
      value: (current ?? this.levels.level().name).replace(/\.json$/i, ''),
      confirmLabel: 'Guardar',
      hint: 'Se guarda en levels/ de la carpeta del editor.',
    });
    if (answer === null) {
      return; // se cancelo
    }

    const fileName = levelFileName(answer);
    const taken = this.levelFiles().some((file) => file.toLowerCase() === fileName.toLowerCase());
    const isSame = current?.toLowerCase() === fileName.toLowerCase();
    if (taken && !isSame && !window.confirm('Ya existe levels/' + fileName + '. ¿Reemplazarlo?')) {
      return;
    }

    this.levels.fileName.set(fileName);
    if (!(await this.writeLevel())) {
      // No se escribio: el nivel sigue siendo el de antes, no el del nombre nuevo.
      this.levels.fileName.set(current);
    }
  }

  /** Escribe el nivel en levels/<fileName> y deja el editor al dia. Devuelve si se pudo. */
  private async writeLevel(): Promise<boolean> {
    try {
      await this.levels.save();
      this.dirty.set(false);
      this.lastSavedPath.set(null);
      this.levelFiles.set(await this.project.listLevels());
      await this.explorer.reloadDir('levels');
      this.note('Guardado en levels/' + this.levels.fileName());
      return true;
    } catch (error) {
      this.note('Error al guardar: ' + this.describe(error));
      return false;
    }
  }

  /** Ruta absoluta de algo de la carpeta del editor, a partir de su ruta relativa. */
  private absolutePath(relativePath: string): string | null {
    const root = this.project.projectRoot();
    return root ? root.replace(/[\\/]$/, '') + '/' + relativePath : null;
  }

  /**
   * Ruta absoluta del archivo del nivel abierto, o null si todavia no se
   * guardo. Si vive justo en levels/ se arma con su nombre; si se abrio de una
   * subcarpeta, es la ruta con que se abrio.
   */
  private currentLevelPath(): string | null {
    const fileName = this.levels.fileName();
    return fileName ? this.absolutePath('levels/' + fileName) : this.lastSavedPath();
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

    await this.engine.launch(levelPath);
  }
}
