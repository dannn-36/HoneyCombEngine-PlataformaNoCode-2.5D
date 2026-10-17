import { UndoHistory } from './undo-history';

describe('UndoHistory', () => {
  it('deshace y rehace de a un paso', () => {
    const history = new UndoHistory<string>();
    history.record('a', 'clic-1');
    history.record('b', 'clic-2');

    expect(history.undo('c')).toBe('b');
    expect(history.undo('b')).toBe('a');
    expect(history.undo('a')).toBeNull();
    expect(history.redo('a')).toBe('b');
    expect(history.redo('b')).toBe('c');
    expect(history.redo('c')).toBeNull();
  });

  it('los cambios de una misma accion (un arrastre) son un solo paso', () => {
    const history = new UndoHistory<string>();
    history.record('antes', 'arrastre-7');
    history.record('mitad', 'arrastre-7');
    history.record('casi', 'arrastre-7');

    expect(history.undo('final')).toBe('antes');
    expect(history.canUndo).toBe(false);
  });

  it('sin accion conocida, cada cambio es su propio paso', () => {
    const history = new UndoHistory<string>();
    history.record('a', null);
    history.record('b', null);
    expect(history.undo('c')).toBe('b');
  });

  it('un cambio nuevo borra lo que habia para rehacer', () => {
    const history = new UndoHistory<string>();
    history.record('a', 'x');
    history.undo('b');
    expect(history.canRedo).toBe(true);
    history.record('a', 'y');
    expect(history.canRedo).toBe(false);
  });

  it('despues de deshacer, la misma accion no se funde con el paso de antes', () => {
    const history = new UndoHistory<string>();
    history.record('a', 'campo-1');
    history.record('b', 'campo-2');
    expect(history.undo('c')).toBe('b');
    // Seguir escribiendo en el campo 1 tiene que poder deshacerse aparte.
    history.record('b', 'campo-1');
    expect(history.undo('d')).toBe('b');
    expect(history.undo('b')).toBe('a');
  });

  it('respeta el limite: se olvidan los pasos mas viejos', () => {
    const history = new UndoHistory<number>(3);
    for (let state = 0; state < 5; state += 1) {
      history.record(state, null);
    }
    expect(history.undo(5)).toBe(4);
    expect(history.undo(4)).toBe(3);
    expect(history.undo(3)).toBe(2);
    expect(history.undo(2)).toBeNull();
  });

  it('peek muestra a donde llevaria cada boton sin moverse', () => {
    const history = new UndoHistory<string>();
    history.record('a', null);
    expect(history.peekUndo()).toBe('a');
    history.undo('b');
    expect(history.peekRedo()).toBe('b');
    expect(history.peekUndo()).toBeUndefined();
  });
});
