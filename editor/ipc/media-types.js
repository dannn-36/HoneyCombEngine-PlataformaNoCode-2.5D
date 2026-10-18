// =============================================================================
// Que se puede mostrar y que se puede importar, por extension
// =============================================================================
//
// Las tablas viven aparte porque las comparten dos dominios que no se conocen:
// el visor de archivos (ipc/files.js) decide con ellas si un archivo se muestra
// como texto, como imagen o no se muestra, y el convertidor (ipc/convert.js)
// usa la misma lista de imagenes para saber como leer la que va a convertir.
// Duplicarlas haria que un formato agregado en un lado faltara en el otro.

const TEXT_FILE_NAMES = new Set([
  '.gitignore', '.gitattributes', '.editorconfig', '.prettierrc', 'license', 'makefile',
]);
const TEXT_EXTENSIONS = new Set([
  '.json', '.md', '.txt', '.ts', '.js', '.mjs', '.cjs', '.html', '.css', '.scss', '.cpp',
  '.hpp', '.h', '.c', '.cc', '.cmake', '.yml', '.yaml', '.xml', '.svg', '.puml', '.cmd',
  '.sh', '.bat', '.ps1', '.log', '.csv', '.ini', '.toml', '.gitignore',
]);
const IMAGE_MIME_TYPES = new Map([
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'], ['.bmp', 'image/bmp'], ['.webp', 'image/webp'],
]);

/**
 * Los sonidos que lee el motor: raylib trae WAV, OGG y MP3 (ver
 * SUPPORT_FILEFORMAT_* en su config.h). FLAC viene apagado, asi que no se
 * ofrece: se importaria y despues no sonaria.
 */
const AUDIO_MIME_TYPES = new Map([
  ['.wav', 'audio/wav'], ['.ogg', 'audio/ogg'], ['.mp3', 'audio/mpeg'],
]);

/** Tope del texto que se manda a la UI. De sobra para leer un archivo, y evita mandar un log de 50 MB. */
const TEXT_PREVIEW_LIMIT = 400 * 1024;
/**
 * Tope de imagen para el visor. En base64 ocupa un tercio mas y viaja entera
 * dentro de un data: URL; 25 MB cubre de sobra una captura 4K en PNG.
 */
const IMAGE_PREVIEW_LIMIT = 25 * 1024 * 1024;
/** Tope del original que se acepta importar. */
const IMAGE_IMPORT_LIMIT = 40 * 1024 * 1024;
/**
 * Tope de un sonido, para importarlo y para escucharlo en el editor (viaja
 * entero en un data: URL). 60 MB es mas de una hora de OGG; un WAV sin
 * comprimir de cinco minutos pesa unos 50.
 */
const AUDIO_LIMIT = 60 * 1024 * 1024;

module.exports = {
  TEXT_FILE_NAMES,
  TEXT_EXTENSIONS,
  IMAGE_MIME_TYPES,
  TEXT_PREVIEW_LIMIT,
  IMAGE_PREVIEW_LIMIT,
  IMAGE_IMPORT_LIMIT,
  AUDIO_MIME_TYPES,
  AUDIO_LIMIT,
};
