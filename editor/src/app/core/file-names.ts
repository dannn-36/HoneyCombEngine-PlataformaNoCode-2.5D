// Nombres de archivo y carpeta que se escriben en el editor (Guardar como,
// Nueva carpeta). Espejo de safeStem en ipc/names.js: el motor abre todo con
// fopen(), que en Windows no entiende caracteres fuera del juego del sistema,
// asi que un nivel o una carpeta de assets con "♡" en el nombre no abriria.

/**
 * Nombre seguro: solo ASCII, los acentos como su letra base ("canción" ->
 * "cancion") y lo demas como "_". Si no queda nada, "fallback".
 */
export function safeName(text: string, fallback: string): string {
  const cleaned = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 _()-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[\s_.-]+|[\s_.-]+$/g, '');
  return cleaned || fallback;
}

/** Archivo de nivel a partir de lo que se escribio: "Mi nivel" -> "Mi nivel.json". Acepta que ya traiga .json. */
export function levelFileName(text: string): string {
  return safeName(text.trim().replace(/\.json$/i, ''), 'nivel') + '.json';
}
