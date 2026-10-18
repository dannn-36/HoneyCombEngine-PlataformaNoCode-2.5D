// Preload de la ventana de medicion de scripts/perf-editor.js. NO es el
// preload.js del editor: este no habla con ningun proceso principal.
//
// Le da al editor una carpeta del editor de SOLO LECTURA: la raiz del
// repositorio (levels/, assets/, characters.json...), leida directo del disco.
// Lo que el editor escribe queda en memoria y se pierde al cerrar: medir nunca
// toca un archivo del proyecto. Asi el editor arranca como en Electron de
// verdad (lista niveles, carga texturas) y dibuja los sprites reales.
//
// Corre con contextIsolation desactivado a proposito: las mediciones tienen que
// enganchar el canvas de la pagina (ver hookCanvas) antes de que arranque
// Angular, y la ventana solo carga el build local del editor.

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const CATALOG = path.join(ROOT, 'schema', 'event_catalog.json');

/** Lo escrito por el editor durante la medicion, y los niveles generados. */
const memory = new Map();

function resolveInside(relativePath) {
  const full = path.resolve(ROOT, relativePath);
  if (!full.startsWith(ROOT)) {
    throw new Error('Ruta fuera del proyecto: ' + relativePath);
  }
  return full;
}

function enoent(relativePath) {
  return new Error(`ENOENT: no such file or directory, open '${relativePath}'`);
}

function readText(relativePath) {
  if (memory.has(relativePath)) {
    return memory.get(relativePath);
  }
  const full = resolveInside(relativePath);
  if (!fs.existsSync(full)) {
    throw enoent(relativePath);
  }
  return fs.readFileSync(full, 'utf8');
}

function entries(relativeDir) {
  const full = resolveInside(relativeDir);
  const list = fs.existsSync(full) ? fs.readdirSync(full, { withFileTypes: true }) : [];
  const nodes = list.map((entry) => ({
    name: entry.name,
    path: (relativeDir ? relativeDir + '/' : '') + entry.name,
    kind: entry.isDirectory() ? 'dir' : 'file',
  }));
  // Los niveles generados en memoria tambien aparecen en levels/.
  if (relativeDir === 'levels') {
    for (const key of memory.keys()) {
      const name = key.slice('levels/'.length);
      if (key.startsWith('levels/') && !name.includes('/') && !nodes.some((node) => node.name === name)) {
        nodes.push({ name, path: key, kind: 'file' });
      }
    }
  }
  return nodes.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'dir' ? -1 : 1));
}

const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif' };

const api = {
  open: async () => ({ canceled: true }),
  workspaceInfo: async () => ({ root: ROOT, seeded: [] }),
  changeWorkspace: async () => null,
  revealWorkspace: async () => undefined,
  readEventCatalog: async () => fs.readFileSync(CATALOG, 'utf8'),
  ensureRoot: async () => ROOT,
  createDir: async () => undefined,
  readFile: async (relativePath) => readText(relativePath),
  writeFile: async (relativePath, contents) => {
    memory.set(relativePath, contents);
  },
  listDir: async (relativeDir) => entries(relativeDir).filter((node) => node.kind === 'file').map((node) => node.name),
  listEntries: async (relativeDir) => entries(relativeDir),
  readFileData: async (relativePath) => {
    const full = resolveInside(relativePath);
    if (!fs.existsSync(full)) {
      throw enoent(relativePath);
    }
    const mime = MIME[path.extname(full).toLowerCase()];
    const data = fs.readFileSync(full);
    if (mime) {
      return { kind: 'image', size: data.length, dataUrl: 'data:' + mime + ';base64,' + data.toString('base64') };
    }
    return { kind: 'text', size: data.length, text: data.toString('utf8').slice(0, 200000), truncated: data.length > 200000 };
  },
  beginConvert: async () => null,
  readConvertImage: async () => '',
  writeConvertedImage: async () => ({ target: '' }),
  resetConvert: async () => undefined,
  writeTexture: async (name) => ({ status: 'written', target: name }),
  run: async () => ({ ok: false, error: 'medicion: el motor no se ejecuta' }),
  clearSave: async () => undefined,
  engineStatus: async () => ({ debug: false, release: false }),
  buildEngine: async () => ({ ok: false, error: 'medicion' }),
  onEngineBuildLog: () => () => undefined,
};

window.honeycombProject = api;

// Plantillas de entidades tomadas de los niveles reales del repo (las figuras
// del sheet con su recorte y su groundOffset), para que los niveles generados
// se parezcan a los de verdad.
const shapeTemplates = new Map();
for (const name of fs.readdirSync(path.join(ROOT, 'levels'))) {
  try {
    const level = JSON.parse(fs.readFileSync(path.join(ROOT, 'levels', name), 'utf8'));
    for (const entity of level.entities ?? []) {
      if (entity.texture === 'textures/shapes.png' && !shapeTemplates.has(entity.type)) {
        shapeTemplates.set(entity.type, {
          type: entity.type,
          texture: entity.texture,
          sourceRect: entity.sourceRect,
          groundOffset: entity.groundOffset,
        });
      }
    }
  } catch {
    // Un nivel roto no aporta plantillas.
  }
}

window.__perfHost = {
  memory,
  shapeTemplates: [...shapeTemplates.values()],
  realLevels: fs.readdirSync(path.join(ROOT, 'levels')).filter((name) => name.endsWith('.json')),
};

// --- Enganche del dibujo -------------------------------------------------------
// IsoCanvasRenderer.draw() empieza asignando canvas.width. Envolviendo ese
// setter se sabe cuando empieza cada dibujo del viewport; una microtarea
// encolada ahi corre cuando termina la tarea (la deteccion de cambios entera).
(function hookCanvas() {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'width');
  Object.defineProperty(HTMLCanvasElement.prototype, 'width', {
    configurable: true,
    enumerable: descriptor.enumerable,
    get: descriptor.get,
    set(value) {
      descriptor.set.call(this, value);
      const listener = window.__perfOnCanvasWidth;
      if (listener && value > 0 && this.isConnected) {
        listener(this);
      }
    },
  });
  window.__perfOnCanvasWidth = (canvas) => {
    if (window.__perfFirstDrawAt === undefined) {
      window.__perfFirstDrawAt = performance.now();
    }
    window.__perfDrawHook?.(canvas);
  };
})();
