import type { IconName } from '../ui/icons.generated';
import { shapeDef } from './iso-shapes';

/**
 * Como se reconoce cada tipo de entidad en la interfaz: nombre, icono y color.
 *
 * El color nunca va solo. Cada tipo tiene un icono de forma distinta (persona,
 * calavera, globo de dialogo...) para que alguien con daltonismo los separe
 * igual. La celda hexagonal del arbol de escena, de las fichas del dock y de la
 * cabecera del inspector dibuja las dos cosas juntas.
 *
 * Los colores son solo de la interfaz: el nivel guarda el "type" como texto y
 * el motor no lee nada de esto.
 */
export interface EntityKindStyle {
  label: string;
  icon: IconName;
  color: string;
}

const KINDS: Record<string, EntityKindStyle> = {
  player: { label: 'Jugador', icon: 'user', color: '#3fb8a9' },
  enemy: { label: 'Enemigo', icon: 'skull', color: '#e0605a' },
  npc: { label: 'NPC', icon: 'message-circle-more', color: '#9b8cf0' },
  item: { label: 'Objeto', icon: 'gem', color: '#79b84a' },
  checkpoint: { label: 'Punto de control', icon: 'flag', color: '#e3b341' },
  obstacle: { label: 'Obstáculo', icon: 'brick-wall', color: '#c98a5a' },
  prop: { label: 'Figura', icon: 'cuboid', color: '#b3a998' },
};

/** Lo que no reconoce nadie (el type es texto libre en el schema). */
const OTHER: EntityKindStyle = { label: 'Entidad', icon: 'circle-dashed', color: '#8f8a80' };

export function entityKindStyle(type: string): EntityKindStyle {
  // Una figura de la paleta guarda como type su propio nombre (cube, pyramid...).
  return KINDS[type] ?? (shapeDef(type) ? KINDS['prop'] : OTHER);
}
