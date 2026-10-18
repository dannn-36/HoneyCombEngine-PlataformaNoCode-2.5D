// =============================================================================
// Estres del editor: agrandar el nivel hasta que algo se rompa o deje de servir.
// =============================================================================
//
// El editor es una aplicacion local de escritorio: no hay usuarios
// concurrentes. Estresarlo es agrandar lo que tiene que manejar: entidades,
// tamano de grilla, salas y tuneles, eventos, el historial de deshacer lleno,
// y guardar y abrir niveles enormes. Por cada dimension se anota donde cruza
// los umbrales del plan de calidad: 100 ms por interaccion (M-05) y 1 s por
// guardar o abrir, y si algo tira una excepcion.
//
// NO corre con `npm test`: tarda minutos y usa bastante memoria. Se pide asi
// (desde editor/, en PowerShell):
//
//   $env:HC_STRESS='1'; $env:HC_PERF_OUT='<carpeta>'
//   npx ng test --watch=false --include src/app/perf/stress.perf.spec.ts
//
// HC_PERF_OUT es opcional: con ella los numeros crudos van a
// <carpeta>/stress-jsdom.json.
//
// Mismo limite que drag.perf.spec.ts: jsdom no tiene canvas, el dibujo se mide
// contra un contexto 2D que solo cuenta las llamadas (no incluye rasterizar).
//
// MEMORIA. Cada escalon mide el heap despues de forzar el recolector. Si pasa
// de MEMORY_GUARD_MB (o un escalon tarda mas de STEP_GUARD_MS), los escalones
// mas grandes de esa dimension no se corren y quedan anotados como "omitido".

import { TestBed } from '@angular/core/testing';

import { buildLayout } from '../core/dungeon-layout';
import { levelForDisk } from '../core/floors';
import { IsoCanvasRenderer } from '../core/iso-canvas-renderer';
import { Level } from '../models/level.model';
import { LevelHistoryService } from '../services/level-history.service';
import { LevelService } from '../services/level.service';
import { bootEditor, env, measureDrag, nodeModule, restoreEditorStubs, writeReport } from './editor-harness';
import {
  CountingContext2D,
  countingCanvas,
  eventsFor,
  levelWithEntities,
  levelWithOneRoom,
  levelWithRooms,
  measure,
  nextTask,
  plainGrid,
  round,
  sceneFor,
  stats,
  time,
} from './perf-helpers';

const ENABLED = env['HC_STRESS'] === '1';
const MEMORY_GUARD_MB = 1500;
const STEP_GUARD_MS = 20000;
/** Lo que se deja retener al historial del mapa antes de cortar y proyectar los 200 pasos. */
const HISTORY_GUARD_MB = 600;
const LONG = 600000;

type Row = Record<string, unknown>;
const results: Record<string, Row[]> = {};

function record(dimension: string, row: Row): void {
  (results[dimension] ??= []).push(row);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let gcFn: (() => void) | null = null;

/** Heap usado en MB, despues de forzar el recolector (si se pudo). */
function heapMB(): number {
  gcFn?.();
  gcFn?.();
  const usage = (globalThis as { process?: { memoryUsage(): { heapUsed: number } } }).process?.memoryUsage();
  return usage ? round(usage.heapUsed / 1048576, 1) : NaN;
}

/** Escalones de una dimension: corre cada uno salvo que el anterior haya pasado los limites. */
async function escalate<T>(
  dimension: string,
  values: readonly T[],
  run: (value: T) => Promise<Row> | Row,
): Promise<void> {
  let stopped: string | null = null;
  const base = heapMB();
  for (const value of values) {
    if (stopped) {
      record(dimension, { value, omitido: stopped });
      continue;
    }
    const before = heapMB();
    const start = performance.now();
    try {
      const row = await run(value);
      const elapsed = performance.now() - start;
      // El pico: el heap con lo que dejo vivo el escalon (lo mide cada run si
      // lo necesita antes de soltar el editor); despues se libera.
      const peak = typeof row['peakHeapMB'] === 'number' ? (row['peakHeapMB'] as number) : heapMB();
      releaseEditor();
      const after = heapMB();
      record(dimension, { value, ...row, heapMB: after, heapDeltaMB: round(after - before, 1), stepMs: Math.round(elapsed) });
      // Proyeccion lineal al escalon siguiente: no se corre uno que no entraria.
      const next = values[values.indexOf(value) + 1];
      const projected =
        typeof next === 'number' && typeof value === 'number' ? ((peak - base) * next) / value : 0;
      if (peak - base > MEMORY_GUARD_MB) {
        stopped = 'heap de ' + peak + ' MB tras ' + String(value);
      } else if (projected > MEMORY_GUARD_MB) {
        stopped = 'proyeccion de ' + Math.round(projected) + ' MB de heap (lineal desde ' + String(value) + ')';
      } else if (elapsed > STEP_GUARD_MS) {
        stopped = 'el escalon ' + String(value) + ' tardo ' + Math.round(elapsed) + ' ms';
      }
    } catch (error) {
      record(dimension, { value, lanzo: String(error) });
      stopped = 'excepcion en ' + String(value);
    }
    await nextTask();
  }
}

/**
 * Vacia el historial de deshacer de un servicio que ya no se usa. Hace falta
 * porque LevelHistoryService se suscribe a window (pointerdown, keydown) y no
 * se desuscribe nunca: en la app es un singleton y no importa, pero aca cada
 * escalon crea uno nuevo, y sin esto los 200 pasos del anterior seguirian vivos.
 */
function clearHistory(history: unknown): void {
  (history as { history: { clear(): void } }).history.clear();
}

/** Suelta el editor de un escalon (fixture, servicios y DOM) para que no cuente en el siguiente. */
function releaseEditor(): void {
  TestBed.resetTestingModule();
  restoreEditorStubs();
  document.body.innerHTML = '';
}

/** window.honeycombProject en memoria: solo lo que usan guardar y abrir. */
function memoryDisk(): Map<string, string> {
  const files = new Map<string, string>();
  (window as unknown as { honeycombProject: unknown }).honeycombProject = {
    readFile: async (path: string) => {
      const contents = files.get(path);
      if (contents === undefined) {
        throw new Error('ENOENT: ' + path);
      }
      return contents;
    },
    writeFile: async (path: string, contents: string) => {
      files.set(path, contents);
    },
  };
  return files;
}

function dropDisk(): void {
  delete (window as unknown as { honeycombProject?: unknown }).honeycombProject;
}

/** Guardar y abrir por LevelService/ProjectService, con el disco en memoria. */
async function saveAndOpen(level: Level): Promise<Row> {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({});
  const files = memoryDisk();
  try {
    const levels = TestBed.inject(LevelService);
    levels.adopt(level, 'stress.json');
    // Guardar: levelForDisk + JSON.stringify(nivel, null, 2) + escribir.
    const saveStart = performance.now();
    await levels.save();
    const saveMs = performance.now() - saveStart;
    const contents = files.get('levels/stress.json') ?? '';
    // Abrir: leer + JSON.parse + parseLevel + adopt.
    levels.createNew('vacio');
    const openStart = performance.now();
    await levels.load('stress.json');
    const openMs = performance.now() - openStart;
    return {
      fileMB: round(contents.length / 1048576, 2),
      saveMs: round(saveMs, 1),
      openMs: round(openMs, 1),
      reopenedEntities: levels.level().entities.length,
    };
  } finally {
    dropDisk();
  }
}

/** Un dibujo del viewport, sin Angular, contra el contexto falso. */
function drawCost(level: Level, options: { withImages?: boolean; zoom?: number; iterations?: number } = {}): Row {
  const renderer = new IsoCanvasRenderer();
  const ctx = new CountingContext2D();
  const canvas = countingCanvas(ctx);
  const scene = sceneFor(() => level, { withImages: options.withImages, zoom: options.zoom ?? 1 });
  const iterations = options.iterations ?? 5;
  const samples = measure(() => renderer.draw(canvas, scene), iterations, 1);
  ctx.reset();
  renderer.draw(canvas, scene);
  return { drawMs: stats(samples).median, drawCalls: ctx.calls, drawImages: ctx.drawImages };
}

describe.skipIf(!ENABLED)('estres del editor (opt-in: HC_STRESS=1)', () => {
  beforeAll(async () => {
    try {
      const v8 = await nodeModule('v8');
      v8.setFlagsFromString('--expose-gc');
      const vm = await nodeModule('vm');
      gcFn = vm.runInNewContext('gc');
    } catch {
      gcFn = null;
    }
  });

  afterAll(async () => {
    await writeReport('stress-jsdom', { memoryGuardMB: MEMORY_GUARD_MB, stepGuardMs: STEP_GUARD_MS, gc: gcFn !== null, results });
  });

  afterEach(() => restoreEditorStubs());

  it('escala las entidades en el editor entero: abrir, arrastrar y pasar el mouse', async () => {
    await escalate('entidades', [1000, 2500, 5000, 10000, 20000], async (count) => {
      TestBed.resetTestingModule();
      const level = levelWithEntities(count);
      const { harness, openMs } = await bootEditor(level);
      const iterations = count <= 5000 ? 20 : 10;
      const drag = await measureDrag(harness, iterations, 3);
      const row: Row = {
        grid: level.grid.width + 'x' + level.grid.height,
        openInEditorMs: round(openMs, 1),
        dragStepMedian: drag.fullStep.median,
        dragStepP95: drag.fullStep.p95,
        hoverStepMedian: drag.hoverStep.median,
        renderMedian: drag.breakdown.render.median,
        updateMedian: drag.breakdown.update.median,
        historyMedian: drag.breakdown.history.median,
        restOfCdMedian: drag.breakdown.restOfChangeDetection.median,
        pointerDownMedian: drag.pointerDown.median,
        pointerUpMedian: drag.pointerUp.median,
        drawCalls: drag.drawCallsPerFrame,
        peakHeapMB: heapMB(),
      };
      clearHistory(harness.app.history);
      harness.fixture.destroy();
      return row;
    });
    expect(results['entidades'].length).toBe(5);
  }, LONG);

  it('escala guardar y abrir con muchas entidades', async () => {
    await escalate('guardar_abrir_entidades', [1000, 5000, 20000, 50000, 100000, 200000], (count) =>
      saveAndOpen(levelWithEntities(count)),
    );
    expect(results['guardar_abrir_entidades'].length).toBe(6);
  }, LONG);

  it('escala el tamano de la grilla sola: dibujo con y sin texturas de piso', async () => {
    await escalate('grilla', [64, 128, 256, 512, 1024, 2048], (side) => {
      const level = plainGrid(side);
      const withImages = drawCost(level, { withImages: true, iterations: side >= 1024 ? 2 : 5 });
      const withoutImages = drawCost(level, { withImages: false, iterations: side >= 1024 ? 2 : 5 });
      return {
        cells: side * side,
        drawMsConTexturas: withImages['drawMs'],
        drawImagesConTexturas: withImages['drawImages'],
        drawMsSinTexturas: withoutImages['drawMs'],
      };
    });
    expect(results['grilla'].length).toBe(6);
  }, LONG);

  it('escala la grilla sola con piso y pared a mano (tiles legacy): cada clic de Piso/Pared', async () => {
    await escalate('grilla_toggle_tile', [64, 128, 256, 512, 1024], (side) => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const levels = TestBed.inject(LevelService);
      levels.adopt(plainGrid(side), null);
      // El primer clic materializa side*side celdas (legacyTiles); los siguientes copian y buscan en todas.
      const first = time(() => levels.toggleTile(1, 1, 'wall')).ms;
      const next = measure((i) => levels.toggleTile(2 + (i % 5), 2, 'wall'), side >= 1024 ? 3 : 8, 1);
      return { cells: side * side, primerClicMs: round(first, 1), clicMs: stats(next).median, tiles: levels.level().tiles?.length };
    });
    expect(results['grilla_toggle_tile'].length).toBe(5);
  }, LONG);

  it('escala una sola sala enorme: buildLayout, dibujo, guardar y abrir', async () => {
    await escalate('sala_unica', [64, 128, 256, 512, 1024, 2048], async (side) => {
      const room = { id: 'sala_1', col: 1, row: 1, width: side, height: side };
      const layout = time(() => buildLayout({ width: 10, height: 10 }, [room], [], []));
      const level = levelWithOneRoom(side);
      const draw = drawCost(level, { iterations: side >= 1024 ? 2 : 5 });
      const disk = time(() => JSON.stringify(levelForDisk(level), null, 2));
      const parse = time(() => JSON.parse(disk.value));
      const sizeMB = round(disk.value.length / 1048576, 1);
      return {
        cells: side * side,
        tiles: layout.value.tiles.length,
        buildLayoutMs: round(layout.ms, 1),
        drawMs: draw['drawMs'],
        drawCalls: draw['drawCalls'],
        saveSerializeMs: round(disk.ms, 1),
        openParseMs: round(parse.ms, 1),
        fileMB: sizeMB,
      };
    });
    expect(results['sala_unica'].length).toBe(6);
  }, LONG);

  it('escala las salas y los tuneles: cada edicion del mapa recalcula el layout', async () => {
    await escalate('salas_tuneles', [10, 50, 100, 250, 500, 1000], (count) => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const levels = TestBed.inject(LevelService);
      const level = levelWithRooms(count, 8, count * 4);
      levels.adopt(level, null);
      const layout = measure(
        () => buildLayout(level.grid, level.rooms ?? [], level.tunnels ?? [], level.tileEdits ?? []),
        5,
        1,
      );
      // Mover una sala una casilla (lo que hace soltar el arrastre de una grilla).
      const moveRoom = measure((i) => levels.updateRoom('sala_1', { col: 1 + (i % 2) }), 5, 1);
      // Un clic de Piso/Pared con salas: buildLayout dos veces (ver toggleTileEdit).
      const toggle = measure((i) => levels.toggleTile(3 + (i % 3), 3, 'wall'), 5, 1);
      const draw = drawCost(levels.level());
      const disk = time(() => JSON.stringify(levelForDisk(levels.level()), null, 2));
      return {
        tunnels: level.tunnels?.length,
        grid: level.grid.width + 'x' + level.grid.height,
        tiles: level.tiles?.length,
        entities: level.entities.length,
        buildLayoutMs: stats(layout).median,
        moverSalaMs: stats(moveRoom).median,
        clicPisoParedMs: stats(toggle).median,
        drawMs: draw['drawMs'],
        saveSerializeMs: round(disk.ms, 1),
        fileMB: round(disk.value.length / 1048576, 2),
      };
    });
    expect(results['salas_tuneles'].length).toBe(6);
  }, LONG);

  it('escala los eventos sin la pestana a la vista: servicios, guardar y abrir', async () => {
    await escalate('eventos_servicios', [100, 1000, 5000, 20000], async (count) => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const levels = TestBed.inject(LevelService);
      const level = levelWithEntities(500, { events: count });
      levels.adopt(level, null);
      const add = measure(() => levels.addEvent(eventsFor(1, ['player_1'])[0]), 10, 2);
      const update = measure((i) => levels.updateEvent(i % count, { conditions: [] }), 10, 2);
      const disk = await saveAndOpen(level);
      return { entities: 500, addEventMs: stats(add).median, updateEventMs: stats(update).median, ...disk };
    });
    expect(results['eventos_servicios'].length).toBe(4);
  }, LONG);

  it('llena el historial de deshacer (200 pasos) con un nivel grande y mide la memoria', async () => {
    // Por paso, LevelService arma un array de entidades nuevo (n referencias) y
    // un objeto para la entidad movida; el resto se comparte.
    await escalate('historial_entidades', [1000, 5000, 20000], async (count) => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const levels = TestBed.inject(LevelService);
      const history = TestBed.inject(LevelHistoryService);
      levels.adopt(levelWithEntities(count), null);
      TestBed.tick();
      const before = heapMB();
      const stepMs: number[] = [];
      for (let i = 0; i < 250; i += 1) {
        // Cada paso es otra accion (otro clic), asi no se funden.
        window.dispatchEvent(new PointerEvent('pointerdown'));
        const id = levels.level().entities[1 + (i % (count - 1))].id;
        const position = levels.level().entities[1 + (i % (count - 1))].position;
        stepMs.push(
          time(() => {
            levels.updateEntity(id, { position: { col: position.col, row: position.row } });
            TestBed.tick();
          }).ms,
        );
      }
      const after = heapMB();
      const undo = measure(() => history.undo(), 50, 0);
      const redo = measure(() => history.redo(), 50, 0);
      clearHistory(history);
      return {
        pasos: 250,
        retenidoMB: round(after - before, 1),
        porPasoKB: round(((after - before) * 1024) / 200, 1),
        pasoMs: stats(stepMs).median,
        undoMs: stats(undo).median,
        redoMs: stats(redo).median,
      };
    });
    expect(results['historial_entidades'].length).toBe(3);
  }, LONG);

  it('llena el historial con ediciones del mapa: cada paso guarda tiles nuevos', async () => {
    // updateRoom recalcula "tiles" con buildLayout, que arma OBJETOS NUEVOS para
    // cada celda: el historial retiene 200 copias del mapa entero.
    await escalate('historial_mapa', [25, 100, 400, 1000], async (rooms) => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({});
      const levels = TestBed.inject(LevelService);
      const history = TestBed.inject(LevelHistoryService);
      levels.adopt(levelWithRooms(rooms, 8), null);
      TestBed.tick();
      const tiles = levels.level().tiles?.length ?? 0;
      const before = heapMB();
      const stepMs: number[] = [];
      let steps = 0;
      for (let i = 0; i < 220; i += 1) {
        window.dispatchEvent(new PointerEvent('pointerdown'));
        stepMs.push(
          time(() => {
            levels.updateRoom('sala_1', { col: 1 + (i % 2) });
            TestBed.tick();
          }).ms,
        );
        steps += 1;
        // Corta antes de llenar la memoria: lo que falta se proyecta.
        if (i % 20 === 19 && heapMB() - before > HISTORY_GUARD_MB) {
          break;
        }
      }
      const after = heapMB();
      const kept = Math.min(200, steps);
      const undo = measure(() => history.undo(), 20, 0);
      clearHistory(history);
      return {
        tiles,
        pasos: steps,
        retenidoMB: round(after - before, 1),
        porPasoMB: round((after - before) / kept, 2),
        proyectado200MB: round(((after - before) / kept) * 200, 1),
        pasoMs: stats(stepMs).median,
        undoMs: stats(undo).median,
      };
    });
    expect(results['historial_mapa'].length).toBe(4);
  }, LONG);

  // Va ultima a proposito: jsdom no devuelve del todo la memoria de un DOM tan
  // grande, y medida antes inflaba el heap de las dimensiones siguientes.
  it('escala los eventos: pestana eventos abierta en el editor entero', async () => {
    const fs = await nodeModule('fs');
    const catalog = JSON.parse(fs.readFileSync('../schema/event_catalog.json', 'utf8'));
    // Con la pestana Eventos a la vista, cada parametro de entidad es un <select>
    // con una <option> por entidad: el DOM crece como eventos x entidades.
    await escalate('eventos_pestana', [100, 500, 1000, 5000], async (count) => {
      TestBed.resetTestingModule();
      const entities = 100;
      const level = levelWithEntities(entities, { events: count });
      const { harness, openMs } = await bootEditor(levelWithEntities(entities));
      harness.app.catalog.catalog.set(catalog);
      harness.app.workspace.set('eventos');
      harness.tick();
      const openStart = performance.now();
      harness.app.levels.adopt(level, null);
      harness.tick();
      const openEventsMs = performance.now() - openStart;
      const options = harness.fixture.nativeElement.querySelectorAll('option').length;
      const drag = await measureDrag(harness, 8, 2);
      const edit = time(() => {
        harness.app.levels.updateEvent(0, { conditions: [] });
        harness.tick();
      }).ms;
      const peakHeapMB = heapMB();
      clearHistory(harness.app.history);
      harness.fixture.destroy();
      return {
        entities,
        options,
        peakHeapMB,
        openInEditorMs: round(openEventsMs, 1),
        openEmptyMs: round(openMs, 1),
        dragStepMedian: drag.fullStep.median,
        hoverStepMedian: drag.hoverStep.median,
        editEventMs: round(edit, 1),
      };
    });
    expect(results['eventos_pestana'].length).toBe(4);
  }, LONG);
});
