// Historial de deshacer y rehacer, sin Angular ni nivel: guarda ESTADOS
// enteros, no operaciones.
//
// Funciona porque el estado es inmutable (ver LevelService): cada cambio arma
// un objeto nuevo y comparte con el anterior todo lo que no toco. Guardar el
// nivel de antes no copia nada, es una referencia; cien pasos de historial
// cuestan lo que cambio en esos cien pasos, no cien niveles.
//
// PASOS Y GESTOS. Un arrastre cambia el nivel en cada movimiento del mouse, y
// escribir un nombre lo cambia en cada tecla. Deshacer eso de a un pixel o de a
// una letra no sirve, asi que cada cambio llega con la ACCION que lo causo (un
// clic, un arrastre, lo escrito en un campo) y los cambios seguidos de la
// misma accion se funden en un solo paso. Quien llama decide que es una
// accion; aca solo se compara.

/** Un paso que se puede deshacer: el estado de ANTES y la accion que lo cambio. */
interface Step<T> {
  state: T;
  action: string | null;
}

export class UndoHistory<T> {
  private past: Step<T>[] = [];
  private future: T[] = [];
  /** true despues de deshacer o rehacer: el cambio que sigue no se funde con nada. */
  private sealed = false;

  constructor(private readonly limit = 100) {}

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  /** El estado al que volveria deshacer, para describir el paso. */
  peekUndo(): T | undefined {
    return this.past.at(-1)?.state;
  }

  /** El estado al que llevaria rehacer. */
  peekRedo(): T | undefined {
    return this.future.at(-1);
  }

  /**
   * Anota que el estado cambio desde "before". Si el paso anterior fue de la
   * misma accion, ese paso ya guarda el estado de antes de la accion y no se
   * agrega otro. Un cambio nuevo borra lo que habia para rehacer.
   */
  record(before: T, action: string | null): void {
    const last = this.past.at(-1);
    const sameAction = !this.sealed && action !== null && last?.action === action;
    if (!sameAction) {
      this.past.push({ state: before, action });
      if (this.past.length > this.limit) {
        this.past.shift();
      }
    }
    this.sealed = false;
    this.future = [];
  }

  /** El estado anterior, o null si no hay. "current" queda para rehacer. */
  undo(current: T): T | null {
    const step = this.past.pop();
    if (!step) {
      return null;
    }
    this.future.push(current);
    this.sealed = true;
    return step.state;
  }

  /** El estado que se deshizo, o null si no hay. "current" vuelve a deshacerse. */
  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) {
      return null;
    }
    this.past.push({ state: current, action: null });
    this.sealed = true;
    return next;
  }

  clear(): void {
    this.past = [];
    this.future = [];
    this.sealed = false;
  }
}
