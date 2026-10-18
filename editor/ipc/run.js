// =============================================================================
// Ejecutar el nivel abierto en el runtime
// =============================================================================
//
// Lanza engine.exe con el nivel abierto, que es el equivalente a hacer a mano:
//
//     engine/build/engine.exe  C:/.../levels/mi_nivel.json
//
// Con el motor que se eligio en el editor: Debug (engine/build) o Release
// (engine/build-release). Ver engine-modes.js.
//
// Se le pasa la ruta ABSOLUTA del nivel a proposito. El motor deduce de ella
// donde estan los assets (assetsRoot = <nivel>/../../assets, ver main.cpp), asi
// que con la ruta completa encuentra las texturas sin importar desde donde se
// lo haya lanzado.

const path = require('node:path');
const fsSync = require('node:fs');
const fs = require('node:fs/promises');
const { spawn } = require('node:child_process');
const { ipcMain } = require('electron');

const { INSTALL_ROOT, getProjectRoot, resolveInProject } = require('./project-root');
const { MODES, isMode, findEngineExecutable } = require('./engine-modes');

/**
 * Las raices donde buscar el motor, en orden. Primero donde esta instalado
 * HoneyComb (junto a editor/): el motor es del programa, y la carpeta del
 * editor -- donde viven los niveles -- no lo tiene. Despues, por
 * compatibilidad, la raiz que se deduce del nivel (<raiz>/levels/<nivel>) y la
 * carpeta del editor, por si alguien la puso dentro de una instalacion.
 */
function engineRoots(levelPath) {
  return [INSTALL_ROOT, path.dirname(path.dirname(levelPath)), getProjectRoot()].filter(Boolean);
}

function register() {
  // mode: 'debug' (desarrollo, con F3) o 'release' (optimizado). Ver engine-modes.js.
  // start: 'level' (directo en el nivel) o 'title' (en la portada de game.json).
  ipcMain.handle('project:run', async (_event, { levelPath, mode, start }) => {
    if (!levelPath) {
      return { ok: false, error: 'No hay un nivel guardado para ejecutar.' };
    }
    if (!fsSync.existsSync(levelPath)) {
      return { ok: false, error: `No se encontro el nivel: ${levelPath}` };
    }

    const engineMode = isMode(mode) ? mode : 'debug';
    const executable = findEngineExecutable(engineRoots(levelPath), engineMode);
    if (!executable) {
      // "missing" le dice a la UI que puede ofrecer compilarlo.
      return {
        ok: false,
        missing: true,
        error: `El motor ${MODES[engineMode].buildType} todavía no está compilado (engine/${MODES[engineMode].buildDir}).`,
      };
    }

    // cwd en la carpeta del ejecutable: ahi viven las DLL (SDL2, libstdc++) que
    // Windows busca al lado del .exe.
    //
    // detached + unref: el juego es un proceso aparte con su propia ventana, y
    // no debe morir si se cierra el editor ni bloquear este handler.
    // --portada: arranca como el juego terminado, en la portada (ver engine/main.cpp).
    const args = start === 'title' ? [levelPath, '--portada'] : [levelPath];
    const child = spawn(executable, args, {
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

  // La partida guardada que escribe el motor (engine/game/Progress.cpp). Una
  // ruta fija y no una que mande la UI: este permiso borra ese archivo y nada
  // mas. Sin partida no es un error, ya esta como se pidio.
  ipcMain.handle('game:clearSave', async () => {
    await fs.rm(resolveInProject('saves/partida.json'), { force: true });
  });
}

module.exports = { register };
