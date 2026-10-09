import { computed, inject, signal } from '@angular/core';

import { LevelService } from '../services/level.service';
import { ENGINE_PLAYER_ID } from '../core/characters';

/** Borrador del dialogo "Pasar a otro nivel". */
export /**
 * Borrador del dialogo "Pasar a otro nivel". Es un atajo para armar el evento
 * mas comun de un juego por niveles sin tener que componerlo a mano en el
 * panel Eventos: un trigger mas la accion load_level.
 */
interface TransitionDraft {
  /** Que dispara el paso: eliminar una entidad, vencer a todos, o tocar una entidad. */
  when: 'entity_destroyed' | 'all_enemies' | 'touch';
  entity: string;
  level: string;
  message: string;
}

/**
 * El dialogo "Pasar a otro nivel": la forma corta de armar el evento mas comun
 * de todos, "cuando pase X, cargar el nivel Y".
 *
 * No es un sistema aparte: lo que confirma es un evento normal (un trigger y
 * una accion load_level) que queda en el panel Eventos, donde se puede seguir
 * ajustando. Esto solo ahorra armarlo bloque por bloque.
 */
export class TransitionController {
  private readonly levels = inject(LevelService);

  private readonly entities = computed(() => this.levels.level().entities);
  private readonly entityIds = computed(() => this.entities().map((entity) => entity.id));

  constructor(
    private readonly note: (message: string) => void,
    private readonly markDirty: () => void,
    /** Los niveles del proyecto: los destinos posibles. */
    private readonly levelFiles: () => string[],
    /** Lleva al panel Eventos, donde queda el evento recien armado. */
    private readonly showEvents: () => void,
  ) {}

  readonly transitionDraft = signal<TransitionDraft | null>(null);

  /**
   * Propone lo mas probable: si hay enemigos, pasar al eliminar el primero;
   * si no, al tocar la primera entidad. El nivel de destino, el primero de
   * levels/ que no sea el que esta abierto.
   */
  openTransitionDialog(): void {
    const enemies = this.entities().filter((entity) => entity.type === 'enemy');
    const current = this.levels.fileName();
    this.transitionDraft.set({
      when: enemies.length > 0 ? 'entity_destroyed' : 'touch',
      entity: enemies[0]?.id ?? this.entityIds().find((id) => id !== ENGINE_PLAYER_ID) ?? '',
      level: this.levelFiles().find((file) => file !== current) ?? '',
      message: '¡Nivel superado!',
    });
  }

  patchTransitionDraft(changes: Partial<TransitionDraft>): void {
    this.transitionDraft.update((draft) => (draft ? { ...draft, ...changes } : draft));
  }

  /** El <select> devuelve texto: se valida antes de aceptarlo. */
  setTransitionWhen(value: string): void {
    if (value === 'entity_destroyed' || value === 'all_enemies' || value === 'touch') {
      this.patchTransitionDraft({ when: value });
    }
  }

  cancelTransitionDialog(): void {
    this.transitionDraft.set(null);
  }

  confirmTransitionDialog(): void {
    const draft = this.transitionDraft();
    if (!draft) {
      return;
    }
    const level = draft.level.trim();
    if (!level) {
      this.note('Elige el nivel al que se pasa.');
      return;
    }
    if (draft.when !== 'all_enemies' && !draft.entity) {
      this.note('Elige la entidad que dispara el paso de nivel.');
      return;
    }

    const trigger =
      draft.when === 'entity_destroyed'
        ? { type: 'on_entity_destroyed', params: { entity: draft.entity } }
        : draft.when === 'all_enemies'
          ? { type: 'on_all_enemies_defeated', params: {} }
          : // "Tocar" es siempre el jugador con esa entidad: es quien se mueve.
            { type: 'on_collision', params: { entityA: ENGINE_PLAYER_ID, entityB: draft.entity } };

    this.levels.addEvent({
      trigger,
      actions: [{ type: 'load_level', params: { level, message: draft.message.trim() } }],
    });
    this.transitionDraft.set(null);
    this.markDirty();
    // Se muestra el evento recien creado, que es donde se lo puede ajustar.
    this.showEvents();
    this.note('Evento creado: al cumplirse, el juego pasa a ' + level + '.');
  }
}
