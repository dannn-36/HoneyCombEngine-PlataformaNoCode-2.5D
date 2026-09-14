// =============================================================================
// Raiz del proyecto abierto, y la barrera que impide salirse de ella
// =============================================================================
//
// Los handlers de IPC estan repartidos por dominio en ipc/, pero casi todos
// necesitan lo mismo: saber cual es la carpeta del proyecto y traducir una ruta
// que llego del renderer a una ruta real dentro de ella. Ese estado vive aca,
// en un solo lugar, y no duplicado en cada modulo.
//
// La validacion de rutas es la razon de peso para que esto sea un modulo y no
// una variable suelta: si cada dominio resolviera rutas por su cuenta, alcanza
// con que uno se olvide de comprobar para abrir un agujero.

const path = require('node:path');
const fsSync = require('node:fs');
const { app, dialog } = require('electron');

// La carpeta del editor (editor/), que es donde vive main.js. Se calcula desde
// __dirname de ESTE archivo, que esta un nivel mas adentro (editor/ipc/): sin
// este salto, "el repositorio del editor" apuntaria a editor/ en vez de a la
// raiz del repo, y inferProjectRoot buscaria assets/ y levels/ donde no estan.
const EDITOR_DIR = path.dirname(__dirname);

let currentProjectRoot = null;

/**
 * Ultimo nivel abierto o guardado por dialogo. Sirve para deducir la carpeta
 * del proyecto cuando nadie la abrio a mano (ver inferProjectRoot).
 */
let lastLevelPath = null;

function getProjectRoot() {
  return currentProjectRoot;
}

function setProjectRoot(root) {
  currentProjectRoot = root;
  return currentProjectRoot;
}

function setLastLevelPath(filePath) {
  lastLevelPath = filePath;
}

// Convierte una ruta que llego del renderer en una ruta absoluta dentro del
// proyecto, o tira error si se sale de el. La comprobacion es sobre el
// resultado de path.relative(): si empieza con ".." o quedo absoluta, el
// destino esta afuera. Asi se frenan tanto "../../etc/passwd" como una ruta
// absoluta a otro disco.
function resolveInProject(relativeOrAbsolutePath) {
  if (!currentProjectRoot) {
    throw new Error('No hay un proyecto abierto.');
  }
  const target = path.isAbsolute(relativeOrAbsolutePath)
    ? relativeOrAbsolutePath
    : path.join(currentProjectRoot, relativeOrAbsolutePath);

  const relative = path.relative(currentProjectRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Ruta fuera del proyecto abierto: ${relativeOrAbsolutePath}`);
  }
  return target;
}

/**
 * La raiz del proyecto cuando nadie abrio una a mano. Antes Importar se negaba
 * de entrada sin carpeta de proyecto, y habia que ir a buscarla primero.
 *
 * Se prueba en orden: la carpeta del ultimo nivel abierto o guardado (un nivel
 * vive en <raiz>/levels/), y despues el repositorio del propio editor, que
 * corriendo desde el codigo esta en <raiz>/editor. Solo cuenta una carpeta con
 * pinta de proyecto HoneyComb, o sea con assets/ o levels/ adentro.
 */
function inferProjectRoot() {
  const candidates = [];
  if (lastLevelPath && path.basename(path.dirname(lastLevelPath)).toLowerCase() === 'levels') {
    candidates.push(path.dirname(path.dirname(lastLevelPath)));
  }
  if (!app.isPackaged) {
    candidates.push(path.dirname(EDITOR_DIR));
  }
  return (
    candidates.find(
      (dir) =>
        fsSync.existsSync(path.join(dir, 'assets')) || fsSync.existsSync(path.join(dir, 'levels')),
    ) ?? null
  );
}

/**
 * La raiz del proyecto para algo que necesita escribir en el: la ya abierta,
 * la deducida (ver inferProjectRoot), o -- solo si no hay forma de deducirla --
 * la que se elija en un dialogo. Null si se cancela ese dialogo.
 */
async function ensureProjectRoot(title) {
  if (!currentProjectRoot) {
    currentProjectRoot = inferProjectRoot();
  }
  if (!currentProjectRoot) {
    const project = await dialog.showOpenDialog({ title, properties: ['openDirectory'] });
    if (project.canceled || project.filePaths.length === 0) return null;
    currentProjectRoot = project.filePaths[0];
  }
  return currentProjectRoot;
}

module.exports = {
  getProjectRoot,
  setProjectRoot,
  setLastLevelPath,
  resolveInProject,
  inferProjectRoot,
  ensureProjectRoot,
};
