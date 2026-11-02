// HoneyComb Engine - Editor (proyectos recientes, para la pantalla de Inicio)
//
// La lista la guarda el proceso principal (ver ipc/project-root.js); aca solo
// estan las cuentas que la pantalla necesita para mostrarla.

/** Misma carpeta: sin distinguir barras, barra final ni mayusculas (Windows). */
export function sameRoot(a: string, b: string): boolean {
  const normal = (root: string) => root.replace(/[\\/]+/g, '/').replace(/\/$/, '').toLowerCase();
  return normal(a) === normal(b);
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
