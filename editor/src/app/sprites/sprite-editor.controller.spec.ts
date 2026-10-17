import { TestBed } from '@angular/core/testing';

import { pixelAt } from '../core/sprite-doc';
import { SpriteEditorController, SpriteEditorDeps } from './sprite-editor.controller';

const NONE = { shift: false, alt: false };

describe('SpriteEditorController', () => {
  let notes: string[];
  let sprite: SpriteEditorController;

  beforeEach(() => {
    notes = [];
    const deps: SpriteEditorDeps = {
      note: (message) => notes.push(message),
      describe: (error) => String(error),
      ask: async () => null,
      reloadLibrary: async () => undefined,
      invalidateTextures: () => undefined,
      tile: () => ({ width: 64, height: 32 }),
      hasFileSystem: false,
    };
    sprite = TestBed.runInInjectionContext(() => new SpriteEditorController(deps));
    sprite.newSprite(4, 4);
  });

  /** El color de un pixel del cuadro al frente, como se ve. */
  function shown(x: number, y: number) {
    return pixelAt(sprite.composite()!, 4, x, y);
  }

  it('arranca con un sprite sin cambios', () => {
    expect(sprite.doc()?.width).toBe(4);
    expect(sprite.dirty()).toBe(false);
    expect(sprite.canUndo()).toBe(false);
  });

  it('el lapiz pinta, se ve mientras se arrastra, y se deshace y rehace', () => {
    sprite.pointerDown({ x: 0, y: 0 }, 'primary', NONE);
    sprite.pointerMove({ x: 2, y: 0 }, { shift: false });
    // Antes de soltar ya se ve, pero todavia no esta en el historial.
    expect(shown(1, 0).a).toBe(255);
    expect(sprite.canUndo()).toBe(false);
    sprite.pointerUp();
    expect(sprite.dirty()).toBe(true);
    expect(sprite.canUndo()).toBe(true);

    sprite.undo();
    expect(shown(1, 0).a).toBe(0);
    sprite.redo();
    expect(shown(1, 0).a).toBe(255);
  });

  it('el clic derecho pinta con el color secundario', () => {
    sprite.setColor('secondary', '#00ff00');
    sprite.pointerDown({ x: 1, y: 1 }, 'secondary', NONE);
    sprite.pointerUp();
    expect(shown(1, 1)).toEqual({ r: 0, g: 255, b: 0, a: 255 });
  });

  it('un trazo que no cambia nada no deja un paso de deshacer', () => {
    sprite.setTool('eraser');
    sprite.pointerDown({ x: 0, y: 0 }, 'primary', NONE);
    sprite.pointerUp();
    expect(sprite.canUndo()).toBe(false);
    expect(sprite.dirty()).toBe(false);
  });

  it('el balde rellena de una y Escape cancela un trazo a medias', () => {
    sprite.setTool('bucket');
    sprite.pointerDown({ x: 3, y: 3 }, 'primary', NONE);
    expect(shown(0, 0).a).toBe(255);

    sprite.setTool('eraser');
    sprite.pointerDown({ x: 0, y: 0 }, 'primary', NONE);
    sprite.onKeyDown(new KeyboardEvent('keydown', { key: 'Escape' }));
    sprite.pointerUp();
    expect(shown(0, 0).a).toBe(255);
  });

  it('el gotero (o Alt + clic) toma el color que se ve', () => {
    sprite.setColor('primary', '#123456');
    sprite.pointerDown({ x: 2, y: 2 }, 'primary', NONE);
    sprite.pointerUp();
    sprite.setColor('primary', '#000000');
    sprite.pointerDown({ x: 2, y: 2 }, 'primary', { shift: false, alt: true });
    sprite.pointerUp();
    expect(sprite.primaryHex()).toBe('#123456');
  });

  it('no pinta sobre una capa oculta y avisa por que', () => {
    sprite.toggleLayerVisible(sprite.activeLayerId());
    sprite.pointerDown({ x: 0, y: 0 }, 'primary', NONE);
    sprite.pointerUp();
    expect(notes.at(-1)).toContain('oculta');
  });

  it('sacar la capa elegida deja elegida otra que existe', () => {
    sprite.addLayer();
    const added = sprite.activeLayerId();
    sprite.removeLayer();
    expect(sprite.doc()?.layers.length).toBe(1);
    expect(sprite.activeLayerId()).not.toBe(added);
    expect(sprite.doc()?.layers.some((layer) => layer.id === sprite.activeLayerId())).toBe(true);
  });

  it('deshacer un cuadro nuevo vuelve a un cuadro que existe', () => {
    sprite.addFrame(false);
    expect(sprite.activeFrame()).toBe(1);
    sprite.undo();
    expect(sprite.doc()?.frames.length).toBe(1);
    expect(sprite.activeFrame()).toBe(0);
  });

  it('los atajos eligen herramienta, cambian el pincel e intercambian colores', () => {
    expect(sprite.onKeyDown(new KeyboardEvent('keydown', { key: 'g' }))).toBe(true);
    expect(sprite.tool()).toBe('bucket');
    sprite.onKeyDown(new KeyboardEvent('keydown', { key: ']' }));
    expect(sprite.brushSize()).toBe(2);
    const primary = sprite.primaryHex();
    sprite.onKeyDown(new KeyboardEvent('keydown', { key: 'x' }));
    expect(sprite.secondaryHex()).toBe(primary);
    // Una tecla que no es de la herramienta sigue de largo hacia el editor.
    expect(sprite.onKeyDown(new KeyboardEvent('keydown', { key: 'F5' }))).toBe(false);
  });

  it('encuadra al zoom entero mas grande que entra, centrado', () => {
    sprite.setHostSize(100, 100);
    sprite.fit();
    expect(sprite.zoom()).toBe(20);
    expect(sprite.offset()).toEqual({ x: 10, y: 10 });
  });
});
