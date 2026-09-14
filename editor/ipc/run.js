// =============================================================================
// Ejecutar el nivel abierto en el runtime
// =============================================================================
//
// Lanza engine.exe con el nivel abierto, que es el equivalente a hacer a mano:
//
//     engine/build/engine.exe  C:/.../levels/mi_nivel.json
//
// Se le pasa la ruta ABSOLUTA del nivel a proposito. El motor deduce de ella
// donde estan los assets (assetsRoot = <nivel>/../../assets, ver main.cpp), asi
// que con la ruta completa encuentra las texturas sin importar desde donde se
// lo haya lanzado.

const path = require('node:path');
const fsSync = require('node:fs');
const { spawn } = require('node:child_process');
const { ipcMain } = require('electron');

const { getProjectRoot } = require('./project-root');

/**
 * Busca el ejecutable del motor a partir de la ruta del nivel.
 *
 * Se usa la MISMA convencion de carpetas que ya usa el motor para los assets:
 * un nivel vive en <raiz>/levels/, asi que la raiz es su abuelo. Deducirlo de
 * ahi hace que Ejecutar funcione aunque no se haya abierto una carpeta de
 * proyecto en el editor; si aun asi no aparece, se prueba con esa carpeta.
 */
function findEngineExecutable(levelPath) {
  const exeName = process.platform === 'win32' ? 'engine.exe' : 'engine';
  const roots = [path.dirname(path.dirname(levelPath)), getProjectRoot()].filter(Boolean);

  for (const root of roots) {
    const candidate = path.join(root, 'engine', 'build', exeName);
    if (fsSync.existsSync(candidate)) return candidate;
  }
  return null;
}

function register() {
  ipcMain.handle('project:run', async (_event, levelPath) => {
    if (!levelPath) {
      return { ok: false, error: 'No hay un nivel guardado para ejecutar.' };
    }
    if (!fsSync.existsSync(levelPath)) {
      return { ok: false, error: `No se encontro el nivel: ${levelPath}` };
    }

    const executable = findEngineExecutable(levelPath);
    if (!executable) {
      return {
        ok: false,
        error: 'No se encontro engine/build/engine.exe. Compila el motor antes de ejecutar.',
      };
    }

    // cwd en la carpeta del ejecutable: ahi viven las DLL (SDL2, libstdc++) que
    // Windows busca al lado del .exe.
    //
    // detached + unref: el juego es un proceso aparte con su propia ventana, y
    // no debe morir si se cierra el editor ni bloquear este handler.
    const child = spawn(executable, [levelPath], {
      cwd: path.dirname(executable),
      detached: true,
      stdio: 'ignore',
    });

    // Si el binario no arranca (permisos, DLL faltante) el fallo llega por este
    // evento y no como excepcion de spawn(); sin el, el error se perderia.
    let spawnError = null;
    child.on('error', (err) => {
      spawnError = err;
      console.error('[honeycomb] no se pudo ejecutar el motor:', err.message);
    });

    child.unref();

    // Un respiro corto para poder informar el fallo inmediato (ENOENT, EACCES)
    // en vez de decir "lanzado" cuando en realidad no arranco.
    await new Promise((resolve) => setTimeout(resolve, 120));
    if (spawnError) {
      return { ok: false, error: `No se pudo ejecutar el motor: ${spawnError.message}` };
    }

    return { ok: true, executable };
  });
}

module.exports = { register };
