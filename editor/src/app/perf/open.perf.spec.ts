// =============================================================================
// Rendimiento: arrancar el editor y abrir los niveles reales de levels/.
// =============================================================================
//
// Arranque: crear App (todos sus controladores) hasta que queda estable, como
// app.spec.ts. Abrir: el camino de Proyecto › nivel (ProjectController.loadLevel):
// leer el archivo, JSON.parse, parseLevel, adoptarlo, encuadrarlo y dibujarlo.
// El disco es uno en memoria con el contenido real de cada archivo: queda
// afuera la lectura del disco y el viaje por IPC hasta el proceso principal.
//
// Igual que drag.perf.spec.ts, el dibujo va contra un contexto 2D que solo
// cuenta las llamadas (ver editor-harness.ts). En Electron, con canvas real,
// se mide con scripts/perf-editor.js.
//
// PRESUPUESTO. El plan pide <= 1 s para abrir un nivel. Los niveles del repo
// abren en decenas de ms; el limite queda en 1 s igual, que es el umbral de la
// metrica, con margen de sobra para una maquina lenta. El arranque en jsdom
// queda bajo 3 s (en la maquina de desarrollo, ~0,25 s la primera vez).

import { bootEditor, nodeModule, restoreEditorStubs, writeReport } from './editor-harness';
import { levelWithEntities, round, stats } from './perf-helpers';

const OPEN_BUDGET_MS = 1000;
const BOOT_BUDGET_MS = 3000;

describe('rendimiento: arrancar el editor y abrir los niveles reales', () => {
  afterEach(() => {
    restoreEditorStubs();
    delete (window as unknown as { honeycombProject?: unknown }).honeycombProject;
  });

  it('arranca y abre cada nivel de levels/ dentro del presupuesto', async () => {
    const fs = await nodeModule('fs');
    const path = await nodeModule('path');
    const dir = path.resolve('..', 'levels');
    const names: string[] = fs.readdirSync(dir).filter((name: string) => name.endsWith('.json'));
    expect(names.length).toBeGreaterThan(0);

    const { harness, bootMs } = await bootEditor(levelWithEntities(1));
    const files = new Map<string, string>(
      names.map((name) => ['levels/' + name, fs.readFileSync(path.join(dir, name), 'utf8')]),
    );
    // El disco se pone despues de arrancar: App ya decidio que no hay carpeta
    // del editor y no intenta listarla, pero abrir usa este readFile.
    (window as unknown as { honeycombProject: unknown }).honeycombProject = {
      readFile: async (relativePath: string) => {
        const contents = files.get(relativePath);
        if (contents === undefined) {
          throw new Error('ENOENT: ' + relativePath);
        }
        return contents;
      },
    };

    const rows: { name: string; bytes: number; entities: number; tiles: number; open: ReturnType<typeof stats> }[] = [];
    for (const name of names) {
      const samples: number[] = [];
      for (let i = 0; i < 6; i += 1) {
        const start = performance.now();
        await harness.app.proj.loadLevel(name);
        harness.tick();
        const elapsed = performance.now() - start;
        if (i > 0) {
          samples.push(elapsed);
        }
      }
      const level = harness.app.levels.level();
      expect(harness.app.levels.fileName()).toBe(name);
      rows.push({
        name,
        bytes: files.get('levels/' + name)?.length ?? 0,
        entities: level.entities.length,
        tiles: level.tiles?.length ?? 0,
        open: stats(samples),
      });
    }

    await writeReport('open-jsdom', { bootMs: round(bootMs, 1), levels: rows });

    expect(bootMs).toBeLessThan(BOOT_BUDGET_MS);
    for (const row of rows) {
      expect(row.open.median, row.name).toBeLessThan(OPEN_BUDGET_MS);
    }
  }, 60000);
});
