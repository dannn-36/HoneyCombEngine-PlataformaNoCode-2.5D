// =============================================================================
// El proyecto visto desde la UI: cual esta abierto, abrir, crear, cerrar
// =============================================================================
//
// El estado vive en ipc/project-root.js; aca solo estan los canales.
//
// Ningun canal recibe de la UI una ruta a la que cambiar: o la elige la
// persona en un dialogo del sistema, o es un proyecto de la lista de
// recientes (que anoto este proceso), o el .honey con que se abrio el editor.
//
// El catalogo de eventos tambien se lee aca, y no con project:readFile: es
// parte del PROGRAMA (schema/ junto a editor/ y engine/), no del proyecto.

const path = require('node:path');
const fs = require('node:fs/promises');
const { ipcMain, dialog, shell, BrowserWindow } = require('electron');

const {
  INSTALL_ROOT,
  PROJECT_EXT,
  askConvert,
  closeProject,
  createProject,
  ensureProjectRoot,
  findProjectOf,
  forgetRecentProject,
  getProjectRoot,
  getProjectsLocation,
  listRecentProjects,
  openProjectAt,
  openProjectFile,
  openRecentProject,
  projectInfo,
  rememberLevel,
  setProjectsLocation,
} = require('./project-root');

/** Un dialogo del sistema sobre la ventana que lo pidio (o suelto, si no hay). */
function showOpenDialog(event, options) {
  const window = BrowserWindow.fromWebContents(event.sender);
  return window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options);
}

/**
 * @param startup lo que devolvio initWorkspace() al arrancar. "error" (el
 *   .honey del doble clic no se pudo abrir) se entrega UNA vez, para avisarlo.
 * @returns requestOpen(file): main.js lo llama cuando se hace doble clic en un
 *   .honey con el editor ya abierto. El archivo queda pendiente hasta que la
 *   UI (despues de preguntar por los cambios sin guardar) pida abrirlo.
 */
function register(startup) {
  let startupError = startup?.error ?? null;
  let requestedFile = null;

  ipcMain.handle('workspace:info', async () => {
    const error = startupError;
    startupError = null;
    return { project: await projectInfo(), location: await getProjectsLocation(), error };
  });

  // Inicio: la lista de proyectos recientes, y quitar uno de ella.
  ipcMain.handle('workspace:recentProjects', () => listRecentProjects());
  ipcMain.handle('workspace:forgetRecent', async (_event, root) => {
    await forgetRecentProject(root);
  });

  // Abrir proyecto: se elige el .honey. Tambien se acepta un .json de un juego
  // de antes (su game.json o uno de sus niveles), para encontrar la carpeta y
  // ofrecer convertirla.
  ipcMain.handle('workspace:openProject', async (event) => {
    const current = getProjectRoot();
    const { canceled, filePaths } = await showOpenDialog(event, {
      title: 'Abrir proyecto',
      defaultPath: current ? path.dirname(current) : await getProjectsLocation(),
      filters: [
        { name: 'Proyecto HoneyComb', extensions: [PROJECT_EXT.slice(1)] },
        { name: 'Juego de una versión anterior (game.json o un nivel)', extensions: ['json'] },
      ],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return null;
    const chosen = filePaths[0];
    if (path.extname(chosen).toLowerCase() === PROJECT_EXT) {
      return openProjectFile(chosen);
    }
    const root = path.basename(chosen).toLowerCase() === 'game.json' ? path.dirname(chosen) : await findProjectOf(chosen);
    if (!root) {
      throw new Error(`${path.basename(chosen)} no está dentro de ningún proyecto de HoneyComb.`);
    }
    return openProjectAt(root, { confirmConvert: askConvert(BrowserWindow.fromWebContents(event.sender)) });
  });

  // Inicio > un reciente. La ruta de la UI solo se busca en la lista.
  ipcMain.handle('workspace:openRecent', (event, root) =>
    openRecentProject(root, { confirmConvert: askConvert(BrowserWindow.fromWebContents(event.sender)) }),
  );

  // Nuevo proyecto: la ubicacion se elige con el dialogo y se recuerda; el
  // nombre lo escribe la persona en el editor.
  ipcMain.handle('workspace:chooseLocation', async (event) => {
    const { canceled, filePaths } = await showOpenDialog(event, {
      title: 'Elige dónde guardar tus proyectos',
      defaultPath: await getProjectsLocation(),
      properties: ['openDirectory', 'createDirectory', 'promptToCreate'],
    });
    if (canceled || filePaths.length === 0) return null;
    return setProjectsLocation(filePaths[0]);
  });

  ipcMain.handle('workspace:createProject', (_event, options) => createProject(options));

  ipcMain.handle('workspace:close', () => {
    closeProject();
  });

  // El nivel que se esta editando, para volver a el al reabrir el proyecto.
  ipcMain.handle('workspace:rememberLevel', (_event, level) => rememberLevel(level));

  // Doble clic en un .honey con el editor abierto (ver main.js).
  ipcMain.handle('workspace:openRequested', async () => {
    const file = requestedFile;
    requestedFile = null;
    return file ? openProjectFile(file) : null;
  });

  ipcMain.handle('workspace:reveal', async () => {
    const error = await shell.openPath(await ensureProjectRoot());
    if (error) throw new Error(error);
  });

  ipcMain.handle('workspace:readEventCatalog', () =>
    fs.readFile(path.join(INSTALL_ROOT, 'schema', 'event_catalog.json'), 'utf-8'),
  );

  return {
    requestOpen(file) {
      requestedFile = file;
    },
  };
}

module.exports = { register };
