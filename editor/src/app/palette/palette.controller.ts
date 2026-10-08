import { inject, signal } from '@angular/core';

import { CharacterId } from '../core/characters';
import { ShapeId } from '../core/iso-shapes';
import { itemKindDef } from '../core/items';
import { CharacterPreset } from '../models/character-preset.model';
import { ItemLibraryService } from '../services/item-library.service';

/** Herramienta activa del viewport. */
export /** Herramienta activa del viewport: seleccionar entidades o colocarlas. */
type Tool = 'select' | 'place' | 'floor' | 'wall' | 'room' | 'tunnel';

export const TOOL_HINTS: Record<Tool, string> = {
  select: 'Seleccionar: clic sobre una entidad para activarla.',
  place: 'Colocar: elige una textura en Recursos o una figura, y clic en la grilla.',
  floor: 'Piso: clic en una celda para quitarle o devolverle el suelo.',
  wall: 'Pared: clic en una celda para levantar o quitar la pared.',
  room: 'Grilla: arrastrá sobre el vacío para dibujar una nueva, o dentro de una para moverla. Clic derecho la configura.',
  tunnel:
    'Túnel: clic en una grilla, clics para marcar el camino y clic en otra grilla para terminar. Retroceso borra el último punto; Escape cancela.',
};

/**
 * La paleta: que herramienta esta activa y QUE se va a colocar con ella.
 *
 * Una textura, una figura, un personaje o un objeto: los cuatro son
 * EXCLUYENTES. Elegir uno apaga los otros tres, porque la herramienta "place"
 * tiene que saber sin ambiguedad que esta a punto de colocar. Ese arbitraje es
 * la razon de ser de esta clase: antes vivia repartido entre cuatro secciones
 * de App, y cada select* tenia que acordarse de apagar a los demas.
 *
 * Colocar no esta aca (ver entities/entity-ops.controller.ts): esto solo
 * decide que esta elegido.
 */
export class PaletteController {
  private readonly itemLibrary = inject(ItemLibraryService);

  constructor(
    private readonly note: (message: string) => void,
    private readonly findPreset: (id: string) => CharacterPreset | undefined,
    private readonly kindHint: (kind: CharacterId) => string,
    /** Cambiar de herramienta abandona un tunel a medio trazar. */
    private readonly cancelTunnelTrace: () => void,
  ) {}

  readonly tool = signal<Tool>('select');

  /** Textura elegida en el panel Recursos; es la que se coloca con la herramienta "place". */
  readonly activeTexture = signal<string | null>(null);

  /**
   * Primitiva elegida en el panel Figuras. Es EXCLUYENTE con activeTexture:
   * elegir una apaga la otra, porque la herramienta "place" tiene que saber sin
   * ambiguedad que esta a punto de colocar.
   */
  readonly activeShape = signal<ShapeId | null>(null);

  /** Panel Figuras: arrastrar con una figura elegida la coloca en cada casilla que pisa. */
  readonly paintShapes = signal(false);

  /**
   * Id del personaje elegido en el panel Personajes: un tipo base
   * ("base-enemy") o uno configurado. Excluyente con los otros dos por el
   * mismo motivo: la herramienta "place" tiene que saber sin ambiguedad que
   * esta a punto de colocar.
   */
  readonly activeCharacter = signal<string | null>(null);

  /** Objeto de la paleta Objetos elegido para colocar con clic. */
  readonly activeItem = signal<string | null>(null);

  selectItem(id: string): void {
    const item = this.itemLibrary.find(id);
    if (!item) {
      return;
    }
    this.activeItem.set(id);
    this.activeCharacter.set(null);
    this.activeShape.set(null);
    this.activeTexture.set(null);
    this.tool.set('place');
    this.note(item.name + ': clic en la grilla para colocarlo. ' + itemKindDef(item.kind).hint);
  }

  activeItemLabel(): string | null {
    const id = this.activeItem();
    return id ? this.itemLibrary.find(id)?.name ?? id : null;
  }

  /**
   * Cambia la herramienta activa y dice en la barra de estado que hace.
   *
   * El mensaje es la parte importante: elegir "piso" o "pared" no cambia nada
   * en pantalla hasta el primer click sobre la grilla, asi que sin el aviso el
   * boton parece no responder aunque este encendido.
   */
  setTool(tool: Tool): void {
    // Cambiar de herramienta abandona un tunel a medio trazar: si no, el
    // camino quedaria dibujado en verde sin ninguna forma de terminarlo.
    if (tool !== 'tunnel') {
      this.cancelTunnelTrace();
    }
    this.tool.set(tool);
    this.note(TOOL_HINTS[tool]);
  }

  /** Elegir una textura pasa sola a la herramienta de colocar: es lo que se va a hacer. */
  selectTexture(name: string): void {
    this.activeTexture.set(name);
    this.activeShape.set(null);
    this.activeCharacter.set(null);
    this.activeItem.set(null);
    this.tool.set('place');
  }

  /** Idem con una primitiva del panel Figuras. */
  selectShape(id: ShapeId): void {
    this.activeShape.set(id);
    this.activeTexture.set(null);
    this.activeCharacter.set(null);
    this.activeItem.set(null);
    this.tool.set('place');
  }

  /** Idem con un personaje del panel Personajes: un tipo base o uno configurado. */
  selectCharacter(presetId: string): void {
    const preset = this.findPreset(presetId);
    if (!preset) {
      return;
    }
    this.activeCharacter.set(presetId);
    this.activeItem.set(null);
    this.activeShape.set(null);
    this.activeTexture.set(null);
    this.tool.set('place');
    this.note(preset.name + ': clic en la grilla para colocarlo. ' + this.kindHint(preset.kind));
  }

  /** Nombre del personaje elegido, para el chip del viewport. */
  activeCharacterLabel(): string | null {
    const id = this.activeCharacter();
    return id ? this.findPreset(id)?.name ?? id : null;
  }
}
