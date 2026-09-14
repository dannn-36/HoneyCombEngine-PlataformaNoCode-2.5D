// =============================================================================
// Importar una carpeta de imagenes como texturas del proyecto
// =============================================================================
//
// Las imagenes se COPIAN dentro de assets/textures/ del proyecto en vez de
// referenciarse donde estan: el nivel guarda rutas relativas a assets/ y el
// motor las resuelve contra esa carpeta (ver AssetResolver), asi que una
// textura que viva fuera del proyecto se veria en el editor y saldria en negro
// al ejecutar.
//
// Y se copian AJUSTADAS: el motor dibuja cada sprite al tamano de su recorte,
// uno a uno, asi que una captura de 2377x1837 px ocuparia decenas de celdas
// (los requisitos estan en src/app/core/texture-fit.ts).
//
// Va en tres pasos porque el ajuste lo hace la UI y no este proceso: hay que
// decodificar la imagen, y el navegador decodifica PNG, JPG, GIF, WebP y BMP,
// mientras que el nativeImage de Electron solo garantiza PNG y JPG.
//
//   1. project:beginImport           elige las carpetas y arma el plan
//   2. project:readImportImage       la UI pide cada original, de a uno
//   3. project:writeImportedTexture  y devuelve el PNG ajustado para escribir
//
// El plan queda guardado ACA, y los pasos 2 y 3 reciben solo un indice: la UI
// nunca elige una ruta, asi que no puede leer ni pisar nada fuera de lo que la
// persona eligio en los dialogos.

const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { ipcMain, dialog } = require('electron');

const { getProjectRoot, ensureProjectRoot } = require('./project-root');
const { IMAGE_MIME_TYPES, IMAGE_IMPORT_LIMIT } = require('./media-types');

let importSession = null;

/** true si los dos archivos tienen exactamente los mismos bytes. */
async function sameContents(a, b) {
  const [statA, statB] = await Promise.all([fs.stat(a), fs.stat(b)]);
  if (statA.size !== statB.size) return false;
  const [bytesA, bytesB] = await Promise.all([fs.readFile(a), fs.readFile(b)]);
  return bytesA.equals(bytesB);
}

function importItem(index) {
  const item = importSession?.items[index];
  if (!item) {
    throw new Error('La importacion ya no esta activa. Volve a empezarla.');
  }
  return item;
}

function register() {
  ipcMain.handle('project:beginImport', async () => {
    // Solo si no se pudo deducir se pregunta, y en el mismo gesto: el dialogo de
    // la carpeta de imagenes viene justo despues, sin volver a tocar Importar.
    if (!(await ensureProjectRoot('Elegi la carpeta del proyecto (las imagenes van a su assets/textures)'))) {
      return null;
    }

    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Elegi la carpeta con las imagenes',
      properties: ['openDirectory'],
    });
    // La raiz se devuelve igual: pudo haberse deducido recien, y la UI tiene que
    // enterarse aunque la persona cancele el segundo dialogo.
    if (canceled || filePaths.length === 0) {
      return { projectRoot: getProjectRoot(), canceled: true };
    }

    const folder = filePaths[0];
    const targetFolder = path.join(getProjectRoot(), 'assets', 'textures');
    await fs.mkdir(targetFolder, { recursive: true });

    const entries = await fs.readdir(folder, { withFileTypes: true });
    const items = [];
    for (const entry of entries) {
      const extension = path.extname(entry.name).toLowerCase();
      if (!entry.isFile() || !IMAGE_MIME_TYPES.has(extension)) continue;

      // Todo sale como PNG: es el formato que el motor carga seguro.
      const target = path.basename(entry.name, extension) + '.png';
      const sourcePath = path.join(folder, entry.name);
      const targetPath = path.join(targetFolder, target);

      //   new     no hay nada con ese nombre
      //   stale   hay una copia CRUDA de esta misma imagen, byte a byte, que dejo
      //           una importacion vieja que no ajustaba el tamano: se puede
      //           reemplazar por la version ajustada sin perder nada
      //   exists  hay OTRA imagen con ese nombre, y esa no se pisa
      let status = 'new';
      if (fsSync.existsSync(targetPath)) {
        status = (await sameContents(sourcePath, targetPath)) ? 'stale' : 'exists';
      }
      items.push({ source: entry.name, target, status });
    }

    importSession = { folder, targetFolder, items };
    return { projectRoot: getProjectRoot(), canceled: false, folder, items };
  });

  ipcMain.handle('project:readImportImage', async (_event, index) => {
    const item = importItem(index);
    const sourcePath = path.join(importSession.folder, item.source);
    const stats = await fs.stat(sourcePath);
    if (stats.size > IMAGE_IMPORT_LIMIT) {
      throw new Error(`${item.source} pesa demasiado para importarla.`);
    }
    const bytes = await fs.readFile(sourcePath);
    const mimeType = IMAGE_MIME_TYPES.get(path.extname(item.source).toLowerCase());
    return `data:${mimeType};base64,${bytes.toString('base64')}`;
  });

  // pngBase64 en null significa "copiar el original tal cual", y solo se acepta
  // para un PNG: cualquier otro formato tiene que llegar convertido, o quedaria
  // un JPG con extension .png que el motor no sabria abrir.
  ipcMain.handle('project:writeImportedTexture', async (_event, { index, pngBase64 }) => {
    const item = importItem(index);
    if (item.status === 'exists') {
      return { written: false };
    }

    const sourcePath = path.join(importSession.folder, item.source);
    if (pngBase64 === null && path.extname(item.source).toLowerCase() !== '.png') {
      throw new Error(`${item.source} no es PNG: tiene que convertirse antes de copiarse.`);
    }
    const bytes =
      pngBase64 === null ? await fs.readFile(sourcePath) : Buffer.from(pngBase64, 'base64');

    try {
      // "wx" falla si el archivo ya existe: dos imagenes de la carpeta que salen
      // con el mismo nombre (sprite.jpg y sprite.png) no se pisan entre si. Solo
      // una copia cruda vieja ("stale") se sobrescribe.
      await fs.writeFile(path.join(importSession.targetFolder, item.target), bytes, {
        flag: item.status === 'stale' ? 'w' : 'wx',
      });
      return { written: true };
    } catch (err) {
      if (err.code === 'EEXIST') return { written: false };
      throw err;
    }
  });
}

module.exports = { register };
