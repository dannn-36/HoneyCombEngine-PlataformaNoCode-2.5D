// Pruebas de deshacer y rehacer del nivel (LevelHistoryService).
//
// El servicio mira el nivel con un effect(): TestBed.tick() hace correr ese
// efecto, igual que la deteccion de cambios del editor despues de cada evento.
// Los gestos (un clic, lo escrito en un campo, un atajo) se simulan con los
// mismos eventos de ventana que escucha el servicio.

import { TestBed } from '@angular/core/testing';

import { LevelEntity } from '../models/level.model';
import { LevelHistoryService } from './level-history.service';
import { LevelService } from './level.service';
import { SelectionService } from './selection.service';

function entity(id: string, col = 1, row = 1): LevelEntity {
  return {
    id,
    type: 'enemy',
    position: { col, row },
    texture: 'textures/enemy.png',
    sourceRect: { x: 0, y: 0, width: 16, height: 16 },
  };
}

describe('LevelHistoryService', () => {
  let levels: LevelService;
  let selection: SelectionService;
  let history: LevelHistoryService;

  const click = () => window.dispatchEvent(new PointerEvent('pointerdown'));
  const key = (target: EventTarget = window) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));

  beforeEach(() => {
    TestBed.configureTestingModule({});
    levels = TestBed.inject(LevelService);
    selection = TestBed.inject(SelectionService);
    history = TestBed.inject(LevelHistoryService);
    TestBed.tick();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('un nivel recien abierto no tiene nada para deshacer ni rehacer', () => {
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);
    expect(history.undo()).toBeNull();
    expect(history.redo()).toBeNull();
    expect(history.undoLabel()).toBe('');
  });

  it('deshacer vuelve al nivel de antes y rehacer al de despues', () => {
    const before = levels.level();
    click();
    levels.addEntity(entity('enemy_1'));
    TestBed.tick();
    const after = levels.level();

    expect(history.undo()).toBe('colocar enemy_1');
    expect(levels.level()).toBe(before);
    expect(history.canRedo()).toBe(true);
    expect(history.redo()).toBe('colocar enemy_1');
    expect(levels.level()).toBe(after);
  });

  it('un cambio que el efecto todavia no vio tambien se deshace', () => {
    const before = levels.level();
    click();
    levels.addEntity(entity('enemy_1'));
    // Sin tick: Ctrl+Z llega antes que la deteccion de cambios.
    expect(history.canUndo()).toBe(true);
    expect(history.undo()).toBe('colocar enemy_1');
    expect(levels.level()).toBe(before);
  });

  it('un arrastre entero es un solo paso', () => {
    levels.addEntity(entity('enemy_1'));
    TestBed.tick();
    const placed = levels.level();

    click();
    for (let col = 2; col <= 6; col += 1) {
      levels.updateEntity('enemy_1', { position: { col, row: 1 } });
      TestBed.tick();
    }
    expect(history.undoLabel()).toBe('mover enemy_1');
    history.undo();
    expect(levels.level()).toBe(placed);
  });

  it('dos clics son dos pasos', () => {
    click();
    levels.addEntity(entity('a'));
    TestBed.tick();
    const first = levels.level();
    click();
    levels.addEntity(entity('b'));
    TestBed.tick();

    history.undo();
    expect(levels.level()).toBe(first);
    expect(history.canUndo()).toBe(true);
  });

  it('lo escrito en un campo se deshace entero, y otra visita al campo es otro paso', () => {
    levels.addEntity(entity('a'));
    TestBed.tick();
    const input = document.createElement('input');
    document.body.appendChild(input);

    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    for (const id of ['b', 'bo', 'bos']) {
      key(input);
      levels.updateEntity(levels.level().entities[0].id, { id });
      TestBed.tick();
    }
    const afterFirstVisit = levels.level();

    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    key(input);
    levels.updateEntity('bos', { id: 'boss' });
    TestBed.tick();

    expect(history.undo()).toBe('renombrar bos → boss');
    expect(levels.level()).toBe(afterFirstVisit);
    expect(history.undo()).toBe('renombrar a → bos');
    expect(levels.level().entities[0].id).toBe('a');
  });

  it('cada atajo de teclado es su propio paso', () => {
    levels.addEntity(entity('a'));
    TestBed.tick();
    key();
    levels.updateEntity('a', { position: { col: 2, row: 1 } });
    TestBed.tick();
    key();
    levels.updateEntity('a', { position: { col: 3, row: 1 } });
    TestBed.tick();

    history.undo();
    expect(levels.level().entities[0].position.col).toBe(2);
  });

  it('un cambio nuevo despues de deshacer borra lo que habia para rehacer', () => {
    click();
    levels.addEntity(entity('a'));
    TestBed.tick();
    history.undo();
    click();
    levels.addEntity(entity('b'));
    TestBed.tick();
    expect(history.canRedo()).toBe(false);
    expect(history.redo()).toBeNull();
  });

  it('abrir o crear un nivel vacia el historial', () => {
    click();
    levels.addEntity(entity('a'));
    TestBed.tick();
    levels.createNew('otro');
    TestBed.tick();
    expect(history.canUndo()).toBe(false);
    expect(history.undo()).toBeNull();
    expect(levels.level().name).toBe('otro');
  });

  it('sabe si el nivel es el guardado, tambien despues de deshacer hasta el', () => {
    expect(history.isClean()).toBe(true);
    click();
    levels.addEntity(entity('a'));
    TestBed.tick();
    expect(history.isClean()).toBe(false);
    history.undo();
    expect(history.isClean()).toBe(true);

    history.redo();
    history.markClean();
    expect(history.isClean()).toBe(true);
    history.undo();
    expect(history.isClean()).toBe(false);
  });

  it('deshacer saca de la seleccion las entidades que quita', () => {
    levels.addEntity(entity('a'));
    TestBed.tick();
    click();
    levels.addEntity(entity('b'));
    TestBed.tick();
    selection.selectEntities(['a', 'b']);
    history.undo();
    expect(selection.selectedEntityIds()).toEqual(['a']);
    expect(levels.selectedEntity()?.id).toBe('a');
  });

  it('las etiquetas dicen que haria cada boton', () => {
    click();
    levels.addEntity(entity('a'));
    TestBed.tick();
    click();
    levels.updateCamera({ zoom: 2 });
    TestBed.tick();
    expect(history.undoLabel()).toBe('cambiar la cámara');
    history.undo();
    expect(history.undoLabel()).toBe('colocar a');
    expect(history.redoLabel()).toBe('cambiar la cámara');
  });

  it('recuerda hasta 200 pasos y olvida los mas viejos', () => {
    for (let i = 0; i < 205; i += 1) {
      click();
      levels.updateGrid({ width: 11 + i });
      TestBed.tick();
    }
    let undone = 0;
    while (history.undo() !== null) {
      undone += 1;
    }
    expect(undone).toBe(200);
    // El nivel queda en el paso 5 (ancho 10 + 5), no en el original: esos ya se olvidaron.
    expect(levels.level().grid.width).toBe(15);
  });
});
