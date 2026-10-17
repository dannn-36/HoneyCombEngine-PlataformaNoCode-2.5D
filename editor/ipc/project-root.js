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

async function readSettings() {
  try {
    return JSON.parse(await fs.readFile(settingsPath(), 'utf-8'));
  } catch {
    // Primera vez, o un archivo roto: se arranca con los valores por defecto.
    return {};
  }
}

async function writeSettings(settings) {
  await fs.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(settings, null, 2), 'utf-8');
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
  return { root, seeded };
}

/** Cambia la carpeta del editor y recuerda la eleccion para las proximas veces. */
async function changeWorkspace(root) {
  await ensureStructure(root);
  workspaceRoot = root;
  await writeSettings({ ...(await readSettings()), workspaceRoot: root });
  return root;
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
  getProjectRoot,
  ensureProjectRoot,
  resolveInProject,
  isInside,
};
