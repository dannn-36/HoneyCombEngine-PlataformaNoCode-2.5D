// =============================================================================
// Seguridad: configuracion de Electron (main.js y src/index.html)
// =============================================================================
//
// main.js se carga de verdad, con un Electron de prueba (ver
// support/entorno.js): se mira con que webPreferences se crea la ventana, que
// carga, que handlers deja puestos (navegacion, ventanas nuevas, permisos) y
// que hace cada evento. Nada de buscar texto en el codigo, salvo la CSP, que
// vive en el HTML.
//
// Ojo con app.isPackaged: el editor que deja el instalador (HoneyComb.cmd)
// corre con "npm run electron", o sea SIN empaquetar. Para esa instalacion
// isPackaged es false, y todo lo que dependa de el (devtools, origen de la UI)
// se comporta como en desarrollo.
// =============================================================================

const { describe, it, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { cargarMain, EDITOR_DIR } = require('./support/entorno');

const ATACANTE = 'https://atacante.example/';

let cargado = null;
afterEach(() => {
  cargado?.limpiar();
  cargado = null;
});

async function main(opciones) {
  cargado = await cargarMain(opciones);
  assert.ok(cargado.ventana, 'main.js no creo la ventana');
  return cargado;
}

/** Evento de mentira con preventDefault, como los de webContents. */
function eventoNavegacion(url) {
  const evento = {
    url,
    prevenido: false,
    preventDefault() {
      evento.prevenido = true;
    },
  };
  return evento;
}

/** Todos los listeners de un evento de la ventana, incluidos los que se agreguen en web-contents-created. */
function listenersDe({ electron, ventana }, nombre) {
  for (const fn of electron.__prueba.eventosApp.get('web-contents-created') ?? []) {
    fn({}, ventana.webContents);
  }
  return ventana.webContents.listeners(nombre);
}

describe('webPreferences de la ventana', () => {
  const prefs = async () => (await main()).ventana.options.webPreferences;

  it('contextIsolation esta activado', async () => {
    assert.equal((await prefs()).contextIsolation, true);
  });

  it('nodeIntegration esta desactivado', async () => {
    assert.equal((await prefs()).nodeIntegration, false);
  });

  it('no activa node en workers ni en subframes', async () => {
    const p = await prefs();
    assert.notEqual(p.nodeIntegrationInWorker, true);
    assert.notEqual(p.nodeIntegrationInSubFrames, true);
  });

  it('no usa el modulo remote', async () => {
    assert.equal('enableRemoteModule' in (await prefs()), false);
  });

  it('no habilita webview, contenido inseguro ni funciones experimentales', async () => {
    const p = await prefs();
    assert.notEqual(p.webviewTag, true);
    assert.notEqual(p.allowRunningInsecureContent, true);
    assert.notEqual(p.experimentalFeatures, true);
    assert.equal(p.enableBlinkFeatures, undefined);
  });

  it('no desactiva webSecurity ni el sandbox', async () => {
    const p = await prefs();
    assert.notEqual(p.webSecurity, false);
    assert.notEqual(p.sandbox, false);
  });

  it(
    'declara sandbox: true de forma explicita',
    // Defecto conocido: SE-08. Electron 20+ ya pone el renderer en sandbox por
    // defecto, pero la ventana no lo declara: un cambio de version o de otra
    // opcion (nodeIntegration) lo puede apagar sin que se note.
    { todo: 'Defecto conocido: SE-08 - sandbox no se declara explicitamente' },
    async () => {
      assert.equal((await prefs()).sandbox, true);
    },
  );

  it(
    'declara webSecurity: true de forma explicita',
    { todo: 'Defecto conocido: SE-08 - webSecurity no se declara explicitamente' },
    async () => {
      assert.equal((await prefs()).webSecurity, true);
    },
  );

  it('el preload es el preload.js del editor', async () => {
    const p = await prefs();
    assert.equal(path.resolve(p.preload), path.join(EDITOR_DIR, 'preload.js'));
    assert.ok(fs.existsSync(p.preload));
  });
});

describe('navegacion y ventanas nuevas (SE-03)', () => {
  it(
    'la ventana no navega a un sitio externo',
    // Defecto conocido: SE-03. main.js no escucha will-navigate: un enlace o
    // un location.href en el renderer lleva la ventana a cualquier URL, y esa
    // pagina recibe el preload (window.honeycombProject) igual que la UI.
    { todo: 'Defecto conocido: SE-03 - no hay handler de will-navigate' },
    async () => {
      const m = await main();
      const evento = eventoNavegacion(ATACANTE);
      for (const fn of listenersDe(m, 'will-navigate')) fn(evento, ATACANTE);
      assert.equal(evento.prevenido, true, 'nadie freno la navegacion');
    },
  );

  it(
    'la ventana no abre ventanas nuevas',
    { todo: 'Defecto conocido: SE-03 - no hay setWindowOpenHandler' },
    async () => {
      const m = await main();
      listenersDe(m, 'did-create-window');
      const manejador = m.ventana.webContents.manejadorVentanaNueva;
      assert.ok(manejador, 'no hay setWindowOpenHandler');
      assert.deepEqual(manejador({ url: ATACANTE }), { action: 'deny' });
    },
  );

  it(
    'las redirecciones a un sitio externo tambien se frenan',
    { todo: 'Defecto conocido: SE-03 - no hay handler de will-redirect' },
    async () => {
      const m = await main();
      const evento = eventoNavegacion(ATACANTE);
      for (const fn of listenersDe(m, 'will-redirect')) fn(evento, ATACANTE);
      assert.equal(evento.prevenido, true);
    },
  );
});

describe('de donde sale la interfaz (SE-09)', () => {
  it(
    'la instalacion sin empaquetar no carga la interfaz desde un servidor local',
    // Defecto nuevo: SE-09. HoneyComb.cmd corre "electron ." sin empaquetar,
    // asi que main.js carga primero http://localhost:4200 y solo si falla usa
    // dist/. Cualquier programa que escuche en ese puerto (otro "ng serve",
    // cualquier proceso local) recibe la ventana con el preload, es decir,
    // leer y escribir el proyecto y ejecutar el motor (y con SE-01, un binario
    // cualquiera).
    {
      todo: 'Defecto conocido: SE-09 - sin ELECTRON_START_URL se carga http://localhost:4200 antes que dist/',
    },
    async () => {
      const m = await main({
        isPackaged: false,
        existeDist: true,
        env: { ELECTRON_START_URL: undefined },
      });
      const [primero] = m.ventana.cargado;
      assert.ok(primero.file, `cargo ${primero.url}`);
      assert.equal(path.resolve(primero.file), m.distIndex);
    },
  );

  it('empaquetada carga dist/ e ignora ELECTRON_START_URL', async () => {
    const m = await main({ isPackaged: true, env: { ELECTRON_START_URL: ATACANTE } });
    assert.deepEqual(m.ventana.cargado, [{ file: m.distIndex }]);
  });

  it('si el servidor no responde cae en dist/ y no en otra url', async () => {
    const m = await main({
      isPackaged: false,
      existeDist: true,
      env: { ELECTRON_START_URL: undefined },
    });
    for (const fn of m.ventana.webContents.listeners('did-fail-load')) {
      fn({}, -102, 'ERR_CONNECTION_REFUSED', 'http://localhost:4200/', true);
    }
    assert.deepEqual(m.ventana.cargado.at(-1), { file: m.distIndex });
  });
});

describe('herramientas de desarrollo (SE-06)', () => {
  it(
    'empaquetada, HONEYCOMB_DEVTOOLS no abre las herramientas',
    // Defecto conocido: SE-06. La variable se respeta siempre, sin mirar
    // app.isPackaged.
    { todo: 'Defecto conocido: SE-06 - HONEYCOMB_DEVTOOLS abre devtools en produccion' },
    async () => {
      const m = await main({ isPackaged: true, env: { HONEYCOMB_DEVTOOLS: '1' } });
      assert.equal(m.ventana.webContents.devToolsAbiertas, 0);
    },
  );

  it(
    'empaquetada, el canal window:toggleDevTools no las abre',
    // Defecto conocido: SE-06. El handler (main.js) no mira isPackaged, y el
    // menu Ver de la UI lo invoca. Ademas, como la instalacion corre sin
    // empaquetar, un control basado solo en isPackaged no la protegeria.
    { todo: 'Defecto conocido: SE-06 - window:toggleDevTools funciona en produccion' },
    async () => {
      const m = await main({ isPackaged: true });
      const handler = m.electron.__prueba.handlers.get('window:toggleDevTools');
      await handler({ sender: m.ventana.webContents });
      assert.equal(m.ventana.webContents.devToolsAlternadas, 0);
    },
  );

  it('sin HONEYCOMB_DEVTOOLS no se abren solas', async () => {
    const m = await main({ env: { HONEYCOMB_DEVTOOLS: undefined } });
    assert.equal(m.ventana.webContents.devToolsAbiertas, 0);
  });
});

describe('pagina de diagnostico (SE-07)', () => {
  /** Dispara did-fail-load sin dist/ y devuelve el HTML de la pagina que se cargo. */
  async function paginaDeDiagnostico(descripcion, url) {
    const m = await main({
      isPackaged: false,
      existeDist: false,
      env: { ELECTRON_START_URL: undefined },
    });
    for (const fn of m.ventana.webContents.listeners('did-fail-load'))
      fn({}, -102, descripcion, url, true);
    const ultima = m.ventana.cargado.at(-1);
    assert.ok(ultima.url?.startsWith('data:text/html'), 'no se cargo la pagina de diagnostico');
    return decodeURIComponent(ultima.url.slice(ultima.url.indexOf(',') + 1));
  }

  it('muestra el motivo y la url que fallaron', async () => {
    const html = await paginaDeDiagnostico('ERR_CONNECTION_REFUSED', 'http://localhost:4200/');
    assert.ok(html.includes('ERR_CONNECTION_REFUSED'));
    assert.ok(html.includes('localhost:4200'));
  });

  it(
    'escapa un <script> que venga en la descripcion o la url',
    // Defecto conocido: SE-07. diagnosticPage() interpola "reason" en el HTML
    // sin escapar, y la pagina se carga en la MISMA ventana, con el preload.
    { todo: 'Defecto conocido: SE-07 - diagnosticPage interpola sin escapar' },
    async () => {
      const html = await paginaDeDiagnostico('<script>alert(1)</script>', 'http://localhost:4200/');
      assert.ok(!html.includes('<script>alert(1)</script>'), 'el <script> quedo como etiqueta');
      assert.ok(html.includes('&lt;script&gt;'));
    },
  );

  it(
    'escapa un <img onerror> que venga en la url',
    { todo: 'Defecto conocido: SE-07 - diagnosticPage interpola sin escapar' },
    async () => {
      const html = await paginaDeDiagnostico(
        'ERR_FAILED',
        'http://localhost:4200/<img src=x onerror=alert(1)>',
      );
      assert.ok(!/<img[^>]*onerror/i.test(html), 'el <img onerror> quedo como etiqueta');
    },
  );

  it('no reacciona a fallos de subframes ni de file:// o data:', async () => {
    const m = await main({
      isPackaged: false,
      existeDist: false,
      env: { ELECTRON_START_URL: undefined },
    });
    const antes = m.ventana.cargado.length;
    for (const fn of m.ventana.webContents.listeners('did-fail-load')) {
      fn({}, -3, '<script>', 'http://localhost:4200/', false);
      fn({}, -3, '<script>', 'file:///C:/x.html', true);
      fn({}, -3, '<script>', 'data:text/html,x', true);
    }
    assert.equal(m.ventana.cargado.length, antes);
  });
});

describe('content security policy (SE-02)', () => {
  /** La politica del <meta http-equiv="Content-Security-Policy">, o null. */
  function cspDe(html) {
    const meta = /<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/i.exec(html);
    if (!meta) return null;
    const content = /content=["']([^"']*)["']/i.exec(meta[0]);
    return content ? content[1] : '';
  }

  function directivas(csp) {
    return new Map(
      csp
        .split(';')
        .map((d) => d.trim().split(/\s+/))
        .filter((d) => d[0])
        .map(([nombre, ...valores]) => [nombre.toLowerCase(), valores]),
    );
  }

  it(
    'src/index.html declara una CSP estricta para scripts',
    // Defecto conocido: SE-02. No hay CSP ni en el HTML ni por cabecera
    // (main.js no toca session.webRequest): un XSS en la UI podria cargar
    // scripts de cualquier lado.
    { todo: 'Defecto conocido: SE-02 - no hay Content Security Policy' },
    () => {
      const csp = cspDe(fs.readFileSync(path.join(EDITOR_DIR, 'src', 'index.html'), 'utf-8'));
      assert.ok(csp !== null, 'no hay <meta http-equiv="Content-Security-Policy">');
      const d = directivas(csp);
      const scripts = d.get('script-src') ?? d.get('default-src');
      assert.ok(scripts, 'no hay script-src ni default-src');
      for (const peligroso of [
        "'unsafe-eval'",
        "'unsafe-inline'",
        '*',
        'http:',
        'https:',
        'data:',
      ]) {
        assert.ok(!scripts.includes(peligroso), `script-src permite ${peligroso}`);
      }
      assert.ok(d.has('object-src') || d.get('default-src')?.includes("'none'"));
    },
  );

  it(
    'el build de dist/ conserva la CSP',
    { todo: 'Defecto conocido: SE-02 - no hay Content Security Policy' },
    (t) => {
      const build = path.join(EDITOR_DIR, 'dist', 'editor', 'browser', 'index.html');
      if (!fs.existsSync(build)) {
        t.skip('no hay build en dist/');
        return;
      }
      assert.ok(cspDe(fs.readFileSync(build, 'utf-8')) !== null);
    },
  );
});

describe('quien le habla al proceso principal (SE-10)', () => {
  it(
    'los handlers rechazan pedidos de un origen que no es la interfaz',
    // Defecto nuevo: SE-10. Ningun handler mira event.senderFrame: cualquier
    // pagina que termine en la ventana (SE-03, SE-09) usa la API completa.
    { todo: 'Defecto conocido: SE-10 - los handlers IPC no validan el remitente' },
    async () => {
      const m = await main();
      const handler = m.electron.__prueba.handlers.get('project:listEntries');
      const evento = {
        sender: m.ventana.webContents,
        senderFrame: { url: ATACANTE, origin: 'https://atacante.example' },
      };
      let err = null;
      try {
        await handler(evento, '');
      } catch (e) {
        err = e;
      }
      assert.ok(err, 'contesto a un origen externo');
    },
  );

  it(
    'se niegan los permisos del navegador que el editor no usa',
    // Defecto nuevo: SE-10. Sin setPermissionRequestHandler, Electron concede
    // por defecto camara, microfono, notificaciones, ubicacion...
    { todo: 'Defecto conocido: SE-10 - no hay setPermissionRequestHandler' },
    async () => {
      const m = await main();
      listenersDe(m, 'did-finish-load');
      const manejador = m.ventana.webContents.session.manejadorPermisos;
      assert.ok(manejador, 'no hay manejador de permisos');
      let concedido = null;
      manejador(m.ventana.webContents, 'media', (ok) => {
        concedido = ok;
      });
      assert.equal(concedido, false);
    },
  );
});
