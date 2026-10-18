// =============================================================================
// Entorno de pruebas del proceso principal: un Electron de mentira
// =============================================================================
//
// Los modulos de ipc/ (y main.js, y preload.js) hacen require('electron'), que
// fuera de Electron no existe. En vez de tocarlos, se intercepta ese require
// y se entrega un objeto con lo minimo que usan: ipcMain guarda los handlers
// para poder invocarlos como lo haria la UI, dialog contesta lo que diga la
// prueba, BrowserWindow anota con que opciones se creo la ventana, etc.
//
// Tambien se intercepta node:child_process para los modulos de ipc/: spawn no
// lanza nada, solo anota que se pidio lanzar (binario, argumentos, opciones).
//
// Cada prueba trabaja en una carpeta temporal propia:
//
//   <base>/proyecto/   la carpeta del editor (levels/, assets/...)
//   <base>/fuera/      lo que NO se tiene que poder leer ni escribir
//   <base>/userData/   la configuracion de Electron (donde se guarda la raiz)
//
// Los modulos se cargan de nuevo en cada entorno (se vacia la cache de
// require): guardan estado propio (la raiz, el plan del convertidor) y una
// prueba no tiene que ver lo que dejo otra.
// =============================================================================

const Module = require('node:module');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { EventEmitter } = require('node:events');

const EDITOR_DIR = path.resolve(__dirname, '..', '..', '..');
const IPC_DIR = path.join(EDITOR_DIR, 'ipc');

// --- Intercepcion de require -------------------------------------------------

let electronActual = null;
let reemplazos = null;

const cargaOriginal = Module._load;
Module._load = function cargarConReemplazos(request, parent, isMain) {
  if (reemplazos) {
    const reemplazo = reemplazos(request, parent);
    if (reemplazo) return reemplazo;
  }
  if (request === 'electron') {
    if (!electronActual) throw new Error('No hay un Electron de prueba activo.');
    return electronActual;
  }
  return cargaOriginal.apply(this, arguments);
};

/** Saca de la cache de require todo lo del editor (main.js, preload.js, ipc/). */
function olvidarModulos() {
  for (const key of Object.keys(require.cache)) {
    if (
      key.startsWith(EDITOR_DIR) &&
      !key.includes(`${path.sep}tests${path.sep}`) &&
      !key.includes('node_modules')
    ) {
      delete require.cache[key];
    }
  }
}

// --- Electron de prueba --------------------------------------------------------

class WebContentsDePrueba extends EventEmitter {
  constructor() {
    super();
    this.devToolsAbiertas = 0;
    this.devToolsAlternadas = 0;
    this.manejadorVentanaNueva = null;
    this.enviados = [];
    this.session = {
      manejadorPermisos: null,
      setPermissionRequestHandler: (fn) => {
        this.session.manejadorPermisos = fn;
      },
      setPermissionCheckHandler: () => {},
    };
  }
  openDevTools() {
    this.devToolsAbiertas += 1;
  }
  toggleDevTools() {
    this.devToolsAlternadas += 1;
  }
  setWindowOpenHandler(fn) {
    this.manejadorVentanaNueva = fn;
  }
  isDestroyed() {
    return false;
  }
  send(canal, ...args) {
    this.enviados.push([canal, ...args]);
  }
}

/**
 * Un modulo 'electron' falso.
 * @param opciones.userData   carpeta de datos de Electron
 * @param opciones.documents  carpeta Documentos
 * @param opciones.isPackaged como app.isPackaged
 * @param opciones.dialogo    funcion (opciones) => resultado de showOpenDialog
 */
function crearElectron({ userData, documents, isPackaged = false, dialogo } = {}) {
  const handlers = new Map();
  const ventanas = [];
  const eventosApp = new Map();
  const expuesto = {};
  const invocadosRenderer = [];
  const escuchasRenderer = [];
  const dialogos = [];
  const abiertosShell = [];

  let listo;
  const whenReady = new Promise((resolve) => {
    listo = resolve;
  });

  class BrowserWindow {
    constructor(options) {
      this.options = options;
      this.webContents = new WebContentsDePrueba();
      this.cargado = [];
      ventanas.push(this);
    }
    loadURL(url) {
      this.cargado.push({ url });
      return Promise.resolve();
    }
    loadFile(file) {
      this.cargado.push({ file });
      return Promise.resolve();
    }
    static getAllWindows() {
      return ventanas;
    }
    static fromWebContents(webContents) {
      return ventanas.find((w) => w.webContents === webContents) ?? null;
    }
  }

  const electron = {
    app: {
      isPackaged,
      getPath(name) {
        if (name === 'userData') return userData;
        if (name === 'documents') return documents;
        return path.join(userData, name);
      },
      whenReady: () => whenReady,
      on(evento, fn) {
        if (!eventosApp.has(evento)) eventosApp.set(evento, []);
        eventosApp.get(evento).push(fn);
      },
      quit() {},
      setAppUserModelId(id) {
        electron.__prueba.appUserModelId = id;
      },
    },
    BrowserWindow,
    Menu: { setApplicationMenu() {} },
    ipcMain: {
      handle(canal, fn) {
        if (handlers.has(canal)) throw new Error(`Canal registrado dos veces: ${canal}`);
        handlers.set(canal, fn);
      },
      on() {},
      removeHandler(canal) {
        handlers.delete(canal);
      },
    },
    dialog: {
      async showOpenDialog(options) {
        dialogos.push(options);
        return dialogo ? dialogo(options) : { canceled: true, filePaths: [] };
      },
    },
    shell: {
      async openPath(p) {
        abiertosShell.push(p);
        return '';
      },
      async openExternal(url) {
        abiertosShell.push(url);
      },
      showItemInFolder(p) {
        abiertosShell.push(p);
      },
    },
    contextBridge: {
      exposeInMainWorld(nombre, api) {
        expuesto[nombre] = api;
      },
    },
    ipcRenderer: {
      invoke(canal, ...args) {
        invocadosRenderer.push([canal, ...args]);
        return Promise.resolve();
      },
      on(canal, fn) {
        escuchasRenderer.push([canal, fn]);
      },
      removeListener() {},
      send() {
        throw new Error('preload.js no deberia usar ipcRenderer.send');
      },
    },
  };

  // Lo que la prueba necesita para mirar y manejar el Electron falso.
  electron.__prueba = {
    handlers,
    ventanas,
    eventosApp,
    expuesto,
    invocadosRenderer,
    escuchasRenderer,
    dialogos,
    abiertosShell,
    arrancar: () => listo(),
  };
  return electron;
}

// --- Carpetas temporales ----------------------------------------------------------

function crearBase(prefijo = 'hc-seguridad-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefijo));
}

/** Todos los archivos (rutas relativas) que hay debajo de una carpeta, sin seguir enlaces. */
function listarArbol(carpeta) {
  const salida = [];
  const recorrer = (dir) => {
    let entradas;
    try {
      entradas = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entrada of entradas) {
      const completa = path.join(dir, entrada.name);
      salida.push(path.relative(carpeta, completa));
      if (entrada.isDirectory() && !entrada.isSymbolicLink()) recorrer(completa);
    }
  };
  recorrer(carpeta);
  return salida.sort();
}

// --- El entorno completo del proceso principal ------------------------------------

/**
 * Prepara una carpeta del editor de prueba y registra TODOS los handlers de
 * ipc/ como lo hace main.js.
 *
 * @param opciones.instalacion 'real' carga ipc/ del repositorio; 'copia' lo
 *   copia a <base>/instalacion/editor/ipc, asi INSTALL_ROOT es una carpeta sin
 *   motor compilado ni schema/ (lo que tenga se arma en la prueba).
 * @param opciones.dialogo     respuesta de dialog.showOpenDialog.
 * @param opciones.isPackaged  como app.isPackaged.
 */
async function prepararEntorno({ instalacion = 'real', dialogo, isPackaged = false } = {}) {
  const base = crearBase();
  const root = path.join(base, 'proyecto');
  const fuera = path.join(base, 'fuera');
  const userData = path.join(base, 'userData');
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(fuera, { recursive: true });
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(fuera, 'secreto.txt'), 'SECRETO');
  // Con la raiz ya elegida en la configuracion, initWorkspace no siembra la
  // carpeta con los niveles del repositorio (eso es solo para la de por defecto).
  fs.writeFileSync(
    path.join(userData, 'honeycomb-settings.json'),
    JSON.stringify({ workspaceRoot: root }),
  );

  let ipcDir = IPC_DIR;
  let installRoot = path.dirname(EDITOR_DIR);
  if (instalacion === 'copia') {
    installRoot = path.join(base, 'instalacion');
    ipcDir = path.join(installRoot, 'editor', 'ipc');
    fs.mkdirSync(ipcDir, { recursive: true });
    for (const file of fs.readdirSync(IPC_DIR)) {
      if (file.endsWith('.js')) fs.copyFileSync(path.join(IPC_DIR, file), path.join(ipcDir, file));
    }
  }

  const electron = crearElectron({
    userData,
    documents: path.join(base, 'documentos'),
    isPackaged,
    dialogo,
  });
  const lanzados = [];
  const realChildProcess = require('node:child_process');
  const spawnDePrueba = (command, args = [], options = {}) => {
    const hijo = new EventEmitter();
    hijo.stdout = new EventEmitter();
    hijo.stderr = new EventEmitter();
    hijo.unref = () => {};
    hijo.pid = 4242;
    lanzados.push({ command, args, options });
    // Un "cmake" que termina bien enseguida.
    setImmediate(() => hijo.emit('close', 0));
    return hijo;
  };

  electronActual = electron;
  reemplazos = (request, parent) => {
    const desde = parent?.filename ?? '';
    if (
      (request === 'node:child_process' || request === 'child_process') &&
      desde.startsWith(ipcDir)
    ) {
      return { ...realChildProcess, spawn: spawnDePrueba };
    }
    return null;
  };
  olvidarModulos();
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(ipcDir)) delete require.cache[key];
  }

  const cargar = (nombre) => require(path.join(ipcDir, nombre));
  const projectRoot = cargar('project-root.js');
  const startup = await projectRoot.initWorkspace();
  cargar('workspace.js').register(startup);
  cargar('levels.js').register();
  cargar('files.js').register();
  cargar('convert.js').register();
  cargar('textures.js').register();
  cargar('run.js').register();
  cargar('engine-build.js').register();
  cargar('export.js').register();
  cargar('recovery.js').register();
  cargar('sounds.js').register();
  cargar('level-check.js').register();

  const remitente = new WebContentsDePrueba();
  const handlers = electron.__prueba.handlers;

  /** Invoca un canal como la UI, con un remitente del origen indicado. */
  async function invocar(canal, ...args) {
    return invocarDesde(
      'file:///' + path.join(EDITOR_DIR, 'dist', 'editor', 'browser', 'index.html'),
      canal,
      ...args,
    );
  }

  async function invocarDesde(url, canal, ...args) {
    const handler = handlers.get(canal);
    if (!handler) throw new Error(`No hay handler para ${canal}`);
    const event = {
      sender: remitente,
      senderFrame: { url, origin: new URL(url).origin },
      frameId: 1,
      processId: 1,
    };
    return handler(event, ...args);
  }

  return {
    base,
    root,
    fuera,
    userData,
    installRoot,
    ipcDir,
    electron,
    handlers,
    lanzados,
    remitente,
    projectRoot,
    cargar,
    invocar,
    invocarDesde,
    /** Lo que hay en <base>/fuera ahora (para ver que nada se escribio ahi). */
    contenidoFuera: () => listarArbol(fuera),
    limpiar() {
      electronActual = null;
      reemplazos = null;
      fs.rmSync(base, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}

/**
 * Carga main.js con un Electron de prueba y lo "arranca" (resuelve
 * app.whenReady). Devuelve el Electron falso para mirar la ventana creada y
 * los handlers registrados.
 *
 * @param opciones.existeDist   si dist/editor/browser/index.html "existe".
 * @param opciones.env          variables de entorno durante la carga.
 */
async function cargarMain({ isPackaged = false, existeDist = true, env = {} } = {}) {
  const base = crearBase('hc-main-');
  const root = path.join(base, 'proyecto');
  const userData = path.join(base, 'userData');
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(
    path.join(userData, 'honeycomb-settings.json'),
    JSON.stringify({ workspaceRoot: root }),
  );

  const electron = crearElectron({
    userData,
    documents: path.join(base, 'documentos'),
    isPackaged,
  });
  const mainPath = path.join(EDITOR_DIR, 'main.js');
  const distIndex = path.join(EDITOR_DIR, 'dist', 'editor', 'browser', 'index.html');
  const realFs = require('node:fs');
  const fsDeMain = {
    ...realFs,
    existsSync: (p) => (path.resolve(String(p)) === distIndex ? existeDist : realFs.existsSync(p)),
  };

  const envAnterior = {};
  for (const [k, v] of Object.entries(env)) {
    envAnterior[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }

  electronActual = electron;
  reemplazos = (request, parent) => {
    if ((request === 'node:fs' || request === 'fs') && parent?.filename === mainPath)
      return fsDeMain;
    return null;
  };
  olvidarModulos();
  require(mainPath);
  electron.__prueba.arrancar();
  // whenReady().then(async ...) espera initWorkspace: se deja correr la cola.
  for (let i = 0; i < 50 && electron.__prueba.ventanas.length === 0; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  return {
    electron,
    distIndex,
    ventana: electron.__prueba.ventanas[0],
    limpiar() {
      for (const [k, v] of Object.entries(envAnterior)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      electronActual = null;
      reemplazos = null;
      fs.rmSync(base, { recursive: true, force: true, maxRetries: 3 });
    },
  };
}

/** Carga preload.js con un Electron de prueba y devuelve lo que expuso. */
function cargarPreload() {
  const electron = crearElectron({});
  const preloadPath = path.join(EDITOR_DIR, 'preload.js');
  const requeridos = [];
  electronActual = electron;
  reemplazos = (request, parent) => {
    if (parent?.filename === preloadPath) requeridos.push(request);
    return null;
  };
  olvidarModulos();
  require(preloadPath);
  electronActual = null;
  reemplazos = null;
  return { ...electron.__prueba, requeridos };
}

/** Espera a que una promesa falle y devuelve el error (o null si no fallo). */
async function errorDe(promesa) {
  try {
    await promesa;
    return null;
  } catch (err) {
    return err;
  }
}

module.exports = {
  EDITOR_DIR,
  IPC_DIR,
  crearElectron,
  crearBase,
  listarArbol,
  prepararEntorno,
  cargarMain,
  cargarPreload,
  errorDe,
};
