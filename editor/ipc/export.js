// =============================================================================
// Exportar el juego: una carpeta (y un .zip) que se juega sin el editor
// =============================================================================
//
// Archivo > Exportar juego. Arma, en la carpeta que se elija con el dialogo:
//
//   <Juego>/
//     <Juego>.exe              el motor Release, renombrado, sin consola y con el
//                              icono del juego (el de game.json; ver ipc/exe-icon.js)
//     *.dll                    las que el motor necesita (SDL2, MinGW)
//     game.json                la configuracion del juego, con su nivel inicial
//     levels/ assets/          los de la carpeta del editor, sin .bak ni .tmp
//     honeycomb-export.json    la marca de juego exportado (ver
//                              engine/game/ExportedGame.hpp): con ella el motor
//                              arranca en la portada y guarda en %APPDATA%
//     LEEME.txt                como se juega
//     AVISOS-DE-TERCEROS.txt   las licencias de lo que va adentro del .exe
//   <Juego>.zip                lo mismo, para mandarlo
//
// Solo Windows por ahora: el motor que se copia es el de engine/build-release.
//
// Que no puede salir mal:
//   - La carpeta de destino la elige el dialogo, en este proceso: la UI no
//     manda ninguna ruta (igual que el convertidor de imagenes).
//   - Solo se reemplaza una carpeta que ya sea una exportacion anterior (tiene
//     la marca). Una carpeta con otra cosa adentro no se toca.
//   - Se arma en una carpeta aparte y se renombra al final: si algo falla a la
//     mitad, la exportacion anterior queda como estaba.
// =============================================================================

const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { ipcMain, dialog, shell, BrowserWindow } = require('electron');

const { INSTALL_ROOT, ensureProjectRoot, isInside } = require('./project-root');
const { findEngineExecutable } = require('./engine-modes');
const { collectAssetRefs } = require('./levels');
const { zipDirectory, zipEntryNames } = require('./zip');
const { iconImagesFrom, setExeIcon, countIconImages } = require('./exe-icon');

const MARKER_FILE = 'honeycomb-export.json';

/**
 * El nombre del juego como nombre de carpeta valido en Windows. Tiene que dar
 * lo MISMO que ExportedGame::SafeFolderName en el motor: el motor usa ese
 * nombre para la carpeta de partidas en %APPDATA%.
 */
function safeFolderName(name) {
  let out = '';
  for (const char of String(name ?? '')) {
    const code = char.codePointAt(0);
    if (code < 0x20 || '<>:"/\\|?*'.includes(char)) continue;
    out += char;
  }
  out = out.replace(/[. ]+$/, '').replace(/^ +/, '');
  const stem = out.split('.')[0].toUpperCase();
  if (!out || /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(stem)) return 'HoneyComb';
  return out;
}

/** Lo que el editor deja junto a los archivos y no es del juego. */
function isEditorLeftover(name) {
  return name.endsWith('.bak') || name.endsWith('.tmp');
}

/**
 * Cambia el subsistema de un .exe de consola (3) a ventana (2), que es lo que
 * hace "editbin /subsystem:windows". Sin esto, al abrir el juego aparece
 * tambien una consola negra. Se toca SOLO la copia exportada: el motor del
 * editor sigue con su consola, que es donde escribe lo que pasa.
 */
async function makeWindowedExe(exePath) {
  const handle = await fs.open(exePath, 'r+');
  try {
    const dos = Buffer.alloc(0x40);
    await handle.read(dos, 0, dos.length, 0);
    if (dos.toString('latin1', 0, 2) !== 'MZ') throw new Error('El motor no es un ejecutable de Windows.');
    const peOffset = dos.readUInt32LE(0x3c);
    const pe = Buffer.alloc(24 + 70);
    await handle.read(pe, 0, pe.length, peOffset);
    if (pe.toString('latin1', 0, 4) !== 'PE\0\0') throw new Error('El motor no es un ejecutable de Windows.');
    const magic = pe.readUInt16LE(24);
    if (magic !== 0x10b && magic !== 0x20b) throw new Error('El motor no es un ejecutable de Windows.');
    // El campo Subsystem esta en el mismo lugar en PE32 y PE32+.
    const subsystemAt = peOffset + 24 + 68;
    const subsystem = pe.readUInt16LE(24 + 68);
    if (subsystem === 3) {
      const patch = Buffer.alloc(2);
      patch.writeUInt16LE(2, 0);
      await handle.write(patch, 0, 2, subsystemAt);
    }
    return subsystem;
  } finally {
    await handle.close();
  }
}

/**
 * Le pone al .exe exportado el icono del juego ("icon" de game.json, una
 * imagen de assets/). Sin icono en game.json queda el de HoneyComb, que el
 * motor ya trae. Devuelve true si lo puso, o el aviso de por que no: no frena
 * la exportacion, el juego anda igual con el icono de HoneyComb.
 */
async function applyGameIcon(root, gameConfig, exePath) {
  const icon = gameConfig?.icon;
  if (typeof icon !== 'string' || !icon) return false;
  const assetsDir = path.join(root, 'assets');
  const iconPath = path.join(assetsDir, ...icon.split('/'));
  if (!isInside(assetsDir, iconPath) || !fsSync.existsSync(iconPath)) {
    return `El ícono del juego (assets/${icon}) no está: el .exe quedó con el de HoneyComb.`;
  }
  // Un motor compilado antes de que trajera su icono no tiene donde ponerlo:
  // la API de Windows falla con esos ejecutables.
  if (countIconImages(await fs.readFile(exePath)) === 0) {
    return 'El motor Release es de una versión anterior y no puede llevar el ícono del juego: compílalo de nuevo (Ejecutar › Compilar motor Release) y vuelve a exportar.';
  }
  const { nativeImage } = require('electron');
  const images = nativeImage ? iconImagesFrom(nativeImage, iconPath) : null;
  if (!images) {
    return `No se pudo leer el ícono del juego (assets/${icon}): el .exe quedó con el de HoneyComb.`;
  }
  try {
    await setExeIcon(exePath, images);
    return true;
  } catch (err) {
    return `No se pudo poner el ícono del juego en el .exe (${err.message}): quedó con el de HoneyComb.`;
  }
}

/** Lee un JSON, o devuelve null si no existe o esta roto. */
async function readJsonOrNull(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf-8'));
  } catch {
    return null;
  }
}

/** true si "level" es un archivo .json relativo que no sale de levels/. */
function isLevelInsideLevels(level) {
  if (typeof level !== 'string' || !level.toLowerCase().endsWith('.json')) return false;
  const normalized = level.replace(/\\/g, '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) return false;
  return !normalized.split('/').some((part) => part === '..' || part === '');
}

/** Todos los .json debajo de levels/, como rutas relativas a levels/ con "/". */
async function listLevels(levelsDir, prefix = '') {
  const out = [];
  let entries = [];
  try {
    entries = await fs.readdir(path.join(levelsDir, prefix), { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listLevels(levelsDir, relative)));
    else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) out.push(relative);
  }
  return out;
}

/** Los niveles a los que pasa un nivel con "Pasar de nivel" (load_level). */
function loadLevelTargets(level) {
  const targets = [];
  for (const event of Array.isArray(level?.events) ? level.events : []) {
    for (const action of Array.isArray(event?.actions) ? event.actions : []) {
      const target = action?.type === 'load_level' ? action?.params?.level : null;
      if (typeof target === 'string' && target) targets.push(target);
    }
  }
  return targets;
}

/**
 * Lo que le falta al juego para andar completo: imagenes y sonidos que un nivel
 * o game.json nombran y no estan en assets/, y niveles de "Pasar de nivel" que
 * no existen. No frena la exportacion: el motor tolera lo que falta, pero el
 * juego se veria o andaria distinto.
 */
async function findMissing(gameDir, gameConfig) {
  const missing = [];
  const assetsDir = path.join(gameDir, 'assets');
  const levelsDir = path.join(gameDir, 'levels');
  const assetMissing = (ref) => !fsSync.existsSync(path.join(assetsDir, ...ref.split('/')));

  for (const relative of await listLevels(levelsDir)) {
    const level = await readJsonOrNull(path.join(levelsDir, ...relative.split('/')));
    if (!level) {
      missing.push(`levels/${relative} no es un JSON válido`);
      continue;
    }
    for (const ref of collectAssetRefs(level)) {
      if (assetMissing(ref)) missing.push(`levels/${relative} usa assets/${ref}, que no está`);
    }
    for (const target of loadLevelTargets(level)) {
      const withExt = target.toLowerCase().endsWith('.json') ? target : `${target}.json`;
      const resolved = path.join(levelsDir, path.dirname(relative), withExt);
      if (!isInside(levelsDir, resolved) || !fsSync.existsSync(resolved)) {
        missing.push(`levels/${relative} pasa al nivel "${target}", que no está`);
      }
    }
  }

  const styleRefs = [
    gameConfig?.icon,
    gameConfig?.titleScreen?.backgroundImage,
    gameConfig?.titleScreen?.music,
    gameConfig?.hud?.heartFull,
    gameConfig?.hud?.heartEmpty,
    gameConfig?.hud?.barFill,
    gameConfig?.hud?.barFrame,
  ];
  for (const ref of styleRefs) {
    if (typeof ref === 'string' && ref && assetMissing(ref)) missing.push(`game.json usa assets/${ref}, que no está`);
  }
  return missing;
}

function readme(name, folderName) {
  return [
    name,
    '='.repeat(Math.max(name.length, 4)),
    '',
    `Para jugar: abre "${folderName}.exe".`,
    '',
    'Controles',
    '  Flechas o WASD ........ moverse',
    '  Clic izquierdo, Espacio o J ... atacar hacia el mouse',
    '  Q ..................... habilidad del arma',
    '  Shift ................. esquivar',
    '  Clic derecho o K ...... defenderse',
    '  1-9 o rueda del mouse . elegir arma',
    '  E ..................... cambiar arma / tienda',
    '  F11 ................... pantalla completa',
    '  Esc ................... pausa',
    '',
    'La partida se guarda en los puntos de control, en',
    `  %APPDATA%\\${folderName}\\saves`,
    'Para empezar de cero, borra esa carpeta.',
    '',
    'Hecho con HoneyComb Engine.',
    '',
  ].join('\r\n');
}

// Las licencias de lo que va compilado adentro del .exe o al lado (las DLL).
// Las de zlib y MIT piden conservar el aviso; las del runtime de GCC permiten
// distribuirlo con el programa (excepcion de runtime de GCC).
const THIRD_PARTY_NOTICES = `AVISOS DE TERCEROS
==================

Este juego usa el motor HoneyComb Engine, que incluye el siguiente software.


raylib (https://www.raylib.com) - licencia zlib/libpng
Copyright (c) 2013-2025 Ramon Santamaria (@raysan5)

SDL2 (https://www.libsdl.org) - licencia zlib
Copyright (C) 1997-2025 Sam Lantinga <slouken@libsdl.org>

Texto de la licencia zlib (vale para raylib y SDL2):

  This software is provided 'as-is', without any express or implied
  warranty. In no event will the authors be held liable for any damages
  arising from the use of this software.

  Permission is granted to anyone to use this software for any purpose,
  including commercial applications, and to alter it and redistribute it
  freely, subject to the following restrictions:

  1. The origin of this software must not be misrepresented; you must not
     claim that you wrote the original software. If you use this software
     in a product, an acknowledgment in the product documentation would be
     appreciated but is not required.
  2. Altered source versions must be plainly marked as such, and must not be
     misrepresented as being the original software.
  3. This notice may not be removed or altered from any source distribution.


JSON for Modern C++ (https://github.com/nlohmann/json) - licencia MIT
Copyright (c) 2013-2025 Niels Lohmann <https://nlohmann.me>

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in
  all copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.


libstdc++-6.dll y libgcc_s_seh-1.dll (GCC, https://gcc.gnu.org)
  GPL version 3 con la GCC Runtime Library Exception, que permite distribuir
  estas bibliotecas junto a un programa compilado con GCC.

libwinpthread-1.dll (mingw-w64, https://www.mingw-w64.org) - licencia MIT
Copyright (c) 2011 mingw-w64 project
`;

/**
 * Prepara "outDir" para una exportacion nueva. Devuelve null si se puede, o el
 * motivo por el que no: solo se reemplaza lo que hizo una exportacion anterior.
 */
async function destinationProblem(outDir, zipPath, folderName) {
  let previousExport = false;
  if (fsSync.existsSync(outDir)) {
    const stat = await fs.lstat(outDir);
    if (!stat.isDirectory()) return `Ya existe un archivo llamado "${folderName}" en esa carpeta.`;
    const entries = await fs.readdir(outDir);
    previousExport = entries.includes(MARKER_FILE);
    if (entries.length > 0 && !previousExport) {
      return `Ya existe una carpeta "${folderName}" que no es una exportación de HoneyComb. Elige otro destino.`;
    }
  }
  if (fsSync.existsSync(zipPath) && !previousExport) {
    const names = await zipEntryNames(zipPath).catch(() => null);
    if (!names || !names.includes(`${folderName}/${MARKER_FILE}`)) {
      return `Ya existe "${folderName}.zip" y no es una exportación de HoneyComb. Elige otro destino.`;
    }
  }
  return null;
}

let exporting = false;
let lastExport = null;

function register() {
  // "startLevel": el nivel con que arranca el juego (archivo dentro de
  // levels/). Si no viene, el de game.json. Es lo UNICO que manda la UI.
  ipcMain.handle('game:export', async (event, request) => {
    if (exporting) return { ok: false, error: 'Ya hay una exportación en curso.' };
    if (process.platform !== 'win32') {
      return { ok: false, error: 'Por ahora el juego solo se exporta para Windows.' };
    }
    exporting = true;
    try {
      return await exportGame(event, request);
    } finally {
      exporting = false;
    }
  });

  // Muestra la ultima exportacion en el explorador. Sin ruta de la UI: la
  // recuerda este proceso.
  ipcMain.handle('game:revealExport', () => {
    if (lastExport) shell.showItemInFolder(lastExport.zip ?? lastExport.folder);
  });
}

async function exportGame(event, request) {
  const root = await ensureProjectRoot();

  // --- El motor Release ----------------------------------------------------------
  // Solo el de la instalacion: un .exe que este en la carpeta del editor no se
  // copia ni se ejecuta (ver SE-01 en ipc/tests).
  const engine = findEngineExecutable([INSTALL_ROOT], 'release');
  if (!engine) {
    return {
      ok: false,
      missing: true,
      error: 'El motor Release todavía no está compilado (engine/build-release): se exporta ese.',
    };
  }

  // --- Que juego se exporta --------------------------------------------------------
  const gameConfig = (await readJsonOrNull(path.join(root, 'game.json'))) ?? {};
  const name = typeof gameConfig.name === 'string' && gameConfig.name.trim() ? gameConfig.name.trim() : 'Mi juego';
  const requested = request && typeof request === 'object' ? request.startLevel : undefined;
  const startLevel = typeof requested === 'string' && requested ? requested : gameConfig.startLevel;
  if (!startLevel) {
    return { ok: false, error: 'Falta el nivel inicial: elígelo en Archivo › Configuración del juego › General.' };
  }
  if (!isLevelInsideLevels(startLevel) || !fsSync.existsSync(path.join(root, 'levels', ...startLevel.split('/')))) {
    return { ok: false, error: `El nivel inicial "${startLevel}" no está en levels/.` };
  }

  // --- A donde -----------------------------------------------------------------------
  const window = BrowserWindow.fromWebContents(event.sender);
  const options = {
    title: 'Elegir dónde exportar el juego',
    buttonLabel: 'Exportar aquí',
    properties: ['openDirectory', 'createDirectory'],
    ...(lastExport ? { defaultPath: path.dirname(lastExport.folder) } : {}),
  };
  const { canceled, filePaths } = window
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  if (canceled || !filePaths || filePaths.length === 0) return { ok: false, canceled: true };

  const parent = filePaths[0];
  const folderName = safeFolderName(name);
  const outDir = path.join(parent, folderName);
  const zipPath = `${outDir}.zip`;
  // Adentro de la carpeta del editor se copiaria a si misma (levels/ dentro de
  // levels/...), y adentro de la instalacion ensuciaria el repositorio.
  if (isInside(root, outDir) || isInside(INSTALL_ROOT, outDir)) {
    return { ok: false, error: 'Elige una carpeta fuera de la carpeta del editor y de la instalación de HoneyComb.' };
  }
  const problem = await destinationProblem(outDir, zipPath, folderName);
  if (problem) return { ok: false, error: problem };

  // --- Se arma aparte -----------------------------------------------------------------
  const staging = path.join(parent, `.${folderName}.exportando`);
  await fs.rm(staging, { recursive: true, force: true });
  await fs.mkdir(staging, { recursive: true });
  try {
    const exeName = `${folderName}.exe`;
    await fs.copyFile(engine, path.join(staging, exeName));
    await makeWindowedExe(path.join(staging, exeName));
    const warnings = [];
    const iconResult = await applyGameIcon(root, gameConfig, path.join(staging, exeName));
    if (typeof iconResult === 'string') warnings.push(iconResult);
    const engineDir = path.dirname(engine);
    for (const file of await fs.readdir(engineDir)) {
      if (file.toLowerCase().endsWith('.dll')) await fs.copyFile(path.join(engineDir, file), path.join(staging, file));
    }

    // Todo levels/ y assets/, menos los respaldos del editor y los enlaces (un
    // enlace podria apuntar afuera de la carpeta del editor).
    for (const dir of ['levels', 'assets']) {
      const source = path.join(root, dir);
      if (!fsSync.existsSync(source)) {
        await fs.mkdir(path.join(staging, dir), { recursive: true });
        continue;
      }
      await fs.cp(source, path.join(staging, dir), {
        recursive: true,
        filter: (src) => {
          const stat = fsSync.lstatSync(src);
          return !stat.isSymbolicLink() && !isEditorLeftover(path.basename(src));
        },
      });
    }

    await fs.writeFile(
      path.join(staging, 'game.json'),
      JSON.stringify({ ...gameConfig, name, startLevel }, null, 2),
      'utf-8',
    );
    await fs.writeFile(
      path.join(staging, MARKER_FILE),
      JSON.stringify({ format: 1, name, startLevel, exportedAt: new Date().toISOString() }, null, 2),
      'utf-8',
    );
    await fs.writeFile(path.join(staging, 'LEEME.txt'), readme(name, folderName), 'utf-8');
    await fs.writeFile(path.join(staging, 'AVISOS-DE-TERCEROS.txt'), THIRD_PARTY_NOTICES.replace(/\n/g, '\r\n'), 'utf-8');
    const license = path.join(INSTALL_ROOT, 'LICENSE');
    if (fsSync.existsSync(license)) await fs.copyFile(license, path.join(staging, 'LICENCIA.txt'));

    warnings.push(...(await findMissing(staging, gameConfig)));

    // --- Recien ahora se reemplaza la anterior ------------------------------------------
    await fs.rm(outDir, { recursive: true, force: true });
    await fs.rename(staging, outDir);
    const files = await zipDirectory(outDir, zipPath, folderName);
    const { size } = await fs.stat(zipPath);

    lastExport = { folder: outDir, zip: zipPath };
    return {
      ok: true,
      folder: outDir,
      zip: zipPath,
      exe: exeName,
      files,
      zipBytes: size,
      gameIcon: iconResult === true,
      warnings,
    };
  } catch (err) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

module.exports = { register, safeFolderName, makeWindowedExe, applyGameIcon, MARKER_FILE };
