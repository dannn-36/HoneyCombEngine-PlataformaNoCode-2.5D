import { ItemDef, ItemKind, OnFullInventory } from '../models/item.model';
import { ITEM_KINDS, describeAttack, itemKindDef } from '../core/items';
import { spriteCropStyle, textureName } from '../core/sprite-style';
import { TextureAsset } from '../core/texture-fit';

/**
 * Como se MUESTRAN los objetos en el editor: el glifo y el color de su tipo,
 * el dato corto de la paleta, la miniatura de su recorte, y la traduccion de
 * los <select> de inventario.
 *
 * Es un presentador: no guarda estado ni modifica el nivel. Lo que se ve de un
 * objeto sale de core/items.ts (ITEM_KINDS); aca solo se arma para la
 * plantilla.
 */
export class ItemsPanelController {
  constructor(
    /** Las texturas decodificadas, para recortar la miniatura de cada objeto. */
    private readonly textures: () => Record<string, TextureAsset>,
    /** Las armas que puede llevar un enemigo, para resumir la elegida. */
    private readonly weaponOptions: () => ItemDef[],
    /** Elegir textura en la ventana de objetos, con sus medidas reales. */
    private readonly setEditorTexture: (name: string, asset: TextureAsset | undefined) => void,
  ) {}

  readonly itemKinds = ITEM_KINDS;

  itemGlyph(item: ItemDef): string {
    return itemKindDef(item.kind).glyph;
  }

  itemColor(item: ItemDef): string {
    return itemKindDef(item.kind).color;
  }

  itemKindHint(kind: ItemKind): string {
    return itemKindDef(kind).hint;
  }

  /** El dato corto de la paleta: dano de un arma, vida de una curacion, valor de una moneda. */
  itemStat(item: ItemDef): string {
    if (item.kind === 'weapon') {
      return '⚔' + (item.weapon?.attack.damage ?? 0) + (item.weapon?.ability ? ' ★' : '');
    }
    return item.kind === 'healing' ? '✚' + (item.heal ?? 0) : '●' + (item.value ?? 1);
  }

  /** Resumen del arma de un enemigo, para el inspector. */
  weaponSummary(id: string): string {
    const weapon = this.weaponOptions().find((item) => item.id === id)?.weapon;
    if (!weapon) {
      return '';
    }
    const ability = weapon.ability ? ' · habilidad cada ' + weapon.ability.hitsRequired + ' golpes' : '';
    return describeAttack(weapon.attack) + ability;
  }

  /** Miniatura del recorte de un objeto, sacada de la miniatura de Recursos. */
  itemSpriteStyle(item: Pick<ItemDef, 'texture' | 'sourceRect'>, box = 22): Record<string, string> | null {
    const asset = this.textures()[textureName(item.texture)];
    return asset && asset.width > 0
      ? spriteCropStyle(asset.dataUrl, asset.width, asset.height, item.sourceRect, box)
      : null;
  }

  /** En la ventana de objetos: elegir textura con sus medidas reales, para recortarla entera. */
  setItemTexture(name: string): void {
    this.setEditorTexture(name, this.textures()[name]);
  }

  /** El <select> devuelve texto: se valida antes de aceptarlo. */
  onFullOf(value: string): OnFullInventory {
    return value === 'auto_replace' || value === 'block' ? value : 'manual_replace';
  }

  onItemDragStart(event: DragEvent, id: string): void {
    event.dataTransfer?.setData('text/honeycomb-item', id);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copy';
    }
  }
}
