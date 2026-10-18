// =============================================================================
// Seguridad: lo que preload.js le expone a la UI
// =============================================================================
//
// preload.js es el UNICO lugar que decide que puede hacer el renderer. Lo
// seguro es una lista cerrada de funciones, cada una atada a un canal fijo,
// sin nada de Node a la vista (ni require, ni ipcRenderer, ni process, ni un
// invoke(canal) generico que deje elegir el canal). Y cada canal tiene que
// tener del otro lado un handler que no se rompa ni salga del proyecto con
// datos basura.
// =============================================================================

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const {
  cargarPreload,
  cargarMain,
  prepararEntorno,
  errorDe,
  EDITOR_DIR,
} = require('./support/entorno');

/** Los metodos de una interfaz de src/app/electron-api.d.ts, el contrato tipado con la UI. */
function metodosDelContrato(interfaz) {
  const fuente = fs.readFileSync(path.join(EDITOR_DIR, 'src', 'app', 'electron-api.d.ts'), 'utf-8');
  const cuerpo = new RegExp(`export interface ${interfaz} \\{([\\s\\S]*?)\\n\\}`).exec(fuente)[1];
  return [...cuerpo.matchAll(/^\s{2}(\w+)\(/gm)].map((m) => m[1]).sort();
}

const API_ESPERADA = [
  'beginConvert',
  'buildEngine',
  'changeWorkspace',
  'checkLevel',
  'clearRecovery',
  'clearSave',
  'createDir',
  'createProject',
  'engineStatus',
  'ensureRoot',
  'exportGame',
  'importSounds',
  'listDir',
  'listEntries',
  'onEngineBuildLog',
  'open',
  'readConvertImage',
  'readEventCatalog',
  'readFile',
  'readFileData',
  'readRecovery',
  'resetConvert',
  'revealExport',
  'revealWorkspace',
  'run',
  'workspaceInfo',
  'writeConvertedImage',
  'writeFile',
  'writeRecovery',
  'writeTexture',
];

const PROHIBIDOS = [
  'require',
  'process',
  'ipcRenderer',
  'invoke',
  'send',
  'sendSync',
  'on',
  'fs',
  'eval',
  'shell',
  'electron',
  'module',
  'Buffer',
];

let preload;

before(() => {
  preload = cargarPreload();
});

/** Llama a una funcion expuesta y devuelve los canales que invoco. */
function canalesDe(api, nombre, args) {
  const antes = preload.invocadosRenderer.length;
  api[nombre](...args);
  return preload.invocadosRenderer.slice(antes).map(([canal]) => canal);
}

describe('la superficie expuesta es minima', () => {
  it('expone solo honeycombProject y honeycombWindow', () => {
    assert.deepEqual(Object.keys(preload.expuesto).sort(), ['honeycombProject', 'honeycombWindow']);
  });

  it('honeycombProject tiene exactamente la lista de funciones esperada', () => {
    assert.deepEqual(Object.keys(preload.expuesto.honeycombProject).sort(), API_ESPERADA);
  });

  it('coincide con el contrato tipado de src/app/electron-api.d.ts', () => {
    assert.deepEqual(
      Object.keys(preload.expuesto.honeycombProject).sort(),
      metodosDelContrato('HoneycombProjectApi'),
    );
    assert.deepEqual(
      Object.keys(preload.expuesto.honeycombWindow).sort(),
      metodosDelContrato('HoneycombWindowApi'),
    );
  });

  it('todo lo expuesto es una funcion: ni objetos, ni modulos, ni valores', () => {
    for (const [global, api] of Object.entries(preload.expuesto)) {
      for (const [nombre, valor] of Object.entries(api)) {
        assert.equal(typeof valor, 'function', `${global}.${nombre} no es una funcion`);
      }
    }
  });

  it('no expone nada de node ni un invoke generico', () => {
    for (const api of Object.values(preload.expuesto)) {
      for (const nombre of PROHIBIDOS) {
        assert.equal(nombre in api, false, `expone ${nombre}`);
      }
    }
  });

  it('preload.js no carga otros modulos que electron (funciona con sandbox)', () => {
    assert.deepEqual([...new Set(preload.requeridos)], ['electron']);
  });
});

describe('cada funcion invoca un canal fijo', () => {
  const casos = [
    ['../../fuera/secreto.txt', 'x'],
    ['project:writeFile', 'engine:build'],
    [{ canal: 'project:writeFile' }, ['window:toggleDevTools']],
  ];

  for (const nombre of API_ESPERADA.filter((n) => n !== 'onEngineBuildLog')) {
    it(`${nombre} invoca siempre el mismo canal, sin importar los argumentos`, () => {
      const api = preload.expuesto.honeycombProject;
      const canales = new Set(casos.flatMap((args) => canalesDe(api, nombre, args)));
      assert.equal(canales.size, 1, `${nombre} invoco ${[...canales].join(', ')}`);
      const [canal] = canales;
      assert.match(canal, /^(project|workspace|convert|textures|sounds|level|recovery|game|engine):[A-Za-z]+$/);
    });
  }

  it('toggleDevTools invoca solo window:toggleDevTools', () => {
    assert.deepEqual(
      canalesDe(preload.expuesto.honeycombWindow, 'toggleDevTools', ['project:readFile']),
      ['window:toggleDevTools'],
    );
  });

  it('onEngineBuildLog entrega solo la linea, nunca el evento de ipc', () => {
    const recibidos = [];
    const dejar = preload.expuesto.honeycombProject.onEngineBuildLog((...args) =>
      recibidos.push(args),
    );
    const [canal, listener] = preload.escuchasRenderer.at(-1);
    assert.equal(canal, 'engine:build-log');
    // El evento trae "sender" (el ipcRenderer): si llegara a la UI, la UI
    // podria mandar por cualquier canal.
    listener({ sender: { send() {} }, ports: [] }, 'Compilando 1/10');
    assert.deepEqual(recibidos, [['Compilando 1/10']]);
    assert.equal(typeof dejar, 'function');
  });
});

describe('cada canal expuesto tiene su handler', () => {
  let canalesPreload;
  let handlersMain;
  let main;

  before(async () => {
    canalesPreload = new Set();
    for (const [global, api] of Object.entries(preload.expuesto)) {
      for (const nombre of Object.keys(api)) {
        if (nombre === 'onEngineBuildLog') continue;
        for (const canal of canalesDe(preload.expuesto[global], nombre, ['x', 'y']))
          canalesPreload.add(canal);
      }
    }
    main = await cargarMain();
    handlersMain = new Set(main.electron.__prueba.handlers.keys());
  });

  after(() => main?.limpiar());

  it('todo canal que invoca el preload esta registrado en el proceso principal', () => {
    for (const canal of canalesPreload) {
      assert.ok(handlersMain.has(canal), `${canal} no tiene handler`);
    }
  });

  it('no hay handlers registrados que el preload no use', () => {
    // Un handler huerfano es una puerta que nadie vigila: si algun dia se
    // expone un invoke generico, quedaria accesible sin revision.
    assert.deepEqual(
      [...handlersMain].filter((c) => !canalesPreload.has(c)),
      [],
    );
  });
});

describe('los handlers aguantan datos basura sin salir del proyecto', () => {
  const BASURA = [
    undefined,
    null,
    0,
    -1,
    NaN,
    true,
    '',
    '../../fuera/secreto.txt',
    'x'.repeat(100000),
    {},
    [],
    { __proto__: { filePath: '../fuera/x.json' } },
    {
      filePath: '../fuera/basura.json',
      contents: 'PISADO',
      levelPath: '../fuera/secreto.txt',
      index: 0,
      name: '..',
    },
    [['../fuera']],
  ];

  let entorno;

  before(async () => {
    entorno = await prepararEntorno();
  });

  after(() => entorno?.limpiar());

  it('ningun canal se cuelga, escribe afuera o lee el secreto con datos basura', async () => {
    for (const canal of entorno.handlers.keys()) {
      for (const valor of BASURA) {
        let resultado;
        const err = await errorDe(
          Promise.race([
            entorno.invocar(canal, valor).then((r) => {
              resultado = r;
            }),
            new Promise((_, reject) => {
              setTimeout(() => reject(new Error('COLGADO')), 3000).unref();
            }),
          ]),
        );
        assert.notEqual(err?.message, 'COLGADO', `${canal} se colgo con ${JSON.stringify(valor)}`);
        assert.ok(
          !JSON.stringify(resultado ?? '').includes('SECRETO'),
          `${canal} devolvio el secreto`,
        );
      }
    }
    assert.deepEqual(entorno.contenidoFuera(), ['secreto.txt']);
    assert.equal(fs.readFileSync(path.join(entorno.fuera, 'secreto.txt'), 'utf-8'), 'SECRETO');
    assert.equal(entorno.lanzados.length, 0, 'se lanzo un proceso con datos basura');
  });
});
