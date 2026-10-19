// Pruebas de las operaciones de edicion del nivel (LevelService).
//
// El servicio se arma a mano con un ProjectService de mentira que guarda en
// un mapa: asi se prueba tambien la ida y vuelta guardar -> abrir sin Electron.

import { cellState } from '../core/dungeon-layout';
import { floorTextureAt } from '../core/floors';
import { newItemDraft } from '../core/items';
import { Level, LevelEntity } from '../models/level.model';
import { LevelService } from './level.service';
import { ProjectService } from './project.service';
import { SelectionService } from './selection.service';

const GRID = { width: 10, height: 10, tileWidth: 64, tileHeight: 32 };

/** Un ProjectService que guarda los niveles como texto, igual que en disco. */
function fakeProject() {
  const disk = new Map<string, string>();
  const project = {
    saveLevel: vi.fn(async (fileName: string, level: Level) => {
      disk.set(fileName, JSON.stringify(level, null, 2));
    }),
    readLevel: vi.fn(async (fileName: string) => {
      const contents = disk.get(fileName);
      if (contents === undefined) {
        throw new Error('ENOENT: ' + fileName);
      }
      // El mismo camino que el ProjectService de verdad: el texto pasa por su parseLevel.
      return readThroughRealParser(contents);
    }),
  };
  return { project, disk };
}

/** Pasa el texto por el parseLevel real de ProjectService, con readFile apuntando a el. */
async function readThroughRealParser(contents: string): Promise<Level> {
  const previous = window.honeycombProject;
  window.honeycombProject = { readFile: async () => contents } as unknown as typeof window.honeycombProject;
  try {
    return await new ProjectService().readLevelAt('levels/x.json');
  } finally {
    window.honeycombProject = previous;
  }
}

function entity(id: string, col = 1, row = 1, changes: Partial<LevelEntity> = {}): LevelEntity {
  return {
    id,
    type: 'enemy',
    position: { col, row },
    texture: 'textures/enemy.png',
    sourceRect: { x: 0, y: 0, width: 16, height: 16 },
    ...changes,
  };
}

describe('LevelService', () => {
  let fake: ReturnType<typeof fakeProject>;
  let selection: SelectionService;
  let service: LevelService;

  beforeEach(() => {
    fake = fakeProject();
    selection = new SelectionService();
    service = new LevelService(fake.project as unknown as ProjectService, selection);
  });

  const level = () => service.level();

  describe('nivel nuevo', () => {
    it('arranca con una grilla de 10x10, sin entidades y con piso y pared por defecto', () => {
      expect(level().grid).toEqual(GRID);
      expect(level().entities).toEqual([]);
      expect(level().visuals?.floor?.texture).toBe('textures/floor.png');
      expect(level().visuals?.wall?.texture).toBe('textures/wall.png');
      expect(service.fileName()).toBeNull();
    });

    it('crear uno nuevo descarta el anterior, la seleccion y sube la generacion', () => {
      service.addEntity(entity('enemy_1'));
      selection.selectEntity('enemy_1');
      const generation = service.generation();
      service.createNew('otro', { width: 4, height: 6, tileWidth: 32, tileHeight: 16 });
      expect(level().name).toBe('otro');
      expect(level().grid).toEqual({ width: 4, height: 6, tileWidth: 32, tileHeight: 16 });
      expect(level().entities).toEqual([]);
      expect(selection.selectedEntityIds()).toEqual([]);
      expect(service.generation()).toBe(generation + 1);
    });

    it('dos niveles nuevos no comparten la grilla ni los visuales', () => {
      service.createNew('a');
      const first = level();
      service.createNew('b');
      service.updateGrid({ width: 20 });
      service.setLevelFloor('textures/pasto.png', { x: 0, y: 0, width: 32, height: 32 });
      expect(first.grid.width).toBe(10);
      expect(first.visuals?.floor?.texture).toBe('textures/floor.png');
      service.createNew('c');
      expect(level().grid.width).toBe(10);
    });

    it('cada edicion arma un nivel nuevo en vez de mutar el anterior', () => {
      const before = level();
      service.addEntity(entity('enemy_1'));
      expect(level()).not.toBe(before);
      expect(before.entities).toEqual([]);
    });
  });

  describe('guardar y abrir', () => {
    it('un nivel nunca guardado toma su nombre como archivo y queda asociado', async () => {
      service.createNew('mazmorra');
      await service.save();
      expect(service.fileName()).toBe('mazmorra.json');
      expect(fake.disk.has('mazmorra.json')).toBe(true);
      service.updateGrid({ width: 12 });
      await service.save();
      expect(fake.project.saveLevel).toHaveBeenLastCalledWith('mazmorra.json', expect.anything(), {});
    });

    it('guardar resuelve las capas del piso en lo que lee el motor', async () => {
      service.paintFloor([{ col: 3, row: 3 }], 'textures/metal.png');
      await service.save();
      const disk = JSON.parse(fake.disk.get('nuevo_nivel.json')!) as Level;
      expect(disk.visuals?.floorVariants).toEqual([{ texture: 'textures/metal.png' }]);
      expect(disk.tiles?.find((tile) => tile.col === 3 && tile.row === 3)?.floorVariant).toBe(0);
      // En memoria siguen solo las capas.
      expect(level().tiles).toBeUndefined();
    });

    it('abrir un nivel lo pone como el abierto, limpia la seleccion y sube la generacion', async () => {
      service.addEntity(entity('enemy_1'));
      await service.save();
      selection.selectEntity('enemy_1');
      service.createNew('otro');
      const generation = service.generation();
      await service.load('nuevo_nivel.json');
      expect(level().entities.map((e) => e.id)).toEqual(['enemy_1']);
      expect(service.fileName()).toBe('nuevo_nivel.json');
      expect(service.generation()).toBe(generation + 1);
      expect(selection.selectedEntityIds()).toEqual([]);
    });

    it('un nivel adoptado de fuera del proyecto no tiene archivo', () => {
      service.adopt({ name: 'suelto', grid: GRID, entities: [], events: [] }, null);
      expect(service.fileName()).toBeNull();
      expect(level().name).toBe('suelto');
    });

    it('abrir un archivo que no existe deja el nivel abierto como estaba', async () => {
      service.addEntity(entity('enemy_1'));
      const before = level();
      await expect(service.load('fantasma.json')).rejects.toThrow('ENOENT');
      expect(level()).toBe(before);
    });

    it('guardar y reabrir conserva entidades, eventos, mapa, zonas y objetos', async () => {
      service.addEntity(entity('enemy_1', 2, 2, { stats: { health: 5, damage: 1, speed: 1 } }));
      service.addRoom({ id: 'sala_2', col: 12, row: 2, width: 3, height: 3 }, { to: 'sala_1', width: 1 });
      service.addZone({ id: 'arena', col: 2, row: 2, width: 2, height: 2 });
      service.upsertItems([{ ...newItemDraft('coin'), id: 'moneda' }]);
      service.addEvent({ trigger: { type: 'on_start', params: {} }, actions: [] });
      const edited = level();
      await service.save();
      await service.load('nuevo_nivel.json');
      expect(level().entities).toEqual(edited.entities);
      expect(level().events).toEqual(edited.events);
      expect(level().rooms).toEqual(edited.rooms);
      expect(level().tunnels).toEqual(edited.tunnels);
      expect(level().tiles).toEqual(edited.tiles);
      expect(level().zones).toEqual(edited.zones);
      expect(level().items).toEqual(edited.items);
    });

    it('guardar y reabrir conserva la camara, la imagen de fondo y las casillas pintadas', async () => {
      service.updateCamera({ mode: 'follow', zoom: 3 });
      service.setBackgroundImage({ texture: 'textures/cielo.png', mode: 'stretch' });
      service.paintFloor([{ col: 2, row: 2 }], 'textures/metal.png');
      const edited = level();
      await service.save();
      await service.load('nuevo_nivel.json');
      expect(level().camera).toEqual(edited.camera);
      expect(level().backgroundImage).toEqual(edited.backgroundImage);
      expect(level().floorPaint).toEqual(edited.floorPaint);
    });
  });

  describe('camara y fondo', () => {
    it('la camara se guarda completa y en rango', () => {
      service.updateCamera({ mode: 'follow', zoom: 100, smoothing: Number.NaN });
      expect(level().camera).toEqual({
        mode: 'follow',
        zoom: 8,
        smoothing: 0.15,
        deadzone: { width: 0, height: 0 },
        clampToLevel: true,
        cullMargin: 2,
      });
    });

    it('cambiar un campo de la camara deja los demas como estaban', () => {
      service.updateCamera({ mode: 'follow', zoom: 2 });
      service.updateCamera({ cullMargin: 5 });
      expect(level().camera).toMatchObject({ mode: 'follow', zoom: 2, cullMargin: 5 });
    });

    it('volver a la camara de siempre quita el bloque', () => {
      service.updateCamera({ zoom: 2 });
      service.resetCamera();
      expect('camera' in level()).toBe(false);
    });

    it('poner y quitar la imagen de fondo', () => {
      const image = { texture: 'textures/cielo.png', mode: 'cover' as const };
      service.setBackgroundImage(image);
      expect(level().backgroundImage).toEqual(image);
      // Es una copia: cambiar el objeto de afuera no toca el nivel.
      image.texture = 'otra.png';
      expect(level().backgroundImage?.texture).toBe('textures/cielo.png');
      service.setBackgroundImage(null);
      expect('backgroundImage' in level()).toBe(false);
    });
  });

  describe('musica', () => {
    it('el volumen se guarda en porcentaje, recortado y redondeado; 100 no se escribe', () => {
      service.setMusic('sounds/tema.ogg');
      expect('musicVolume' in level()).toBe(false);
      service.setMusicVolume(42.6);
      expect(level().musicVolume).toBe(43);
      service.setMusicVolume(250);
      expect('musicVolume' in level()).toBe(false);
      service.setMusicVolume(-5);
      expect(level().musicVolume).toBe(0);
    });

    it('cambiar de musica conserva el volumen; quitarla lo quita tambien', () => {
      service.setMusic('sounds/a.ogg');
      service.setMusicVolume(60);
      service.setMusic('sounds/b.ogg');
      expect(level().musicVolume).toBe(60);
      service.setMusic(null);
      expect('music' in level()).toBe(false);
      expect('musicVolume' in level()).toBe(false);
    });
  });

  describe('entidades', () => {
    it('agregar, cambiar y borrar una entidad', () => {
      service.addEntity(entity('enemy_1'));
      service.addEntity(entity('enemy_2'));
      service.updateEntity('enemy_1', { position: { col: 5, row: 6 } });
      expect(level().entities[0].position).toEqual({ col: 5, row: 6 });
      expect(level().entities[1].position).toEqual({ col: 1, row: 1 });
      service.removeEntity('enemy_1');
      expect(level().entities.map((e) => e.id)).toEqual(['enemy_2']);
    });

    it('cambiar una entidad que no existe no cambia nada', () => {
      service.addEntity(entity('enemy_1'));
      service.updateEntity('nadie', { type: 'player' });
      expect(level().entities).toEqual([entity('enemy_1')]);
    });

    it('borrar varias las saca tambien de la seleccion', () => {
      service.addEntity(entity('a'));
      service.addEntity(entity('b'));
      service.addEntity(entity('c'));
      selection.selectEntities(['a', 'b', 'c']);
      service.removeEntities(['a', 'c']);
      expect(level().entities.map((e) => e.id)).toEqual(['b']);
      expect(selection.selectedEntityIds()).toEqual(['b']);
    });

    it('la entidad activa sigue a la seleccion y desaparece al borrarla', () => {
      service.addEntity(entity('a'));
      service.addEntity(entity('b'));
      selection.selectEntities(['a', 'b']);
      expect(service.selectedEntity()?.id).toBe('b');
      service.removeEntity('b');
      expect(service.selectedEntity()?.id).toBe('a');
      selection.selectEntity('inexistente');
      expect(service.selectedEntity()).toBeUndefined();
    });

    it('varios cambios de entidad se aplican de una sola vez', () => {
      service.addEntity(entity('puerta'));
      service.addEntity(entity('llave'));
      const before = level();
      service.applyEntityChanges([
        { id: 'puerta', changes: { hidden: true } },
        { id: 'llave', changes: { item: 'llave_roja' } },
        { id: 'nadie', changes: { hidden: true } },
      ]);
      expect(level().entities[0].hidden).toBe(true);
      expect(level().entities[1].item).toBe('llave_roja');
      expect(level().entities).toHaveLength(2);
      expect(before.entities[0].hidden).toBeUndefined();
    });
  });

  describe('piso y pared sin salas', () => {
    it('la primera celda tocada materializa la grilla con su borde de pared', () => {
      service.toggleTile(4, 4, 'wall');
      const tiles = level().tiles!;
      expect(tiles).toHaveLength(100);
      expect(cellState(tiles, 0, 0)).toEqual({ floor: true, wall: true });
      expect(cellState(tiles, 4, 4)).toEqual({ floor: true, wall: true });
      expect(cellState(tiles, 5, 5)).toEqual({ floor: true, wall: false });
    });

    it('tocar dos veces la misma celda la deja como estaba', () => {
      service.toggleTile(4, 4, 'floor');
      service.toggleTile(4, 4, 'floor');
      expect(cellState(level().tiles!, 4, 4)).toEqual({ floor: true, wall: false });
    });

    it('una celda fuera de la grilla se agrega en vez de perderse', () => {
      service.toggleTile(15, 15, 'wall');
      expect(level().tiles!.find((tile) => tile.col === 15 && tile.row === 15)).toEqual({
        col: 15,
        row: 15,
        floor: false,
        wall: true,
      });
    });

    it('un nivel viejo sin visuales los recibe al tocar una celda', () => {
      service.adopt({ name: 'viejo', grid: GRID, entities: [], events: [] }, 'viejo.json');
      service.toggleTile(2, 2, 'wall');
      expect(level().visuals?.wall?.texture).toBe('textures/wall.png');
    });

    it('un nivel con visuales propios los conserva', () => {
      const visuals = { floor: { texture: 'textures/piedra.png', sourceRect: { x: 0, y: 0, width: 8, height: 8 } } };
      service.adopt({ name: 'propio', grid: GRID, entities: [], events: [], visuals }, null);
      service.toggleTile(2, 2, 'wall');
      expect(level().visuals).toBe(visuals);
    });
  });

  describe('mapa de salas y tuneles', () => {
    it('agregar una sala convierte la grilla vieja en sala_1 y la une con un tunel', () => {
      service.addRoom({ id: 'sala_2', col: 12, row: 2, width: 3, height: 3 }, { to: 'sala_1', width: 2 });
      expect(level().rooms?.map((room) => room.id)).toEqual(['sala_1', 'sala_2']);
      expect(level().rooms?.[0]).toEqual({ id: 'sala_1', col: 1, row: 1, width: 8, height: 8 });
      expect(level().tunnels).toEqual([
        { id: 'tunel_1', from: 'sala_1', to: 'sala_2', width: 2, fromSide: undefined, toSide: undefined },
      ]);
      // La grilla crece para que entre la sala nueva con su pared.
      expect(level().grid.width).toBeGreaterThanOrEqual(16);
      expect(cellState(level().tiles!, 13, 3).floor).toBe(true);
    });

    it('una sala sin conexion no crea tuneles', () => {
      service.addRoom({ id: 'sala_2', col: 12, row: 2, width: 3, height: 3 }, null);
      expect(level().tunnels).toEqual([]);
    });

    it('conservar lo retocado a mano al pasar la grilla vieja a mapa', () => {
      service.toggleTile(4, 4, 'wall');
      service.addRoom({ id: 'sala_2', col: 12, row: 2, width: 3, height: 3 }, null);
      expect(cellState(level().tiles!, 4, 4).wall).toBe(true);
    });

    it('una sala a la izquierda o arriba del mapa corre todo lo demas', () => {
      service.addEntity(entity('enemy_1', 3, 3));
      service.addRoom({ id: 'sala_2', col: 1, row: 1, width: 2, height: 2 }, null);
      service.addRoom({ id: 'sala_3', col: -4, row: -2, width: 2, height: 2 }, null);
      const rooms = level().rooms!;
      expect(rooms.find((room) => room.id === 'sala_3')).toMatchObject({ col: 1, row: 1 });
      // Todo lo demas se corrio 5 columnas y 3 filas.
      expect(rooms.find((room) => room.id === 'sala_2')).toMatchObject({ col: 6, row: 4 });
      expect(level().entities[0].position).toEqual({ col: 8, row: 6 });
      // Ninguna celda queda en negativo.
      expect(level().tiles!.every((tile) => tile.col >= 0 && tile.row >= 0)).toBe(true);
    });

    it('mover una sala recalcula las celdas', () => {
      service.addRoom({ id: 'sala_2', col: 12, row: 2, width: 3, height: 3 }, null);
      service.updateRoom('sala_2', { col: 15 });
      expect(cellState(level().tiles!, 12, 2).floor).toBe(false);
      expect(cellState(level().tiles!, 16, 3).floor).toBe(true);
    });

    it('una sala con medidas rotas queda con numeros validos', () => {
      service.addRoom({ id: 'sala_2', col: 12, row: 2, width: 3, height: 3 }, null);
      service.updateRoom('sala_2', { width: 0, height: 2.6 });
      expect(level().rooms?.find((room) => room.id === 'sala_2')).toMatchObject({ width: 1, height: 3 });
    });

    it('mover una sala mas alla del borde de arriba corre el mapa', () => {
      service.addRoom({ id: 'sala_2', col: 12, row: 2, width: 3, height: 3 }, null);
      service.updateRoom('sala_2', { row: -3 });
      expect(level().rooms?.find((room) => room.id === 'sala_2')?.row).toBe(1);
      expect(level().rooms?.find((room) => room.id === 'sala_1')?.row).toBe(5);
    });

    it('mover una sala que no existe no cambia nada', () => {
      service.addRoom({ id: 'sala_2', col: 12, row: 2, width: 3, height: 3 }, null);
      const before = level();
      service.updateRoom('nadie', { col: 3 });
      expect(level()).toBe(before);
    });

    it('quitar una sala quita sus tuneles', () => {
      service.addRoom({ id: 'sala_2', col: 12, row: 2, width: 3, height: 3 }, { to: 'sala_1', width: 1 });
      service.addRoom({ id: 'sala_3', col: 12, row: 8, width: 3, height: 3 }, { to: 'sala_1', width: 1 });
      service.removeRoom('sala_2');
      expect(level().rooms?.map((room) => room.id)).toEqual(['sala_1', 'sala_3']);
      expect(level().tunnels?.map((tunnel) => tunnel.to)).toEqual(['sala_3']);
    });

    it('quitar la ultima sala vuelve a una sola grilla', () => {
      service.addRoom({ id: 'sala_2', col: 12, row: 2, width: 3, height: 3 }, null);
      service.removeRoom('sala_1');
      service.removeRoom('sala_2');
      expect(level().rooms).toBeUndefined();
      expect(level().tunnels).toBeUndefined();
      expect(level().tiles).toBeUndefined();
      expect(level().tileEdits).toBeUndefined();
    });

    it('agregar tuneles les da ids libres y un ancho de al menos 1', () => {
      service.addRoom({ id: 'sala_2', col: 12, row: 2, width: 3, height: 3 }, null);
      service.addTunnel({ from: 'sala_1', to: 'sala_2', width: 0 });
      service.addTunnel({ from: 'sala_1', to: 'sala_2', width: 2.7 });
      expect(level().tunnels?.map((tunnel) => [tunnel.id, tunnel.width])).toEqual([
        ['tunel_1', 1],
        ['tunel_2', 3],
      ]);
    });

    it('un tunel hacia una sala que no existe no rompe el mapa', () => {
      service.addRoom({ id: 'sala_2', col: 12, row: 2, width: 3, height: 3 }, null);
      const tiles = level().tiles;
      service.addTunnel({ from: 'sala_1', to: 'fantasma', width: 1 });
      expect(level().tiles).toEqual(tiles);
    });

    it('cambiar un tunel con una clave en undefined la borra', () => {
      service.addRoom({ id: 'sala_2', col: 12, row: 2, width: 3, height: 3 }, null);
      service.addTunnel({ from: 'sala_1', to: 'sala_2', width: 1, path: [{ col: 10, row: 3 }] });
      service.updateTunnel('tunel_1', { path: undefined, width: -4 });
      const tunnel = level().tunnels![0];
      expect(tunnel.path).toBeUndefined();
      expect(tunnel.width).toBe(1);
      expect(tunnel.id).toBe('tunel_1');
    });

    it('quitar un tunel deja de abrir su pasillo', () => {
      service.addRoom({ id: 'sala_2', col: 12, row: 2, width: 3, height: 3 }, { to: 'sala_1', width: 1 });
      const withTunnel = level().tiles!.filter((tile) => tile.floor !== false).length;
      service.removeTunnel('tunel_1');
      const without = level().tiles!.filter((tile) => tile.floor !== false).length;
      expect(without).toBeLessThan(withTunnel);
      expect(level().tunnels).toEqual([]);
    });

    it('un retoque con salas se guarda solo si cambia algo, y deshacerlo lo borra', () => {
      service.addRoom({ id: 'sala_2', col: 12, row: 2, width: 3, height: 3 }, null);
      service.toggleTile(3, 3, 'wall');
      expect(level().tileEdits).toEqual([{ col: 3, row: 3, wall: true }]);
      expect(cellState(level().tiles!, 3, 3).wall).toBe(true);
      service.toggleTile(3, 3, 'wall');
      expect(level().tileEdits).toEqual([]);
      expect(cellState(level().tiles!, 3, 3).wall).toBe(false);
    });

    it('los retoques sobreviven a mover otra sala', () => {
      service.addRoom({ id: 'sala_2', col: 12, row: 2, width: 3, height: 3 }, null);
      service.toggleTile(3, 3, 'floor');
      service.updateRoom('sala_2', { col: 14 });
      expect(cellState(level().tiles!, 3, 3).floor).toBe(false);
    });

    it('olvidar los retoques deja el mapa como lo generan las salas', () => {
      service.addRoom({ id: 'sala_2', col: 12, row: 2, width: 3, height: 3 }, null);
      const generated = level().tiles;
      service.toggleTile(3, 3, 'wall');
      service.toggleTile(4, 4, 'floor');
      service.clearTileEdits();
      expect(level().tileEdits).toEqual([]);
      expect(level().tiles).toEqual(generated);
    });

    it('achicar la grilla por debajo de las salas la vuelve a agrandar', () => {
      service.addRoom({ id: 'sala_2', col: 12, row: 2, width: 3, height: 3 }, null);
      const width = level().grid.width;
      service.updateGrid({ width: 2, height: 2 });
      expect(level().grid.width).toBe(width);
      expect(level().grid.height).toBeGreaterThanOrEqual(10);
    });

    it('sin salas la grilla toma el tamano pedido', () => {
      service.updateGrid({ width: 3, tileWidth: 128 });
      expect(level().grid).toEqual({ width: 3, height: 10, tileWidth: 128, tileHeight: 32 });
    });
  });

  describe('piso por capas', () => {
    beforeEach(() => {
      service.addRoom({ id: 'sala_2', col: 12, row: 2, width: 3, height: 3 }, { to: 'sala_1', width: 1 });
    });

    it('el piso del nivel cambia la textura de toda casilla sin capa propia', () => {
      service.setLevelFloor('textures/pasto.png', { x: 0, y: 0, width: 32, height: 32 });
      expect(level().visuals?.floor).toEqual({ texture: 'textures/pasto.png', sourceRect: { x: 0, y: 0, width: 32, height: 32 } });
      expect(level().visuals?.wall?.texture).toBe('textures/wall.png');
      expect(floorTextureAt(level(), 2, 2)).toBe('textures/pasto.png');
    });

    it('el piso de una sala pisa al del nivel y null se lo quita', () => {
      service.setRoomFloor('sala_2', 'textures/madera.png');
      expect(floorTextureAt(level(), 13, 3)).toBe('textures/madera.png');
      service.setRoomFloor('sala_2', null);
      expect('floorTexture' in level().rooms![1]).toBe(false);
      expect(floorTextureAt(level(), 13, 3)).toBe('textures/floor.png');
    });

    it('el piso de un tunel se pone y se quita', () => {
      service.setTunnelFloor('tunel_1', 'textures/pasto.png');
      expect(level().tunnels![0].floorTexture).toBe('textures/pasto.png');
      service.setTunnelFloor('tunel_1', null);
      expect('floorTexture' in level().tunnels![0]).toBe(false);
    });

    it('pintar y despintar casillas', () => {
      service.paintFloor(
        [
          { col: 2, row: 2 },
          { col: 3, row: 2 },
        ],
        'textures/metal.png',
      );
      expect(level().floorPaint).toHaveLength(2);
      service.paintFloor([{ col: 2, row: 2 }], null);
      expect(level().floorPaint).toEqual([{ col: 3, row: 2, texture: 'textures/metal.png' }]);
      service.paintFloor([{ col: 3, row: 2 }], null);
      expect(level().floorPaint).toBeUndefined();
    });

    it('pintar con la misma textura que ya tiene no guarda nada', () => {
      service.paintFloor([{ col: 2, row: 2 }], 'textures/floor.png');
      expect(level().floorPaint).toBeUndefined();
    });

    it('despintar todo vuelve al piso de las salas y del nivel', () => {
      service.paintFloor([{ col: 2, row: 2 }], 'textures/metal.png');
      service.clearFloorPaint();
      expect(level().floorPaint).toBeUndefined();
      expect(floorTextureAt(level(), 2, 2)).toBe('textures/floor.png');
    });
  });

  describe('eventos', () => {
    const event = (type: string) => ({ trigger: { type, params: {} }, actions: [] });

    it('se agregan al final y se cambian o borran por su posicion', () => {
      service.addEvent(event('on_start'));
      service.addEvents([event('on_collision'), event('on_entity_destroyed')]);
      service.updateEvent(1, { actions: [{ type: 'show_message', params: { text: 'hola' } }] });
      expect(level().events[1].actions).toHaveLength(1);
      expect(level().events[0].actions).toHaveLength(0);
      service.removeEvent(0);
      expect(level().events.map((e) => e.trigger.type)).toEqual(['on_collision', 'on_entity_destroyed']);
    });

    it('un indice fuera de rango no cambia nada', () => {
      service.addEvent(event('on_start'));
      service.updateEvent(5, { actions: [{ type: 'x', params: {} }] });
      service.removeEvent(-1);
      expect(level().events).toEqual([event('on_start')]);
    });
  });

  describe('objetos y zonas', () => {
    it('copiar un objeto al nivel reemplaza el que tenga el mismo id', () => {
      const coin = { ...newItemDraft('coin'), id: 'moneda' };
      service.upsertItems([coin]);
      service.upsertItems([{ ...coin, value: 5 }]);
      expect(level().items).toEqual([{ ...coin, value: 5 }]);
    });

    it('la copia del objeto no depende de la biblioteca', () => {
      const coin = { ...newItemDraft('coin'), id: 'moneda' };
      service.upsertItems([coin]);
      coin.name = 'cambiado';
      expect(level().items![0].name).toBe('Moneda');
    });

    it('las zonas se ajustan a enteros validos al cambiarlas', () => {
      service.addZone({ id: 'arena', col: 1, row: 1, width: 2, height: 2 });
      service.updateZone('arena', { col: -3, row: 2.4, width: 0, height: 3.6 });
      expect(level().zones).toEqual([{ id: 'arena', col: 0, row: 2, width: 1, height: 4 }]);
    });

    it('quitar la ultima zona quita la lista', () => {
      service.addZone({ id: 'a', col: 1, row: 1, width: 2, height: 2 });
      service.addZone({ id: 'b', col: 4, row: 4, width: 2, height: 2 });
      service.removeZone('a');
      expect(level().zones?.map((zone) => zone.id)).toEqual(['b']);
      service.removeZone('b');
      expect(level().zones).toBeUndefined();
    });
  });
});
