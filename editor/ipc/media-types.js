// =============================================================================
// Que se puede mostrar y que se puede importar, por extension
// =============================================================================
//
// Las tablas viven aparte porque las comparten dos dominios que no se conocen:
// el visor de archivos (ipc/files.js) decide con ellas si un archivo se muestra
// como texto, como imagen o no se muestra, y el importador (ipc/import.js) usa
// la misma lista de imagenes para saber que puede copiar como textura.
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

/** Tope del texto que se manda a la UI. De sobra para leer un archivo, y evita mandar un log de 50 MB. */
const TEXT_PREVIEW_LIMIT = 400 * 1024;
/**
 * Tope de imagen para el visor. En base64 ocupa un tercio mas y viaja entera
 * dentro de un data: URL; 25 MB cubre de sobra una captura 4K en PNG.
 */
const IMAGE_PREVIEW_LIMIT = 25 * 1024 * 1024;
/** Tope del original que se acepta importar. */
const IMAGE_IMPORT_LIMIT = 40 * 1024 * 1024;

module.exports = {
  TEXT_FILE_NAMES,
  TEXT_EXTENSIONS,
  IMAGE_MIME_TYPES,
  TEXT_PREVIEW_LIMIT,
  IMAGE_PREVIEW_LIMIT,
  IMAGE_IMPORT_LIMIT,
};
