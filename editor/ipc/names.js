// =============================================================================
// Nombres de archivo dentro de la carpeta del editor
// =============================================================================
//
// Lo comparten el convertidor de imagenes y la importacion de niveles: todo lo
// que entra desde afuera recibe un nombre que el motor pueda abrir, y nunca
// pisa algo que ya estaba.

const path = require('node:path');
const fsSync = require('node:fs');

/**
 * Nombre seguro para el motor, que abre los archivos con fopen(): en Windows,
 * fopen no entiende caracteres fuera del juego del sistema. Solo ASCII; los
 * acentos quedan como su letra base ("canción" -> "cancion") y lo demas pasa a
 * "_". Si no queda nada ("♡"), se usa "fallback". Devuelve el nombre SIN
 * extension.
 */
function safeStem(fileName, fallback) {
  const base = path.basename(fileName, path.extname(fileName));
  const cleaned = base
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 _()-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[\s_.-]+|[\s_.-]+$/g, '');
  return cleaned || fallback;
}

/** Nombre de textura seguro: siempre .png. */
function safeTextureName(fileName) {
  return safeStem(fileName, 'imagen') + '.png';
}

/**
 * Nombre de sonido seguro: la extension original en minusculas (el motor elige
 * el decodificador por extension), y el resto como safeStem.
 */
function safeSoundName(fileName) {
  return safeStem(fileName, 'sonido') + path.extname(fileName).toLowerCase();
}

/**
 * El primer nombre libre a partir de "name": ni en la carpeta ni reservado
 * ("reserved", en minusculas: Windows no distingue mayusculas). "foo.png"
 * ocupado pasa a "foo-2.png", "foo-3.png"...
 */
function freeName(folder, name, reserved = new Set()) {
  const extension = path.extname(name);
  const stem = path.basename(name, extension);
  for (let n = 1; ; n += 1) {
    const candidate = n === 1 ? name : `${stem}-${n}${extension}`;
    if (!reserved.has(candidate.toLowerCase()) && !fsSync.existsSync(path.join(folder, candidate))) {
      return candidate;
    }
  }
}

module.exports = { safeStem, safeTextureName, safeSoundName, freeName };
