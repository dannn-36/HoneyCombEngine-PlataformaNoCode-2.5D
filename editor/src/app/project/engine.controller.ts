import { inject, signal } from '@angular/core';

import type { EngineMode, EngineStart } from '../electron-api';
import { ProjectService } from '../services/project.service';

const STORAGE_KEY = 'honeycomb.engineMode';
const START_STORAGE_KEY = 'honeycomb.engineStart';

/** Los dos motores, con lo que cada uno es en palabras de quien lo usa. */
export const ENGINE_MODES: readonly { id: EngineMode; label: string; hint: string }[] = [
  {
    id: 'debug',
    label: 'Debug',
    hint: 'Debug: la versión de desarrollo. Sin optimizar, con herramientas de administrador en el juego (F3).',
  },
  {
    id: 'release',
    label: 'Release',
    hint: 'Release: optimizada, la versión que se juega. Sin herramientas de administrador.',
  },
];

/**
 * Donde arranca el juego al ejecutar: el nivel que se esta editando (para
 * probar) o la portada (el juego como terminado). Ver Configuración del juego.
 */
export const ENGINE_STARTS: readonly { id: EngineStart; label: string; hint: string }[] = [
  {
    id: 'level',
    label: 'Nivel',
    hint: 'Nivel: abre directo el nivel que estás editando, para probarlo rápido.',
  },
  {
    id: 'title',
    label: 'Portada',
    hint:
      'Portada: el juego completo, como terminado. Arranca en la portada y «Nueva partida» va al nivel inicial ' +
      '(Archivo › Configuración del juego).',
  },
];

function isEngineMode(value: unknown): value is EngineMode {
  return value === 'debug' || value === 'release';
}

/** El motor elegido la ultima vez. Sin almacenamiento (tests, modo privado), Debug. */
function storedMode(): EngineMode {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isEngineMode(value) ? value : 'debug';
  } catch {
    return 'debug';
  }
}

/** Donde se arranco la ultima vez. Sin almacenamiento, en el nivel: lo de siempre. */
function storedStart(): EngineStart {
  try {
    return globalThis.localStorage?.getItem(START_STORAGE_KEY) === 'title' ? 'title' : 'level';
  } catch {
    return 'level';
  }
}

/** Lo que el controlador del motor recibe del editor. */
export interface EngineDeps {
  /** Mensaje a la barra de estado y a la Consola. */
  note: (message: string) => void;
  /** Solo a la barra de estado: el avance de la compilacion. */
  status: (message: string) => void;
  /** Solo a la Consola: cada linea de la salida de CMake. */
  log: (line: string) => void;
  hasFileSystem: boolean;
}

/**
 * Con que motor se ejecuta el nivel: Debug (desarrollo, con F3) o Release
 * (optimizado). Ejecutar usa el elegido, y si todavia no esta compilado ofrece
 * compilarlo ahi mismo. Que es cada uno y donde vive: editor/ipc/engine-modes.js.
 *
 * Es un controlador y no un componente por la misma razon que
 * ItemEditorController: el markup vive en app.html para usar los estilos de
 * App (ver el comentario de cabecera de app.ts).
 */
export class EngineController {
  private readonly project = inject(ProjectService);

  readonly modes = ENGINE_MODES;

  readonly mode = signal<EngineMode>(storedMode());

  readonly starts = ENGINE_STARTS;

  /** Donde arranca el juego con Ejecutar y F5. Shift+F5 arranca en el otro. */
  readonly start = signal<EngineStart>(storedStart());

  /** Cuales estan compilados. null mientras no se sepa (sin disco, o antes de preguntar). */
  readonly compiled = signal<Record<EngineMode, boolean> | null>(null);

  /** El que se esta compilando, o null. */
  readonly building = signal<EngineMode | null>(null);

  /** "12/29" mientras compila: los pasos de ninja. */
  readonly progress = signal('');

  constructor(private readonly deps: EngineDeps) {}

  label(mode: EngineMode): string {
    return ENGINE_MODES.find((entry) => entry.id === mode)?.label ?? mode;
  }

  /** La explicacion del modo, y si le falta compilarse. */
  hint(mode: EngineMode): string {
    const base = ENGINE_MODES.find((entry) => entry.id === mode)?.hint ?? '';
    return this.compiled()?.[mode] === false ? base + ' Todavía no está compilada: se compila al ejecutar.' : base;
  }

  /** true solo si se sabe que no esta compilado (sin saberlo, no se marca nada). */
  isMissing(mode: EngineMode): boolean {
    return this.compiled()?.[mode] === false;
  }

  setMode(mode: EngineMode): void {
    this.mode.set(mode);
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, mode);
    } catch {
      // Sin almacenamiento la eleccion vale para esta sesion y nada mas.
    }
    this.deps.note('Motor: ' + this.hint(mode));
  }

  startLabel(start: EngineStart): string {
    return ENGINE_STARTS.find((entry) => entry.id === start)?.label ?? start;
  }

  startHint(start: EngineStart): string {
    return ENGINE_STARTS.find((entry) => entry.id === start)?.hint ?? '';
  }

  /** El arranque que no esta elegido: el de Shift+F5. */
  otherStart(): EngineStart {
    return this.start() === 'title' ? 'level' : 'title';
  }

  setStart(start: EngineStart): void {
    this.start.set(start);
    try {
      globalThis.localStorage?.setItem(START_STORAGE_KEY, start);
    } catch {
      // Sin almacenamiento la eleccion vale para esta sesion y nada mas.
    }
    this.deps.note('Al ejecutar: ' + this.startHint(start));
  }

  /** Vuelve a mirar que motores hay compilados. */
  async refresh(): Promise<void> {
    if (!this.deps.hasFileSystem) {
      return;
    }
    try {
      this.compiled.set(await this.project.engineStatus());
    } catch {
      this.compiled.set(null);
    }
  }

  /** Compila el motor de un modo. Devuelve si quedo compilado. */
  async build(mode: EngineMode = this.mode()): Promise<boolean> {
    if (!this.deps.hasFileSystem) {
      this.deps.note('Compilar el motor necesita el editor de escritorio.');
      return false;
    }
    if (this.building()) {
      this.deps.note('Ya se está compilando el motor ' + this.label(this.building() as EngineMode) + '.');
      return false;
    }
    this.building.set(mode);
    this.progress.set('');
    this.deps.note('Compilando el motor ' + this.label(mode) + '… La primera vez tarda unos minutos; el avance va en la Consola.');
    let result: { ok: boolean; error?: string };
    try {
      result = await this.project.buildEngine(mode, (line) => {
        const step = /^\[(\d+)\/(\d+)\]/.exec(line);
        if (step) {
          this.progress.set(step[1] + '/' + step[2]);
          this.deps.status('Compilando el motor ' + this.label(mode) + '… ' + step[1] + ' de ' + step[2]);
        }
        this.deps.log(line);
      });
    } catch (error) {
      result = { ok: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      this.building.set(null);
      this.progress.set('');
    }
    await this.refresh();
    this.deps.note(result.ok ? 'Motor ' + this.label(mode) + ' compilado.' : result.error ?? 'No se pudo compilar el motor.');
    return result.ok;
  }

  /**
   * Ejecuta un nivel ya guardado con el motor elegido. Si ese motor no esta
   * compilado, pregunta si compilarlo y, si se acepta, lo compila y ejecuta.
   * Arranca donde diga el selector (Nivel o Portada), salvo que se pida otro.
   */
  async launch(levelPath: string, start: EngineStart = this.start()): Promise<void> {
    const mode = this.mode();
    if (this.building()) {
      this.deps.note('Espera a que termine de compilar el motor ' + this.label(this.building() as EngineMode) + '.');
      return;
    }
    let result = await this.project.runLevel(levelPath, mode, start);
    if (!result.ok && result.missing) {
      const accepted = window.confirm(
        (result.error ?? 'Ese motor no está compilado.') + ' ¿Compilarlo ahora? La primera vez tarda unos minutos.',
      );
      if (!accepted) {
        this.deps.note(result.error ?? 'Ese motor no está compilado.');
        return;
      }
      if (!(await this.build(mode))) {
        return;
      }
      result = await this.project.runLevel(levelPath, mode, start);
    }
    this.deps.note(
      result.ok
        ? (start === 'title' ? 'Ejecutando el juego desde la portada' : 'Ejecutando ' + levelPath) +
          ' con el motor ' + this.label(mode) + (mode === 'debug' ? ' (F3: herramientas).' : '.')
        : result.error ?? 'No se pudo ejecutar el motor.',
    );
  }
}
