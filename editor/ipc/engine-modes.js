// =============================================================================
// Las dos compilaciones del motor: Debug y Release
// =============================================================================
//
// El editor deja elegir con que motor se ejecuta un nivel (Ejecutar > Motor):
//
//   debug    la version de desarrollo: sin optimizar, con las herramientas de
//            administrador (F3, ver engine/game/DevTools.hpp). Es la que deja
//            el instalador, en engine/build.
//   release  la que se juega: optimizada (-O3) y sin herramientas. Vive en
//            engine/build-release y la compila el editor la primera vez que
//            se pide (ver engine-build.js).
//
// Van en carpetas separadas para tener las dos listas a la vez: cambiar de una
// a otra no recompila nada.
//
// Este archivo no usa Electron a proposito: es la parte que decide (donde esta
// cada motor, que comandos compilan cada uno) y se puede probar con node solo.

const path = require('node:path');
const fsSync = require('node:fs');

const MODES = {
  debug: {
    buildType: 'Debug',
    buildDir: 'build',
    // Donde puede haber quedado el binario, en orden de preferencia. "build"
    // es lo que usan el instalador y el preset de Linux, pero los presets de
    // Windows escriben en build-mingw y build-msvc, y los generadores
    // multi-configuracion (Visual Studio) meten un Debug/ mas adentro.
    lookup: [['build'], ['build', 'Debug'], ['build-mingw'], ['build-msvc'], ['build-msvc', 'Debug']],
  },
  release: {
    buildType: 'Release',
    buildDir: 'build-release',
    lookup: [['build-release'], ['build-release', 'Release'], ['build-msvc', 'Release']],
  },
};

/** Carpetas que ya tienen una configuracion de CMake de la que copiar el compilador y vcpkg. */
const REFERENCE_DIRS = ['build', 'build-release', 'build-mingw'];

function isMode(value) {
  return value === 'debug' || value === 'release';
}

const EXE_NAME = process.platform === 'win32' ? 'engine.exe' : 'engine';

/** El ejecutable de un modo dentro de alguna de las raices, o null. */
function findEngineExecutable(roots, mode) {
  for (const root of roots) {
    for (const buildDir of MODES[mode].lookup) {
      const candidate = path.join(root, 'engine', ...buildDir, EXE_NAME);
      if (fsSync.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

/** Las variables de un CMakeCache.txt ("CLAVE:TIPO=valor"), o null si no existe. */
function readCMakeCache(buildDir) {
  let text;
  try {
    text = fsSync.readFileSync(path.join(buildDir, 'CMakeCache.txt'), 'utf-8');
  } catch {
    return null;
  }
  const values = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9_]+):[A-Z]+=(.*)$/.exec(line);
    if (match) values.set(match[1], match[2]);
  }
  return values;
}

/**
 * Los comandos que dejan compilado el motor de un modo.
 *
 * Si la carpeta ya esta configurada con ese tipo, alcanza con "cmake --build":
 * ninja recompila solo lo que cambio. Si no, se configura primero COPIANDO de
 * otra carpeta ya configurada el compilador, el generador y vcpkg. Es lo que
 * hizo el instalador (ver tools/setup/wizard.ps1), y asi el editor no tiene
 * que volver a averiguar donde esta MSYS2 o vcpkg en esta maquina.
 *
 * Devuelve { error } si no hay de donde copiar: el motor nunca se compilo.
 */
function buildPlan(engineDir, mode) {
  const target = path.join(engineDir, MODES[mode].buildDir);
  const own = readCMakeCache(target);
  const configured = own && own.get('CMAKE_BUILD_TYPE') === MODES[mode].buildType;

  const reference =
    own ?? REFERENCE_DIRS.map((dir) => readCMakeCache(path.join(engineDir, dir))).find((cache) => cache);
  if (!reference) {
    return {
      error:
        'El motor nunca se compiló en esta instalación: no hay de dónde sacar el compilador y vcpkg. ' +
        'Corre el instalador (HoneyComb-Setup) una vez.',
    };
  }

  const cmake = reference.get('CMAKE_COMMAND') || 'cmake';
  const steps = [];
  if (!configured) {
    const args = ['-S', engineDir, '-B', target, `-DCMAKE_BUILD_TYPE=${MODES[mode].buildType}`];
    const generator = reference.get('CMAKE_GENERATOR');
    if (generator) args.push('-G', generator);
    for (const key of [
      'CMAKE_TOOLCHAIN_FILE',
      'VCPKG_TARGET_TRIPLET',
      'VCPKG_HOST_TRIPLET',
      'CMAKE_C_COMPILER',
      'CMAKE_CXX_COMPILER',
      'CMAKE_MAKE_PROGRAM',
    ]) {
      const value = reference.get(key);
      if (value) args.push(`-D${key}=${value}`);
    }
    steps.push({ label: 'Configurando', args });
  }
  steps.push({ label: 'Compilando', args: ['--build', target] });

  // El compilador de MinGW y vcpkg buscan sus herramientas en el PATH: se
  // antepone la carpeta del compilador y la de cmake, como en la terminal de
  // MSYS2 donde se instalo.
  const extraPath = [reference.get('CMAKE_CXX_COMPILER'), cmake]
    .filter((file) => file && path.isAbsolute(file))
    .map((file) => path.dirname(file));
  const toolchain = reference.get('CMAKE_TOOLCHAIN_FILE');
  const vcpkgRoot = toolchain ? path.resolve(path.dirname(toolchain), '..', '..') : null;

  return { cmake, steps, extraPath: [...new Set(extraPath)], vcpkgRoot, target };
}

/**
 * Las variables de entorno para correr los pasos de un plan: el PATH con el
 * compilador y cmake adelante, y VCPKG_ROOT si no estaba. Lo usan el editor
 * (engine-build.js) y el que arma el instalador (scripts/build-installer.js).
 */
function buildEnv(plan, baseEnv = process.env) {
  const env = { ...baseEnv };
  const pathKey = Object.keys(env).find((key) => key.toUpperCase() === 'PATH') ?? 'PATH';
  env[pathKey] = [...plan.extraPath, env[pathKey] ?? ''].join(path.delimiter);
  if (plan.vcpkgRoot && !env.VCPKG_ROOT) {
    env.VCPKG_ROOT = plan.vcpkgRoot;
  }
  // VS Code exporta esto en su terminal y convierte cualquier Electron hijo en Node.
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

module.exports = { MODES, isMode, findEngineExecutable, readCMakeCache, buildPlan, buildEnv };
