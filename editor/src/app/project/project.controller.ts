import { WritableSignal, computed, effect, inject, signal, untracked } from '@angular/core';

import { EventsController } from '../events/events.controller';
import { ItemLibraryService } from '../services/item-library.service';
import { CatalogService } from '../services/catalog.service';
import { CharacterPresetService } from '../services/character-preset.service';
import { GameConfigService } from '../services/game-config.service';
import { LevelService } from '../services/level.service';
import { LevelChangedOnDiskError, ProjectService, writeOrConfirm } from '../services/project.service';
import { TexturesController } from '../textures/textures.controller';
import { ViewportController } from '../viewport/viewport.controller';
import { EngineController } from './engine.controller';
import { ExplorerController } from './explorer.controller';
import { DEFAULT_STARTER_TEXTURE } from '../entities/entity-ops.controller';
import { GridConfig, Level } from '../models/level.model';
import { levelFileName, safeName } from '../core/file-names';
import { sameRoot } from '../core/recent-files';
import type { EngineStart, LevelImport, ProjectInfo } from '../electron-api';
import { NamePromptController } from '../ui/name-prompt.controller';
import { SoundsController } from '../sounds/sounds.controller';

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
  /** Los sonidos del proyecto (Recursos › Sonidos). */
  sounds: SoundsController;
  /** Muestra la pantalla de Inicio (sin proyecto, es donde se elige uno). */
  showStart: () => void;
}

/**
 * El PROYECTO y el NIVEL COMO DOCUMENTO: abrir, crear y cerrar proyectos, y
 * dentro del proyecto abrir, crear, guardar, guardar como y ejecutar niveles.
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
  private readonly gameConfig = inject(GameConfigService);

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
  private readonly sounds: SoundsController;
  private readonly showStart: () => void;

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
    this.sounds = deps.sounds;
    this.showStart = deps.showStart;

    // El nivel que se esta editando queda anotado como el ultimo del proyecto,
    // para volver a el al reabrirlo desde Inicio. Mira el archivo y el cambio
    // de nivel, no el proyecto: al cambiar de proyecto el nivel se cierra
    // ANTES de que el proyecto nuevo quede puesto (ver enterProject).
    effect(() => {
      const level = this.levels.fileName();
      this.levels.generation();
      if (this.hasFileSystem && level && untracked(() => this.project.projectRoot())) {
        void this.project.rememberLevel(level).catch(() => {});
      }
    });

    // Guardado automatico: con cambios sin guardar, una copia del nivel cada
    // pocos segundos (ver scheduleRecovery). Mira el nivel y la marca de
    // cambios; recien despues de ofrecer la copia que hubiera al arrancar, para
    // no borrarla antes de preguntar (al arrancar no hay cambios).
    effect(() => {
      const dirty = this.dirty();
      this.levels.level();
      if (this.hasFileSystem && this.recoveryArmed()) {
        untracked(() => this.scheduleRecovery(dirty));
      }
    });
  }

  // --- Guardado automatico y recuperacion -------------------------------------
  //
  // Si el editor se cierra de golpe con cambios sin guardar, al volver a
  // abrirlo se ofrece recuperarlos. La copia vive fuera de la carpeta del
  // editor (ver ipc/recovery.js) y nunca pisa el nivel: recuperarla deja el
  // nivel abierto y "sin guardar", y lo que se haga con el es decision de quien
  // edita.

  /** Cuanto se espera despues del ultimo cambio para escribir la copia. */
  static readonly RECOVERY_DELAY_MS = 4000;

  /** false hasta haber ofrecido la copia del arranque. */
  private readonly recoveryArmed = signal(false);

  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;

  /** Hay una copia escrita en esta sesion que todavia no se borro. */
  private recoveryWritten = false;

  /**
   * Con cambios, escribe la copia al rato del ultimo (escribir en cada tecla
   * seria escribir el nivel entero decenas de veces por segundo). Sin cambios
   * (se guardo, se abrio otro nivel, se deshizo hasta lo guardado), la borra.
   */
  private scheduleRecovery(dirty: boolean): void {
    if (this.recoveryTimer !== null) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    if (!dirty) {
      if (this.recoveryWritten) {
        this.recoveryWritten = false;
        void this.project.clearRecovery().catch(() => {});
      }
      return;
    }
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      void this.writeRecoveryNow();
    }, ProjectController.RECOVERY_DELAY_MS);
  }

  private async writeRecoveryNow(): Promise<void> {
    if (!this.dirty()) {
      return;
    }
    try {
      await this.project.writeRecovery({
        level: this.levels.level(),
        fileName: this.levels.fileName(),
        openedPath: this.lastSavedPath(),
      });
      this.recoveryWritten = true;
    } catch (error) {
      // La copia es una red de seguridad: si falla, se avisa una vez y se sigue editando.
      if (!this.recoveryFailedNoted) {
        this.recoveryFailedNoted = true;
        this.note('No se pudo hacer la copia de seguridad automática del nivel: ' + this.describe(error));
      }
    }
  }

  private recoveryFailedNoted = false;

  /**
   * Al arrancar: si quedo una copia de una sesion que se corto, pregunta si se
   * quiere recuperar. Si si, el nivel se abre como estaba y queda sin guardar;
   * si no, la copia se borra.
   */
  private async offerRecovery(): Promise<boolean> {
    let recovered;
    try {
      recovered = await this.project.readRecovery();
    } catch {
      recovered = null;
    }
    if (!recovered) {
      return false;
    }
    const name = recovered.fileName ?? recovered.level.name;
    const when = new Date(recovered.savedAt);
    const time = Number.isNaN(when.getTime())
      ? ''
      : ' (' + when.toLocaleDateString() + ' ' + when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) + ')';
    const accept = window.confirm(
      `El editor se cerró sin guardar los cambios del nivel «${name}»${time}. ¿Recuperarlos?\n\n` +
        'Se abren como estaban, sin guardar: para conservarlos usa Archivo › Guardar. Si eliges Cancelar, se descartan.',
    );
    if (!accept) {
      await this.project.clearRecovery().catch(() => {});
      this.note('Se descartaron los cambios sin guardar de la sesión anterior.');
      return false;
    }
    this.levels.adopt(recovered.level, recovered.fileName);
    this.lastSavedPath.set(recovered.openedPath);
    this.dirty.set(true);
    this.recoveryWritten = true;
    this.view.frameAll();
    this.note('Recuperados los cambios sin guardar de «' + name + '». Guarda para conservarlos.');
    return true;
  }

  /**
   * Borra la copia del guardado automatico ya mismo: se eligio perder los
   * cambios y lo que sigue cambia de proyecto o recarga la ventana. Se borra
   * ANTES de cambiar: despues, el proceso principal ya esta en el otro
   * proyecto y la copia de este no se encuentra (y se ofreceria al volver).
   */
  async discardRecovery(): Promise<void> {
    if (this.recoveryTimer !== null) {
      clearTimeout(this.recoveryTimer);
      this.recoveryTimer = null;
    }
    this.recoveryWritten = false;
    if (this.hasFileSystem) {
      await this.project.clearRecovery().catch(() => {});
    }
  }

  /**
   * Al final no se cambio de proyecto (se cancelo el dialogo, o fallo): si el
   * nivel sigue con cambios, se vuelve a programar su copia, que se borro antes
   * de intentarlo.
   */
  private rearmRecovery(): void {
    if (this.hasFileSystem && this.dirty()) {
      this.scheduleRecovery(true);
    }
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
   * La imagen de las plantillas con jugador: player.png si el proyecto la tiene
   * (todo proyecto nuevo la trae), y si no la primera de Recursos.
   */
  readonly starterTexture = computed(() => {
    const textures = this.tex.textures();
    return textures.includes(DEFAULT_STARTER_TEXTURE) ? DEFAULT_STARTER_TEXTURE : (textures[0] ?? DEFAULT_STARTER_TEXTURE);
  });

  /** Por que no se pudo crear el nivel (el nombre ya existe), dentro del dialogo. */
  readonly newLevelError = signal<string | null>(null);

  /** Hay un proyecto abierto: sin el no se puede crear ni guardar un nivel. */
  readonly hasProject = computed(() => this.project.projectRoot() !== null);

  // --- Dialogo de proyecto nuevo ------------------------------------------------

  readonly showNewProjectDialog = signal(false);

  /** true: copia del juego de ejemplo; false: proyecto vacio. */
  readonly newProjectExample = signal(false);

  readonly newProjectName = signal('');

  /** Donde se crean los proyectos (la elige el dialogo del sistema y la recuerda el proceso principal). */
  readonly newProjectLocation = signal('');

  readonly newProjectError = signal<string | null>(null);

  readonly newProjectBusy = signal(false);

  /** La carpeta que se va a crear, para mostrarla antes de crearla. Vacio si el nombre no sirve. */
  readonly newProjectFolder = computed(() => {
    const location = this.newProjectLocation().replace(/[\\/]+$/, '');
    const folder = safeName(this.newProjectName().trim(), '');
    if (!location || !folder) {
      return '';
    }
    return location + (location.includes('\\') ? '\\' : '/') + folder;
  });

  /**
   * Al arrancar: sin proyecto (se elige en Inicio), salvo que el editor se haya
   * abierto con doble clic en un .honey. Desde aca tambien se escuchan los
   * doble clic en un .honey con el editor ya abierto.
   */
  async openWorkspace(): Promise<void> {
    if (!this.hasFileSystem) {
      return;
    }
    try {
      this.project.onOpenRequested((fileName) => void this.openRequested(fileName));
      const info = await this.project.workspaceInfo();
      this.newProjectLocation.set(info.location);
      if (info.error) {
        this.note(info.error);
      }
      if (info.project) {
        await this.enterProject(info.project);
      }
    } catch (error) {
      this.note('No se pudo preparar el editor: ' + this.describe(error));
    } finally {
      this.recoveryArmed.set(true);
    }
  }

  /**
   * Deja el editor en el proyecto "info", que el proceso principal ya abrio:
   * cierra el nivel del anterior, relee niveles, recursos y configuracion, y
   * abre un nivel. "open" es el nivel a abrir (Abrir nivel de otro proyecto);
   * sin el, primero se ofrece recuperar los cambios sin guardar que hubieran
   * quedado de este proyecto, y si no, se abre el ultimo nivel que se edito,
   * el nivel inicial del juego o el primero de levels/.
   */
  private async enterProject(
    info: ProjectInfo,
    open?: { relativePath: string; contents: string; level: Level },
  ): Promise<void> {
    // El nivel se cierra antes de poner el proyecto nuevo: nada tiene que ver
    // el proyecto nuevo con el nivel del viejo (ver el effect de rememberLevel).
    this.levels.createNew('nuevo_nivel');
    this.lastSavedPath.set(null);
    this.dirty.set(false);
    this.project.setProject(info);
    await this.refreshProject();
    this.view.frameAll();

    if (open) {
      this.project.rememberOpened(open.relativePath, open.contents);
      this.adoptOpened(open.relativePath, open.level);
      this.note('Proyecto «' + info.name + '»: abierto ' + open.relativePath + '.');
      return;
    }
    if (await this.offerRecovery()) {
      return;
    }
    const files = this.levelFiles();
    const exists = (file: string | null | undefined): file is string =>
      !!file && files.some((other) => other.toLowerCase() === file.toLowerCase());
    const first = [info.lastLevel, this.gameConfig.config().startLevel, files[0]].find(exists);
    if (first) {
      await this.loadLevel(first);
    } else {
      this.note('El proyecto «' + info.name + '» todavía no tiene niveles: crea uno con Archivo › Nuevo nivel (Ctrl+N).');
    }
  }

  /**
   * Cambia de proyecto con "open" (un dialogo, un reciente...), que devuelve
   * el proyecto ya abierto en el proceso principal o null si no se cambio.
   * Pregunta antes por los cambios sin guardar. Devuelve si se cambio.
   */
  private async switchProject(action: string, open: () => Promise<ProjectInfo | null>): Promise<boolean> {
    if (!this.hasFileSystem) {
      this.note('Sin acceso a disco. Abre el editor con "npm run electron".');
      return false;
    }
    if (!this.confirmDiscard(action)) {
      return false;
    }
    await this.discardRecovery();
    let info: ProjectInfo | null;
    try {
      info = await open();
    } catch (error) {
      this.rearmRecovery();
      throw error;
    }
    if (!info) {
      this.rearmRecovery();
      return false;
    }
    await this.enterProject(info);
    return true;
  }

  /** Archivo › Abrir proyecto…: elegir el .honey (o una carpeta de antes, que se ofrece convertir). */
  async openProject(): Promise<void> {
    try {
      await this.switchProject('Abrir otro proyecto', () => this.project.openProject());
    } catch (error) {
      this.note('No se pudo abrir el proyecto: ' + this.describe(error));
    }
  }

  /** Doble clic en un .honey con el editor abierto. */
  private async openRequested(fileName: string): Promise<void> {
    try {
      await this.switchProject('Abrir el proyecto ' + fileName, () => this.project.openRequestedProject());
    } catch (error) {
      this.note('No se pudo abrir ' + fileName + ': ' + this.describe(error));
    }
  }

  /**
   * Abre un proyecto reciente (pantalla de Inicio, Archivo › Proyectos
   * recientes). Devuelve "ok", "cancelado" (habia cambios y no se quisieron
   * perder, o no se quiso convertir) o el motivo por el que no se pudo, para
   * mostrarlo junto a la entrada.
   */
  async openRecent(root: string): Promise<'ok' | 'cancelado' | { error: string }> {
    if (!this.hasFileSystem) {
      return { error: 'Sin acceso a disco. Abre el editor con "npm run electron".' };
    }
    const current = this.project.projectRoot();
    if (current && sameRoot(current, root)) {
      return 'ok';
    }
    try {
      return (await this.switchProject('Abrir otro proyecto', () => this.project.openRecentProject(root)))
        ? 'ok'
        : 'cancelado';
    } catch (error) {
      return { error: this.describe(error) };
    }
  }

  /**
   * Archivo › Nuevo proyecto… (o Proyecto de ejemplo…): abre el dialogo que
   * pide el nombre del juego y muestra donde se va a crear.
   */
  newProject(example = false): void {
    if (!this.hasFileSystem) {
      this.note('Sin acceso a disco. Abre el editor con "npm run electron".');
      return;
    }
    this.newProjectExample.set(example);
    this.newProjectName.set(example ? 'Ejemplo HoneyComb' : '');
    this.newProjectError.set(null);
    this.showNewProjectDialog.set(true);
  }

  cancelNewProject(): void {
    if (!this.newProjectBusy()) {
      this.showNewProjectDialog.set(false);
    }
  }

  /** "Elegir…" del dialogo de proyecto nuevo: la ubicacion de los proyectos, con el dialogo del sistema. */
  async chooseProjectLocation(): Promise<void> {
    try {
      const location = await this.project.chooseProjectsLocation();
      if (location) {
        this.newProjectLocation.set(location);
        this.newProjectError.set(null);
      }
    } catch (error) {
      this.newProjectError.set(this.describe(error));
    }
  }

  /**
   * Crea el proyecto y pasa a trabajar ahi. Uno vacio sigue con el dialogo de
   * nivel nuevo con el jugador ya puesto (las imagenes basicas vienen con el
   * proyecto); el de ejemplo abre su nivel.
   */
  async confirmNewProject(): Promise<void> {
    const name = this.newProjectName().trim();
    if (!name) {
      this.newProjectError.set('Escribe un nombre para el juego.');
      return;
    }
    if (this.newProjectBusy() || !this.confirmDiscard('Crear un proyecto nuevo')) {
      return;
    }
    const example = this.newProjectExample();
    this.newProjectBusy.set(true);
    this.newProjectError.set(null);
    try {
      await this.discardRecovery();
      const created = await this.project.createProject({ name, example });
      this.showNewProjectDialog.set(false);
      await this.enterProject(created.project);
      this.note('Proyecto «' + created.project.name + '» creado en ' + created.project.root + '.');
      if (!example) {
        this.newLevel();
        this.newLevelName.set('nivel_1');
        this.newLevelTemplate.set('player');
      }
    } catch (error) {
      this.rearmRecovery();
      this.newProjectError.set(this.describe(error));
    } finally {
      this.newProjectBusy.set(false);
    }
  }

  /**
   * true si se puede reemplazar el nivel abierto por otro: no tiene cambios sin
   * guardar, o la persona acepta perderlos. Lo pregunta TODO lo que cambia el
   * nivel abierto (abrir, nuevo, el desplegable, el explorador, cambiar de
   * proyecto).
   */
  confirmDiscard(action = 'Abrir otro nivel'): boolean {
    return !this.dirty() || window.confirm(`Hay cambios sin guardar en el nivel. ¿${action} igual y perderlos?`);
  }

  /**
   * Archivo › Cerrar proyecto: el editor queda sin proyecto y vuelve a Inicio
   * para elegir otro.
   */
  async closeProject(): Promise<void> {
    if (!this.hasFileSystem || !this.project.projectRoot()) {
      return;
    }
    if (!this.confirmDiscard('Cerrar el proyecto')) {
      return;
    }
    try {
      await this.discardRecovery();
      const name = this.project.project()?.name ?? '';
      await this.project.closeProject();
      this.levels.createNew('nuevo_nivel');
      this.lastSavedPath.set(null);
      this.dirty.set(false);
      await this.refreshProject();
      this.view.frameAll();
      this.note('Proyecto «' + name + '» cerrado.');
      this.showStart();
    } catch (error) {
      this.note('No se pudo cerrar el proyecto: ' + this.describe(error));
    }
  }

  /** Abre la carpeta del proyecto en el explorador del sistema. */
  async revealWorkspace(): Promise<void> {
    if (!this.hasFileSystem || !this.project.projectRoot()) {
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
    if (!this.project.projectRoot()) {
      // Sin proyecto no hay nada que leer: se vacia lo del anterior.
      this.levelFiles.set([]);
      this.tex.textures.set([]);
      this.tex.invalidate();
      await this.sounds.reload();
      await this.explorer.loadRoot();
      this.presetsService.presets.set([]);
      this.itemLibrary.items.set([]);
      this.gameConfig.reset();
      return;
    }
    try {
      this.levelFiles.set(await this.project.listLevels());
      this.tex.textures.set(await this.project.listTextures());
      await this.sounds.reload();
      // Las miniaturas no se cargan aca: cada una se pide cuando aparece en
      // pantalla (ver TextureThumbDirective). Solo se descarta lo que hubiera
      // de antes, que puede ser de otra carpeta.
      this.tex.invalidate();
      // El explorador arranca con la raiz y nada desplegado, como VS Code.
      await this.explorer.loadRoot();
      this.note('Proyecto: ' + (this.project.project()?.name ?? '') + ' (' + this.project.projectRoot() + ')');
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

    // Y la configuracion del juego: sin ella (o rota) se edita igual, con la de
    // siempre. Rota se avisa, porque guardar desde la ventana la reemplazaria.
    try {
      await this.gameConfig.load();
    } catch (error) {
      this.gameConfig.reset();
      this.note('No se pudo leer game.json: ' + this.describe(error));
    }
  }

  /**
   * Abre un nivel eligiendo el archivo con el dialogo del sistema.
   *
   * El dialogo arranca en levels/. Un .json de OTRO proyecto cambia el editor
   * a ese proyecto y lo abre ahi: cada juego guarda sus niveles en su carpeta.
   * Uno suelto (que no es de ningun proyecto) se IMPORTA: el proceso principal
   * lo copia a levels/ con sus texturas y sonidos, y lo que se abre es la copia.
   */
  async openLevelFile(): Promise<void> {
    if (!this.hasFileSystem) {
      this.note('Sin acceso a disco. Abre el editor con "npm run electron".');
      return;
    }
    // Antes del dialogo y no despues: elegir un nivel ya puede cambiar de
    // proyecto o importarlo, y no tiene sentido hacerlo para despues no abrirlo.
    if (!this.confirmDiscard()) {
      return;
    }
    const wasDirty = this.dirty();
    if (wasDirty) {
      await this.discardRecovery();
    }
    try {
      const opened = await this.project.openLevelFile();
      if (!opened) {
        this.rearmRecovery();
        return; // el usuario cancelo el dialogo
      }
      if (opened.project) {
        await this.enterProject(opened.project, opened);
        return;
      }

      this.adoptOpened(opened.relativePath, opened.level);
      if (opened.imported) {
        await this.afterImport(opened.imported);
      } else {
        this.note('Abierto ' + opened.relativePath + ' (' + this.entities().length + ' entidades).');
      }
    } catch (error) {
      this.rearmRecovery();
      this.note('No se pudo abrir: ' + this.describe(error));
    }
  }

  /**
   * Deja abierto un nivel recien leido. Uno que esta justo en levels/ se adopta
   * con su nombre: aparece en el desplegable y guardar no vuelve a preguntar.
   * Uno de una subcarpeta se abre igual, pero Guardar pide nombre y lo escribe
   * en levels/.
   */
  private adoptOpened(relativePath: string, level: Level): void {
    const direct = /^levels\/[^/]+$/i.test(relativePath) ? relativePath.slice('levels/'.length) : null;
    this.levels.adopt(level, direct);
    this.lastSavedPath.set(this.absolutePath(relativePath));
    this.dirty.set(false);
    this.view.frameAll();
  }

  /** Deja al dia la lista de niveles y las texturas despues de importar un nivel, y cuenta que paso. */
  private async afterImport(imported: LevelImport): Promise<void> {
    this.levelFiles.set(await this.project.listLevels());
    await this.explorer.reloadDir('levels');
    if (imported.copied > 0) {
      await this.tex.reloadLibrary();
    }
    const parts = ['Nivel importado a levels/' + imported.fileName + ' del proyecto (el original no se tocó)'];
    if (imported.copied > 0) {
      parts.push(imported.copied + ' recursos copiados');
    }
    if (imported.kept > 0) {
      parts.push(imported.kept + ' ya estaban en el proyecto');
    }
    if (imported.missing.length > 0) {
      const names = imported.missing.slice(0, 3).join(', ') + (imported.missing.length > 3 ? '…' : '');
      parts.push(imported.missing.length + ' no se encontraron (' + names + ')');
    }
    this.note(parts.join('; ') + '.');
  }

  /**
   * Abre un nivel del proyecto y recentra la camara sobre el. Devuelve si se
   * abrio: false si se cancelo por cambios sin guardar o si fallo la lectura
   * (el desplegable lo usa para volver a mostrar el nivel que sigue abierto).
   */
  async loadLevel(fileName: string): Promise<boolean> {
    if (!this.confirmDiscard()) {
      return false;
    }
    try {
      await this.levels.load(fileName);
      this.dirty.set(false);
      // Sin recentrar, un nivel chico abierto despues de uno grande podria
      // quedar fuera de la vista o entrar con un zoom que no le corresponde.
      this.view.frameAll();
      this.note('Nivel "' + fileName + '" cargado (' + this.entities().length + ' entidades).');
      return true;
    } catch (error) {
      this.note('Error al cargar ' + fileName + ': ' + this.describe(error));
      return false;
    }
  }

  /**
   * Abre el dialogo de nivel nuevo, con los valores siempre en su default. Sin
   * proyecto abierto no hay donde crearlo: se muestra Inicio para elegir uno.
   */
  newLevel(): void {
    if (this.hasFileSystem && !this.project.projectRoot()) {
      this.note('Primero crea o abre un proyecto: cada nivel se guarda dentro de su juego.');
      this.showStart();
      return;
    }
    if (!this.confirmDiscard('Crear un nivel nuevo')) {
      return;
    }
    this.newLevelError.set(null);
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
   * Crea el nivel con la plantilla elegida y lo escribe YA en levels/ del
   * proyecto abierto: aparece enseguida en el explorador y en la lista de
   * niveles, y es del juego que se esta editando. Si el proyecto todavia no
   * tiene nivel inicial, este pasa a serlo.
   *
   * Sin disco (el editor en un navegador) queda solo en memoria, como antes.
   */
  async confirmNewLevel(): Promise<void> {
    const name = this.newLevelName().trim() || 'nuevo_nivel';
    // Todo entero y >= 1: el schema exige enteros positivos, y el usuario
    // puede haber dejado el campo vacio o con decimales.
    const grid: GridConfig = {
      width: Math.max(1, Math.round(this.newLevelWidth())),
      height: Math.max(1, Math.round(this.newLevelHeight())),
      tileWidth: Math.max(1, Math.round(this.newLevelTileWidth())),
      tileHeight: Math.max(1, Math.round(this.newLevelTileHeight())),
    };

    if (!this.hasFileSystem) {
      this.createLevelInMemory(name, grid);
      this.note('Nivel nuevo en memoria. Revisa la escena y usa Guardar.');
      return;
    }
    if (!this.project.projectRoot()) {
      this.newLevelError.set('No hay ningún proyecto abierto.');
      return;
    }

    // La lista se relee: un archivo creado por fuera desde la ultima vez no se
    // puede pisar sin preguntar.
    const fileName = levelFileName(name);
    try {
      this.levelFiles.set(await this.project.listLevels());
    } catch (error) {
      this.newLevelError.set('No se pudo leer levels/: ' + this.describe(error));
      return;
    }
    if (this.levelFiles().some((file) => file.toLowerCase() === fileName.toLowerCase())) {
      this.newLevelError.set('Ya hay un nivel levels/' + fileName + ' en este proyecto. Elige otro nombre.');
      return;
    }

    this.createLevelInMemory(name, grid);
    this.levels.fileName.set(fileName);
    if (!(await this.writeLevel())) {
      // Queda abierto y sin guardar: con Guardar se puede reintentar.
      this.levels.fileName.set(null);
      return;
    }
    this.note('Nivel «' + name + '» creado en levels/' + fileName + ' del proyecto «' + (this.project.project()?.name ?? '') + '».');
    await this.useAsStartLevelIfNone(fileName);
  }

  /** El nivel nuevo, todavia sin archivo, con la plantilla del dialogo. */
  private createLevelInMemory(name: string, grid: GridConfig): void {
    this.levels.createNew(name, grid);
    // Un nivel nuevo no tiene archivo: Ejecutar no puede caer en el anterior.
    this.lastSavedPath.set(null);
    this.addStarterEntities(this.newLevelTemplate(), grid);
    this.showNewLevelDialog.set(false);
    this.dirty.set(true);
    this.view.frameAll();
  }

  /**
   * Si game.json no dice con que nivel empieza el juego, empieza con este: asi
   * el primer nivel de un proyecto ya se juega desde la portada y se exporta.
   * Se cambia en Archivo › Configuración del juego.
   */
  private async useAsStartLevelIfNone(fileName: string): Promise<void> {
    const config = this.gameConfig.config();
    if (config.startLevel) {
      return;
    }
    try {
      const saved = await writeOrConfirm(
        (options) => this.gameConfig.save({ ...config, startLevel: fileName }, options),
        'el nivel inicial nuevo',
      );
      if (saved) {
        this.note(fileName + ' quedó como nivel inicial del juego (se cambia en Archivo › Configuración del juego).');
      }
    } catch (error) {
      this.note('No se pudo poner ' + fileName + ' como nivel inicial: ' + this.describe(error));
    }
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

    const texture = this.starterTexture();

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
   * Guarda el nivel en levels/ del proyecto abierto. Si ya tiene archivo lo
   * escribe sin preguntar; si no (uno abierto de una subcarpeta, uno
   * recuperado), pide el nombre con Guardar como.
   */
  async save(): Promise<void> {
    if (!this.hasFileSystem) {
      this.note('Sin acceso a disco. Abre el editor con "npm run electron".');
      return;
    }
    if (!this.requireProject()) {
      return;
    }
    if (!this.levels.fileName()) {
      await this.saveAs();
      return;
    }
    await this.writeLevel();
  }

  /**
   * Guardar como: pide un nombre y guarda en levels/ del proyecto abierto.
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
    if (!this.requireProject()) {
      return;
    }

    const current = this.levels.fileName();
    const answer = await this.prompt.ask({
      title: 'Guardar nivel como',
      label: 'Nombre',
      value: (current ?? this.levels.level().name).replace(/\.json$/i, ''),
      confirmLabel: 'Guardar',
      hint: 'Se guarda en levels/ del proyecto «' + (this.project.project()?.name ?? '') + '».',
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
    // Reemplazar otro archivo ya se pregunto recien: no se vuelve a preguntar
    // aunque ese archivo haya cambiado en el disco.
    if (!(await this.writeLevel(taken && !isSame))) {
      // No se escribio: el nivel sigue siendo el de antes, no el del nombre nuevo.
      this.levels.fileName.set(current);
    }
  }

  /**
   * true si hay un proyecto abierto. Si no, lo avisa y muestra Inicio: un
   * nivel sin proyecto no tiene donde guardarse.
   */
  private requireProject(): boolean {
    if (this.project.projectRoot()) {
      return true;
    }
    this.note('Abre o crea un proyecto para guardar el nivel: cada nivel se guarda dentro de su juego.');
    this.showStart();
    return false;
  }

  /**
   * Escribe el nivel en levels/<fileName> y deja el editor al dia. Devuelve si
   * se pudo. Si el archivo cambio en el disco desde que se abrio, pregunta
   * antes de pisarlo (overwrite = ya se pregunto).
   */
  private async writeLevel(overwrite = false): Promise<boolean> {
    try {
      // Escribir es asincrono, y mientras tanto se puede seguir editando. Cada
      // cambio reemplaza el objeto del nivel, asi que si al terminar ya no es
      // el que se escribio, ese cambio NO esta en el disco y la marca de "sin
      // guardar" tiene que seguir prendida.
      const written = this.levels.level();
      await this.levels.save({ overwrite });
      if (this.levels.level() === written) {
        this.dirty.set(false);
      }
      this.lastSavedPath.set(null);
      this.levelFiles.set(await this.project.listLevels());
      await this.explorer.reloadDir('levels');
      this.note('Guardado en levels/' + this.levels.fileName());
      void this.reportSchemaProblems('levels/' + this.levels.fileName());
      return true;
    } catch (error) {
      if (error instanceof LevelChangedOnDiskError && !overwrite) {
        const replace = window.confirm(
          `${error.relativePath} cambió en el disco desde que lo abriste (otro programa, una copia del ` +
            'proyecto o git). ¿Reemplazarlo con lo que tienes en el editor?\n\n' +
            `La versión del disco quedará en ${error.relativePath}.bak.`,
        );
        if (replace) {
          return this.writeLevel(true);
        }
        this.note(
          'No se guardó: ' + error.relativePath + ' cambió en el disco. Guarda con otro nombre (Ctrl+Shift+S) ' +
            'para conservar los dos, o ábrelo de nuevo para ver la versión del disco.',
        );
        return false;
      }
      this.note('Error al guardar: ' + this.describe(error));
      return false;
    }
  }

  /**
   * Revisa contra schema/level.schema.json lo que se acaba de guardar y avisa
   * en la Consola lo que el motor rechazaria al cargarlo. Solo avisa: el nivel
   * ya esta guardado. Asi se ve al guardar, y no recien al Ejecutar.
   */
  private async reportSchemaProblems(relativePath: string): Promise<void> {
    let problems: string[];
    try {
      problems = await this.project.checkSavedLevel(relativePath);
    } catch {
      return; // Revisar es una ayuda: si no se puede, el guardado sigue valiendo.
    }
    if (problems.length === 0) {
      return;
    }
    this.note(
      `Aviso: ${relativePath} se guardó, pero el motor puede rechazarlo al ejecutarlo ` +
        `(${problems.length === 1 ? 'un problema' : problems.length + ' problemas'} con el formato del nivel):`,
    );
    for (const problem of problems) {
      this.note('  · ' + problem);
    }
  }

  /**
   * Archivo › Exportar juego…: arma el juego para Windows en una carpeta y un
   * .zip que se juegan sin el editor (ver ipc/export.js).
   *
   * Se exporta lo que esta en el DISCO, igual que Ejecutar corre lo del disco:
   * por eso guarda antes si hay cambios. Empieza en el nivel inicial de
   * game.json o, si no dice ninguno, en el nivel abierto.
   */
  async exportGame(confirmed = false): Promise<void> {
    if (!this.hasFileSystem) {
      this.note('Exportar necesita el editor de escritorio. Ábrelo con "npm run electron".');
      return;
    }
    if (!this.project.projectRoot()) {
      this.note('Abre un proyecto para exportarlo.');
      this.showStart();
      return;
    }
    if (this.dirty()) {
      await this.save();
      if (this.dirty()) {
        this.note('Guarda el nivel antes de exportar el juego.');
        return;
      }
    }

    const config = this.gameConfig.config();
    const startLevel = config.startLevel || this.levels.fileName();
    if (!startLevel) {
      this.note('Falta el nivel inicial: elígelo en Archivo › Configuración del juego › General, o guarda el nivel abierto.');
      return;
    }
    const name = config.name.trim() || 'Mi juego';
    if (
      !confirmed &&
      !window.confirm(
        `Exportar «${name}» para Windows, empezando en ${startLevel}.\n\n` +
          'Se copian todos los niveles y recursos del proyecto. Después eliges dónde guardarlo.',
      )
    ) {
      return;
    }

    this.note('Exportando «' + name + '»…');
    let result;
    try {
      result = await this.project.exportGame(startLevel);
    } catch (error) {
      this.note('No se pudo exportar el juego: ' + this.describe(error));
      return;
    }
    if (result.canceled) {
      this.note('Exportación cancelada.');
      return;
    }
    if (result.missing && !this.engine.canBuild()) {
      // La app instalada no compila: el motor Release venia con ella.
      this.note('No se pudo exportar el juego: falta el motor Release. Reinstala HoneyComb para recuperarlo.');
      return;
    }
    if (result.missing) {
      // El juego exportado lleva el motor Release. Sin el, se ofrece compilarlo
      // y se sigue sin volver a preguntar lo mismo.
      if (
        window.confirm(
          'Para exportar hace falta el motor Release, que todavía no está compilado. ¿Compilarlo ahora? ' +
            'La primera vez tarda unos minutos.',
        ) &&
        (await this.engine.build('release'))
      ) {
        await this.exportGame(true);
      }
      return;
    }
    if (!result.ok) {
      this.note('No se pudo exportar el juego: ' + (result.error ?? 'error desconocido'));
      return;
    }

    const megabytes = ((result.zipBytes ?? 0) / (1024 * 1024)).toFixed(1);
    this.note(`Juego exportado en ${result.folder} (${result.files} archivos; el .zip pesa ${megabytes} MB).`);
    const warnings = result.warnings ?? [];
    for (const warning of warnings.slice(0, 5)) {
      this.note('Aviso: ' + warning);
    }
    if (warnings.length > 5) {
      this.note(`… y ${warnings.length - 5} avisos más del mismo tipo.`);
    }
    if (window.confirm('Juego exportado. ¿Abrir la carpeta donde quedó?')) {
      await this.project.revealExport();
    }
  }

  /** Ruta absoluta de algo del proyecto abierto, a partir de su ruta relativa. */
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
   *
   * Arranca donde diga el selector de la barra (Nivel o Portada); Shift+F5
   * pasa el otro. En la portada se ve el juego completo, con su menu: Nueva
   * partida empieza en el nivel inicial de game.json, o en este si no hay uno.
   */
  async run(start: EngineStart = this.engine.start()): Promise<void> {
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

    await this.engine.launch(levelPath, start);
  }
}
