import { computed, inject, signal } from '@angular/core';

import { GridCoord, IsoProjection } from '../core/iso-projection';
import {
  SHAPE_TEXTURE,
  ShapeDef,
  ShapeId,
  shapeCollider,
  shapeDef,
  shapeOf,
} from '../core/iso-shapes';
import { CharacterPreset } from '../models/character-preset.model';
import { GridPosition, LevelEntity } from '../models/level.model';
import { ItemLibraryService } from '../services/item-library.service';
import { LevelService } from '../services/level.service';
import { SelectionService } from '../services/selection.service';
import { ENGINE_PLAYER_ID, entityFromPreset } from '../core/characters';
import { blocksOverlap, clampBlockPosition, entitySpan, nextEntityId } from '../core/entity-blocks';
import { entityFromItem } from '../core/items';

/**
 * Algo que quedo esperando respuesta porque cayo sobre celdas ocupadas, y que
 * se puede resolver en los tres sentidos (reemplazar, superponer, cancelar)
 * sin rehacer el trabajo. Llega de dos lados:
 *   place  una entidad nueva, YA ARMADA, que todavia no se agrego
 *   move   entidades arrastradas con Ctrl que ya se movieron; "originals"
 *          guarda de donde salieron, para que Cancelar las devuelva ahi
 */
export type PendingPlacement =
  | { kind: 'place'; entity: LevelEntity; occupants: LevelEntity[] }
  | {
      kind: 'move';
      movedIds: string[];
      originals: Map<string, GridPosition>;
      occupants: LevelEntity[];
    };

/** Textura de respaldo si el proyecto abierto todavia no tiene ninguna. */
export const DEFAULT_STARTER_TEXTURE = 'player.png';

/**
 * Lo que EntityOpsController necesita del editor y no le corresponde decidir.
 *
 * Es el contrato entero hacia afuera, en un solo lugar: si algun dia hace falta
 * probar estas operaciones sin App, alcanza con implementar esto.
 */
export interface EntityOpsHost {
  note(message: string): void;
  markDirty(): void;
  /** Seleccionar algo tambien trae al frente su inspector: lo decide App. */
  selectEntity(id: string): void;
  findPreset(id: string): CharacterPreset | undefined;
  /** Lo elegido en la paleta: es lo que coloca la herramienta "place". */
  activeShape(): ShapeId | null;
  activeTexture(): string | null;
}

/**
 * Todo lo que MODIFICA las entidades del nivel: colocarlas, resolver una celda
 * ocupada, cambiarles el tamano, la colision o el rol de pared, y las
 * operaciones de grupo sobre la seleccion (borrar, duplicar, empujar).
 *
 * No sabe nada de punteros ni de canvas: recibe celdas ya calculadas. Quien
 * traduce clicks y arrastres a estas llamadas es el viewport, que esta un
 * nivel mas arriba y es el unico que depende de este controlador -- nunca al
 * reves.
 */
export class EntityOpsController {
  private readonly levels = inject(LevelService);
  private readonly selection = inject(SelectionService);
  private readonly itemLibrary = inject(ItemLibraryService);

  private readonly entities = computed(() => this.levels.level().entities);
  private readonly entityIds = computed(() => this.entities().map((entity) => entity.id));
  private readonly grid = computed(() => this.levels.level().grid);
  private readonly selectedIds = this.selection.selectedEntityIds;
  private readonly selectedSet = computed(() => new Set(this.selectedIds()));

  constructor(private readonly host: EntityOpsHost) {}

  private isSelected(id: string): boolean {
    return this.selectedSet().has(id);
  }

  // --- Celda ocupada --------------------------------------------------------
  //
  // Colocar algo donde ya hay otra cosa no se resuelve solo: antes se apilaba
  // sin avisar y las dos entidades quedaban en la misma casilla tapandose entre
  // si -- se veia una sola, y la de abajo aparecia unicamente en el outliner,
  // asi que lo normal era no enterarse hasta ejecutar el nivel. Ahora se
  // pregunta, y la respuesta esperable (reemplazar) es la que esta primera.

  /** Colocacion esperando respuesta porque la celda ya tenia algo. */
  readonly pendingPlacement = signal<PendingPlacement | null>(null);

  /**
   * Coloca un objeto para juntar. Su definicion se copia al nivel en el mismo
   * paso: una entidad que referencia un objeto que el nivel no define no la
   * junta nadie en el juego.
   */
  placeItem(coord: GridCoord, id: string): void {
    const item = this.itemLibrary.find(id);
    const grid = this.grid();
    if (!item || !new IsoProjection(grid.tileWidth, grid.tileHeight).isValidCoord(coord, grid.width, grid.height)) {
      return;
    }
    this.levels.upsertItems([item]);
    const entity = entityFromItem(item, coord, new Set(this.entityIds()));
    if (this.commitPlacement(entity)) {
      this.host.note(item.name + ' "' + entity.id + '" colocado. El jugador lo junta al tocarlo.');
    }
  }

  // --- Tamano de las figuras ------------------------------------------------
  //
  // Una figura puede ocupar un bloque de NxN celdas ("span" en el contrato),
  // y se cambia desde el menu del clic derecho. Solo las figuras: son volumenes
  // pensados para llenar casillas, mientras que agrandar cuatro veces un
  // personaje de 16 px solo lo dejaria pixelado.

  /** Tamanos que el menu ofrece de un clic; uno mas grande se escribe a mano. */
  readonly spanChoices = [1, 2, 3, 4];

  isShape(entity: LevelEntity): boolean {
    return shapeOf(entity) !== undefined;
  }

  spanOf(entity: LevelEntity): number {
    return entitySpan(entity);
  }

  /** El bloque mas grande que entra en la grilla del nivel. */
  maxSpan(): number {
    const grid = this.grid();
    return Math.max(1, Math.min(grid.width, grid.height));
  }

  /** Ids de las entidades que comparten alguna celda con el bloque de esta. */
  overlapIds(entity: LevelEntity): string[] {
    return this.entities()
      .filter((other) => other.id !== entity.id && blocksOverlap(other, entity))
      .map((other) => other.id);
  }

  /**
   * Cambia cuantas celdas por lado ocupa una figura.
   *
   * El collider crece con ella, porque el motor agranda el sprite entero y una
   * figura grande con la huella de una chica se dejaria atravesar casi toda. Si
   * el bloque no entra desde su celda, la figura se corre hacia adentro lo
   * justo, en vez de quedar con celdas fuera del mapa.
   */
  setSpan(id: string, requested: number): void {
    const entity = this.entities().find((candidate) => candidate.id === id);
    const shape = entity ? shapeOf(entity) : undefined;
    if (!entity || !shape) {
      return;
    }

    const grid = this.grid();
    const span = Math.min(this.maxSpan(), Math.max(1, Math.round(requested) || 1));
    const position = clampBlockPosition(entity.position, span, grid);
    const shifted = position.col !== entity.position.col || position.row !== entity.position.row;

    this.levels.updateEntity(id, {
      // 1 se omite: es el default del schema, y asi el JSON de lo que no se
      // agrando queda exactamente igual que antes de que existiera el campo.
      span: span === 1 ? undefined : span,
      position,
      // Solo se agranda el collider que ya tenia (con Colision o sensor): una
      // figura sin Colision sigue sin collider, y se sigue atravesando.
      collider: entity.collider
        ? { ...shapeCollider(shape, grid, span), solid: entity.collider.solid }
        : undefined,
    });
    this.host.markDirty();
    this.host.note(
      '"' + id + '" ocupa ' + span + '×' + span + ' celdas' +
        (shifted ? ', corrida a ' + position.col + ',' + position.row + ' para entrar en la grilla.' : '.'),
    );
  }

  // --- Colision y Pared -----------------------------------------------------
  //
  // Dos propiedades del contrato (ver schema/level.schema.json), excluyentes:
  // activar una apaga la otra.
  //
  //   ninguna  -> se atraviesa
  //   Colision -> collider.solid = true  bloquea solo el area de su collider,
  //                                      con la forma y el tamano de la figura
  //   Pared    -> wall = true            muro invisible en todo su tile (el
  //                                      bloque entero), sin importar la forma

  /** true si la entidad choca con su propia forma (casilla "Colision"). */
  hasCollision(entity: LevelEntity): boolean {
    return entity.collider?.solid === true;
  }

  /** true si la entidad bloquea el tile entero (casilla "Pared"). */
  isWall(entity: LevelEntity): boolean {
    return entity.wall === true;
  }

  /**
   * Activa o desactiva la Colision de una entidad.
   *
   * Al activarla, una figura recibe el collider de su forma (ver
   * shapeCollider); el resto conserva su caja, o la del tamano de su sprite.
   *
   * Al desactivarla, una figura se queda sin collider; el resto conserva la
   * caja como sensor, para que los eventos de contacto sigan andando.
   *
   * Activarla le quita la Pared: son excluyentes.
   */
  setCollision(id: string, enabled: boolean): void {
    const entity = this.entities().find((candidate) => candidate.id === id);
    if (!entity) {
      return;
    }

    const shape = shapeOf(entity);
    if (enabled) {
      const collider = shape
        ? shapeCollider(shape, this.grid(), entitySpan(entity))
        : {
            ...(entity.collider ?? { width: entity.sourceRect.width, height: entity.sourceRect.height }),
            solid: true,
          };
      this.levels.updateEntity(id, { collider, wall: undefined });
    } else {
      this.levels.updateEntity(id, { collider: this.colliderWithoutCollision(entity) });
    }
    this.host.markDirty();
    this.host.note(
      '"' + id + '" ' +
        (enabled
          ? 'ahora tiene colisión con su forma' + (entity.wall ? ' (se quitó la pared).' : '.')
          : 'ya no tiene colisión.'),
    );
  }

  /**
   * El collider de una entidad sin Colision: una figura se queda sin collider;
   * el resto conserva la caja como sensor (solid se omite: es el default).
   */
  private colliderWithoutCollision(entity: LevelEntity): LevelEntity['collider'] {
    return !shapeOf(entity) && entity.collider ? { ...entity.collider, solid: undefined } : undefined;
  }

  /** Lo mismo que setCollision, sobre toda la seleccion (la casilla del inspector). */
  setCollisionOnSelection(enabled: boolean): void {
    const ids = this.selectedIds();
    for (const id of ids) {
      this.setCollision(id, enabled);
    }
    if (ids.length > 1) {
      this.host.note(ids.length + ' entidades: ' + (enabled ? 'ahora tienen colisión.' : 'ya no tienen colisión.'));
    }
  }

  /**
   * Marca o desmarca una entidad como Pared: un muro invisible en todas las
   * celdas de su bloque. Activarla le quita la Colision: son excluyentes.
   */
  setWall(id: string, wall: boolean): void {
    const entity = this.entities().find((candidate) => candidate.id === id);
    if (!entity) {
      return;
    }
    const hadCollision = this.hasCollision(entity);
    this.levels.updateEntity(id, {
      // Se omite cuando es false: es el default del schema.
      wall: wall ? true : undefined,
      ...(wall && hadCollision ? { collider: this.colliderWithoutCollision(entity) } : {}),
    });
    this.host.markDirty();
    this.host.note(
      '"' + id + '" ' +
        (wall
          ? 'ahora es pared: bloquea todo el tile' + (hadCollision ? ' (se quitó la colisión).' : '.')
          : 'ya no es pared.'),
    );
  }

  /**
   * Lo mismo, pero sobre TODA la seleccion: es la casilla del inspector, que
   * con varias entidades elegidas tiene que aplicarles el cambio a todas.
   */
  setWallOnSelection(wall: boolean): void {
    const ids = this.selectedIds();
    for (const id of ids) {
      this.setWall(id, wall);
    }
    if (ids.length > 1) {
      this.host.note(ids.length + ' entidades: ' + (wall ? 'ahora son pared.' : 'ya no son pared.'));
    }
  }

  /**
   * Coloca un personaje en la celda indicada. Todos los valores salen del
   * personaje -- asset, recorte, cuadros, escala, colision, caracteristicas --
   * y se COPIAN a la entidad (ver entityFromPreset).
   *
   * El jugador es el unico caso especial, y no por capricho del editor: el
   * motor mueve con las flechas a la entidad con id "player_1" y a ninguna
   * otra, asi que el primer jugador que se coloque se queda con ese id.
   */
  placeCharacter(coord: GridCoord, presetId: string): void {
    const preset = this.host.findPreset(presetId);
    const grid = this.grid();
    if (!preset || !new IsoProjection(grid.tileWidth, grid.tileHeight).isValidCoord(coord, grid.width, grid.height)) {
      return;
    }

    const entity = entityFromPreset(preset, coord, new Set(this.entityIds()));
    const placed = this.commitPlacement(entity);

    // El aviso del jugador se da igual aunque la colocacion quede esperando:
    // habla del id, no de la celda, y es lo que hay que saber antes de decidir.
    if (preset.kind === 'player' && entity.id !== ENGINE_PLAYER_ID) {
      this.host.note(
        'Ya hay un "' + ENGINE_PLAYER_ID + '": el motor solo mueve a ese. "' +
          entity.id + '" queda como decorado hasta que le cambies el id.',
      );
    } else if (placed) {
      this.host.note(preset.name + ' "' + entity.id + '" colocado.');
    }
  }

  /**
   * Crea una entidad nueva en la celda indicada. Si "shape" viene, la entidad
   * es una primitiva de bloqueo; si no, se usa la textura activa.
   *
   * Las dos ramas producen una entidad IGUAL DE VALIDA para el motor: la figura
   * viaja en el "type" (texto libre, uso del editor) y la textura sigue siendo
   * obligatoria en las dos, porque el schema la exige. La diferencia es solo
   * como la dibuja el canvas del editor.
   */
  placeEntity(coord: GridCoord, shape: ShapeId | null = this.host.activeShape()): void {
    const grid = this.grid();
    const iso = new IsoProjection(grid.tileWidth, grid.tileHeight);
    if (!iso.isValidCoord(coord, grid.width, grid.height)) {
      this.host.note('Esa celda queda fuera de la grilla.');
      return;
    }

    const texture = this.host.activeTexture();
    if (!shape && !texture) {
      this.host.note('Elige una textura en Recursos o una primitiva en Figuras antes de colocar.');
      return;
    }

    // Una primitiva NO es un caso especial del nivel: es una entidad como
    // cualquier otra, apuntando a un recorte del spritesheet de figuras. Por
    // eso el runtime la dibuja sin saber nada de "figuras", y por eso el JSON
    // que sale de aca no tiene ni un campo inventado.
    const def = shape ? shapeDef(shape) : undefined;

    const entity: LevelEntity = def
      ? this.shapeEntity(coord, def)
      : {
          id: this.nextId('entidad'),
          type: 'prop',
          position: { col: coord.col, row: coord.row },
          // Prefijo "textures/": las rutas del nivel son relativas a assets/,
          // que es donde AssetResolver las busca del lado del motor.
          texture: 'textures/' + (texture ?? DEFAULT_STARTER_TEXTURE),
          sourceRect: { x: 0, y: 0, width: 16, height: 16 },
        };

    this.commitPlacement(entity);
  }

  shapeEntity(coord: GridCoord, def: ShapeDef): LevelEntity {
    return {
      id: this.nextId(def.id),
      type: def.id,
      position: { col: coord.col, row: coord.row },
      texture: SHAPE_TEXTURE,
      sourceRect: { ...def.sourceRect },
      // Sin esto el solido flota medio tile sobre su casilla: el motor
      // apoya el borde inferior del sprite en el punto de la celda, y un
      // solido tiene que apoyar ahi el centro del rombo de su base.
      groundOffset: def.groundOffset,
      // Sin collider ni pared: por defecto una figura se atraviesa. Las
      // casillas Colision y Pared del inspector se lo agregan.
    };
  }

  /**
   * Agrega la entidad, salvo que su celda ya este ocupada: en ese caso no toca
   * nada todavia y deja la colocacion esperando respuesta.
   *
   * Devuelve true si quedo colocada en el acto.
   */
  commitPlacement(entity: LevelEntity): boolean {
    // Por bloque y no por celda exacta: una figura de 3x3 ocupa nueve casillas,
    // y colocar algo en cualquiera de ellas es ponerlo encima.
    const occupants = this.entities().filter((other) => blocksOverlap(other, entity));
    if (occupants.length > 0) {
      this.pendingPlacement.set({ kind: 'place', entity, occupants });
      return false;
    }
    this.addPlaced(entity);
    return true;
  }

  addPlaced(entity: LevelEntity): void {
    this.levels.addEntity(entity);
    // Queda seleccionada para poder ajustarla en el inspector sin buscarla.
    this.host.selectEntity(entity.id);
    this.host.markDirty();
  }

  /** Saca lo que habia en esas celdas y deja lo nuevo, o lo que se movio. */
  replacePending(): void {
    const pending = this.pendingPlacement();
    if (!pending) {
      return;
    }
    this.pendingPlacement.set(null);
    this.levels.removeEntities(pending.occupants.map((entity) => entity.id));
    const replaced =
      pending.occupants.length === 1
        ? '"' + pending.occupants[0].id + '" reemplazada'
        : pending.occupants.length + ' entidades reemplazadas';

    if (pending.kind === 'place') {
      this.addPlaced(pending.entity);
      this.host.note(replaced + ' por "' + pending.entity.id + '".');
    } else {
      this.host.markDirty();
      this.host.note(replaced + ' por lo que moviste.');
    }
  }

  /** Deja todo en las mismas celdas, una cosa encima de la otra. */
  stackPending(): void {
    const pending = this.pendingPlacement();
    if (!pending) {
      return;
    }
    this.pendingPlacement.set(null);
    if (pending.kind === 'place') {
      this.addPlaced(pending.entity);
      this.host.note('"' + pending.entity.id + '" queda encima de lo que ya habia en esa celda.');
    } else {
      this.host.markDirty();
      this.host.note('Queda encima de lo que ya habia en esas celdas.');
    }
  }

  /** Descarta: una colocacion no se hace, y un movimiento vuelve a donde estaba. */
  cancelPending(): void {
    const pending = this.pendingPlacement();
    this.pendingPlacement.set(null);
    if (pending?.kind === 'move') {
      for (const [id, position] of pending.originals) {
        this.levels.updateEntity(id, { position });
      }
    }
  }

  /** Texto del dialogo de celdas ocupadas, segun de donde venga la espera. */
  pendingSummary(): string {
    const pending = this.pendingPlacement();
    if (!pending) {
      return '';
    }
    const there =
      pending.occupants.length === 1
        ? 'ya esta "' + pending.occupants[0].id + '"'
        : 'ya hay ' + pending.occupants.length + ' entidades';

    if (pending.kind === 'place') {
      const { col, row } = pending.entity.position;
      return (
        'En la celda ' + col + ',' + row + ' ' + there +
        '. Vas a colocar "' + pending.entity.id + '".'
      );
    }
    const what =
      pending.movedIds.length === 1
        ? '"' + pending.movedIds[0] + '"'
        : pending.movedIds.length + ' entidades';
    return 'Donde soltaste ' + what + ' ' + there + '. Cancelar lo devuelve a donde estaba.';
  }

  /** Borra TODA la seleccion, no solo la entidad activa. */
  deleteSelected(): void {
    const ids = this.selectedIds();
    if (ids.length === 0) {
      return;
    }
    this.levels.removeEntities(ids);
    this.host.markDirty();
    this.host.note(
      ids.length === 1 ? 'Entidad "' + ids[0] + '" eliminada.' : ids.length + ' entidades eliminadas.',
    );
  }

  /**
   * Duplica toda la seleccion una celda a la derecha y deja seleccionadas las
   * copias, que es lo que uno quiere seguir moviendo.
   *
   * Los objetos anidados se copian a mano: el spread es superficial, y sin esto
   * la copia compartiria sourceRect y collider con el original (editar uno
   * moveria los dos).
   */
  duplicateSelected(): void {
    const sources = this.entities().filter((entity) => this.isSelected(entity.id));
    if (sources.length === 0) {
      return;
    }

    const copies: string[] = [];
    for (const source of sources) {
      const copy: LevelEntity = {
        ...source,
        id: this.nextId(source.type || 'entidad'),
        position: { col: source.position.col + 1, row: source.position.row },
        sourceRect: { ...source.sourceRect },
        collider: source.collider ? { ...source.collider } : undefined,
      };
      this.levels.addEntity(copy);
      copies.push(copy.id);
    }

    this.selection.selectEntities(copies);
    this.host.markDirty();
    this.host.note(copies.length === 1 ? 'Copia creada.' : copies.length + ' copias creadas.');
  }

  /**
   * Mueve la seleccion entera por celdas (las flechas del teclado). Es la
   * unica forma de mover VARIAS a la vez: los campos de columna y fila del
   * inspector escriben un valor absoluto, y aplicarlo a todas las amontonaria
   * en la misma casilla.
   */
  nudgeSelection(deltaCol: number, deltaRow: number): void {
    const ids = this.selectedIds();
    if (ids.length === 0) {
      return;
    }
    const grid = this.grid();
    for (const entity of this.entities()) {
      if (!this.isSelected(entity.id)) {
        continue;
      }
      this.levels.updateEntity(entity.id, {
        position: {
          col: Math.min(grid.width - 1, Math.max(0, entity.position.col + deltaCol)),
          row: Math.min(grid.height - 1, Math.max(0, entity.position.row + deltaRow)),
        },
      });
    }
    this.host.markDirty();
  }

  /**
   * Deja un mensaje en la barra de estado y en la consola del panel inferior.
   * El log se corta en 40 lineas: es para ver que acaba de pasar, no un
   * historial, y sin tope crece sin limite durante una sesion larga.
   */
  /** Primer id libre de la forma "base_N" entre las entidades del nivel. */
  nextId(base: string): string {
    return nextEntityId(base, this.entityIds());
  }
}
