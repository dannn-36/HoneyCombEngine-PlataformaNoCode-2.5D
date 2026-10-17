// =============================================================================
// La carpeta del editor vista desde la UI: cual es, cambiarla, mostrarla
// =============================================================================
//
// El estado vive en ipc/project-root.js; aca solo estan los canales.
//
// El catalogo de eventos tambien se lee aca, y no con project:readFile: es
// parte del PROGRAMA (schema/ junto a editor/ y engine/), no del proyecto. Con
// la carpeta del editor fuera del repositorio, buscarlo en el proyecto
// dejaria el panel de eventos vacio.

const path = require('node:path');
const fs = require('node:fs/promises');
const { ipcMain, dialog, shell } = require('electron');

const { INSTALL_ROOT, changeWorkspace, ensureProjectRoot } = require('./project-root');

/**
 * @param startup lo que devolvio initWorkspace() al arrancar. "seeded" se
 *   entrega UNA vez, para que la UI avise que copio los niveles del repositorio.
 */
function register(startup) {
  let pendingSeed = startup.seeded;

  ipcMain.handle('workspace:info', async () => {
    const root = await ensureProjectRoot();
    const seeded = pendingSeed;
    pendingSeed = [];
    return { root, seeded };
  });

  ipcMain.handle('workspace:change', async () => {
    const current = await ensureProjectRoot();
    const { canceled, filePaths } = await dialog.showOpenDialog({
      title: 'Elegí la carpeta del editor',
      defaultPath: current,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || filePaths.length === 0) return null;
    return changeWorkspace(filePaths[0]);
  });

  ipcMain.handle('workspace:reveal', async () => {
    const error = await shell.openPath(await ensureProjectRoot());
    if (error) throw new Error(error);
  });

  ipcMain.handle('workspace:readEventCatalog', () =>
    fs.readFile(path.join(INSTALL_ROOT, 'schema', 'event_catalog.json'), 'utf-8'),
  );
}

module.exports = { register };
