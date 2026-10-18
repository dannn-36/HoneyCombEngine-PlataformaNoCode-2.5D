// =============================================================================
// La carpeta del editor: la raiz de todo proyecto, y la barrera para no salirse
// =============================================================================
//
// El editor trabaja SIEMPRE dentro de una carpeta propia, que es la raiz del
// proyecto. Antes la raiz era la que se eligiera con "Carpeta...", o la que se
// dedujera del ultimo nivel abierto, o el repositorio entero: abrir un nivel de
// Descargas convertia Descargas en el proyecto, e Importar copiaba la carpeta
// que se eligiera, entera. Ahora nada de eso decide donde se trabaja.
//
// La carpeta tiene la misma forma que espera el runtime:
//
//   <carpeta del editor>/
//     levels/            los niveles (.json)
//     assets/textures/   las imagenes, ya convertidas a PNG
//     assets/sounds/     los sonidos
//     characters.json    personajes configurados
//     items.json         biblioteca de objetos
//
// El motor encuentra los assets como <nivel>/../../assets (ver GameSession), asi
// que un nivel guardado aca corre tal cual. Lo que llega de afuera -- una
// imagen, un nivel de otra carpeta -- se COPIA adentro; el original no se toca.
//
// Por defecto es Documentos/HoneyComb. Se puede cambiar (Archivo > Cambiar
// carpeta del editor), y la eleccion se guarda en la carpeta de datos de
// Electron, fuera del proyecto.
//
// La validacion de rutas sigue viviendo aca: todo handler que reciba una ruta
// del renderer la pasa por resolveInProject, y ninguna puede salir de la
// carpeta del editor.

const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { app } = require('electron');

const { writeFileAtomic, backupPathOf, removeStaleTempFiles } = require('./safe-write');

// La carpeta del editor (editor/), que es donde vive main.js. Se calcula desde
// __dirname de ESTE archivo, que esta un nivel mas adentro (editor/ipc/).
const EDITOR_DIR = path.dirname(__dirname);

/**
 * Donde esta instalado HoneyComb: la carpeta que contiene editor/, engine/ y
 * schema/. De aca salen el catalogo de eventos y el motor, que son del
 * programa y no del proyecto.
 */
const INSTALL_ROOT = path.dirname(EDITOR_DIR);

/** Subcarpetas que toda carpeta del editor tiene que tener. */
const WORKSPACE_DIRS = ['levels', path.join('assets', 'textures'), path.join('assets', 'sounds')];

/** Lo que se copia del repositorio la primera vez (ver seedFromInstall). */
const SEED_ENTRIES = ['levels', 'assets', 'characters.json', 'items.json'];

let workspaceRoot = null;

function settingsPath() {
  return path.join(app.getPath('userData'), 'honeycomb-settings.json');
}

function defaultWorkspaceRoot() {
  return path.join(app.getPath('documents'), 'HoneyComb');
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
 * writeFileAtomic: sin el, el editor "olvidaba" la carpeta elegida y volvia a
 * Documentos/HoneyComb sin avisar. Sin ninguno de los dos, los valores por
 * defecto (es la primera vez).
 */
async function readSettings() {
  return (await readJsonObject(settingsPath())) ?? (await readJsonObject(backupPathOf(settingsPath()))) ?? {};
}

async function writeSettings(settings) {
  // Atomica (ver ipc/safe-write.js): un corte a mitad de la escritura ya no
  // puede dejar el archivo vacio, y el anterior queda en .bak.
  await writeFileAtomic(settingsPath(), JSON.stringify(settings, null, 2));
}

/** true si la carpeta no existe o no tiene nada adentro. */
async function isEmptyDir(dir) {
  try {
    return (await fs.readdir(dir)).length === 0;
  } catch (err) {
    if (err.code === 'ENOENT') return true;
    throw err;
  }
}

/**
 * La primera vez que se crea la carpeta del editor se copian a ella los
 * niveles y recursos del repositorio, para no arrancar con un proyecto vacio.
 * Se COPIAN: lo del repositorio queda donde estaba.
 */
async function seedFromInstall(root) {
  const copied = [];
  for (const entry of SEED_ENTRIES) {
    const source = path.join(INSTALL_ROOT, entry);
    if (!fsSync.existsSync(source)) continue;
    await fs.cp(source, path.join(root, entry), { recursive: true, force: false, errorOnExist: false });
    copied.push(entry);
  }
  return copied;
}

/**
 * Lo que trae un proyecto nuevo (Archivo > Nuevo proyecto): las imagenes que
 * usa un nivel recien creado (piso, pared y jugador, ver defaultVisuals en
 * level.service.ts) y la hoja de figuras de Recursos > Figuras. Sin ellas el
 * primer nivel se veria vacio en el motor, que dibuja en negro lo que no
 * encuentra.
 */
const STARTER_TEXTURES = ['floor.png', 'wall.png', 'player.png', 'shapes.png'];

/**
 * Arma un proyecto nuevo en "root": la estructura de carpetas y las imagenes
 * basicas. La carpeta tiene que estar vacia (o no existir): un proyecto nuevo
 * no se mezcla con lo que ya habia. Devuelve las imagenes que copio.
 */
async function createProject(root) {
  if (!(await isEmptyDir(root))) {
    throw new Error('La carpeta elegida no está vacía. Elige una carpeta vacía, o crea una nueva desde el diálogo.');
  }
  await ensureStructure(root);
  const copied = [];
  for (const name of STARTER_TEXTURES) {
    const source = path.join(INSTALL_ROOT, 'assets', 'textures', name);
    if (!fsSync.existsSync(source)) continue;
    await fs.copyFile(source, path.join(root, 'assets', 'textures', name), fsSync.constants.COPYFILE_EXCL);
    copied.push(name);
  }
  return copied;
}

/** Crea las subcarpetas que falten. No borra ni pisa nada. */
async function ensureStructure(root) {
  for (const dir of WORKSPACE_DIRS) {
    await fs.mkdir(path.join(root, dir), { recursive: true });
  }
}

/**
 * Deja lista la carpeta del editor al arrancar: la guardada en la
 * configuracion o la de por defecto, con su estructura. Devuelve la raiz y que
 * se copio del repositorio si se creo recien.
 */
async function initWorkspace() {
  const settings = await readSettings();
  const root = settings.workspaceRoot || defaultWorkspaceRoot();
  // Solo la carpeta POR DEFECTO se siembra: una elegida a mano es de la
  // persona, y llenarla sola seria una sorpresa.
  const seeded = !settings.workspaceRoot && (await isEmptyDir(root)) ? await seedFromInstall(root) : [];
  await ensureStructure(root);
  workspaceRoot = root;
  // La carpeta del editor y la de la configuracion (honeycomb-settings.json).
  cleanTempFiles([
    [root, 4],
    [path.dirname(settingsPath()), 0],
  ]);
  return { root, seeded };
}

/** Cambia la carpeta del editor y recuerda la eleccion para las proximas veces. */
async function changeWorkspace(root) {
  await ensureStructure(root);
  workspaceRoot = root;
  await writeSettings({ ...(await readSettings()), workspaceRoot: root });
  cleanTempFiles([[root, 4]]);
  return root;
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

function getProjectRoot() {
  return workspaceRoot;
}

/**
 * La raiz para algo que necesita escribir en el proyecto. Antes podia abrir un
 * dialogo para elegirla; ahora siempre es la carpeta del editor.
 */
async function ensureProjectRoot() {
  if (!workspaceRoot) {
    await initWorkspace();
  }
  return workspaceRoot;
}

/** true si "target" esta dentro de "folder" (o es la misma carpeta). */
function isInside(folder, target) {
  const relative = path.relative(folder, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

// Convierte una ruta que llego del renderer en una ruta absoluta dentro de la
// carpeta del editor, o tira error si se sale de ella. Asi se frenan tanto
// "../../etc/passwd" como una ruta absoluta a otro disco.
function resolveInProject(relativeOrAbsolutePath) {
  if (!workspaceRoot) {
    throw new Error('La carpeta del editor todavia no esta lista.');
  }
  const target = path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.join(workspaceRoot, relativeOrAbsolutePath);
  if (!isInside(workspaceRoot, target)) {
    throw new Error(`Ruta fuera de la carpeta del editor: ${relativeOrAbsolutePath}`);
  }
  return target;
}

module.exports = {
  INSTALL_ROOT,
  initWorkspace,
  changeWorkspace,
  createProject,
  getProjectRoot,
  ensureProjectRoot,
  resolveInProject,
  isInside,
  tempCleanup,
  settingsPath,
};
