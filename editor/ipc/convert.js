// =============================================================================
// Convertidor de imagenes: archivos sueltos PNG, JPG o JPEG a texturas PNG
// =============================================================================
//
// Es la UNICA puerta de entrada de imagenes al proyecto (Recursos > Importar y
// Herramientas > Convertidor de imagenes llevan aca). Las imagenes se COPIAN a
// assets/textures/ de la carpeta del editor (ver ipc/project-root.js): una
// textura que viviera fuera se veria en el editor y saldria en negro en el
// runtime, que la busca relativa al nivel.
//
//   - Se eligen ARCHIVOS, uno o varios, de cualquier carpeta (o los JPG que ya
//     estan en assets/textures/). Nunca una carpeta entera: elegir Descargas
//     no puede meter Descargas completa en el proyecto.
//   - El nombre de destino se limpia (ver ipc/names.js): una textura "♡.jpg"
//     no abre en el motor aunque sea PNG; aca sale como "imagen.png".
//
// Va en tres pasos porque el ajuste de tamano lo hace la UI (ver
// src/app/core/texture-fit.ts): hay que decodificar la imagen, y el navegador
// decodifica PNG y JPG sin depender de con que opciones se compilo nada.
//
//   1. convert:begin       elige los archivos y los agrega al plan
//   2. convert:readImage   la UI pide cada original, de a uno
//   3. convert:writeImage  y devuelve el PNG ajustado para escribir
//
// El plan vive ACA y los pasos 2 y 3 reciben solo un indice: la UI nunca elige
// una ruta, ni de lectura ni de escritura.

const path = require('node:path');
const fs = require('node:fs/promises');
const { ipcMain, dialog } = require('electron');

const { getProjectRoot, ensureProjectRoot } = require('./project-root');
const { IMAGE_MIME_TYPES, IMAGE_IMPORT_LIMIT } = require('./media-types');
const { safeTextureName, freeName } = require('./names');

/** Lo que acepta el convertidor: lo que se elige en su dialogo. */
const CONVERTIBLE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg']);

/**
 * El plan de la ventana abierta. Se ACUMULA: se
 * pueden agregar archivos de varias carpetas antes de convertir, y cada uno
 * conserva su indice hasta que se cierra la ventana (convert:reset).
 */
let convertSession = null;

function convertItem(index) {
  const item = convertSession?.items[index];
  if (!item) {
    throw new Error('El convertidor ya no tiene esa imagen. Volve a agregarla.');
  }
  return item;
}

/** Los archivos elegidos: con el dialogo, o los JPG/JPEG que ya estan en assets/textures/. */
async function pickSources(from, targetFolder) {
  if (from === 'project-jpg') {
    const entries = await fs.readdir(targetFolder, { withFileTypes: true }).catch(() => []);
    return entries
      .filter((entry) => entry.isFile() && /\.(jpe?g)$/i.test(entry.name))
      .map((entry) => path.join(targetFolder, entry.name));
  }

  const result = await dialog.showOpenDialog({
    title: 'Elegí las imágenes a convertir',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Imágenes (PNG, JPG, JPEG)', extensions: ['png', 'jpg', 'jpeg'] }],
  });
  if (result.canceled) return null;
  return result.filePaths;
}

function register() {
  ipcMain.handle('convert:begin', async (_event, from) => {
    // Siempre la carpeta del editor: una imagen de afuera se COPIA adentro.
    await ensureProjectRoot();
    const projectRoot = getProjectRoot();
    const targetFolder = path.join(projectRoot, 'assets', 'textures');
    await fs.mkdir(targetFolder, { recursive: true });

    // Un plan de otro proyecto no se mezcla con este: sus destinos apuntan a
    // otra carpeta.
    if (!convertSession || convertSession.targetFolder !== targetFolder) {
      convertSession = { targetFolder, items: [] };
    }

    const sources = await pickSources(from, targetFolder);
    if (!sources) {
      return { projectRoot, canceled: true };
    }

    const reserved = new Set(convertSession.items.map((item) => item.target.toLowerCase()));
    const known = new Set(convertSession.items.map((item) => item.sourcePath.toLowerCase()));
    const added = [];
    for (const sourcePath of sources) {
      const extension = path.extname(sourcePath).toLowerCase();
      // El filtro del dialogo se puede saltear escribiendo el nombre a mano.
      if (!CONVERTIBLE_EXTENSIONS.has(extension)) continue;
      // Elegir dos veces el mismo archivo no lo convierte dos veces.
      if (known.has(sourcePath.toLowerCase())) continue;
      known.add(sourcePath.toLowerCase());

      const stats = await fs.stat(sourcePath);
      const target = freeName(targetFolder, safeTextureName(sourcePath), reserved);
      reserved.add(target.toLowerCase());

      const item = { sourcePath, source: path.basename(sourcePath), target, size: stats.size };
      convertSession.items.push(item);
      added.push({ index: convertSession.items.length - 1, source: item.source, target, size: item.size });
    }
    return { projectRoot, canceled: false, items: added };
  });

  ipcMain.handle('convert:readImage', async (_event, index) => {
    const item = convertItem(index);
    const stats = await fs.stat(item.sourcePath);
    if (stats.size > IMAGE_IMPORT_LIMIT) {
      throw new Error(`${item.source} pesa demasiado para convertirla.`);
    }
    const bytes = await fs.readFile(item.sourcePath);
    const mimeType = IMAGE_MIME_TYPES.get(path.extname(item.source).toLowerCase());
    return `data:${mimeType};base64,${bytes.toString('base64')}`;
  });

  // pngBase64 en null significa "copiar el original tal cual", y solo vale para
  // un PNG: un JPG copiado con extension .png seguiria sin abrir en el motor.
  // Devuelve el nombre con que quedo, que puede no ser el del plan si mientras
  // tanto aparecio otro archivo con ese nombre.
  ipcMain.handle('convert:writeImage', async (_event, { index, pngBase64 }) => {
    const item = convertItem(index);
    if (pngBase64 === null && path.extname(item.source).toLowerCase() !== '.png') {
      throw new Error(`${item.source} no es PNG: tiene que convertirse antes de copiarse.`);
    }
    const bytes = pngBase64 === null ? await fs.readFile(item.sourcePath) : Buffer.from(pngBase64, 'base64');

    const others = new Set(
      convertSession.items.filter((other) => other !== item).map((other) => other.target.toLowerCase()),
    );
    // "wx" nunca pisa: si otro proceso creo el archivo entre la eleccion del
    // nombre y la escritura, se prueba con el siguiente libre.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const target = freeName(convertSession.targetFolder, item.target, others);
      try {
        await fs.writeFile(path.join(convertSession.targetFolder, target), bytes, { flag: 'wx' });
        item.target = target;
        return { target };
      } catch (err) {
        if (err.code !== 'EEXIST') throw err;
      }
    }
    throw new Error(`No se encontró un nombre libre para ${item.source}.`);
  });

  ipcMain.handle('convert:reset', () => {
    convertSession = null;
  });
}

module.exports = { register };
