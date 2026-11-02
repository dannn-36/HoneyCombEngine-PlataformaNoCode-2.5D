// HoneyComb Engine - Editor (niveles recientes, para la pantalla de Inicio)
//
// Cada entrada es un nivel de levels/ dentro de una carpeta del editor. Se
// guardan en este equipo (localStorage), el mas nuevo primero. Volver a la
// carpeta lo decide el proceso principal (ver ipc/project-root.js): aca solo
// se recuerda que se abrio y cuando.

export interface RecentFile {
  /** Carpeta del editor, ruta absoluta. */
  root: string;
  /** Archivo dentro de levels/ ("nivel_1.json"). */
  level: string;
  /** Cuando se abrio o guardo por ultima vez (ms desde 1970). */
  openedAt: number;
}

/** Cuantos niveles se recuerdan. */
export const RECENT_LIMIT = 12;

/** Misma carpeta: sin distinguir barras, barra final ni mayusculas (Windows). */
export function sameRoot(a: string, b: string): boolean {
  const normal = (root: string) => root.replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
  return normal(a) === normal(b);
}

function sameEntry(a: Pick<RecentFile, 'root' | 'level'>, b: Pick<RecentFile, 'root' | 'level'>): boolean {
  return sameRoot(a.root, b.root) && a.level.toLowerCase() === b.level.toLowerCase();
}

/** La lista guardada, o vacia si no hay o esta rota. Las entradas raras se descartan. */
export function parseRecents(text: string | null | undefined): RecentFile[] {
  let value: unknown;
  try {
    value = JSON.parse(text ?? 'null');
  } catch {
    return [];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter(
      (entry): entry is RecentFile =>
        !!entry &&
        typeof entry.root === 'string' &&
        entry.root !== '' &&
        typeof entry.level === 'string' &&
        entry.level !== '' &&
        typeof entry.openedAt === 'number' &&
        Number.isFinite(entry.openedAt),
    )
    .map(({ root, level, openedAt }) => ({ root, level, openedAt }))
    .slice(0, RECENT_LIMIT);
}

/** La lista con esta entrada primero, sin repetirla y con el tope. */
export function addRecent(list: readonly RecentFile[], entry: RecentFile): RecentFile[] {
  return [entry, ...list.filter((other) => !sameEntry(other, entry))].slice(0, RECENT_LIMIT);
}

export function removeRecent(list: readonly RecentFile[], entry: Pick<RecentFile, 'root' | 'level'>): RecentFile[] {
  return list.filter((other) => !sameEntry(other, entry));
}

/** El nombre de la carpeta, lo ultimo de la ruta ("C:\Juegos\Mi juego" -> "Mi juego"). */
export function folderName(root: string): string {
  const parts = root.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? root;
}

/** El nombre del nivel sin ".json". */
export function levelTitle(level: string): string {
  return level.replace(/\.json$/i, '');
}

/**
 * Cuando, en palabras: "hace un momento", "hace 5 min", "hace 3 h", "ayer",
 * "hace 4 días" y, de una semana para atras, la fecha.
 */
export function timeAgo(openedAt: number, now: number = Date.now()): string {
  const minutes = Math.floor((now - openedAt) / 60000);
  if (minutes < 1) {
    return 'hace un momento';
  }
  if (minutes < 60) {
    return `hace ${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `hace ${hours} h`;
  }
  const days = Math.floor(hours / 24);
  if (days === 1) {
    return 'ayer';
  }
  if (days < 7) {
    return `hace ${days} días`;
  }
  return new Date(openedAt).toLocaleDateString();
}
