import { SelectionService } from './selection.service';

describe('SelectionService', () => {
  let selection: SelectionService;

  beforeEach(() => {
    selection = new SelectionService();
  });

  it('arranca sin nada seleccionado', () => {
    expect(selection.selectedEntityIds()).toEqual([]);
    expect(selection.selectedEntityId()).toBeNull();
  });

  it('elegir una entidad deja solo esa, y null no deja ninguna', () => {
    selection.selectEntities(['a', 'b']);
    selection.selectEntity('c');
    expect(selection.selectedEntityIds()).toEqual(['c']);
    selection.selectEntity(null);
    expect(selection.selectedEntityIds()).toEqual([]);
  });

  it('la activa es la ultima de la lista', () => {
    selection.selectEntities(['a', 'b', 'c']);
    expect(selection.selectedEntityId()).toBe('c');
  });

  it('la lista elegida es una copia de la que se paso', () => {
    const ids = ['a', 'b'];
    selection.selectEntities(ids);
    ids.push('c');
    expect(selection.selectedEntityIds()).toEqual(['a', 'b']);
  });

  it('shift+clic suma al final y pasa a ser la activa', () => {
    selection.selectEntity('a');
    selection.toggleEntitySelection('b');
    expect(selection.selectedEntityIds()).toEqual(['a', 'b']);
    expect(selection.selectedEntityId()).toBe('b');
  });

  it('shift+clic sobre una ya elegida la quita y la activa pasa a la anterior', () => {
    selection.selectEntities(['a', 'b']);
    selection.toggleEntitySelection('b');
    expect(selection.selectedEntityIds()).toEqual(['a']);
    expect(selection.selectedEntityId()).toBe('a');
    selection.toggleEntitySelection('a');
    expect(selection.selectedEntityId()).toBeNull();
  });

  it('olvidar entidades borradas deja las demas en su orden', () => {
    selection.selectEntities(['a', 'b', 'c', 'd']);
    selection.forget(new Set(['b', 'd', 'nadie']));
    expect(selection.selectedEntityIds()).toEqual(['a', 'c']);
  });

  it('vaciar la seleccion', () => {
    selection.selectEntities(['a', 'b']);
    selection.clear();
    expect(selection.selectedEntityIds()).toEqual([]);
    expect(selection.selectedEntityId()).toBeNull();
  });
});
