import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';

import { describeLevelChange } from '../core/level-diff';
import { UndoHistory } from '../core/undo-history';
import { Level } from '../models/level.model';
import { LevelService } from './level.service';
import { SelectionService } from './selection.service';

/** Pasos que se recuerdan. Son referencias a niveles inmutables: no copian nada. */
const HISTORY_LIMIT = 200;

/** true si el elemento es un campo donde se escribe o se elige. */
function isField(target: EventTarget | null): boolean {
  const tag = (target as HTMLElement | null)?.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (target as HTMLElement | null)?.isContentEditable === true;
}

/**
 * Deshacer y rehacer del nivel (Ctrl+Z / Ctrl+Y), como en la herramienta de
 * sprites.
 *
 * NO HAY QUE AVISARLE NADA. Mira el nivel de LevelService y anota cada version
 * nueva, venga de donde venga: el viewport, el inspector, los eventos, un
 * dialogo. Por eso ningun controlador sabe que existe, y lo que se agregue
 * despues queda cubierto solo. Funciona porque el nivel es inmutable (ver
 * core/undo-history.ts).
 *
 * QUE ES UN PASO. Los cambios se agrupan por la accion de quien edita, que se
 * sigue con los eventos de la ventana:
 *   - un clic o un arrastre, del pointerdown al siguiente: mover una entidad
 *     arrastrandola se deshace entera, no de a un movimiento del mouse;
 *   - lo que se escribe en un campo mientras tiene el foco: un nombre se
 *     deshace entero, no de a una letra;
 *   - cada atajo de teclado (borrar, duplicar, las flechas) es su propio paso.
 *
 * Abrir o crear un nivel no se puede deshacer: el historial vuelve a cero.
 */
@Injectable({ providedIn: 'root' })
export class LevelHistoryService {
  private readonly levels = inject(LevelService);
  private readonly selection = inject(SelectionService);

  private readonly history = new UndoHistory<Level>(HISTORY_LIMIT);

  /** El ultimo nivel anotado: el "antes" del proximo cambio. */
  private seen: Level = this.levels.level();
  private seenGeneration = this.levels.generation();
  /** El nivel tal como esta en disco, para saber si deshacer volvio a el. */
  private clean: Level = this.seen;

  /** La accion en curso: los cambios que llegan con la misma se funden en un paso. */
  private action: string | null = null;
  private actionCount = 0;
  /** Sube al entrar a un campo: lo escrito en otra visita es otro paso. */
  private fieldVisit = 0;

  /** Sube con cada cambio del historial: el historial no es un signal y los computed lo necesitan. */
  private readonly version = signal(0);

  /** Tambien con un cambio que el efecto todavia no anoto: deshacer lo anota primero (ver flush). */
  readonly canUndo = computed(() => {
    this.version();
    return this.history.canUndo || this.levels.level() !== this.seen;
  });

  readonly canRedo = computed(() => {
    this.version();
    return this.history.canRedo;
  });

  /** Lo que desharia el boton ("mover player_1"), o '' si no hay nada. */
  readonly undoLabel = computed(() => {
    this.version();
    const target = this.history.peekUndo();
    return target ? describeLevelChange(target, this.levels.level()) : '';
  });

  /** Lo que rehacer volveria a hacer, o '' si no hay nada. */
  readonly redoLabel = computed(() => {
    this.version();
    const target = this.history.peekRedo();
    return target ? describeLevelChange(this.levels.level(), target) : '';
  });

  constructor() {
    effect(() => {
      const level = this.levels.level();
      const generation = this.levels.generation();
      untracked(() => this.observe(level, generation));
    });

    // En fase de captura: tienen que verse ANTES que el handler que cambia el
    // nivel, para que su cambio quede anotado con esta accion y no con la de antes.
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', () => this.startAction('clic'), true);
      window.addEventListener(
        'keydown',
        (event) => {
          if (isField(event.target)) {
            this.action = 'campo-' + this.fieldVisit;
          } else {
            this.startAction('tecla');
          }
        },
        true,
      );
      window.addEventListener(
        'focusin',
        (event) => {
          if (isField(event.target)) {
            this.fieldVisit += 1;
          }
        },
        true,
      );
    }
  }

  /** Deshace un paso. Devuelve lo que deshizo, o null si no habia nada. */
  undo(): string | null {
    this.flush();
    const current = this.levels.level();
    const previous = this.history.undo(current);
    if (!previous) {
      return null;
    }
    this.restore(previous);
    return describeLevelChange(previous, current);
  }

  /** Rehace un paso. Devuelve lo que rehizo, o null si no habia nada. */
  redo(): string | null {
    this.flush();
    const current = this.levels.level();
    const next = this.history.redo(current);
    if (!next) {
      return null;
    }
    this.restore(next);
    return describeLevelChange(current, next);
  }

  /** true si el nivel es el mismo que esta guardado en disco. */
  isClean(): boolean {
    return this.levels.level() === this.clean;
  }

  /** El nivel de ahora es el que esta en disco (se acaba de guardar o de abrir). */
  markClean(): void {
    this.clean = this.levels.level();
  }

  /**
   * Anota ya un cambio que el efecto todavia no vio. Los efectos corren con la
   * deteccion de cambios, no en el acto: sin esto, un Ctrl+Z que llega antes
   * se saltearia el ultimo cambio y lo perderia.
   */
  private flush(): void {
    this.observe(this.levels.level(), this.levels.generation());
  }

  private startAction(kind: string): void {
    this.actionCount += 1;
    this.action = kind + '-' + this.actionCount;
  }

  private observe(level: Level, generation: number): void {
    if (generation !== this.seenGeneration) {
      this.seenGeneration = generation;
      this.seen = level;
      this.clean = level;
      this.history.clear();
      this.version.update((value) => value + 1);
      return;
    }
    if (level === this.seen) {
      return;
    }
    this.history.record(this.seen, this.action);
    this.seen = level;
    this.version.update((value) => value + 1);
  }

  private restore(level: Level): void {
    // Anotado como visto ANTES de ponerlo: para el efecto no es un cambio nuevo.
    this.seen = level;
    this.levels.level.set(level);
    // La seleccion no puede quedar apuntando a entidades que el paso quito.
    const present = new Set(level.entities.map((entity) => entity.id));
    const gone = this.selection.selectedEntityIds().filter((id) => !present.has(id));
    if (gone.length > 0) {
      this.selection.forget(new Set(gone));
    }
    this.version.update((value) => value + 1);
  }
}
