// =============================================================================
// Guardar/abrir un nivel suelto, con dialogo del sistema
// =============================================================================
//
// Estos dos no dependen de que haya un proyecto abierto: el usuario elige el
// archivo a mano en el dialogo, y esa eleccion es la autorizacion. Por eso no
// pasan por resolveInProject como el resto.
//
// Lo unico que comparten con los demas es dejar anotado el ultimo nivel
// tocado, que es de donde se deduce la carpeta del proyecto si nadie la abrio.

const fs = require('node:fs/promises');
const { ipcMain, dialog } = require('electron');

const { setLastLevelPath } = require('./project-root');

function register() {
  ipcMain.handle('project:save', async (_event, { defaultPath, contents }) => {
    const { canceled, filePath } = await dialog.showSaveDialog({
      defaultPath: defaultPath || 'level.json',
      filters: [{ name: 'HoneyComb Level', extensions: ['json'] }],
    });
    if (canceled || !filePath) return { canceled: true };
    await fs.writeFile(filePath, contents, 'utf-8');
    setLastLevelPath(filePath);
    return { canceled: false, filePath };
  });

  ipcMain.handle('project:open', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      filters: [{ name: 'HoneyComb Level', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (canceled || filePaths.length === 0) return { canceled: true };
    const contents = await fs.readFile(filePaths[0], 'utf-8');
    setLastLevelPath(filePaths[0]);
    return { canceled: false, filePath: filePaths[0], contents };
  });
}

module.exports = { register };
