// =============================================================================
// Arma el instalador de Windows: editor/release/HoneyComb-Engine-Setup-<version>.exe
// =============================================================================
//
// Uso: npm run installer   (desde editor/), o doble clic en Crear-Instalador.cmd
//
// En orden:
//   1. Compila el motor Debug y Release con el compilador que dejo el asistente
//      (HoneyComb-Setup). Ninja recompila solo lo que cambio: si ya estaba al
//      dia tarda segundos. Es lo que evita que el instalador lleve un motor viejo.
//   2. Compila la interfaz (ng build, configuracion production).
//   3. Empaqueta con electron-builder, con la configuracion de "build" en
//      package.json.
//
// Lo que queda instalado, junto a "HoneyComb Engine.exe":
//
//   resources/app.asar          main.js, preload.js, ipc/, dist/ y ajv
//   resources/engine/build/     engine.exe + DLL (Debug)
//   resources/engine/build-release/  engine.exe + DLL (Release)
//   resources/schema/  levels/  assets/  characters.json  items.json
//
// resources/ queda con la misma forma que la raiz del repositorio. INSTALL_ROOT
// (ipc/project-root.js) es la carpeta que contiene al codigo del editor, y en
// la app instalada ese codigo vive en resources/app.asar: asi el editor
// encuentra el motor, el schema y los niveles de ejemplo sin cambiar nada.
//
// Quien instala no necesita Node, CMake ni compilador: el motor va ya
// compilado. Quien ARMA el instalador si, porque se recompila el motor.
// =============================================================================

const path = require('node:path');
const fsSync = require('node:fs');
const { spawn } = require('node:child_process');

const { MODES, buildPlan, buildEnv } = require('../ipc/engine-modes');

const EDITOR_DIR = path.dirname(__dirname);
const INSTALL_ROOT = path.dirname(EDITOR_DIR);
const ENGINE_DIR = path.join(INSTALL_ROOT, 'engine');
const ANGULAR_INDEX = path.join(EDITOR_DIR, 'dist', 'editor', 'browser', 'index.html');

function fail(message) {
  console.error(`\n[instalador] ${message}`);
  process.exit(1);
}

function step(message) {
  console.log(`\n[instalador] ${message}`);
}

/** Corre un comando mostrando su salida. Resuelve con el codigo de salida. */
function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.on('error', (err) => {
      console.error(`No se pudo ejecutar ${command}: ${err.message}`);
      resolve(-1);
    });
    child.on('close', (code) => resolve(code ?? -1));
  });
}

/**
 * Compila el motor de un modo en la carpeta que copia extraResources
 * (engine/build o engine/build-release), con los mismos pasos que "Compilar
 * motor" del editor (ver ipc/engine-modes.js).
 */
async function buildEngine(mode) {
  const { buildType, buildDir } = MODES[mode];
  const plan = buildPlan(ENGINE_DIR, mode);
  if (plan.error) fail(plan.error);
  const env = buildEnv(plan);
  for (const { label, args } of plan.steps) {
    step(`${label} el motor ${buildType}...`);
    const code = await run(plan.cmake, args, { cwd: ENGINE_DIR, env });
    if (code !== 0) fail(`${label} el motor ${buildType} fallo (codigo ${code}).`);
  }
  const exe = path.join(ENGINE_DIR, buildDir, 'engine.exe');
  if (!fsSync.existsSync(exe)) fail(`La compilacion termino pero no esta ${exe}.`);
  const dlls = fsSync.readdirSync(path.dirname(exe)).filter((file) => file.toLowerCase().endsWith('.dll'));
  if (dlls.length === 0) fail(`Junto a ${exe} no hay ninguna DLL (SDL2, MinGW): el motor no arrancaria.`);
}

async function buildInterface() {
  step('Compilando la interfaz (ng build)...');
  const ng = require.resolve('@angular/cli/bin/ng.js', { paths: [EDITOR_DIR] });
  const code = await run(process.execPath, [ng, 'build'], { cwd: EDITOR_DIR });
  if (code !== 0) fail(`ng build fallo (codigo ${code}).`);
  if (!fsSync.existsSync(ANGULAR_INDEX)) fail(`ng build termino pero no esta ${ANGULAR_INDEX}.`);
}

async function packageApp() {
  step('Empaquetando con electron-builder...');
  const builder = require('electron-builder');
  const artifacts = await builder.build({
    projectDir: EDITOR_DIR,
    targets: builder.Platform.WINDOWS.createTarget(),
    // Nunca subir nada a ningun lado: el instalador queda en editor/release.
    publish: 'never',
  });
  return artifacts.filter((file) => file.toLowerCase().endsWith('.exe'));
}

async function main() {
  if (process.platform !== 'win32') {
    fail('El instalador es para Windows y se arma en Windows (el motor que lleva es el de MinGW).');
  }
  const started = Date.now();

  await buildEngine('debug');
  await buildEngine('release');
  await buildInterface();
  const installers = await packageApp();

  const seconds = Math.round((Date.now() - started) / 1000);
  step(`Listo en ${seconds} s.`);
  for (const file of installers) {
    const megabytes = (fsSync.statSync(file).size / (1024 * 1024)).toFixed(1);
    console.log(`  ${file}  (${megabytes} MB)`);
  }
}

main().catch((err) => fail(err && err.stack ? err.stack : String(err)));
