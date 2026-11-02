// =============================================================================
// Abrir un nivel con el dialogo del sistema
// =============================================================================
//
// El dialogo arranca en levels/ del proyecto abierto, pero deja elegir un
// .json de cualquier parte:
//
//   - Uno del proyecto abierto se abre tal cual.
//   - Uno de OTRO proyecto (una carpeta con .honey, o una de antes con el
//     nivel en su levels/) cambia el editor a ese proyecto y lo abre ahi. Nada
//     se copia: cada juego guarda sus niveles en su propia carpeta.
//   - Uno suelto, que no es de ningun proyecto (Descargas, un adjunto), se
//     IMPORTA al proyecto abierto: se copia a levels/ con un nombre libre,
//     junto con las texturas y sonidos que usa. El original queda intacto.
//
// Guardar no pasa por un dialogo: los niveles viven en levels/, y el nombre
// lo pide el editor (Guardar como). Por eso aca no hay handler de guardado; se
// escribe con project:writeFile, que no puede salir del proyecto.

const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { ipcMain, dialog, BrowserWindow } = require('electron');

const {
  askConvertOrImport,
  findProjectOf,
  getProjectRoot,
  getProjectsLocation,
  isInside,
  openProjectAt,
} = require('./project-root');
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
 * Copia un nivel suelto a levels/ del proyecto abierto, con sus assets.
 *
 * Los assets se buscan donde los buscaria el motor: <nivel>/../../assets. Uno
 * que ya existe en el proyecto no se pisa (puede ser otra imagen con
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
    // escribir fuera de los del proyecto.
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

/** Ruta relativa a la carpeta del proyecto, siempre con "/": la UI compara contra "levels/". */
function toProjectPath(root, target) {
  return path.relative(root, target).split(path.sep).join('/');
}

function register() {
  ipcMain.handle('project:open', async (event) => {
    const root = getProjectRoot();
    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Abrir nivel',
      defaultPath: root ? path.join(root, 'levels') : await getProjectsLocation(),
      filters: [{ name: 'HoneyComb Level', extensions: ['json'] }],
      properties: ['openFile'],
    };
    const { canceled, filePaths } = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (canceled || filePaths.length === 0) return { canceled: true };

    const sourcePath = filePaths[0];
    const contents = await fs.readFile(sourcePath, 'utf-8');
    if (root && isInside(root, sourcePath)) {
      return { canceled: false, relativePath: toProjectPath(root, sourcePath), contents };
    }

    // De otro proyecto: se pasa a ese proyecto. Si es uno de antes se ofrece
    // convertirlo o, con un proyecto abierto, importar solo este nivel.
    const owner = await findProjectOf(sourcePath);
    let importInstead = false;
    if (owner) {
      const ask = askConvertOrImport(window, { allowImport: !!root });
      const project = await openProjectAt(owner, {
        confirmConvert: async (dir) => {
          const choice = await ask(dir);
          importInstead = choice === 'import';
          return choice === 'convert';
        },
      });
      if (project) {
        return { canceled: false, relativePath: toProjectPath(owner, sourcePath), contents, project };
      }
      if (!importInstead) return { canceled: true };
    }

    if (!root) {
      throw new Error(
        `${path.basename(sourcePath)} no está dentro de ningún proyecto. Crea o abre un proyecto y ábrelo de nuevo para importarlo.`,
      );
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
