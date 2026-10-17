import { computed, inject } from '@angular/core';

import { cameraOf } from '../core/camera';
import { ENGINE_PLAYER_ID, characterOf, defaultStatsFor } from '../core/characters';
import { ParamTypeLookup, eventsUsingEntity, renameEntityInEvents } from '../core/entity-refs';
import { SHAPES, shapeDef, usesShapeSheet } from '../core/iso-shapes';
import { CameraConfig, EntityStats, GridConfig, LevelEntity } from '../models/level.model';
import { CatalogService } from '../services/catalog.service';
import { LevelService } from '../services/level.service';
import { SelectionService } from '../services/selection.service';

/**
 * Lo que puede ser una entidad, en palabras del juego. El value es el "type"
 * que guarda el nivel, asi que elegir aca escribe exactamente lo mismo que
 * antes se tipeaba a mano.
 */
export const ROLE_OPTIONS: readonly { value: string; label: string; hint: string }[] = [
  { value: 'player', label: 'Jugador', hint: 'Lo controla quien juega. Su inventario y su combate se configuran abajo.' },
  { value: 'enemy', label: 'Enemigo', hint: 'Ataca al jugador y recibe daño. Configúralo abajo, en Combate.' },
  { value: 'npc', label: 'NPC con tienda', hint: 'El jugador se acerca, aprieta E y le compra. Lo que vende se elige abajo.' },
  { value: 'item', label: 'Objeto para juntar', hint: 'El jugador lo junta al tocarlo. Elige abajo qué objeto es.' },
  { value: 'obstacle', label: 'Obstáculo', hint: 'Un estorbo del mapa. Marca «Choca con su forma» para que no se atraviese.' },
  { value: 'prop', label: 'Decoración', hint: 'Adorna el nivel. No hace nada en el juego hasta que un evento lo use.' },
];

const SHAPE_HINT = 'Una figura para armar el nivel. No hace nada en el juego hasta que un evento la use.';
const OTHER_HINT = 'Un tipo propio: el motor no le da ningún comportamiento. Cámbialo en Avanzado.';

/**
 * Los formularios del inspector: lo que se escribe en el panel de propiedades
 * de la entidad activa (posicion, recorte, collider, animacion, estadisticas)
 * y del nivel (grilla, nombre y camara).
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

  private readonly catalog = inject(CatalogService);

  /** La entidad activa, resuelta. undefined si no hay ninguna. */
  private readonly selected = this.levels.selectedEntity;

  constructor(
    private readonly markDirty: () => void,
    private readonly note: (message: string) => void,
  ) {}

  // --- Nombre ------------------------------------------------------------------
  //
  // El nombre ("id" en el nivel) es lo que usan los eventos para encontrar una
  // entidad. Por eso se valida que sea unico y, al cambiarlo, se reescriben
  // los eventos que lo nombran: si no, quedarian apuntando a algo que ya no
  // existe y el motor los ignoraria sin avisar.

  /** Tipo de cada param segun el catalogo de eventos (ver core/entity-refs.ts). */
  private readonly paramType: ParamTypeLookup = (kind, stepType, param) => {
    const entry =
      kind === 'trigger'
        ? this.catalog.findTrigger(stepType)
        : kind === 'condition'
          ? this.catalog.findCondition(stepType)
          : this.catalog.findAction(stepType);
    return entry?.params[param]?.type;
  };

  /** Cuantos eventos del nivel nombran a esta entidad. */
  eventCount(id: string): number {
    return eventsUsingEntity(this.levels.level().events, id, this.paramType).length;
  }

  /** true si es la entidad que el motor mueve con las flechas. */
  isEnginePlayer(entity: LevelEntity): boolean {
    return entity.id === ENGINE_PLAYER_ID;
  }

  /**
   * Renombra la entidad activa con lo escrito en el campo. Si el nombre no
   * sirve (vacio o repetido) avisa y devuelve el campo a como estaba.
   */
  renameEntity(input: HTMLInputElement): void {
    const entity = this.selected();
    if (!entity) {
      return;
    }
    const next = input.value.trim();
    if (next === entity.id) {
      input.value = entity.id;
      return;
    }
    if (!next) {
      input.value = entity.id;
      this.note('El nombre no puede quedar vacío.');
      return;
    }
    if (this.levels.level().entities.some((other) => other.id === next)) {
      input.value = entity.id;
      this.note('Ya hay otro objeto llamado "' + next + '". Elige otro nombre.');
      return;
    }

    const renamed = renameEntityInEvents(this.levels.level().events, entity.id, next, this.paramType);
    this.levels.level.update((level) => ({
      ...level,
      events: renamed.events,
      entities: level.entities.map((other) => (other.id === entity.id ? { ...other, id: next } : other)),
    }));
    this.selection.selectEntity(next);
    this.markDirty();

    let message = '"' + entity.id + '" ahora se llama "' + next + '".';
    if (renamed.changed > 0) {
      message += ' ' + (renamed.changed === 1 ? 'Se actualizó 1 evento' : 'Se actualizaron ' + renamed.changed + ' eventos') + ' que lo usaban.';
    }
    if (entity.id === ENGINE_PLAYER_ID) {
      message += ' Ojo: el motor solo mueve con las flechas al que se llama "' + ENGINE_PLAYER_ID + '".';
    } else if (next === ENGINE_PLAYER_ID && entity.type === 'player') {
      message += ' Ahora es el jugador que se mueve con las flechas.';
    }
    this.note(message);
  }

  // --- Que es ------------------------------------------------------------------

  readonly roleOptions = ROLE_OPTIONS;
  /** Las figuras agrupadas por material, para los grupos del desplegable. */
  readonly shapeGroups = [...new Set(SHAPES.map((shape) => shape.materialLabel))].map((label) => ({
    label,
    shapes: SHAPES.filter((shape) => shape.materialLabel === label),
  }));

  /** true si dibuja del sheet de figuras: puede cambiar de figura sin perder el dibujo. */
  usesShapeSheet(entity: LevelEntity): boolean {
    return usesShapeSheet(entity.texture);
  }

  /** true si "Que es" tiene que ofrecer las figuras: dibuja del sheet, o su type ya es una figura. */
  showsShapes(entity: LevelEntity): boolean {
    return usesShapeSheet(entity.texture) || shapeDef(entity.type) !== undefined;
  }

  /** true si el type no es un rol ni una figura: un tipo propio escrito a mano. */
  isCustomKind(entity: LevelEntity): boolean {
    return !ROLE_OPTIONS.some((option) => option.value === entity.type) && !shapeDef(entity.type);
  }

  /** La ayuda corta de lo que hace en el juego. */
  kindHint(entity: LevelEntity): string {
    const role = ROLE_OPTIONS.find((option) => option.value === entity.type);
    if (role) {
      return role.hint;
    }
    return shapeDef(entity.type) ? SHAPE_HINT : OTHER_HINT;
  }

  /**
   * Cambia lo que es la entidad. Pasar a otra figura trae su recorte y su
   * apoyo, para que se dibuje esa figura; cualquier otro cambio solo toca el
   * type, asi que el dibujo se conserva.
   */
  setKind(value: string): void {
    const entity = this.selected();
    if (!entity || !value || value === entity.type) {
      return;
    }
    const shape = shapeDef(value);
    if (shape && usesShapeSheet(entity.texture)) {
      this.patchEntity({ type: value, sourceRect: { ...shape.sourceRect }, groundOffset: shape.groundOffset });
    } else {
      this.patchEntity({ type: value });
    }
  }

  // --- Nivel -------------------------------------------------------------------

  /** true si las casillas tienen la proporcion isometrica de siempre, ancho = 2 x alto. */
  readonly tileRatioOk = computed(() => {
    const grid = this.levels.level().grid;
    return grid.tileWidth === grid.tileHeight * 2;
  });

  /** true si el nivel tiene a quien seguir la camara. */
  readonly hasEnginePlayer = computed(() =>
    this.levels.level().entities.some((entity) => entity.id === ENGINE_PLAYER_ID),
  );

  readonly enginePlayerId = ENGINE_PLAYER_ID;

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

  // --- Camara del runtime ----------------------------------------------------
  //
  // La pestana Escena configura la camara que va a usar el motor. El editor no
  // la simula: su viewport sigue mostrando el nivel entero, que es lo que hace
  // falta para armarlo.

  /** La camara del nivel con todo resuelto, para mostrar los campos aunque el nivel no la declare. */
  readonly camera = computed(() => cameraOf(this.levels.level()));

  /** true si el nivel declara su propia camara; si no, usa la de siempre. */
  readonly hasCustomCamera = computed(() => this.levels.level().camera !== undefined);

  patchCamera(changes: Partial<CameraConfig>): void {
    this.levels.updateCamera(changes);
    this.markDirty();
  }

  patchDeadzone(field: 'width' | 'height', value: number): void {
    this.patchCamera({ deadzone: { ...this.camera().deadzone, [field]: value } });
  }

  /** Vuelve a la camara de siempre: quita el bloque del nivel. */
  resetCamera(): void {
    this.levels.resetCamera();
    this.markDirty();
  }
}
