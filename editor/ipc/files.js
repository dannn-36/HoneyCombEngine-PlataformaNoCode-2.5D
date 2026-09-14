// =============================================================================
// Archivos del proyecto abierto: abrir la carpeta, leer, escribir, listar
// =============================================================================
//
// Todas las rutas que llegan del renderer se resuelven relativas a la raiz del
// proyecto y se validan para que no puedan escapar de esa carpeta (ver
// ipc/project-root.js). El renderer no es confiable por definicion, aunque
// contextIsolation ya limita mucho el riesgo -- esto es una segunda barrera
// barata.

const path = require('node:path');
const fs = require('node:fs/promises');
const { ipcMain, dialog } = require('electron');

const {
  getProjectRoot,
  setProjectRoot,
  resolveInProject,
  ensureProjectRoot,
} = require('./project-root');
const {
  TEXT_FILE_NAMES,
  TEXT_EXTENSIONS,
  IMAGE_MIME_TYPES,
  TEXT_PREVIEW_LIMIT,
  IMAGE_PREVIEW_LIMIT,
} = require('./media-types');

function register() {
  ipcMain.handle('project:openFolder', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openDirectory'],
    });
    if (canceled || filePaths.length === 0) return null;
    return setProjectRoot(filePaths[0]);
  });

  ipcMain.handle('project:ensureRoot', () =>
    ensureProjectRoot('Elegi la carpeta del proyecto (donde estan levels/ y assets/)'),
  );

  ipcMain.handle('project:readFile', async (_event, relativePath) => {
    const targetPath = resolveInProject(relativePath);
    return fs.readFile(targetPath, 'utf-8');
  });

  ipcMain.handle('project:writeFile', async (_event, { filePath, contents }) => {
    const targetPath = resolveInProject(filePath);
    // mkdir recursivo: guardar el primer nivel de un proyecto recien creado no
    // deberia fallar solo porque todavia no existe la carpeta levels/.
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.writeFile(targetPath, contents, 'utf-8');
  });

  ipcMain.handle('project:listDir', async (_event, relativeDir) => {
    const targetDir = resolveInProject(relativeDir);
    try {
      const entries = await fs.readdir(targetDir, { withFileTypes: true });
      // Solo archivos: el editor lista niveles y texturas, no navega carpetas.
      return entries.filter((entry) => entry.isFile()).map((entry) => entry.name);
    } catch (err) {
      // Una carpeta que no existe es un caso normal (un proyecto sin texturas
      // todavia), no un error: se devuelve vacio y la UI muestra el panel vacio.
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  });

  // --- Explorador de archivos -----------------------------------------------
  //
  // El explorador de la izquierda muestra la carpeta del proyecto entera, como
  // el de VS Code. Se lee UNA CARPETA POR VEZ, cuando se la despliega, y no el
  // arbol completo de una: recorrer en profundidad al abrir el proyecto
  // significaria entrar en node_modules (decenas de miles de archivos) y dejar
  // la ventana congelada varios segundos antes de mostrar nada. Con carga
  // perezosa cada despliegue cuesta un readdir y no se esconde ninguna carpeta.
  //
  // project:listDir sigue existiendo aparte, para los listados planos que piden
  // el desplegable de niveles y el panel de Recursos.

  ipcMain.handle('project:listEntries', async (_event, relativeDir) => {
    if (!getProjectRoot()) {
      return [];
    }
    const targetDir = resolveInProject(relativeDir || '.');
    let entries;
    try {
      entries = await fs.readdir(targetDir, { withFileTypes: true });
    } catch (err) {
      // Una carpeta que ya no esta (la borraron por fuera) no es motivo para
      // romper el explorador entero: esa rama queda vacia y el resto sigue.
      if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return [];
      throw err;
    }

    const nodes = [];
    for (const entry of entries) {
      // Barras normales siempre: estas rutas viajan a la UI, que las compara
      // contra prefijos como "levels/", y eso no puede depender del separador
      // de Windows.
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        nodes.push({ name: entry.name, path: relativePath, kind: 'dir' });
      } else if (entry.isFile()) {
        nodes.push({ name: entry.name, path: relativePath, kind: 'file' });
      }
    }

    // Carpetas primero y alfabetico dentro de cada grupo, como cualquier
    // explorador: el orden en que readdir devuelve las entradas depende del
    // sistema de archivos y no es el que una persona espera leer.
    nodes.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
    return nodes;
  });

  // --- Leer un archivo cualquiera para mirarlo ------------------------------
  //
  // project:readFile devuelve texto crudo y sirve para los .json que el editor
  // entiende. Este handler es para MIRAR cualquier archivo del proyecto: decide
  // por extension si se puede mostrar como texto, como imagen o si no se puede
  // mostrar, y corta lo que sea demasiado grande para meter en una ventana.

  ipcMain.handle('project:readFileData', async (_event, relativePath) => {
    const targetPath = resolveInProject(relativePath);
    const stats = await fs.stat(targetPath);
    const extension = path.extname(targetPath).toLowerCase();
    const name = path.basename(targetPath).toLowerCase();

    const mimeType = IMAGE_MIME_TYPES.get(extension);
    if (mimeType) {
      if (stats.size > IMAGE_PREVIEW_LIMIT) {
        return { kind: 'binary', size: stats.size, reason: 'too-large' };
      }
      const bytes = await fs.readFile(targetPath);
      return {
        kind: 'image',
        size: stats.size,
        dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}`,
      };
    }

    if (!TEXT_EXTENSIONS.has(extension) && !TEXT_FILE_NAMES.has(name)) {
      return { kind: 'binary', size: stats.size, reason: 'unsupported' };
    }

    // Se lee solo el principio y no el archivo entero: un .log grande no tiene
    // por que entrar en memoria para ver sus primeras lineas.
    const handle = await fs.open(targetPath, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(stats.size, TEXT_PREVIEW_LIMIT));
      await handle.read(buffer, 0, buffer.length, 0);
      return {
        kind: 'text',
        size: stats.size,
        text: buffer.toString('utf-8'),
        truncated: stats.size > buffer.length,
      };
    } finally {
      await handle.close();
    }
  });
}

module.exports = { register };
