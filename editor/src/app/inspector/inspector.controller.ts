import { inject } from '@angular/core';

import { characterOf, defaultStatsFor } from '../core/characters';
import { EntityStats, GridConfig, LevelEntity } from '../models/level.model';
import { LevelService } from '../services/level.service';
import { SelectionService } from '../services/selection.service';

/**
 * Los formularios del inspector: lo que se escribe en el panel de propiedades
 * de la entidad activa (posicion, recorte, collider, animacion, estadisticas)
 * y del nivel (grilla y nombre).
 *
 * Cada patch* parte de la entidad ACTIVA -- la ultima seleccionada, la que
 * muestra el inspector -- aunque haya varias seleccionadas: un campo de
 * formulario solo puede mostrar un valor a la vez. Las operaciones que
 * afectan a toda la seleccion (borrar, duplicar, mover, colision) estan en
 * entities/entity-ops.controller.ts.
 */
export class InspectorController {
  private readonly levels = inject(LevelService);
  private readonly selection = inject(SelectionService);

  /** La entidad activa, resuelta. undefined si no hay ninguna. */
  private readonly selected = this.levels.selectedEntity;

  constructor(private readonly markDirty: () => void) {}

  /** Las caracteristicas se muestran para personajes, y para todo lo que ya tenga "stats". */
  isCharacter(entity: LevelEntity): boolean {
    return characterOf(entity) !== undefined || entity.stats !== undefined;
  }

  statsOf(entity: LevelEntity): EntityStats {
    return entity.stats ?? defaultStatsFor(entity.type);
  }

  /** Cuadros que anima el motor, contando el "player_idle" de los niveles viejos. */
  effectiveFrames(entity: LevelEntity): number {
    return entity.frames ?? (entity.animation === 'player_idle' ? 2 : 1);
  }

  effectiveFrameDuration(entity: LevelEntity): number {
    return entity.frameDuration ?? (entity.animation === 'player_idle' ? 0.4 : 0.15);
  }

  patchEntityStats(field: keyof EntityStats, value: number): void {
    const entity = this.selected();
    if (!entity) {
      return;
    }
    this.patchEntity({ stats: { ...this.statsOf(entity), [field]: Math.max(0, value) } });
  }

  /**
   * Cuadros de animacion de la entidad. Se quita "animation" en el mismo paso:
   * el nombre de clip viejo solo cuenta mientras no haya "frames", y dejarlo
   * suelto confundiria a quien lea el JSON.
   */
  patchEntityFrames(value: number): void {
    const entity = this.selected();
    if (!entity) {
      return;
    }
    const frames = Math.max(1, Math.round(value) || 1);
    this.patchEntity({
      frames: frames > 1 ? frames : undefined,
      frameDuration: frames > 1 ? this.effectiveFrameDuration(entity) : undefined,
      animation: undefined,
    });
  }

  patchEntityFrameDuration(value: number): void {
    const entity = this.selected();
    if (!entity) {
      return;
    }
    const frames = this.effectiveFrames(entity);
    this.patchEntity({
      frames: frames > 1 ? frames : undefined,
      frameDuration: value > 0 ? value : 0.15,
      animation: undefined,
    });
  }

  patchEntityScale(value: number): void {
    const scale = value > 0 ? value : 1;
    this.patchEntity({ scale: scale === 1 ? undefined : scale });
  }

  /**
   * Aplica un cambio parcial a la entidad seleccionada. Es el paso obligado de
   * todo el inspector: un solo lugar que marca "dirty" y que reengancha la
   * seleccion si lo que cambio fue el propio id (si no, se perderia).
   */
  patchEntity(changes: Partial<LevelEntity>): void {
    const id = this.selection.selectedEntityId();
    if (!id) {
      return;
    }
    this.levels.updateEntity(id, changes);
    this.markDirty();
    if (changes.id && changes.id !== id) {
      this.selection.selectEntity(changes.id);
    }
  }

  // Los patch* de abajo existen porque estos campos son objetos anidados: hay
  // que reconstruir el objeto entero, no se puede tocar una sola clave.

  patchPosition(axis: 'col' | 'row', value: number): void {
    const entity = this.selected();
    if (!entity) {
      return;
    }
    this.patchEntity({ position: { ...entity.position, [axis]: value } });
  }

  patchSourceRect(field: 'x' | 'y' | 'width' | 'height', value: number): void {
    const entity = this.selected();
    if (!entity) {
      return;
    }
    this.patchEntity({ sourceRect: { ...entity.sourceRect, [field]: value } });
  }

  patchCollider(field: 'width' | 'height', value: number): void {
    const entity = this.selected();
    if (!entity || !entity.collider) {
      return;
    }
    this.patchEntity({ collider: { ...entity.collider, [field]: value } });
  }

  patchGrid(changes: Partial<GridConfig>): void {
    this.levels.updateGrid(changes);
    this.markDirty();
  }

  renameLevel(name: string): void {
    this.levels.level.update((level) => ({ ...level, name }));
    this.markDirty();
  }

  /** Fondo del runtime. Sin "backgroundColor" el motor usa RAYWHITE, asi que se muestra ese. */
}
