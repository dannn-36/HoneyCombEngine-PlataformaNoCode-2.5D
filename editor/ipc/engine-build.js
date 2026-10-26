// =============================================================================
// Compilar el motor desde el editor (Debug o Release)
// =============================================================================
//
// Corre los comandos de CMake que arma engine-modes.js (buildPlan) y manda cada
// linea de la salida a la UI por "engine:build-log", que la muestra en la
// Consola. Que modo es cual y por que van en carpetas separadas esta en
// engine-modes.js.
//
// Un solo build a la vez: dos ninja sobre la misma carpeta se pisan.
//
// La app instalada (la del instalador, ver scripts/build-installer.js) no
// compila: trae los dos motores ya compilados y no tiene CMake ni compilador.
// Ahi "canBuild" es false y la UI no ofrece compilar.

const path = require('node:path');
const { spawn } = require('node:child_process');
const { app, ipcMain } = require('electron');

const { INSTALL_ROOT } = require('./project-root');
const { MODES, isMode, findEngineExecutable, buildPlan, buildEnv } = require('./engine-modes');

const ENGINE_DIR = path.join(INSTALL_ROOT, 'engine');

let building = false;

/** Corre un comando y reenvia su salida linea por linea. Resuelve con el codigo de salida. */
function runStep(cmake, args, env, onLine) {
  return new Promise((resolve) => {
    const child = spawn(cmake, args, { cwd: ENGINE_DIR, env, windowsHide: true });
    let pending = '';
    const forward = (chunk) => {
      pending += chunk.toString();
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) {
        if (line.trim()) onLine(line);
      }
    };
    child.stdout.on('data', forward);
    child.stderr.on('data', forward);
    child.on('error', (err) => {
      onLine(`No se pudo ejecutar ${cmake}: ${err.message}`);
      resolve(-1);
    });
    child.on('close', (code) => {
      if (pending.trim()) onLine(pending);
      resolve(code ?? -1);
    });
  });
}

function register() {
  // Que motores hay compilados, para que la UI marque el que falta, y si esta
  // instalacion puede compilarlos.
  ipcMain.handle('engine:status', () => ({
    debug: findEngineExecutable([INSTALL_ROOT], 'debug') !== null,
    release: findEngineExecutable([INSTALL_ROOT], 'release') !== null,
    canBuild: !app.isPackaged,
  }));

  ipcMain.handle('engine:build', async (event, mode) => {
    if (!isMode(mode)) {
      return { ok: false, error: 'Modo de motor desconocido.' };
    }
    if (app.isPackaged) {
      return {
        ok: false,
        error: 'Esta instalación de HoneyComb trae el motor ya compilado y no puede compilarlo. Si falta, reinstala HoneyComb.',
      };
    }
    if (building) {
      return { ok: false, error: 'Ya se está compilando el motor. Espera a que termine.' };
    }
    const plan = buildPlan(ENGINE_DIR, mode);
    if (plan.error) {
      return { ok: false, error: plan.error };
    }

    const env = buildEnv(plan);

    const send = (line) => {
      if (!event.sender.isDestroyed()) event.sender.send('engine:build-log', line);
    };

    building = true;
    try {
      for (const step of plan.steps) {
        send(`${step.label} el motor ${MODES[mode].buildType}…`);
        const code = await runStep(plan.cmake, step.args, env, send);
        if (code !== 0) {
          return { ok: false, error: `${step.label} el motor ${MODES[mode].buildType} falló (código ${code}). El detalle está en la Consola.` };
        }
      }
    } finally {
      building = false;
    }
    return { ok: true, executable: findEngineExecutable([INSTALL_ROOT], mode) };
  });
}

module.exports = { register };
