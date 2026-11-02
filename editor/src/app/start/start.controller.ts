import { Signal, WritableSignal, computed, effect, inject, signal, untracked } from '@angular/core';

import {
  RecentFile,
  addRecent,
  folderName,
  levelTitle,
  parseRecents,
  removeRecent,
  sameRoot,
  timeAgo,
} from '../core/recent-files';
import { ProjectController } from '../project/project.controller';
import { LevelService } from '../services/level.service';
import { ProjectService } from '../services/project.service';

const RECENTS_KEY = 'honeycomb.recentLevels';
const SHOW_KEY = 'honeycomb.showStartScreen';

/** Una fila de la lista de Inicio, ya con los textos que muestra. */
export interface StartRow {
  entry: RecentFile;
  title: string;
  folder: string;
  when: string;
  /** Es de la carpeta abierta ahora. */
  here: boolean;
}

/** Lo que la pantalla de Inicio recibe del editor. */
export interface StartDeps {
  proj: ProjectController;
  hasFileSystem: boolean;
  dirty: Signal<boolean>;
}

/**
 * La pantalla de Inicio: lo primero que se ve al abrir el editor, como en
 * Premiere, Photoshop o GameMaker. A la izquierda crear o abrir; a la derecha
 * los niveles que se abrieron o guardaron hace poco, de cualquier carpeta.
 *
 * Los recientes se anotan solos: cada vez que el nivel abierto pasa a tener
 * archivo en levels/ (se abrio, se guardo, se guardo como), con la carpeta del
 * editor de ese momento. Se guardan en este equipo (localStorage).
 *
 * Es un controlador y no un componente por la misma razon que los demas: el
 * estado vive en App y el markup en dialogs/start-screen.html.
 */
export class StartController {
  private readonly project = inject(ProjectService);
  private readonly levels = inject(LevelService);

  readonly open = signal(false);
  readonly recents: WritableSignal<RecentFile[]> = signal(parseRecents(read(RECENTS_KEY)));
  /** "Mostrar al iniciar": se puede apagar, como en los programas que la tienen. */
  readonly showOnStartup = signal(read(SHOW_KEY) !== 'false');
  /** La entrada que se esta abriendo, para mostrarla ocupada y no abrir dos. */
  readonly busy = signal<RecentFile | null>(null);
  /** Lo que salio mal al abrir una entrada, para mostrarlo en su fila. */
  readonly failure = signal<{ entry: RecentFile; message: string } | null>(null);

  /** Para "hace 5 min": se recalcula al abrir la pantalla, no a cada segundo. */
  private readonly now = signal(Date.now());

  readonly rows = computed<StartRow[]>(() => {
    const now = this.now();
    const root = this.project.projectRoot();
    return this.recents().map((entry) => ({
      entry,
      title: levelTitle(entry.level),
      folder: folderName(entry.root),
      when: timeAgo(entry.openedAt, now),
      here: !!root && sameRoot(root, entry.root),
    }));
  });

  /**
   * Sin recientes (la primera vez), los niveles de la carpeta abierta: algo
   * para abrir con un clic en vez de una lista vacia.
   */
  readonly folderLevels = computed(() => (this.recents().length ? [] : this.deps.proj.levelFiles()));

  readonly currentFolder = computed(() => {
    const root = this.project.projectRoot();
    return root ? folderName(root) : null;
  });

  constructor(private readonly deps: StartDeps) {
    // Mira el archivo y el cambio de nivel, no la carpeta: al cambiar de
    // carpeta, la nueva se anota antes de cerrar el nivel de la anterior, y
    // mirandola se anotaria ese nivel en una carpeta que no es la suya.
    effect(() => {
      const level = this.levels.fileName();
      this.levels.generation();
      const root = untracked(() => this.project.projectRoot());
      if (root && level) {
        untracked(() => this.remember({ root, level, openedAt: Date.now() }));
      }
    });
  }

  /** Al arrancar, despues de preparar la carpeta. Si se recupero un nivel sin guardar, no tapa ese trabajo. */
  openAtStartup(): void {
    if (this.deps.hasFileSystem && this.showOnStartup() && !this.deps.dirty()) {
      this.show();
    }
  }

  show(): void {
    this.now.set(Date.now());
    this.failure.set(null);
    this.open.set(true);
  }

  close(): void {
    this.open.set(false);
  }

  setShowOnStartup(show: boolean): void {
    this.showOnStartup.set(show);
    write(SHOW_KEY, String(show));
  }

  forget(entry: RecentFile): void {
    this.update(removeRecent(this.recents(), entry));
    if (this.failure()?.entry === entry) {
      this.failure.set(null);
    }
  }

  async openRecent(entry: RecentFile): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(entry);
    this.failure.set(null);
    try {
      const result = await this.deps.proj.openRecent(entry.root, entry.level);
      if (result === 'ok') {
        this.close();
      } else if (result !== 'cancelado') {
        this.failure.set({ entry, message: result.error });
      }
    } finally {
      this.busy.set(null);
    }
  }

  /** Un nivel de la carpeta abierta (la lista de la primera vez). */
  async openFolderLevel(level: string): Promise<void> {
    if (await this.deps.proj.loadLevel(level)) {
      this.close();
    }
  }

  /**
   * Los botones de la izquierda. Los que abren un dialogo del sistema pueden
   * cancelarse: la pantalla se cierra solo si se abrio o creo algo (el nivel
   * abierto cambio). "Nuevo nivel" abre el dialogo del editor, que va encima.
   */
  async run(action: 'nuevo-proyecto' | 'abrir-carpeta' | 'abrir-nivel' | 'nuevo-nivel'): Promise<void> {
    const proj = this.deps.proj;
    if (action === 'nuevo-nivel') {
      this.close();
      proj.newLevel();
      return;
    }
    const before = this.levels.generation();
    if (action === 'nuevo-proyecto') {
      await proj.newProject();
    } else if (action === 'abrir-carpeta') {
      await proj.changeWorkspace();
    } else {
      await proj.openLevelFile();
    }
    if (this.levels.generation() !== before) {
      this.close();
    }
  }

  private remember(entry: RecentFile): void {
    this.update(addRecent(this.recents(), entry));
  }

  private update(list: RecentFile[]): void {
    this.recents.set(list);
    write(RECENTS_KEY, JSON.stringify(list));
  }
}

function read(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Sin almacenamiento (modo privado, cuota llena): se pierde la lista, no el trabajo.
  }
}
