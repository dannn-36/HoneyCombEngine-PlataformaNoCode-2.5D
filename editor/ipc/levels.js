// =============================================================================
// Abrir un nivel con el dialogo del sistema
// =============================================================================
//
// El dialogo arranca en levels/ de la carpeta del editor, pero deja elegir un
// .json de cualquier parte. Lo que se elige AFUERA no se edita donde esta: se
// IMPORTA, igual que una imagen. Se copia a levels/ con un nombre libre, junto
// con las texturas y sonidos que usa, y el editor abre la copia. El original
// queda intacto, y lo que se guarde va siempre a la carpeta del editor.
//
// Guardar ya no pasa por un dialogo: los niveles viven en levels/, y el nombre
// lo pide el editor (Guardar como). Por eso aca no hay handler de guardado; se
// escribe con project:writeFile, que no puede salir de la carpeta del editor.

const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { ipcMain, dialog } = require('electron');

const { ensureProjectRoot, isInside } = require('./project-root');
const { safeStem, freeName } = require('./names');

/**
 * Las claves del nivel que nombran un archivo de assets/ (ver
 * schema/level.schema.json): las texturas, la musica del nivel, y los sonidos y
 * musicas de los eventos (play_sound, play_music).
 */
const ASSET_KEYS = new Set(['texture', 'soundPath', 'floorTexture', 'music']);

/** Rutas de assets/ que usa un nivel, buscadas en todo el JSON (entidades, visuales, eventos...). */
function collectAssetRefs(value, refs = new Set()) {
  if (Array.isArray(value)) {
    for (const child of value) collectAssetRefs(child, refs);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (ASSET_KEYS.has(key) && typeof child === 'string' && child !== '') {
        refs.add(child);
      } else {
        collectAssetRefs(child, refs);
      }
    }
  }
  return refs;
}

/**
 * Copia un nivel de afuera a levels/ de la carpeta del editor, con sus assets.
 *
 * Los assets se buscan donde los buscaria el motor: <nivel>/../../assets. Uno
 * que ya existe en la carpeta del editor no se pisa (puede ser otra imagen con
 * el mismo nombre, y otros niveles la usan). Los niveles a los que este pasa
 * con un evento load_level NO se copian: se importan aparte, de a uno.
 */
async function importLevel(root, sourcePath, contents) {
  let level;
  try {
    level = JSON.parse(contents);
  } catch {
    throw new Error(`${path.basename(sourcePath)} no es un JSON valido.`);
  }

  const sourceAssets = path.join(path.dirname(path.dirname(sourcePath)), 'assets');
  const targetAssets = path.join(root, 'assets');
  const report = { copied: 0, kept: 0, missing: [] };

  for (const ref of collectAssetRefs(level)) {
    const from = path.resolve(sourceAssets, ref);
    const to = path.resolve(targetAssets, ref);
    // Una ruta como "../../algo" no puede leer fuera de los assets de origen ni
    // escribir fuera de los de la carpeta del editor.
    if (!isInside(sourceAssets, from) || !isInside(targetAssets, to)) {
      report.missing.push(ref);
    } else if (fsSync.existsSync(to)) {
      report.kept += 1;
    } else if (!fsSync.existsSync(from)) {
      report.missing.push(ref);
    } else {
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(from, to, fsSync.constants.COPYFILE_EXCL);
      report.copied += 1;
    }
  }

  const levelsDir = path.join(root, 'levels');
  await fs.mkdir(levelsDir, { recursive: true });
  const fileName = freeName(levelsDir, safeStem(sourcePath, 'nivel') + '.json');
  await fs.writeFile(path.join(levelsDir, fileName), contents, { encoding: 'utf-8', flag: 'wx' });
  return { from: sourcePath, fileName, ...report };
}

/** Ruta relativa a la carpeta del editor, siempre con "/": la UI compara contra "levels/". */
function toProjectPath(root, target) {
  return path.relative(root, target).split(path.sep).join('/');
}

function register() {
  ipcMain.handle('project:open', async () => {
    const root = await ensureProjectRoot();
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Abrir nivel',
      defaultPath: path.join(root, 'levels'),
      filters: [{ name: 'HoneyComb Level', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return { canceled: true };

    const sourcePath = filePaths[0];
    const contents = await fs.readFile(sourcePath, 'utf-8');
    if (isInside(root, sourcePath)) {
      return { canceled: false, relativePath: toProjectPath(root, sourcePath), contents };
    }

    const imported = await importLevel(root, sourcePath, contents);
    return {
      canceled: false,
      relativePath: `levels/${imported.fileName}`,
      contents,
      imported,
    };
  });
}

module.exports = { register, collectAssetRefs };
