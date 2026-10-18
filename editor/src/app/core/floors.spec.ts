import { Level } from '../models/level.model';
import { buildLayout } from './dungeon-layout';
import { floorOverrides, floorTextureAt, levelForDisk, paintFloorCell } from './floors';

const FLOOR = { texture: 'textures/floor.png', sourceRect: { x: 0, y: 0, width: 64, height: 64 } };

/** Dos salas unidas por un tunel, con sus "tiles" ya generados como los deja el editor. */
function mapLevel(changes: Partial<Level> = {}): Level {
  const base: Level = {
    name: 'mapa',
    grid: { width: 10, height: 10, tileWidth: 64, tileHeight: 32 },
    entities: [],
    events: [],
    visuals: { floor: FLOOR },
    rooms: [
      { id: 'a', col: 1, row: 1, width: 3, height: 3 },
      { id: 'b', col: 8, row: 1, width: 3, height: 3 },
    ],
    tunnels: [{ id: 't', from: 'a', to: 'b', width: 1 }],
    ...changes,
  };
  const layout = buildLayout(base.grid, base.rooms ?? [], base.tunnels ?? [], []);
  return { ...base, grid: { ...base.grid, width: layout.width, height: layout.height }, tiles: layout.tiles };
}

describe('capas del piso', () => {
  it('sin capas, todo usa la del nivel', () => {
    const level = mapLevel();
    expect(floorOverrides(level).size).toBe(0);
    expect(floorTextureAt(level, 2, 2)).toBe('textures/floor.png');
  });

  it('la sala pisa al nivel, y gana sobre el tunel que entra en ella', () => {
    const level = mapLevel({
      rooms: [
        { id: 'a', col: 1, row: 1, width: 3, height: 3, floorTexture: 'textures/madera.png' },
        { id: 'b', col: 8, row: 1, width: 3, height: 3 },
      ],
      tunnels: [{ id: 't', from: 'a', to: 'b', width: 1, floorTexture: 'textures/pasto.png' }],
    });
    // El centro de "a" es donde arranca el tunel: manda la sala.
    expect(floorTextureAt(level, 2, 2)).toBe('textures/madera.png');
    // Entre las dos salas solo esta el tunel.
    expect(floorTextureAt(level, 5, 2)).toBe('textures/pasto.png');
    // "b" no dice nada: la del nivel, tambien en su centro, donde llega el tunel.
    expect(floorTextureAt(level, 10, 3)).toBe('textures/floor.png');
    expect(floorTextureAt(level, 9, 2)).toBe('textures/floor.png');
  });

  it('una casilla pintada pisa a su sala', () => {
    const level = mapLevel({
      rooms: [{ id: 'a', col: 1, row: 1, width: 3, height: 3, floorTexture: 'textures/madera.png' }],
      tunnels: [],
      floorPaint: [{ col: 2, row: 2, texture: 'textures/metal.png' }],
    });
    expect(floorTextureAt(level, 2, 2)).toBe('textures/metal.png');
    expect(floorTextureAt(level, 1, 1)).toBe('textures/madera.png');
  });
});

describe('paintFloorCell', () => {
  it('pinta, cambia y despinta una casilla', () => {
    const level = mapLevel();
    const painted = paintFloorCell(level, 2, 2, 'textures/metal.png');
    expect(painted).toEqual([{ col: 2, row: 2, texture: 'textures/metal.png' }]);
    const repainted = paintFloorCell({ ...level, floorPaint: painted }, 2, 2, 'textures/pasto.png');
    expect(repainted).toEqual([{ col: 2, row: 2, texture: 'textures/pasto.png' }]);
    expect(paintFloorCell({ ...level, floorPaint: repainted }, 2, 2, null)).toEqual([]);
  });

  it('pintar con lo que ya tiene debajo no guarda nada', () => {
    const level = mapLevel({
      rooms: [{ id: 'a', col: 1, row: 1, width: 3, height: 3, floorTexture: 'textures/madera.png' }],
      tunnels: [],
    });
    expect(paintFloorCell(level, 2, 2, 'textures/madera.png')).toEqual([]);
    expect(paintFloorCell(level, 6, 6, 'textures/floor.png')).toEqual([]);
  });
});

describe('levelForDisk', () => {
  it('sin capas no agrega nada al JSON', () => {
    const level = mapLevel();
    const disk = levelForDisk(level);
    expect(disk.visuals?.floorVariants).toBeUndefined();
    expect(disk.tiles?.some((tile) => tile.floorVariant !== undefined)).toBe(false);
  });

  it('resuelve las capas en indices sobre una lista de texturas', () => {
    const level = mapLevel({
      rooms: [
        { id: 'a', col: 1, row: 1, width: 3, height: 3, floorTexture: 'textures/madera.png' },
        { id: 'b', col: 8, row: 1, width: 3, height: 3 },
      ],
      floorPaint: [{ col: 9, row: 2, texture: 'textures/metal.png' }],
    });
    const disk = levelForDisk(level);
    const variants = disk.visuals?.floorVariants?.map((variant) => variant.texture);
    expect(variants?.sort()).toEqual(['textures/madera.png', 'textures/metal.png']);
    const tileAt = (col: number, row: number) => disk.tiles?.find((tile) => tile.col === col && tile.row === row);
    const textureAt = (col: number, row: number) => {
      const index = tileAt(col, row)?.floorVariant;
      return index === undefined ? 'nivel' : disk.visuals?.floorVariants?.[index].texture;
    };
    expect(textureAt(2, 2)).toBe('textures/madera.png');
    expect(textureAt(9, 2)).toBe('textures/metal.png');
    expect(textureAt(10, 3)).toBe('nivel');
    // Las paredes (sin piso) no llevan textura de piso.
    expect(tileAt(0, 0)?.floorVariant).toBeUndefined();
    // El piso del nivel queda igual.
    expect(disk.visuals?.floor).toEqual(FLOOR);
  });

  it('rehace lo resuelto en cada guardado: lo viejo no se arrastra', () => {
    const level = mapLevel({ floorPaint: [{ col: 2, row: 2, texture: 'textures/metal.png' }] });
    const saved = levelForDisk(level);
    // Se despinta y se vuelve a guardar sobre el nivel que vino del disco.
    const reopened = { ...saved, floorPaint: [] };
    const again = levelForDisk(reopened);
    expect(again.visuals?.floorVariants).toBeUndefined();
    expect(again.tiles?.some((tile) => tile.floorVariant !== undefined)).toBe(false);
    // Y guardar dos veces lo mismo da lo mismo.
    expect(levelForDisk(saved)).toEqual(saved);
  });

  it('un nivel de una sola grilla con pintura recibe sus tiles', () => {
    const level: Level = {
      name: 'simple',
      grid: { width: 4, height: 4, tileWidth: 64, tileHeight: 32 },
      entities: [],
      events: [],
      visuals: { floor: FLOOR },
      floorPaint: [{ col: 1, row: 1, texture: 'textures/metal.png' }],
    };
    const disk = levelForDisk(level);
    expect(disk.tiles?.length).toBe(16);
    expect(disk.tiles?.find((tile) => tile.col === 1 && tile.row === 1)?.floorVariant).toBe(0);
  });
});
