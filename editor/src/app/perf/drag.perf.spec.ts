// =============================================================================
// Rendimiento: arrastrar una entidad en el editor (metrica M-05, caso CP-17).
// =============================================================================
//
// QUE SE MIDE. El camino real de un movimiento del mouse sobre el canvas, con
// el editor entero armado (ver editor-harness.ts):
//
//   pointermove en el <canvas>  ->  ViewportController.onPointerMove
//     -> updateMove: celda bajo el cursor, limite de la grilla, updateEntity
//   tick de la deteccion de cambios que sigue al evento
//     -> efecto del historial (LevelHistoryService anota el paso)
//     -> efecto del dibujo (IsoCanvasRenderer.draw: el viewport entero)
//     -> plantilla de App (outliner, inspector, barra de estado...)
//
// y por separado cada pieza: actualizacion del nivel, historial, seleccion,
// dibujo y el resto de la deteccion de cambios. Tambien mover el mouse sin
// arrastrar (hit-test + redibujo), y agarrar y soltar.
//
// QUE NO SE MIDE. jsdom no tiene canvas: el contexto 2D es uno falso que
// recibe cada llamada y la cuenta. Queda AFUERA rasterizar (pintar pixeles),
// el layout y el pintado del navegador y la composicion en pantalla. Eso se
// mide en Electron con scripts/perf-editor.js.
//
// PRESUPUESTO. M-05 pide <= 100 ms por interaccion con 500 entidades (CP-17:
// 1000). Aca el limite es mas estricto: 50 ms de mediana y 80 ms de p95. La
// otra mitad de los 100 ms queda para lo que jsdom no incluye (rasterizar y
// presentar el cuadro). Y en la maquina de desarrollo el paso mide varias
// veces menos que eso, asi que el margen absorbe una maquina mas lenta o la
// corrida en paralelo con las demas pruebas sin fallar al azar: si falla, el
// arrastre se volvio varias veces mas caro.
//
// Con HC_PERF_OUT=<carpeta> los numeros crudos van a <carpeta>/drag-jsdom.json.

import { DragMeasurement, bootEditor, measureDrag, restoreEditorStubs, writeReport } from './editor-harness';
import { levelWithEntities } from './perf-helpers';

const SIZES = [100, 250, 500, 1000];

/** Presupuesto (ver la cabecera). */
const BUDGET_MEDIAN_MS = 50;
const BUDGET_P95_MS = 80;

interface DragReport extends DragMeasurement {
  entities: number;
  grid: string;
  bootMs: number;
  openMs: number;
}

describe('rendimiento: arrastrar una entidad (m-05)', () => {
  const reports: DragReport[] = [];

  afterEach(() => restoreEditorStubs());

  afterAll(async () => {
    await writeReport('drag-jsdom', reports);
  });

  for (const count of SIZES) {
    it(`responde a cada paso del arrastre dentro del presupuesto con ${count} entidades`, async () => {
      const level = levelWithEntities(count);
      const { harness, bootMs, openMs } = await bootEditor(level);
      const result = await measureDrag(harness);
      reports.push({ entities: count, grid: level.grid.width + 'x' + level.grid.height, bootMs, openMs, ...result });

      // Que se haya dibujado de verdad: una imagen por entidad como minimo.
      expect(result.drawImagesPerFrame).toBeGreaterThanOrEqual(count);
      // Y que el arrastre haya movido la entidad (el paso cambia de celda).
      expect(harness.app.history.canUndo()).toBe(true);

      if (count >= 500) {
        expect(result.fullStep.median).toBeLessThan(BUDGET_MEDIAN_MS);
        expect(result.fullStep.p95).toBeLessThan(BUDGET_P95_MS);
        expect(result.hoverStep.median).toBeLessThan(BUDGET_MEDIAN_MS);
      }
    }, 30000);
  }
});
