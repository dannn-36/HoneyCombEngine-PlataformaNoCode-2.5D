import { Level, LevelEntity } from '../models/level.model';
import { describeLevelChange } from './level-diff';

const entity = (id: string, col = 0): LevelEntity => ({
  id,
  type: 'prop',
  position: { col, row: 0 },
  texture: 'textures/a.png',
  sourceRect: { x: 0, y: 0, width: 16, height: 16 },
});

const base: Level = {
  name: 'nivel',
  grid: { width: 10, height: 10, tileWidth: 64, tileHeight: 32 },
  entities: [entity('a'), entity('b')],
  events: [],
};

describe('describeLevelChange', () => {
  it('colocar y eliminar nombran la entidad', () => {
    const added = { ...base, entities: [...base.entities, entity('c')] };
    expect(describeLevelChange(base, added)).toBe('colocar c');
    expect(describeLevelChange(added, base)).toBe('eliminar c');
  });

  it('varias a la vez se cuentan', () => {
    expect(describeLevelChange(base, { ...base, entities: [] })).toBe('eliminar 2 entidades');
  });

  it('distingue mover de editar', () => {
    const [a, b] = base.entities;
    const moved = { ...base, entities: [{ ...a, position: { col: 3, row: 1 } }, b] };
    const edited = { ...base, entities: [{ ...a, scale: 2 }, b] };
    expect(describeLevelChange(base, moved)).toBe('mover a');
    expect(describeLevelChange(base, edited)).toBe('editar a');
  });

  it('cambiar el id en su lugar es renombrar; reemplazar en la celda no', () => {
    const [a, b] = base.entities;
    const renamed = { ...base, entities: [{ ...a, id: 'jefe' }, b] };
    const replaced = { ...base, entities: [b, entity('nuevo')] };
    expect(describeLevelChange(base, renamed)).toBe('renombrar a → jefe');
    expect(describeLevelChange(base, replaced)).toBe('reemplazar a');
  });

  it('fuera de las entidades, dice que parte del nivel cambio', () => {
    expect(describeLevelChange(base, { ...base, events: [] })).toBe('editar los eventos');
    expect(describeLevelChange(base, { ...base, rooms: [] })).toBe('editar el mapa');
    expect(describeLevelChange(base, { ...base, grid: { ...base.grid, width: 12 } })).toBe('cambiar la grilla');
    expect(describeLevelChange(base, { ...base, name: 'otro' })).toBe('renombrar el nivel');
  });
});
