// Medicion del editor en Electron de verdad: arranque, abrir niveles y la
// latencia de arrastrar una entidad (metrica M-05, caso CP-17), con el canvas
// real de Chromium. Complementa las pruebas de src/app/perf/, que corren en
// jsdom con un contexto 2D falso y por eso no incluyen rasterizar.
//
// Uso (desde editor/):
//   node scripts/perf-editor.js [--out <carpeta>] [--sizes 100,250,500,1000]
//                               [--steps 40] [--skip-build]
//
// Que hace:
//   1. Compila el editor en modo desarrollo en una carpeta temporal (hace falta
//      el modo desarrollo: la API de depuracion "ng" de Angular es la que deja
//      llegar a App desde la pagina). Con --skip-build reusa la anterior.
//   2. Abre ESA compilacion en una ventana de Electron de 1366x768 con
//      scripts/perf-editor-preload.js: una carpeta del editor de solo lectura
//      sobre el repo (lo que el editor escribe queda en memoria).
//   3. Mide el arranque (5 recargas), abrir cada nivel de levels/, y arrastrar
//      con eventos de mouse REALES (webContents.sendInputEvent: pasan por la
//      tuberia de entrada de Chromium, como un mouse) en niveles generados.
//   4. Escribe <out>/perf-electron.json.
//
// Tiempos de cada paso del arrastre, medidos dentro de la pagina:
//   handler   : el pointermove entero (todos sus listeners).
//   inputToDraw: desde el timestamp del evento hasta que termina la deteccion
//                de cambios que redibuja el canvas (trabajo del hilo principal).
//   inputToNextFrame: hasta el requestAnimationFrame siguiente al dibujo: el
//                cuadro con el cambio ya se entrego a pintar. Es la cota
//                superior de lo que percibe el usuario, en saltos de un vsync.
//   raster    : (pasada aparte) getImageData(0,0,1,1) justo despues del dibujo
//                obliga a Chromium a rasterizar lo encolado y leerlo: el costo
//                de pintar los pixeles que jsdom no tiene.

const { spawnSync, spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const EDITOR = path.resolve(__dirname, '..');
const BUILD_DIR = path.join(os.tmpdir(), 'honeycomb-perf-build');

function arg(name, fallback) {
  const index = process.argv.indexOf('--' + name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

// --- Modo Node: compilar y lanzar Electron -----------------------------------

function runFromNode() {
  if (!process.argv.includes('--skip-build') || !fs.existsSync(path.join(BUILD_DIR, 'browser', 'index.html'))) {
    console.log('Compilando el editor (desarrollo) en ' + BUILD_DIR + ' ...');
    const build = spawnSync('npx', ['ng', 'build', '--configuration', 'development', '--output-path', BUILD_DIR], {
      cwd: EDITOR,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    if (build.status !== 0) {
      process.exit(build.status ?? 1);
    }
  }
  const electron = require('electron');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electron, [__filename, '--electron', ...process.argv.slice(2)], { stdio: 'inherit', env });
  child.on('exit', (code) => process.exit(code ?? 0));
}

// --- Modo Electron: medir ------------------------------------------------------

/**
 * Lo que corre DENTRO de la pagina. Se inyecta como texto con
 * executeJavaScript; deja window.__perf con las operaciones que pide el
 * proceso principal.
 */
function pageAgent() {
  const host = window.__perfHost;
  const app = () => window.ng.getComponent(document.querySelector('app-root'));
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(performance.now())));

  function rng(seed) {
    let state = seed >>> 0;
    return () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Igual que levelWithEntities de src/app/perf/perf-helpers.ts. */
  function generate(count, events) {
    const side = Math.max(16, Math.ceil(Math.sqrt(count * 2)));
    const random = rng(7);
    const cells = side * side;
    const order = Array.from({ length: cells }, (_, i) => i);
    const center = Math.floor(side / 2) * side + Math.floor(side / 2);
    [order[0], order[center]] = [order[center], order[0]];
    for (let i = 1; i < count; i += 1) {
      const j = i + Math.floor(random() * (cells - i));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const shapes = host.shapeTemplates;
    const entities = [];
    for (let i = 0; i < count; i += 1) {
      const position = { col: order[i] % side, row: Math.floor(order[i] / side) };
      if (i === 0) {
        entities.push({
          id: 'player_1', type: 'player', position, texture: 'textures/player.png',
          sourceRect: { x: 0, y: 0, width: 16, height: 16 }, scale: 2,
          collider: { width: 16, height: 16 }, stats: { health: 100, damage: 10, speed: 3 },
        });
        continue;
      }
      const roll = random();
      if (roll < 0.6 && shapes.length) {
        const shape = shapes[i % shapes.length];
        entities.push({ id: shape.type + '_' + i, position, ...structuredClone(shape) });
      } else if (roll < 0.85) {
        entities.push({
          id: 'enemy_' + i, type: 'enemy', position, texture: 'textures/player2.png',
          sourceRect: { x: 0, y: 0, width: 16, height: 16 }, scale: 2,
          collider: { width: 16, height: 16, solid: true }, stats: { health: 30, damage: 10, speed: 1.5 },
          boss: roll > 0.84,
        });
      } else if (roll < 0.95) {
        entities.push({
          id: 'prop_' + i, type: 'prop', position, texture: 'textures/wall.png',
          sourceRect: { x: 0, y: 0, width: 32, height: 32 }, wall: true, hidden: roll > 0.93,
        });
      } else {
        entities.push({
          id: 'item_' + i, type: 'pickup', position, texture: 'textures/player.png',
          sourceRect: { x: 0, y: 0, width: 16, height: 16 },
        });
      }
    }
    const ids = entities.map((entity) => entity.id);
    return {
      name: 'perf_' + count,
      grid: { width: side, height: side, tileWidth: 64, tileHeight: 32 },
      visuals: {
        floor: { texture: 'textures/floor.png', sourceRect: { x: 0, y: 0, width: 64, height: 64 } },
        wall: { texture: 'textures/wall.png', sourceRect: { x: 0, y: 0, width: 32, height: 32 } },
      },
      entities,
      events: Array.from({ length: events }, (_, i) => ({
        trigger: { type: 'on_entity_destroyed', params: { entity: ids[i % ids.length] } },
        conditions: [{ type: 'flag_is_set', params: { flag: 'marca_' + (i % 10) } }],
        actions: [
          { type: 'show_entity', params: { entity: ids[(i + 1) % ids.length] } },
          { type: 'play_sound', params: { soundPath: 'sounds/aviso.ogg' } },
        ],
      })),
    };
  }

  // --- Instrumentacion de un paso ---------------------------------------------
  let armed = null;
  window.addEventListener('pointermove', (event) => {
    if (armed && armed.evStart === undefined) {
      armed.evTs = event.timeStamp;
      armed.evStart = performance.now();
    }
  }, true);
  window.addEventListener('pointermove', () => {
    if (armed && armed.evEnd === undefined && armed.evStart !== undefined) {
      armed.evEnd = performance.now();
    }
  }, false);
  const longTasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks.push({ start: entry.startTime, duration: entry.duration });
      }
    }).observe({ type: 'longtask', buffered: false });
  } catch {
    // Sin Long Tasks API no se cuentan.
  }

  window.__perfDrawHook = (canvas) => {
    const step = armed;
    if (!step || step.drawStart !== undefined || (step.evStart === undefined && !step.anyDraw)) {
      return;
    }
    step.drawStart = performance.now();
    queueMicrotask(() => {
      step.drawEnd = performance.now();
      if (step.forceRaster) {
        const t = performance.now();
        canvas.getContext('2d').getImageData(0, 0, 1, 1);
        step.raster = performance.now() - t;
      }
      requestAnimationFrame(() => {
        step.nextFrame = performance.now();
        step.resolve();
      });
    });
  };

  function arm(options = {}) {
    let resolve;
    const done = new Promise((r) => (resolve = r));
    armed = { ...options, resolve, done, armedAt: performance.now() };
    return armed;
  }

  async function collect(timeoutMs = 3000) {
    const step = armed;
    const timeout = new Promise((r) => setTimeout(() => r('timeout'), timeoutMs));
    const result = await Promise.race([step.done, timeout]);
    armed = null;
    if (result === 'timeout') {
      return { timeout: true, handler: step.evEnd - step.evStart };
    }
    return {
      handler: step.evEnd - step.evStart,
      inputToDraw: step.drawEnd - step.evTs,
      inputToNextFrame: step.nextFrame - step.evTs,
      drawToEndOfTick: step.drawEnd - step.drawStart,
      eventToDrawStart: step.drawStart - step.evEnd,
      raster: step.raster,
    };
  }

  /** Abre un nivel por el camino del editor (Proyecto › nivel) y espera a verlo pintado. */
  async function open(fileName) {
    const step = arm({ anyDraw: true });
    const start = performance.now();
    await app().proj.loadLevel(fileName);
    const result = await Promise.race([step.done, new Promise((r) => setTimeout(() => r('timeout'), 30000))]);
    armed = null;
    await frame();
    return {
      ms: result === 'timeout' ? NaN : step.nextFrame - start,
      drawn: result !== 'timeout',
      entities: app().levels.level().entities.length,
    };
  }

  function canvas() {
    return app().viewport().nativeElement;
  }

  /** Punto en coordenadas de la ventana de una casilla, unos pixeles por encima de su punto. */
  function pointOf(cell, lift = 4) {
    const a = app();
    const rect = canvas().getBoundingClientRect();
    const zoom = a.view.zoom();
    const pan = a.view.pan();
    const grid = a.levels.level().grid;
    const originX = rect.width / 2 + pan.x;
    const originY = 60 + pan.y;
    return {
      x: Math.round(rect.left + originX + (cell.col - cell.row) * (grid.tileWidth / 2) * zoom),
      y: Math.round(rect.top + originY + (cell.col + cell.row) * (grid.tileHeight / 2) * zoom - lift * zoom),
    };
  }

  async function setup(count, variant) {
    const level = generate(count, variant.events ?? 0);
    const fileName = 'perf_' + count + (variant.events ? '_ev' + variant.events : '') + '.json';
    host.memory.set('levels/' + fileName, JSON.stringify(level, null, 2));
    const a = app();
    a.workspace.set(variant.workspace ?? 'layout');
    const opened = await open(fileName);
    const player = a.levels.level().entities.find((entity) => entity.id === 'player_1');
    const start = player.position;
    if (variant.zoom) {
      // Acercar la vista sobre el jugador: casi todo el nivel queda FUERA del
      // canvas. Sin descarte por camara, el dibujo cuesta lo mismo igual.
      const rect = canvas().getBoundingClientRect();
      const grid = a.levels.level().grid;
      a.view.setZoom(variant.zoom);
      a.view.pan.set({
        x: -(start.col - start.row) * (grid.tileWidth / 2) * variant.zoom,
        y: rect.height / 2 - 60 - (start.col + start.row) * (grid.tileHeight / 2) * variant.zoom,
      });
    }
    // Que terminen de cargar las texturas que pidio el primer dibujo.
    for (let i = 0; i < 30; i += 1) {
      await frame();
    }
    const offsets = [{ col: 1, row: 0 }, { col: 1, row: 1 }, { col: 0, row: 1 }, { col: 0, row: 0 }];
    const steps = offsets.map((o) => pointOf({ col: start.col + o.col, row: start.row + o.row }));
    const hover = offsets.map((o) => pointOf({ col: start.col - 3 + o.col, row: start.row - 3 + o.row }));
    const rect = canvas().getBoundingClientRect();
    return {
      opened,
      grid: level.grid.width + 'x' + level.grid.height,
      zoom: a.view.zoom(),
      canvas: { w: Math.round(rect.width), h: Math.round(rect.height) },
      grab: pointOf(start),
      steps,
      hover,
    };
  }

  window.__perf = {
    setup,
    open,
    frames: async (n = 2) => {
      for (let i = 0; i < n; i += 1) {
        await frame();
      }
      return true;
    },
    arm: (options) => {
      arm(options);
      return true;
    },
    collect,
    moving: () => app().view.moving(),
    playerAt: () => app().levels.level().entities.find((entity) => entity.id === 'player_1').position,
    longTasksSince: (t) => longTasks.filter((task) => task.start >= t),
    now: () => performance.now(),
    heapMB: () => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null),
    realLevels: () => host.realLevels,
    startup: () => {
      const nav = performance.getEntriesByType('navigation')[0];
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      return {
        domContentLoaded: nav?.domContentLoadedEventEnd,
        load: nav?.loadEventEnd,
        firstContentfulPaint: fcp?.startTime,
        firstCanvasDraw: window.__perfFirstDrawAt,
      };
    },
  };
  return true;
}

function percentile(sorted, p) {
  if (!sorted.length) {
    return null;
  }
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1];
}

function summarize(values) {
  const list = values.filter((value) => typeof value === 'number' && Number.isFinite(value)).sort((a, b) => a - b);
  const r = (value) => (value === null ? null : Math.round(value * 100) / 100);
  return {
    n: list.length,
    median: r(percentile(list, 50)),
    p95: r(percentile(list, 95)),
    max: r(list.at(-1) ?? null),
  };
}

async function runInElectron() {
  const { app, BrowserWindow } = require('electron');
  const processStart = Date.now() - Math.round(process.uptime() * 1000);
  app.commandLine.appendSwitch('disable-renderer-backgrounding');
  app.commandLine.appendSwitch('disable-background-timer-throttling');
  app.commandLine.appendSwitch('enable-precise-memory-info');
  // Windows marca "oculta" una ventana tapada por otras (o con la sesion
  // bloqueada), y una pagina oculta no dibuja ni mide su canvas.
  app.commandLine.appendSwitch('disable-features', 'CalculateNativeWinOcclusion');

  await app.whenReady();
  const readyAt = Date.now();
  const sizes = String(arg('sizes', '100,250,500,1000')).split(',').map(Number);
  const steps = Number(arg('steps', 40));
  // Fuera del repo por defecto: los numeros son de esta maquina, no del proyecto.
  const outDir = arg('out', path.join(os.tmpdir(), 'honeycomb-perf'));
  const index = path.join(BUILD_DIR, 'browser', 'index.html');

  const win = new BrowserWindow({
    width: 1366,
    height: 768,
    useContentSize: true,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, 'perf-editor-preload.js'),
      contextIsolation: false,
      sandbox: false,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  const wc = win.webContents;
  wc.on('console-message', (event) => {
    if (event.level === 'error') {
      console.log('[pagina] ' + event.message);
    }
  });
  const js = (code) => wc.executeJavaScript(code, true);

  async function waitReady() {
    for (let i = 0; i < 600; i += 1) {
      const ready = await js(
        `(() => { try { const a = window.ng?.getComponent(document.querySelector('app-root'));
           return !!a && a.proj.levelFiles().length > 0 && window.__perfFirstDrawAt !== undefined; } catch { return false; } })()`,
      );
      if (ready) {
        return js('performance.now()');
      }
      await new Promise((r) => setTimeout(r, 10));
    }
    const state = await js(
      `(() => { const a = window.ng?.getComponent?.(document.querySelector('app-root'));
         return JSON.stringify({ ng: !!window.ng, app: !!a, api: 'honeycombProject' in window,
           levels: a?.proj?.levelFiles?.().length, firstDraw: window.__perfFirstDrawAt,
           canvas: a ? a.viewport()?.nativeElement.width : null, size: a?.view?.canvasSize?.(),
           visibility: document.visibilityState, inner: [innerWidth, innerHeight],
           host: a ? a.viewport()?.nativeElement.parentElement?.getBoundingClientRect().toJSON() : null }); })()`,
    );
    throw new Error('El editor no arranco: ' + state);
  }

  // --- Arranque ---------------------------------------------------------------
  const startup = [];
  for (let i = 0; i < 6; i += 1) {
    const t0 = Date.now();
    if (i === 0) {
      await win.loadFile(index);
    } else {
      const loaded = new Promise((r) => wc.once('did-finish-load', r));
      wc.reload();
      await loaded;
    }
    const readyMs = await waitReady();
    await js('(' + pageAgent.toString() + ')()');
    startup.push({ run: i === 0 ? 'primera carga' : 'recarga', wallMs: Date.now() - t0, readyMs, ...(await js('__perf.startup()')) });
  }
  console.log('Arranque:', JSON.stringify(startup.map((s) => Math.round(s.readyMs))));

  // --- Abrir los niveles reales ---------------------------------------------------
  const realLevels = [];
  for (const name of await js('__perf.realLevels()')) {
    const times = [];
    let entities = 0;
    for (let i = 0; i < 5; i += 1) {
      const result = await js(`__perf.open(${JSON.stringify(name)})`);
      times.push(result.ms);
      entities = result.entities;
    }
    const size = fs.statSync(path.join(EDITOR, '..', 'levels', name)).size;
    realLevels.push({ name, bytes: size, entities, openMs: summarize(times) });
  }
  console.log('Niveles reales:', realLevels.map((l) => l.name + '=' + l.openMs.median).join(' '));

  // --- Arrastrar ----------------------------------------------------------------
  const send = (event) => wc.sendInputEvent(event);
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));

  async function drag(count, variant) {
    const setup = await js(`__perf.setup(${count}, ${JSON.stringify(variant)})`);
    const heapBefore = await js('__perf.heapMB()');
    const t0 = await js('__perf.now()');
    send({ type: 'mouseMove', x: setup.grab.x, y: setup.grab.y });
    await js('__perf.frames(3)');
    send({ type: 'mouseDown', x: setup.grab.x, y: setup.grab.y, button: 'left', clickCount: 1 });
    await js('__perf.frames(3)');
    const grabbed = await js('__perf.moving()');
    const samples = [];
    const rasterSamples = [];
    const total = steps + 5;
    for (let i = 0; i < total; i += 1) {
      const point = setup.steps[i % setup.steps.length];
      await js('__perf.arm({})');
      send({ type: 'mouseMove', x: point.x, y: point.y, button: 'left', modifiers: ['leftButtonDown'] });
      const result = await js('__perf.collect()');
      if (i >= 5) {
        samples.push(result);
      }
      await pause(4);
    }
    // Pasada aparte para el costo de rasterizar (getImageData fuerza el pintado).
    for (let i = 0; i < 16; i += 1) {
      const point = setup.steps[i % setup.steps.length];
      await js(`__perf.arm(${JSON.stringify({ forceRaster: true })})`);
      send({ type: 'mouseMove', x: point.x, y: point.y, button: 'left', modifiers: ['leftButtonDown'] });
      const result = await js('__perf.collect()');
      if (i >= 4 && typeof result.raster === 'number') {
        rasterSamples.push(result.raster);
      }
      await pause(4);
    }
    // Termina en la casilla de inicio: soltar sin movimiento neto no abre ningun dialogo.
    const last = setup.steps[3];
    send({ type: 'mouseMove', x: last.x, y: last.y, button: 'left', modifiers: ['leftButtonDown'] });
    await js('__perf.frames(2)');
    const movedTo = await js('__perf.playerAt()');
    send({ type: 'mouseUp', x: last.x, y: last.y, button: 'left', clickCount: 1 });
    await js('__perf.frames(3)');

    // Pasar el mouse sin arrastrar.
    const hover = [];
    for (let i = 0; i < Math.min(steps, 30) + 5; i += 1) {
      const point = setup.hover[i % setup.hover.length];
      await js('__perf.arm({})');
      send({ type: 'mouseMove', x: point.x, y: point.y });
      const result = await js('__perf.collect()');
      if (i >= 5) {
        hover.push(result);
      }
      await pause(4);
    }
    const longTasks = await js(`__perf.longTasksSince(${t0})`);
    const pick = (list, key) => summarize(list.map((sample) => sample[key]));
    return {
      entities: count,
      variant,
      grid: setup.grid,
      zoom: setup.zoom,
      canvas: setup.canvas,
      grabbed,
      movedTo,
      openMs: setup.opened.ms,
      heapMB: { before: heapBefore, after: await js('__perf.heapMB()') },
      timeouts: samples.filter((s) => s.timeout).length,
      drag: {
        handler: pick(samples, 'handler'),
        eventToDrawStart: pick(samples, 'eventToDrawStart'),
        drawToEndOfTick: pick(samples, 'drawToEndOfTick'),
        inputToDraw: pick(samples, 'inputToDraw'),
        inputToNextFrame: pick(samples, 'inputToNextFrame'),
        raster: summarize(rasterSamples),
      },
      hover: {
        handler: pick(hover, 'handler'),
        inputToDraw: pick(hover, 'inputToDraw'),
        inputToNextFrame: pick(hover, 'inputToNextFrame'),
      },
      longTasks: { count: longTasks.length, maxMs: Math.round(Math.max(0, ...longTasks.map((t) => t.duration))) },
      // Las muestras sueltas, en ms, para quien quiera rehacer las cuentas.
      raw: {
        dragInputToDraw: samples.map((s) => Math.round(s.inputToDraw * 10) / 10),
        dragInputToNextFrame: samples.map((s) => Math.round(s.inputToNextFrame * 10) / 10),
        raster: rasterSamples.map((value) => Math.round(value * 10) / 10),
        hoverInputToNextFrame: hover.map((s) => Math.round(s.inputToNextFrame * 10) / 10),
      },
    };
  }

  const dragRuns = [];
  for (const count of sizes) {
    const result = await drag(count, {});
    dragRuns.push(result);
    console.log(
      `Arrastre ${count}: agarrada=${result.grabbed} inputToNextFrame=${result.drag.inputToNextFrame.median}/${result.drag.inputToNextFrame.p95} ` +
        `draw=${result.drag.drawToEndOfTick.median} raster=${result.drag.raster.median} hover=${result.hover.inputToNextFrame.median}`,
    );
  }
  // Variantes con 1000 entidades: la vista acercada (casi todo fuera de
  // pantalla), la pestana JSON abierta, y 200 eventos con la pestana Eventos.
  const variants = [
    { zoom: 3 },
    { workspace: 'json' },
    { workspace: 'eventos', events: 200 },
  ];
  for (const variant of variants) {
    const result = await drag(1000, variant);
    dragRuns.push(result);
    console.log(`Arrastre 1000 ${JSON.stringify(variant)}: inputToNextFrame=${result.drag.inputToNextFrame.median}/${result.drag.inputToNextFrame.p95}`);
  }

  const cpus = os.cpus();
  const report = {
    generatedAt: new Date().toISOString(),
    machine: {
      cpu: cpus[0]?.model.trim(),
      threads: cpus.length,
      totalMemGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
      platform: os.platform() + ' ' + os.release(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      gpu: app.getGPUFeatureStatus(),
      displayScale: require('electron').screen.getPrimaryDisplay().scaleFactor,
      refreshRate: require('electron').screen.getPrimaryDisplay().displayFrequency,
    },
    electronProcessToReadyMs: readyAt - processStart,
    startup,
    realLevels,
    dragRuns,
  };
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'perf-electron.json'), JSON.stringify(report, null, 2));
  console.log('Escrito ' + path.join(outDir, 'perf-electron.json'));
  app.quit();
}

if (process.versions.electron && process.argv.includes('--electron')) {
  runInElectron().catch((error) => {
    console.error(error);
    require('electron').app.exit(1);
  });
} else {
  runFromNode();
}
