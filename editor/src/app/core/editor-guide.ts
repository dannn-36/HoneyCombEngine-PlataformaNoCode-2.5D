// La guia del editor: una grilla de referencia alrededor del nivel.
//
// Es SOLO del editor. Muestra el espacio que rodea al nivel, para ubicar salas
// nuevas y ver hasta donde se puede crecer, pero no es parte del nivel: no se
// guarda en el JSON, no cambia el tamano de la grilla ni donde se puede colocar
// algo, y el motor no se entera. Se configura en Propiedades › Nivel › Guía
// del editor, y la eleccion se recuerda en este equipo (localStorage), como
// el tema.

export interface EditorGuide {
  visible: boolean;
  /** Casillas de guia por cada lado del nivel. */
  margin: number;
  /** Que tan visibles son las lineas: 0.1 apenas, 1 como la grilla del nivel. */
  opacity: number;
}

export const GUIDE_MARGIN_MIN = 1;
export const GUIDE_MARGIN_MAX = 64;
export const GUIDE_OPACITY_MIN = 0.1;
export const GUIDE_OPACITY_MAX = 1;

export function defaultGuide(): EditorGuide {
  return { visible: false, margin: 12, opacity: 0.5 };
}

/** Una guia valida a partir de cualquier cosa (lo guardado, un campo a medio escribir). */
export function sanitizeGuide(raw: unknown): EditorGuide {
  const base = defaultGuide();
  if (!raw || typeof raw !== 'object') {
    return base;
  }
  const data = raw as Partial<Record<keyof EditorGuide, unknown>>;
  const number = (value: unknown, fallback: number) =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return {
    visible: typeof data.visible === 'boolean' ? data.visible : base.visible,
    margin: Math.round(Math.min(GUIDE_MARGIN_MAX, Math.max(GUIDE_MARGIN_MIN, number(data.margin, base.margin)))),
    opacity: Math.min(GUIDE_OPACITY_MAX, Math.max(GUIDE_OPACITY_MIN, number(data.opacity, base.opacity))),
  };
}

const STORAGE_KEY = 'honeycomb.editorGuide';

/** La guia guardada en este equipo. Sin almacenamiento (tests, modo privado), la de siempre. */
export function storedGuide(): EditorGuide {
  try {
    const text = globalThis.localStorage?.getItem(STORAGE_KEY);
    return text ? sanitizeGuide(JSON.parse(text)) : defaultGuide();
  } catch {
    return defaultGuide();
  }
}

export function storeGuide(guide: EditorGuide): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(guide));
  } catch {
    // Sin almacenamiento vale para esta sesion y nada mas.
  }
}
