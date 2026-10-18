import { computed, inject, signal } from '@angular/core';

import { cellState } from '../core/dungeon-layout';
import { textureName } from '../core/sprite-style';
import { GridPosition } from '../models/level.model';
import { PaletteController } from '../palette/palette.controller';
import { LevelService } from '../services/level.service';
import { TexturesController } from '../textures/textures.controller';

/** Una sala o un tunel, como opcion de "Piso de…". */
export interface FloorSection {
  /** "room:sala_1" o "tunnel:tunel_1": lo que devuelve el <select>. */
  value: string;
  label: string;
  /** Su textura propia, o null si usa la del nivel. */
  texture: string | null;
}

/** Lo que el piso recibe del editor. */
export interface FloorDeps {
  note: (message: string) => void;
  markDirty: () => void;
  palette: PaletteController;
  tex: TexturesController;
}

/**
 * La textura del piso desde Recursos › Texturas: elegir una textura y ponerla
 * en todo el nivel, en una sala o tunel, o pintarla casilla por casilla. Las
 * tres capas y como llegan al motor estan en core/floors.ts; esto es lo que
 * las conecta con los botones, el panel Piso (Nivel) y el pincel del viewport.
 *
 * Es un controlador y no un componente por la misma razon que
 * ItemEditorController: el markup vive en app.html para usar los estilos de
 * App (ver el comentario de cabecera de app.ts).
 */
export class FloorController {
  private readonly levels = inject(LevelService);

  constructor(private readonly deps: FloorDeps) {}

  /**
   * Pintar casillas: con una textura elegida, clic o arrastre en el viewport
   * pinta el piso en vez de colocar una entidad. Es lo mismo que "Pintar
   * figuras arrastrando" del panel Figuras.
   */
  readonly painting = signal(false);

  /** La textura elegida en Recursos, con la ruta que se guarda en el nivel. */
  readonly texture = computed(() => {
    const name = this.deps.palette.activeTexture();
    return name ? 'textures/' + name : null;
  });

  /** La textura del piso de todo el nivel, o null si no tiene. */
  readonly levelTexture = computed(() => this.levels.level().visuals?.floor?.texture ?? null);

  /** Las salas y los tuneles, con el piso propio de cada uno. */
  readonly sections = computed<FloorSection[]>(() => {
    const level = this.levels.level();
    return [
      ...(level.rooms ?? []).map((room) => ({
        value: 'room:' + room.id,
        label: 'Sala ' + room.id,
        texture: room.floorTexture ?? null,
      })),
      ...(level.tunnels ?? []).map((tunnel) => ({
        value: 'tunnel:' + tunnel.id,
        label: 'Túnel ' + tunnel.from + ' → ' + tunnel.to,
        texture: tunnel.floorTexture ?? null,
      })),
    ];
  });

  /** Las que tienen piso propio: las que lista el panel Piso. */
  readonly customSections = computed(() => this.sections().filter((section) => section.texture !== null));

  readonly paintedCount = computed(() => this.levels.level().floorPaint?.length ?? 0);

  /** "madera.png" para mostrar, sin la carpeta. */
  label(texture: string | null): string {
    return texture ? textureName(texture) : 'ninguna';
  }

  setPainting(on: boolean): void {
    this.painting.set(on);
    this.deps.note(
      on
        ? 'Pintar casillas: clic o arrastrar pinta el piso con la textura elegida; Alt + clic devuelve la casilla a la de su sala o del nivel.'
        : 'Pintar casillas apagado: un clic vuelve a colocar la textura como entidad.',
    );
  }

  /** La textura elegida pasa a ser el piso de todo el nivel. */
  async applyToLevel(): Promise<void> {
    const name = this.deps.palette.activeTexture();
    if (!name) {
      return;
    }
    // El recorte es la imagen entera: el tamano real, aunque su miniatura no
    // se haya cargado todavia.
    const asset = await this.deps.tex.ensureAsset(name);
    if (!asset || asset.width <= 0) {
      this.deps.note('No se pudo leer ' + name + ' para usarla de piso.');
      return;
    }
    this.levels.setLevelFloor('textures/' + name, { x: 0, y: 0, width: asset.width, height: asset.height });
    this.deps.markDirty();
    const kept = this.customSections().length + (this.paintedCount() > 0 ? 1 : 0);
    this.deps.note(
      'Piso de todo el nivel: ' + name + '.' +
        (kept > 0 ? ' Las salas, túneles y casillas con piso propio lo conservan (panel Piso, en Nivel).' : ''),
    );
  }

  /** La textura elegida pasa a ser el piso de una sala o un tunel ("room:id" o "tunnel:id"). */
  applyToSection(value: string): void {
    const texture = this.texture();
    if (texture && this.setSection(value, texture)) {
      const section = this.sections().find((candidate) => candidate.value === value);
      this.deps.note('Piso de ' + (section?.label.toLowerCase() ?? value) + ': ' + this.label(texture) + '.');
    }
  }

  /** Devuelve una sala o un tunel al piso del nivel. */
  resetSection(value: string): void {
    if (this.setSection(value, null)) {
      this.deps.note('Vuelve a usar el piso del nivel.');
    }
  }

  /** Despinta todas las casillas pintadas a mano. */
  clearPaint(): void {
    const count = this.paintedCount();
    if (count === 0) {
      return;
    }
    this.levels.clearFloorPaint();
    this.deps.markDirty();
    this.deps.note(count + ' casillas pintadas vuelven al piso de su sala o del nivel.');
  }

  /**
   * Pinta casillas con la textura elegida, o las despinta. Solo las que tienen
   * piso: en el vacio o en una pared no hay nada que pintar. Devuelve cuantas
   * se tocaron.
   */
  paint(cells: readonly GridPosition[], erase: boolean): number {
    const texture = erase ? null : this.texture();
    if (!erase && !texture) {
      return 0;
    }
    const level = this.levels.level();
    const { width, height } = level.grid;
    const withFloor = cells.filter((cell) => {
      if (cell.col < 0 || cell.row < 0 || cell.col >= width || cell.row >= height) {
        return false;
      }
      // Sin "tiles", el nivel es la grilla de siempre: piso en todas partes.
      return level.tiles ? cellState(level.tiles, cell.col, cell.row).floor : true;
    });
    if (withFloor.length > 0) {
      this.levels.paintFloor(withFloor, texture);
      this.deps.markDirty();
    }
    return withFloor.length;
  }

  private setSection(value: string, texture: string | null): boolean {
    const [kind, ...rest] = value.split(':');
    const id = rest.join(':');
    if (kind === 'room') {
      this.levels.setRoomFloor(id, texture);
    } else if (kind === 'tunnel') {
      this.levels.setTunnelFloor(id, texture);
    } else {
      return false;
    }
    this.deps.markDirty();
    return true;
  }
}
