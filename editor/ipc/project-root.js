// =============================================================================
// El proyecto abierto: la raiz de todo lo que se lee y escribe, y la barrera
// para no salirse de ella
// =============================================================================
//
// Cada juego es un PROYECTO: una carpeta con un archivo <Nombre>.honey en la
// raiz. El editor trabaja siempre dentro del proyecto abierto, y sin proyecto
// abierto no lee ni escribe nada: al arrancar se elige (o se crea) uno en la
// pantalla de Inicio. Antes habia una sola "carpeta del editor" para todo, y
// un nivel nuevo terminaba ahi aunque se estuviera trabajando en otro juego.
//
// La carpeta tiene la misma forma que espera el runtime:
//
//   <proyecto>/
//     <Nombre>.honey     marca la carpeta como proyecto (nombre, formato)
//     game.json          configuracion del juego, la lee el motor
//     levels/            los niveles (.json)
//     assets/textures/   las imagenes, ya convertidas a PNG
//     assets/sounds/     los sonidos
//     characters.json    personajes configurados
//     items.json         biblioteca de objetos
//
// El .honey es del EDITOR: el motor no lo lee (encuentra los assets como
// <nivel>/../../assets, ver GameSession), asi que un juego corre igual con o
// sin el. Una carpeta de antes, sin .honey, se convierte al abrirla si quien
// edita acepta: solo se agrega el archivo, no se mueve ni se cambia nada.
//
// La UI nunca elige a que carpeta cambiar: o lo elige la persona en un dialogo
// del sistema, o es un proyecto de la lista de recientes que anoto este
// proceso, o el .honey con que se abrio el editor (doble clic). Una ruta que
// mande la UI y no este en la lista se rechaza.
//
// La validacion de rutas sigue viviendo aca: todo handler que reciba una ruta
// del renderer la pasa por resolveInProject, y ninguna puede salir del
// proyecto abierto.

const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { app, dialog } = require('electron');

const { writeFileAtomic, backupPathOf, removeStaleTempFiles } = require('./safe-write');
const { safeName } = require('./names');

// La carpeta del editor (editor/), que es donde vive main.js. Se calcula desde
// __dirname de ESTE archivo, que esta un nivel mas adentro (editor/ipc/).
const EDITOR_DIR = path.dirname(__dirname);

/**
 * Donde esta instalado HoneyComb: la carpeta que contiene editor/, engine/ y
 * schema/. De aca salen el catalogo de eventos, el motor y el proyecto de
 * ejemplo, que son del programa y no del proyecto.
 */
const INSTALL_ROOT = path.dirname(EDITOR_DIR);

/** La extension del archivo de proyecto. */
const PROJECT_EXT = '.honey';

/** Version del formato del .honey, por si algun dia cambia. */
const PROJECT_FORMAT = 1;

/** Subcarpetas que todo proyecto tiene que tener. */
const PROJECT_DIRS = ['levels', path.join('assets', 'textures'), path.join('assets', 'sounds')];

/**
 * Lo que trae un proyecto nuevo: las imagenes que usa un nivel recien creado
 * (piso, pared y jugador, ver defaultVisuals en level.service.ts) y la hoja de
 * figuras de Recursos > Figuras. Sin ellas el primer nivel se veria vacio en
 * el motor, que dibuja en negro lo que no encuentra.
 */
const STARTER_TEXTURES = ['floor.png', 'wall.png', 'player.png', 'shapes.png'];

/** El nivel del proyecto de ejemplo, y lo que se copia con el de la instalacion. */
const EXAMPLE_LEVEL = 'HoneyComb_Showcase.json';
const EXAMPLE_ENTRIES = ['assets', 'characters.json', 'items.json'];

/** Donde se crean los proyectos si nunca se eligio otra ubicacion. */
const DEFAULT_LOCATION_NAME = 'Juegos HoneyComb';

/** Cuantos proyectos se recuerdan en Inicio. */
const RECENT_PROJECTS_LIMIT = 20;

/** El proyecto abierto: { root, file, name }, o null si no hay ninguno. */
let current = null;

const NO_PROJECT = 'No hay ningún proyecto abierto. Crea o abre uno desde Archivo › Inicio.';

// --- Configuracion del editor ----------------------------------------------------

function settingsPath() {
  return path.join(app.getPath('userData'), 'honeycomb-settings.json');
}

/** Un objeto JSON leido de "file", o null si no esta o no es un objeto JSON valido. */
async function readJsonObject(file) {
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf-8'));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * La configuracion del editor. Si el archivo se rompio (un guardado cortado
 * por una version vieja, o editado a mano), se usa el respaldo .bak que deja
 * writeFileAtomic: sin el, el editor "olvidaba" los proyectos recientes. Sin
 * ninguno de los dos, los valores por defecto (es la primera vez).
 */
async function readSettings() {
  return (await readJsonObject(settingsPath())) ?? (await readJsonObject(backupPathOf(settingsPath()))) ?? {};
}

/**
 * Atomica (ver ipc/safe-write.js): un corte a mitad de la escritura no puede
 * dejar el archivo vacio, y el anterior queda en .bak. Las claves de la
 * version anterior (una sola carpeta del editor) ya pasaron a recentProjects
 * (ver recentProjectsOf) y no se vuelven a escribir.
 */
async function writeSettings(settings) {
  const { workspaceRoot: _root, recentWorkspaces: _recent, ...rest } = settings;
  await writeFileAtomic(settingsPath(), JSON.stringify(rest, null, 2));
}

// --- Utilidades de carpetas ------------------------------------------------------

/** true si la carpeta no existe o no tiene nada adentro. */
async function isEmptyDir(dir) {
  try {
    return (await fs.readdir(dir)).length === 0;
  } catch (err) {
    if (err.code === 'ENOENT') return true;
    throw err;
  }
}

async function isDir(dir) {
  try {
    return (await fs.stat(dir)).isDirectory();
  } catch {
    return false;
  }
}

/** true si son la misma carpeta (en Windows, sin distinguir mayusculas). */
function samePath(a, b) {
  const left = path.resolve(a);
  const right = path.resolve(b);
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right;
}

/**
 * La carpeta de la instalacion (en desarrollo, el repositorio) tiene levels/ y
 * assets/ de ejemplo, pero NO es un proyecto: no se convierte ni se abre como
 * tal. Sus niveles se importan al proyecto abierto, y el juego de muestra se
 * copia con Proyecto de ejemplo.
 */
function isInstallRoot(dir) {
  return samePath(dir, INSTALL_ROOT);
}

/** true si "target" esta dentro de "folder" (o es la misma carpeta). */
function isInside(folder, target) {
  const relative = path.relative(folder, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/** Crea las subcarpetas que falten. No borra ni pisa nada. */
async function ensureStructure(root) {
  for (const dir of PROJECT_DIRS) {
    await fs.mkdir(path.join(root, dir), { recursive: true });
  }
}

// --- El archivo de proyecto ------------------------------------------------------

function isProjectFile(file) {
  return typeof file === 'string' && path.extname(file).toLowerCase() === PROJECT_EXT;
}

/**
 * El .honey de la carpeta, o null si no tiene. Con mas de uno (una copia a
 * mano), el primero por nombre: siempre el mismo.
 */
async function findProjectFile(root) {
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return null;
  }
  const names = entries
    .filter((entry) => entry.isFile() && isProjectFile(entry.name))
    .map((entry) => entry.name)
    .sort();
  return names.length > 0 ? path.join(root, names[0]) : null;
}

/**
 * El nombre del juego segun el .honey. Uno roto o sin nombre no impide abrir
 * el proyecto: se usa el nombre del archivo.
 */
async function readProjectName(file) {
  const data = await readJsonObject(file);
  const name = typeof data?.name === 'string' ? data.name.trim() : '';
  return name || path.basename(file, path.extname(file));
}

function projectFileContents(name) {
  return JSON.stringify({ format: PROJECT_FORMAT, name }, null, 2) + '\n';
}

/** El archivo de proyecto para un juego con ese nombre: "La Catedral" -> "La Catedral.honey". */
function projectFileName(name) {
  return safeName(name, 'proyecto') + PROJECT_EXT;
}

/** El nombre del juego en game.json, o '' si no tiene. */
async function gameNameIn(root) {
  const game = await readJsonObject(path.join(root, 'game.json'));
  return typeof game?.name === 'string' ? game.name.trim() : '';
}

/** Una carpeta de antes del .honey: tiene levels/ o game.json. */
async function looksLikeOldProject(root) {
  return (await isDir(path.join(root, 'levels'))) || fsSync.existsSync(path.join(root, 'game.json'));
}

/**
 * Convierte una carpeta de antes en proyecto: le agrega el .honey, con el
 * nombre del juego de game.json o, si no tiene, el de la carpeta. No toca nada
 * mas. Devuelve la ruta del archivo.
 */
async function convertToProject(root) {
  const name = (await gameNameIn(root)) || path.basename(root);
  const file = path.join(root, projectFileName(name));
  await fs.writeFile(file, projectFileContents(name), { encoding: 'utf-8', flag: 'wx' });
  return file;
}

/**
 * Pregunta con un dialogo del sistema si se convierte una carpeta de antes.
 * Se pregunta desde aca y no desde la UI para que la UI no tenga que mandar
 * ninguna ruta de vuelta: lo que se convierte es lo que este proceso ya eligio.
 */
function askConvert(window) {
  const ask = askConvertOrImport(window, { allowImport: false });
  return async (root) => (await ask(root)) === 'convert';
}

/**
 * Lo mismo, para Abrir nivel: con "allowImport" (hay un proyecto abierto) se
 * ofrece tambien importar solo ese nivel al proyecto abierto, como antes.
 * Devuelve 'convert', 'import' o 'cancel'.
 */
function askConvertOrImport(window, { allowImport }) {
  return async (root) => {
    const choices = allowImport ? ['convert', 'import', 'cancel'] : ['convert', 'cancel'];
    const options = {
      type: 'question',
      title: 'Convertir en proyecto',
      message: `«${path.basename(root)}» no tiene archivo de proyecto (${PROJECT_EXT}).`,
      detail:
        'Parece un juego hecho con una versión anterior del editor. ¿Convertirlo en proyecto? ' +
        `Se agrega un archivo ${PROJECT_EXT} en la carpeta; no se mueve ni se cambia nada más.` +
        (allowImport ? '\n\nO importa solo este nivel (una copia) al proyecto abierto.' : ''),
      buttons: allowImport
        ? ['Convertir en proyecto', 'Importar solo este nivel', 'Cancelar']
        : ['Convertir en proyecto', 'Cancelar'],
      defaultId: 0,
      cancelId: choices.length - 1,
      noLink: true,
    };
    const { response } = window
      ? await dialog.showMessageBox(window, options)
      : await dialog.showMessageBox(options);
    return choices[response] ?? 'cancel';
  };
}

// --- Proyectos recientes (la pantalla de Inicio) --------------------------------
//
// Cada entrada es { root, name, lastLevel, openedAt }. "lastLevel" es el
// ultimo nivel que se edito, para volver a el al abrir el proyecto. La lista
// es tambien la que decide a que carpetas puede volver la UI sin dialogo.

function validEntry(entry) {
  return !!entry && typeof entry === 'object' && typeof entry.root === 'string' && path.isAbsolute(entry.root);
}

/**
 * La lista guardada. Si todavia no hay (la configuracion es de antes de los
 * proyectos), se arma con la carpeta del editor y las carpetas recientes de
 * entonces: asi aparecen en Inicio, y al abrirlas se ofrece convertirlas.
 */
function recentProjectsOf(settings) {
  if (Array.isArray(settings.recentProjects)) {
    return settings.recentProjects
      .filter(validEntry)
      .map((entry) => ({
        root: entry.root,
        name: typeof entry.name === 'string' && entry.name ? entry.name : path.basename(entry.root),
        lastLevel: typeof entry.lastLevel === 'string' && entry.lastLevel ? entry.lastLevel : null,
        openedAt: Number.isFinite(entry.openedAt) ? entry.openedAt : 0,
      }))
      .slice(0, RECENT_PROJECTS_LIMIT);
  }
  const roots = [settings.workspaceRoot, ...(Array.isArray(settings.recentWorkspaces) ? settings.recentWorkspaces : [])];
  const list = [];
  for (const root of roots) {
    if (typeof root === 'string' && path.isAbsolute(root) && !list.some((entry) => samePath(entry.root, root))) {
      list.push({ root, name: path.basename(root), lastLevel: null, openedAt: 0 });
    }
  }
  return list.slice(0, RECENT_PROJECTS_LIMIT);
}

/** La lista con "entry" primero y sin repetir su carpeta. */
function withRecent(list, entry) {
  return [entry, ...list.filter((other) => !samePath(other.root, entry.root))].slice(0, RECENT_PROJECTS_LIMIT);
}

/** Lo que muestra Inicio: la lista, y de cada proyecto si sigue estando y si ya tiene .honey. */
async function listRecentProjects() {
  const list = recentProjectsOf(await readSettings());
  return Promise.all(
    list.map(async (entry) => {
      const exists = await isDir(entry.root);
      const legacy = exists && !(await findProjectFile(entry.root));
      return { ...entry, exists, legacy };
    }),
  );
}

/** Quita un proyecto de la lista (la carpeta no se toca). */
async function forgetRecentProject(root) {
  if (typeof root !== 'string' || !root) throw new Error('Proyecto no válido.');
  const settings = await readSettings();
  const list = recentProjectsOf(settings).filter((entry) => !samePath(entry.root, root));
  await writeSettings({ ...settings, recentProjects: list });
  return list.length;
}

/**
 * Anota el nivel que se esta editando como el ultimo del proyecto abierto.
 * "level" es un archivo de levels/ ("nivel_1.json"), sin carpetas, y tiene
 * que existir: si la UI todavia mostraba un nivel del proyecto anterior, no
 * se anota en este.
 */
async function rememberLevel(level) {
  if (!current) return false;
  if (typeof level !== 'string' || !level || level.length > 255 || /[\\/]/.test(level) || level.startsWith('.')) {
    throw new Error('Nivel no válido.');
  }
  if (!fsSync.existsSync(path.join(current.root, 'levels', level))) return false;
  const settings = await readSettings();
  await writeSettings({
    ...settings,
    recentProjects: withRecent(recentProjectsOf(settings), {
      root: current.root,
      name: current.name,
      lastLevel: level,
      openedAt: Date.now(),
    }),
  });
  return true;
}

// --- Abrir, crear y cerrar --------------------------------------------------------

/** Lo que la UI sabe del proyecto abierto. */
async function projectInfo() {
  if (!current) return null;
  const entry = recentProjectsOf(await readSettings()).find((other) => samePath(other.root, current.root));
  return { root: current.root, file: current.file, name: current.name, lastLevel: entry?.lastLevel ?? null };
}

/**
 * Pasa a trabajar en el proyecto del archivo "file" (un .honey dentro de
 * "root"): le completa las carpetas que falten, lo pone primero en recientes y
 * limpia los temporales de guardados cortados. Devuelve su info.
 */
async function activate(root, file) {
  const name = await readProjectName(file);
  await ensureStructure(root);
  current = { root, file, name };
  const settings = await readSettings();
  const list = recentProjectsOf(settings);
  const previous = list.find((entry) => samePath(entry.root, root));
  await writeSettings({
    ...settings,
    recentProjects: withRecent(list, { root, name, lastLevel: previous?.lastLevel ?? null, openedAt: Date.now() }),
  });
  cleanTempFiles([[root, 4]]);
  return projectInfo();
}

/** Abre el proyecto de un .honey (el dialogo, o el editor abierto con doble clic). */
async function openProjectFile(file) {
  if (!isProjectFile(file)) throw new Error(`Eso no es un archivo de proyecto (${PROJECT_EXT}).`);
  let stat;
  try {
    stat = await fs.stat(file);
  } catch {
    throw new Error(`No se encontró ${file}.`);
  }
  if (!stat.isFile()) throw new Error(`${file} no es un archivo de proyecto.`);
  return activate(path.dirname(file), file);
}

/**
 * Abre el proyecto de la carpeta "root". Sin .honey: si es una carpeta de
 * antes, pregunta con "confirmConvert" y la convierte; si no se quiere
 * convertir, devuelve null y no cambia nada. Si no parece un proyecto, falla.
 */
async function openProjectAt(root, { confirmConvert }) {
  if (!(await isDir(root))) throw new Error(`La carpeta ${root} ya no existe.`);
  if (isInstallRoot(root)) {
    throw new Error('Esa es la carpeta de HoneyComb, no un proyecto. Para jugar con el juego de muestra usa Proyecto de ejemplo.');
  }
  let file = await findProjectFile(root);
  if (!file) {
    if (!(await looksLikeOldProject(root))) {
      throw new Error(`${root} no es un proyecto de HoneyComb: no tiene un archivo ${PROJECT_EXT} ni la carpeta levels/.`);
    }
    if (!(await confirmConvert(root))) return null;
    file = await convertToProject(root);
  }
  return activate(root, file);
}

/**
 * Vuelve a un proyecto reciente. "requested" llega de la UI: solo se usa para
 * buscarlo en la lista, y lo que se abre es la ruta guardada.
 */
async function openRecentProject(requested, options) {
  if (typeof requested !== 'string' || !requested || !path.isAbsolute(requested)) {
    throw new Error('Proyecto no válido.');
  }
  const known = recentProjectsOf(await readSettings()).map((entry) => entry.root);
  if (current) known.unshift(current.root);
  const match = known.find((root) => samePath(root, requested));
  if (!match) {
    throw new Error('Ese proyecto no está entre los recientes. Ábrelo con Abrir proyecto.');
  }
  return openProjectAt(match, options);
}

/**
 * El proyecto al que pertenece un archivo (un nivel elegido con Abrir nivel):
 * la carpeta mas cercana hacia arriba que tenga un .honey, o una de antes que
 * tenga el archivo dentro de su levels/. null si no es de ningun proyecto
 * (tampoco la carpeta de la instalacion: sus niveles se importan).
 */
async function findProjectOf(file) {
  let dir = path.dirname(file);
  for (let depth = 0; depth < 6; depth += 1) {
    if (isInstallRoot(dir)) return null;
    if (await findProjectFile(dir)) return dir;
    const levels = path.join(dir, 'levels');
    if (isInside(levels, file) && (await isDir(levels))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Deja el editor sin proyecto (Archivo › Cerrar proyecto). */
function closeProject() {
  current = null;
}

/** Donde se crean los proyectos nuevos: la ultima ubicacion elegida, o Documentos/Juegos HoneyComb. */
async function getProjectsLocation() {
  const saved = (await readSettings()).projectsLocation;
  return typeof saved === 'string' && path.isAbsolute(saved)
    ? saved
    : path.join(app.getPath('documents'), DEFAULT_LOCATION_NAME);
}

/** Recuerda la ubicacion elegida con el dialogo para los proximos proyectos. */
async function setProjectsLocation(dir) {
  const settings = await readSettings();
  await writeSettings({ ...settings, projectsLocation: dir });
  return dir;
}

/**
 * Crea un proyecto nuevo en la ubicacion de proyectos: la carpeta
 * <ubicacion>/<Nombre>/ con <Nombre>.honey, game.json, levels/ y assets/, y
 * pasa a trabajar ahi.
 *
 * Vacio trae las imagenes basicas; "example" trae el juego de muestra de la
 * instalacion (su nivel, sus assets, personajes y objetos) con ese nivel como
 * nivel inicial. La carpeta no puede existir con algo adentro: un proyecto
 * nuevo no se mezcla con lo que ya habia. Si algo falla a mitad, se borra lo
 * que se llego a crear.
 */
async function createProject(options) {
  const name = typeof options?.name === 'string' ? options.name.trim() : '';
  const example = options?.example === true;
  if (!name) throw new Error('Escribe un nombre para el juego.');
  if (name.length > 80) throw new Error('El nombre es demasiado largo (máximo 80 caracteres).');
  const folder = safeName(name, '');
  if (!folder) throw new Error('El nombre tiene que tener al menos una letra o un número.');

  const location = await getProjectsLocation();
  const root = path.join(location, folder);
  if (!(await isEmptyDir(root))) {
    throw new Error(`Ya existe la carpeta ${root} y tiene archivos. Elige otro nombre u otra ubicación.`);
  }
  const exampleLevel = path.join(INSTALL_ROOT, 'levels', EXAMPLE_LEVEL);
  if (example && !fsSync.existsSync(exampleLevel)) {
    throw new Error('No se encontró el juego de ejemplo en la instalación.');
  }

  const existed = fsSync.existsSync(root);
  const file = path.join(root, projectFileName(name));
  const copied = [];
  try {
    await fs.mkdir(root, { recursive: true });
    if (example) {
      for (const entry of EXAMPLE_ENTRIES) {
        const source = path.join(INSTALL_ROOT, entry);
        if (!fsSync.existsSync(source)) continue;
        await fs.cp(source, path.join(root, entry), { recursive: true, force: false, errorOnExist: false });
        copied.push(entry);
      }
      await ensureStructure(root);
      await fs.copyFile(exampleLevel, path.join(root, 'levels', EXAMPLE_LEVEL), fsSync.constants.COPYFILE_EXCL);
      copied.push(`levels/${EXAMPLE_LEVEL}`);
    } else {
      await ensureStructure(root);
      for (const texture of STARTER_TEXTURES) {
        const source = path.join(INSTALL_ROOT, 'assets', 'textures', texture);
        if (!fsSync.existsSync(source)) continue;
        await fs.copyFile(source, path.join(root, 'assets', 'textures', texture), fsSync.constants.COPYFILE_EXCL);
        copied.push(texture);
      }
    }
    const game = example ? { name, startLevel: EXAMPLE_LEVEL } : { name };
    await fs.writeFile(path.join(root, 'game.json'), JSON.stringify(game, null, 2), { encoding: 'utf-8', flag: 'wx' });
    await fs.writeFile(file, projectFileContents(name), { encoding: 'utf-8', flag: 'wx' });
  } catch (err) {
    // La carpeta estaba vacia (o no existia): todo lo que hay es de este intento.
    await (existed ? emptyDir(root) : fs.rm(root, { recursive: true, force: true })).catch(() => {});
    throw err;
  }
  return { project: await activate(root, file), copied };
}

async function emptyDir(dir) {
  for (const entry of await fs.readdir(dir)) {
    await fs.rm(path.join(dir, entry), { recursive: true, force: true });
  }
}

// --- Arranque -------------------------------------------------------------------

/** El .honey entre los argumentos del programa (doble clic en el archivo), o null. */
function projectFileFromArgs(argv) {
  if (!Array.isArray(argv)) return null;
  for (const arg of argv.slice(1)) {
    if (isProjectFile(arg) && path.isAbsolute(arg) && fsSync.existsSync(arg)) return arg;
  }
  return null;
}

/**
 * Al arrancar: sin proyecto (se elige en Inicio), salvo que el editor se haya
 * abierto con un .honey (doble clic). Limpia los temporales de la carpeta de
 * la configuracion. Devuelve el proyecto abierto, o el motivo por el que el
 * del doble clic no se pudo abrir.
 */
async function initWorkspace({ argv } = {}) {
  current = null;
  cleanTempFiles([[path.dirname(settingsPath()), 0]]);
  const file = projectFileFromArgs(argv);
  if (!file) return { project: null, error: null };
  try {
    return { project: await openProjectFile(file), error: null };
  } catch (err) {
    return { project: null, error: `No se pudo abrir ${file}: ${err.message}` };
  }
}

/**
 * Borra, sin esperar, los .tmp que dejo un guardado que se corto (ver
 * removeStaleTempFiles) en cada [carpeta, profundidad]. En segundo plano: una
 * carpeta grande no tiene por que demorar la ventana. La ultima limpieza queda
 * en lastCleanup, para las pruebas.
 */
let lastCleanup = Promise.resolve(0);
function cleanTempFiles(folders) {
  lastCleanup = Promise.all(
    folders.map(([folder, depth]) =>
      removeStaleTempFiles(folder, { depth }).then((removed) => {
        if (removed > 0) {
          console.log(`[honeycomb] se borraron ${removed} temporales de guardados cortados en ${folder}`);
        }
        return removed;
      }),
    ),
  ).then((counts) => counts.reduce((sum, count) => sum + count, 0));
}

/** La limpieza de temporales que se lanzo por ultima vez (cuantos borro). */
function tempCleanup() {
  return lastCleanup;
}

// --- Rutas dentro del proyecto -------------------------------------------------

/** La carpeta del proyecto abierto, o null si no hay ninguno. */
function getProjectRoot() {
  return current?.root ?? null;
}

/** La raiz para algo que necesita el proyecto. Sin proyecto abierto, falla con un mensaje que se entienda. */
async function ensureProjectRoot() {
  if (!current) throw new Error(NO_PROJECT);
  return current.root;
}

// Convierte una ruta que llego del renderer en una ruta absoluta dentro del
// proyecto abierto, o tira error si se sale de el. Asi se frenan tanto
// "../../etc/passwd" como una ruta absoluta a otro disco.
function resolveInProject(relativeOrAbsolutePath) {
  if (!current) {
    throw new Error(NO_PROJECT);
  }
  const root = current.root;
  const target = path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.join(root, relativeOrAbsolutePath);
  if (!isInside(root, target)) {
    throw new Error(`Ruta fuera del proyecto: ${relativeOrAbsolutePath}`);
  }
  return target;
}

module.exports = {
  INSTALL_ROOT,
  PROJECT_EXT,
  initWorkspace,
  askConvert,
  askConvertOrImport,
  openProjectFile,
  openProjectAt,
  openRecentProject,
  findProjectOf,
  listRecentProjects,
  forgetRecentProject,
  rememberLevel,
  projectInfo,
  closeProject,
  createProject,
  getProjectsLocation,
  setProjectsLocation,
  projectFileFromArgs,
  getProjectRoot,
  ensureProjectRoot,
  resolveInProject,
  isInside,
  tempCleanup,
  settingsPath,
};
