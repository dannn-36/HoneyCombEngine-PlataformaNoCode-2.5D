// La celda de tipo (ver ui/icon.ts) y los iconos sueltos, como imagenes para
// dibujar en el canvas del viewport.
//
// El canvas no entiende <use> ni CSS: cada celda se arma una vez como un SVG
// completo (hexagono + el trazo del icono de Lucide), se convierte en una
// imagen y se guarda. Las de los tipos conocidos se cargan al importar el
// modulo, asi ya estan listas para el primer dibujo.

import { ICON_SPRITE, IconName } from '../ui/icons.generated';
import { entityKindStyle } from './entity-kinds';

const HEX = 'M12 1.6 21 6.8v10.4L12 22.4 3 17.2V6.8Z';
const INK = '#14120f';
const HONEY = '#f2b33d';

const cache = new Map<string, HTMLImageElement>();

/** El contenido de un <symbol> del sprite: los trazos del icono. */
function symbolBody(name: IconName): string {
  const match = ICON_SPRITE.match(new RegExp(`<symbol id="i-${name}" viewBox="0 0 24 24">(.*?)</symbol>`));
  return match ? match[1] : '';
}

function load(key: string, svg: string): HTMLImageElement | null {
  if (typeof Image === 'undefined') {
    return null;
  }
  let image = cache.get(key);
  if (!image) {
    image = new Image();
    image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    cache.set(key, image);
  }
  // Mientras decodifica, nada: el proximo redibujo ya la encuentra lista.
  return image.complete && image.naturalWidth > 0 ? image : null;
}

/**
 * La celda de un tipo de entidad. Con "active", el anillo de miel del objeto
 * activo; si no, un contorno oscuro fino para que se lea sobre cualquier sprite.
 * El viewBox deja margen para el anillo.
 */
export function cellImage(type: string, active: boolean): HTMLImageElement | null {
  const style = entityKindStyle(type);
  const edge = active
    ? `stroke="${HONEY}" stroke-width="2.6" paint-order="stroke"`
    : `stroke="${INK}" stroke-width="1.4" paint-order="stroke"`;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 28 28" width="56" height="56">` +
    `<path d="${HEX}" fill="${style.color}" ${edge}/>` +
    `<g transform="translate(6.5 6.5) scale(${11 / 24})" fill="none" stroke="${INK}" stroke-width="2.6" ` +
    `stroke-linecap="round" stroke-linejoin="round">${symbolBody(style.icon)}</g></svg>`;
  return load(`cell:${style.icon}:${style.color}:${active}`, svg);
}

/** Un icono suelto de un color, con un borde oscuro que lo despega del fondo. */
export function iconImage(name: IconName, color: string): HTMLImageElement | null {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 28 28" width="56" height="56">` +
    `<g fill="none" stroke-linecap="round" stroke-linejoin="round">` +
    `<g stroke="${INK}" stroke-width="4.5">${symbolBody(name)}</g>` +
    `<g stroke="${color}" stroke-width="2">${symbolBody(name)}</g></g></svg>`;
  return load(`icon:${name}:${color}`, svg);
}

// Precarga de lo que se dibuja siempre.
for (const type of ['player', 'enemy', 'npc', 'item', 'obstacle', 'prop', '']) {
  cellImage(type, false);
  cellImage(type, true);
}
iconImage('crown', '#f7c766');
