// HoneyComb Engine - Editor (temas: lista y paleta de los canvas)
//
// Los colores de los paneles viven en app.scss, por [data-theme] en app-root.
// Aca va lo que el CSS no alcanza: la paleta de los canvas, que se pinta desde
// TypeScript. El tema elegido lo guarda services/theme.service.ts.

export type ThemeId = 'honeycomb' | 'pastel';

export const THEMES: readonly { id: ThemeId; label: string }[] = [
  { id: 'honeycomb', label: 'HoneyComb' },
  { id: 'pastel', label: 'Pastel claro' },
];

/** Colores del viewport isometrico y de la vista previa de ataques. */
export interface CanvasPalette {
  /** Fondo del lienzo, fuera de la grilla. */
  background: string;
  /** Lo que no es piso dentro de un mapa de celdas. */
  void: string;
  floor: string;
  /** Lineas de la grilla por debajo de las entidades. */
  gridUnder: string;
  /** Lineas de la grilla por encima: opacas, tienen que leerse sobre el arte. */
  gridOver: string;
  wallFill: string;
  wallStroke: string;
  /** Contorno y ancla del objeto activo: el acento del tema. */
  active: string;
  /** El resto de la seleccion: el acento apagado. */
  selected: string;
  /** Borde de contraste por fuera del contorno de seleccion. */
  halo: string;
  /** Ancla de las entidades que no son la activa. */
  anchor: string;
  label: string;
  labelSelected: string;
  /** Medidas del nivel bajo el gizmo. */
  stats: string;
  /** Punteado de una entidad oculta al empezar. */
  hiddenOutline: string;
  /** Celda bajo el cursor. */
  hoverFill: string;
  hoverStroke: string;
  /** Relleno del rectangulo de Seleccionar area; el borde va en "active". */
  marqueeFill: string;
  /** Etiqueta de nombre y tipo sobre una entidad: fondo, borde y texto. */
  tagBg: string;
  tagLine: string;
  tagText: string;
}

/**
 * Las paredes van en la miel del boton Ejecutar de cada tema, rellenas y con
 * un borde oscuro que separa las celdas. La seleccion no se confunde con
 * ellas: es un contorno con halo oscuro alrededor de la entidad, no un relleno.
 */
export const CANVAS_PALETTES: Record<ThemeId, CanvasPalette> = {
  honeycomb: {
    background: '#1e1e1e',
    void: '#141414',
    floor: '#2a2a2a',
    gridUnder: '#3c3c3c',
    gridOver: '#cccccc',
    wallFill: '#f2b33d',
    wallStroke: 'rgba(0, 0, 0, 0.55)',
    active: '#f2b33d',
    selected: '#9a7428',
    halo: 'rgba(0, 0, 0, 0.6)',
    anchor: 'rgba(255, 255, 255, 0.55)',
    label: 'rgba(212, 212, 212, 0.75)',
    labelSelected: '#f2b33d',
    stats: 'rgba(212, 212, 212, 0.7)',
    hiddenOutline: 'rgba(204, 204, 204, 0.85)',
    hoverFill: 'rgba(255, 255, 255, 0.07)',
    hoverStroke: 'rgba(255, 255, 255, 0.45)',
    marqueeFill: 'rgba(242, 179, 61, 0.12)',
    tagBg: 'rgba(24, 24, 24, 0.9)',
    tagLine: 'rgba(85, 85, 85, 0.9)',
    tagText: '#d4d4d4',
  },
  pastel: {
    background: '#e5ded2',
    void: '#cfc6b7',
    floor: '#efeae2',
    gridUnder: '#cbc0af',
    gridOver: '#5e5444',
    wallFill: '#f3c969',
    wallStroke: 'rgba(60, 45, 20, 0.4)',
    active: '#e0a526',
    selected: '#b89a5c',
    halo: 'rgba(43, 36, 25, 0.6)',
    anchor: 'rgba(43, 36, 25, 0.55)',
    label: 'rgba(43, 36, 25, 0.8)',
    labelSelected: '#734a00',
    stats: 'rgba(43, 36, 25, 0.7)',
    hiddenOutline: 'rgba(94, 84, 68, 0.8)',
    hoverFill: 'rgba(43, 36, 25, 0.06)',
    hoverStroke: 'rgba(43, 36, 25, 0.5)',
    marqueeFill: 'rgba(224, 165, 38, 0.16)',
    tagBg: 'rgba(239, 234, 226, 0.94)',
    tagLine: 'rgba(173, 160, 139, 0.9)',
    tagText: '#2b2419',
  },
};
