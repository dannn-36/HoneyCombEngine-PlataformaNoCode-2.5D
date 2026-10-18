// =============================================================================
// El editor entero, armado en jsdom para medirlo (perf/).
// =============================================================================
//
// Lo usan drag.perf.spec.ts y stress.perf.spec.ts. Es un .ts comun y no un
// .spec.ts para poder importarlo desde las dos pruebas sin registrar sus casos
// dos veces; por eso no usa los globales de Vitest (vi, expect) y lo que
// necesita de Node lo pide en tiempo de ejecucion (ver writeReport).
//
// QUE HACE. Lo mismo que app.spec.ts (TestBed.createComponent(App)), mas tres
// cosas que jsdom no trae y el viewport necesita para dibujar:
//   - un ResizeObserver que informa un tamano fijo de canvas;
//   - un contexto 2D falso que cuenta las llamadas (perf-helpers.ts);
//   - el sheet de figuras y las texturas "ya cargadas", como en Electron con la
//     carpeta del editor abierta, para que el dibujo haga los mismos drawImage.
// Los eventos del puntero se disparan sobre el <canvas> de verdad, asi que
// pasan por el (pointermove)="view.onPointerMove($event)" de app.html.

import { ApplicationRef } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { App } from '../app';
import { Level } from '../models/level.model';
import { CountingContext2D, Stats, cellToCanvas, loadedImage, measureAsync, nextTask, stats, time } from './perf-helpers';

/** Tamano del canvas en jsdom: el que tiene el viewport a 1366x768 con los paneles abiertos. */
export const CANVAS = { w: 900, h: 520 };

type Env = Record<string, string | undefined>;
export const env: Env = (globalThis as { process?: { env: Env } }).process?.env ?? {};

/** ResizeObserver que informa enseguida el tamano fijo de arriba: jsdom no lo trae. */
class FixedResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(): void {
    this.callback(
      [{ contentRect: { width: CANVAS.w, height: CANVAS.h } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
  unobserve(): void {}
  disconnect(): void {}
}

export interface EditorHarness {
  fixture: ComponentFixture<App>;
  app: App;
  canvas: HTMLCanvasElement;
  ctx: CountingContext2D;
  appRef: ApplicationRef;
  /** Punto del canvas (= clientX/Y: en jsdom el canvas esta en 0,0) de una casilla, "lift" px mas arriba. */
  pointAt(cell: { col: number; row: number }, lift?: number): { x: number; y: number };
  pointer(type: string, point: { x: number; y: number }, init?: PointerEventInit): void;
  /** La deteccion de cambios que sigue a un evento: efectos y plantilla. */
  tick(): void;
}

const originalGetContext = HTMLCanvasElement.prototype.getContext;

/**
 * Arma el editor entero y le abre un nivel. bootMs es el arranque (crear App
 * hasta que queda estable); openMs, abrir el nivel ya leido y dibujarlo.
 */
export async function bootEditor(level: Level): Promise<{ harness: EditorHarness; bootMs: number; openMs: number }> {
  const ctx = new CountingContext2D();
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = FixedResizeObserver;
  HTMLCanvasElement.prototype.getContext = function () {
    return ctx;
  } as unknown as typeof originalGetContext;

  await TestBed.configureTestingModule({ imports: [App] }).compileComponents();
  const bootStart = performance.now();
  const fixture = TestBed.createComponent(App);
  await fixture.whenStable();
  const bootMs = performance.now() - bootStart;

  const app = fixture.componentInstance;
  const appRef = TestBed.inject(ApplicationRef);
  const view = app.view as unknown as {
    shapeSheet: { set(image: HTMLImageElement): void };
    sprites: { get(texture: string): HTMLImageElement | null };
  };
  const image = loadedImage();
  view.shapeSheet.set(image);
  view.sprites.get = () => image;

  const canvas = (app as unknown as { viewport(): { nativeElement: HTMLCanvasElement } }).viewport().nativeElement;
  // jsdom no implementa la captura del puntero.
  canvas.setPointerCapture = () => undefined;
  canvas.releasePointerCapture = () => undefined;

  // Abrir el nivel: lo mismo que hace "Abrir" despues de leer el archivo.
  const openStart = performance.now();
  app.levels.adopt(level, null);
  app.view.frameAll();
  appRef.tick();
  const openMs = performance.now() - openStart;

  const harness: EditorHarness = {
    fixture,
    app,
    canvas,
    ctx,
    appRef,
    pointAt(cell, lift = 0) {
      const zoom = app.view.zoom();
      const pan = app.view.pan();
      const origin = { x: CANVAS.w / 2 + pan.x, y: 60 + pan.y };
      const point = cellToCanvas(cell, app.levels.level(), origin, zoom);
      return { x: point.x, y: point.y - lift * zoom };
    },
    pointer(type, point, init = {}) {
      canvas.dispatchEvent(
        new PointerEvent(type, { clientX: point.x, clientY: point.y, bubbles: true, pointerId: 1, ...init }),
      );
    },
    tick: () => appRef.tick(),
  };
  return { harness, bootMs, openMs };
}

/** Deshace los reemplazos de bootEditor. */
export function restoreEditorStubs(): void {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = undefined;
}

/**
 * Agarra una entidad (por defecto player_1, la del centro) con Seleccionar.
 * Se apunta un poco por encima del punto de la casilla, dentro del sprite,
 * como haria alguien con el mouse. Devuelve la casilla donde se la agarro.
 */
export function grab(h: EditorHarness, id = 'player_1'): { col: number; row: number } {
  const entity = h.app.levels.level().entities.find((candidate) => candidate.id === id);
  if (!entity) {
    throw new Error('No esta la entidad ' + id);
  }
  const start = { ...entity.position };
  h.pointer('pointerdown', h.pointAt(start, 4), { button: 0, buttons: 1 });
  h.tick();
  if (!h.app.view.moving()) {
    throw new Error('El pointerdown no agarro ninguna entidad');
  }
  return start;
}

/** Ida y vuelta entre casillas vecinas: cada paso cambia de celda, y cada 4 se vuelve al inicio. */
export function stepCell(start: { col: number; row: number }, i: number): { col: number; row: number } {
  const offsets = [
    { col: 1, row: 0 },
    { col: 1, row: 1 },
    { col: 0, row: 1 },
    { col: 0, row: 0 },
  ];
  const offset = offsets[i % offsets.length];
  return { col: start.col + offset.col, row: start.row + offset.row };
}

export interface DragMeasurement {
  drawCallsPerFrame: number;
  drawImagesPerFrame: number;
  /** Evento + deteccion de cambios: lo que tarda el editor en responder a un movimiento. */
  fullStep: Stats;
  breakdown: {
    /** El handler: celda bajo el cursor, limite de la grilla y updateEntity. */
    update: Stats;
    /** LevelHistoryService anota el paso, y la etiqueta "Deshacer: mover ..." que lee la barra. */
    history: Stats;
    /** Los computed de seleccion que se recalculan con el nivel nuevo. */
    selection: Stats;
    /** IsoCanvasRenderer.draw, el viewport entero, contra el contexto falso. */
    render: Stats;
    /** El resto del tick: la plantilla de App y los demas efectos (sin el dibujo). */
    restOfChangeDetection: Stats;
  };
  /** Mover el mouse SIN arrastrar: hit-test de entidades y redibujo (riesgo ED-07). */
  hoverStep: Stats;
  pointerDown: Stats;
  pointerUp: Stats;
}

/** El arrastre completo y su desglose, sobre el nivel ya abierto. */
export async function measureDrag(h: EditorHarness, iterations = 40, warmup = 5): Promise<DragMeasurement> {
  const app = h.app;
  const history = app.history as unknown as { flush(): void };
  const view = app.view as unknown as { draw(): void };
  const move = (cell: { col: number; row: number }) => h.pointer('pointermove', h.pointAt(cell, 4), { buttons: 1 });

  // --- Paso completo: evento + deteccion de cambios ---------------------------
  const start = grab(h);
  await nextTask();
  const fullStep = await measureAsync((i) => {
    move(stepCell(start, i));
    h.tick();
  }, iterations, warmup);
  h.ctx.reset();
  move(stepCell(start, 0));
  h.tick();
  const drawCallsPerFrame = h.ctx.calls;
  const drawImagesPerFrame = h.ctx.drawImages;
  await nextTask();

  // --- Desglose, pieza por pieza ----------------------------------------------
  const update: number[] = [];
  const historySamples: number[] = [];
  const selection: number[] = [];
  const render: number[] = [];
  const rest: number[] = [];
  for (let i = 0; i < warmup + iterations; i += 1) {
    const a = time(() => move(stepCell(start, i + 1))).ms;
    const b = time(() => {
      history.flush();
      app.history.undoLabel();
      app.undoText();
    }).ms;
    const c = time(() => {
      app.levels.selectedEntity();
      app.sel.selectedSet();
    }).ms;
    const d = time(() => view.draw()).ms;
    const e = time(() => h.tick()).ms;
    if (i >= warmup) {
      update.push(a);
      historySamples.push(b);
      selection.push(c);
      render.push(d);
      // El tick vuelve a dibujar (el efecto del dibujo sigue sucio): se descuenta.
      rest.push(Math.max(0, e - d));
    }
    await nextTask();
  }

  // Volver a la casilla de inicio y soltar: sin movimiento neto no hay dialogo.
  move(start);
  h.tick();
  await nextTask();
  h.pointer('pointerup', h.pointAt(start, 4), { button: 0 });
  h.tick();
  await nextTask();

  // --- Agarrar y soltar, como gestos sueltos --------------------------------
  const downs: number[] = [];
  const ups: number[] = [];
  for (let i = 0; i < 10; i += 1) {
    downs.push(time(() => grab(h)).ms);
    await nextTask();
    move(stepCell(start, 0));
    h.tick();
    await nextTask();
    move(start);
    h.tick();
    await nextTask();
    ups.push(
      time(() => {
        h.pointer('pointerup', h.pointAt(start, 4), { button: 0 });
        h.tick();
      }).ms,
    );
    await nextTask();
  }

  // --- Pasar el mouse sin arrastrar (cada movimiento redibuja: riesgo ED-07) --
  const hoverStep = await measureAsync((i) => {
    h.pointer('pointermove', h.pointAt(stepCell({ col: start.col - 2, row: start.row - 2 }, i), 4));
    h.tick();
  }, iterations, warmup);

  return {
    drawCallsPerFrame,
    drawImagesPerFrame,
    fullStep: stats(fullStep),
    breakdown: {
      update: stats(update),
      history: stats(historySamples),
      selection: stats(selection),
      render: stats(render),
      restOfChangeDetection: stats(rest),
    },
    hoverStep: stats(hoverStep),
    pointerDown: stats(downs),
    pointerUp: stats(ups),
  };
}

/**
 * Un modulo de Node pedido en tiempo de ejecucion. El nombre va en una
 * variable para que el compilador no intente resolver sus tipos: este archivo
 * tambien lo ve el tsconfig de la app, que no trae los de Node.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function nodeModule(name: string): Promise<any> {
  const specifier = 'node:' + name;
  return import(/* @vite-ignore */ specifier);
}

/** La maquina donde se midio, como la ve Node. */
export async function machineInfo(): Promise<Record<string, unknown>> {
  const os = await nodeModule('os');
  const cpus = os.cpus() as { model: string; speed: number }[];
  return {
    cpu: cpus[0]?.model.trim(),
    threads: cpus.length,
    mhz: cpus[0]?.speed,
    totalMemGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    platform: os.platform() + ' ' + os.release(),
    node: (globalThis as { process?: { version: string } }).process?.version,
  };
}

/** Con HC_PERF_OUT=<carpeta>, escribe <carpeta>/<name>.json con los numeros crudos. */
export async function writeReport(name: string, data: unknown): Promise<void> {
  const dir = env['HC_PERF_OUT'];
  if (!dir) {
    return;
  }
  const fs = await nodeModule('fs');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    dir + '/' + name + '.json',
    JSON.stringify({ generatedAt: new Date().toISOString(), machine: await machineInfo(), data }, null, 2),
  );
}
