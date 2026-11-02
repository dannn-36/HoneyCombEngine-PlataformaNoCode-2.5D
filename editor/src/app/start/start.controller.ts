import { Signal, computed, effect, inject, signal, untracked } from '@angular/core';

import { sameRoot, timeAgo } from '../core/recent-files';
import type { RecentProject } from '../electron-api';
import { ProjectController } from '../project/project.controller';
import { LevelService } from '../services/level.service';
import { ProjectService } from '../services/project.service';

/** Una fila de la lista de Inicio, ya con los textos que muestra. */
export interface StartRow {
  entry: RecentProject;
  title: string;
  when: string;
  /** Es el proyecto abierto ahora. */
  here: boolean;
}

/** Lo que la pantalla de Inicio recibe del editor. */
export interface StartDeps {
  proj: ProjectController;
  hasFileSystem: boolean;
  dirty: Signal<boolean>;
}

/** Los botones de la izquierda de Inicio. */
export type StartAction = 'nuevo-proyecto' | 'ejemplo' | 'abrir-proyecto' | 'abrir-nivel' | 'nuevo-nivel';

/**
 * La pantalla de Inicio: donde se elige el proyecto, como en Godot, Unity o
 * GameMaker. A la izquierda crear o abrir; a la derecha los proyectos
 * recientes. Sin proyecto abierto es lo que se ve al arrancar, y no se puede
 * cerrar: cada juego es un proyecto, y el editor no tiene donde guardar nada
 * sin uno.
 *
 * La lista la guarda el proceso principal (ver ipc/project-root.js), que
 * tambien es quien decide a que carpetas se puede volver sin dialogo.
 *
 * Es un controlador y no un componente por la misma razon que los demas: el
 * estado vive en App y el markup en dialogs/start-screen.html.
 */
export class StartController {
  private readonly project = inject(ProjectService);
  private readonly levels = inject(LevelService);

  readonly open = signal(false);
  readonly recents = signal<RecentProject[]>([]);
  /** La entrada que se esta abriendo, para mostrarla ocupada y no abrir dos. */
  readonly busy = signal<RecentProject | null>(null);
  /** Lo que salio mal al abrir una entrada, para mostrarlo en su fila. */
  readonly failure = signal<{ entry: RecentProject; message: string } | null>(null);

  /** Para "hace 5 min": se recalcula al abrir la pantalla, no a cada segundo. */
  private readonly now = signal(Date.now());

  readonly rows = computed<StartRow[]>(() => {
    const now = this.now();
    const root = this.project.projectRoot();
    return this.recents().map((entry) => ({
      entry,
      title: entry.name,
      // Las que vienen de la version anterior no tienen fecha.
      when: entry.openedAt > 0 ? timeAgo(entry.openedAt, now) : '',
      here: !!root && sameRoot(root, entry.root),
    }));
  });

  /** El nombre del juego abierto, o null. */
  readonly currentProject = computed(() => this.project.project()?.name ?? null);

  /** Sin proyecto (en el editor de escritorio), Inicio no se puede cerrar. */
  readonly canClose = computed(() => !this.deps.hasFileSystem || this.project.projectRoot() !== null);

  constructor(private readonly deps: StartDeps) {
    // Al abrir (o cambiar de) proyecto la lista cambia de orden, y si Inicio
    // estaba abierto ya cumplio: se cierra.
    effect(() => {
      const root = this.project.projectRoot();
      untracked(() => {
        void this.reload();
        if (root) {
          this.open.set(false);
        }
      });
    });
  }

  /** Al arrancar, despues de preparar el editor: sin proyecto abierto, hay que elegir uno. */
  openAtStartup(): void {
    if (this.deps.hasFileSystem && !this.project.projectRoot()) {
      this.show();
    }
  }

  show(): void {
    this.now.set(Date.now());
    this.failure.set(null);
    this.open.set(true);
    void this.reload();
  }

  close(): void {
    if (this.canClose()) {
      this.open.set(false);
    }
  }

  /** Relee la lista de recientes del proceso principal. */
  async reload(): Promise<void> {
    if (!this.deps.hasFileSystem) {
      return;
    }
    try {
      this.recents.set(await this.project.recentProjects());
    } catch {
      // Sin lista se puede seguir: abrir y crear no la necesitan.
    }
  }

  async forget(entry: RecentProject): Promise<void> {
    try {
      await this.project.forgetRecentProject(entry.root);
    } finally {
      if (this.failure()?.entry === entry) {
        this.failure.set(null);
      }
      await this.reload();
    }
  }

  async openRecent(entry: RecentProject): Promise<void> {
    if (this.busy()) {
      return;
    }
    this.busy.set(entry);
    this.failure.set(null);
    try {
      const result = await this.deps.proj.openRecent(entry.root);
      if (result === 'ok') {
        this.close();
      } else if (result !== 'cancelado') {
        this.failure.set({ entry, message: result.error });
      }
    } finally {
      this.busy.set(null);
    }
  }

  /**
   * Los botones de la izquierda. Abrir un proyecto (o un nivel de otro) cierra
   * Inicio solo, al cambiar el proyecto (ver el effect del constructor). Nuevo
   * proyecto y Proyecto de ejemplo abren su dialogo encima; "Nuevo nivel" abre
   * el del nivel, y Inicio se cierra para dejarlo a la vista.
   */
  async run(action: StartAction): Promise<void> {
    const proj = this.deps.proj;
    switch (action) {
      case 'nuevo-nivel':
        this.close();
        proj.newLevel();
        return;
      case 'nuevo-proyecto':
        proj.newProject(false);
        return;
      case 'ejemplo':
        proj.newProject(true);
        return;
      case 'abrir-proyecto':
        await proj.openProject();
        return;
      case 'abrir-nivel': {
        const before = this.levels.generation();
        await proj.openLevelFile();
        if (this.levels.generation() !== before) {
          this.close();
        }
        return;
      }
    }
  }
}
