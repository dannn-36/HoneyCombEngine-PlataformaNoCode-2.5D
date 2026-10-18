// Pruebas del puente con el disco (ProjectService).
//
// window.honeycombProject se reemplaza por un proyecto en memoria: un mapa de
// ruta -> contenido, con los mismos errores que devuelve el proceso principal
// (un archivo que no existe llega como un Error con "ENOENT" en el mensaje).
// Lo que importa aca es la ida y vuelta: lo que se guarda tiene que volver
// igual al abrirlo.

import { HoneycombProjectApi, OpenLevelResult, ProjectNode } from '../electron-api';
import { defaultGameConfig } from '../core/game-config';
import { levelForDisk } from '../core/floors';
import { newItemDraft } from '../core/items';
import { Level } from '../models/level.model';
import {
  CHARACTERS_FILE,
  GAME_FILE,
  ITEMS_FILE,
  LevelChangedOnDiskError,
  ProjectService,
  SAVE_FILE,
} from './project.service';

/** Un proyecto de mentira: archivos en memoria y el resto de la API grabando las llamadas. */
function fakeProject() {
  const files = new Map<string, string>();
  const tree = new Map<string, ProjectNode[]>();
  let openResult: OpenLevelResult = { canceled: true };
  const buildListeners: ((line: string) => void)[] = [];

  const enoent = (path: string) =>
    new Error(`Error invoking remote method 'project:readFile': Error: ENOENT: no such file or directory, open '${path}'`);

  const api: HoneycombProjectApi = {
    open: vi.fn(async () => openResult),
    workspaceInfo: vi.fn(async () => ({ root: 'C:/proyecto', seeded: ['levels/test_level.json'] })),
    changeWorkspace: vi.fn(async () => null),
    revealWorkspace: vi.fn(async () => undefined),
    readEventCatalog: vi.fn(async () => JSON.stringify({ triggers: [], conditions: [], actions: [] })),
    ensureRoot: vi.fn(async () => 'C:/proyecto'),
    createDir: vi.fn(async () => undefined),
    readFile: vi.fn(async (path: string) => {
      const contents = files.get(path);
      if (contents === undefined) {
        throw enoent(path);
      }
      return contents;
    }),
    writeFile: vi.fn(async (path: string, contents: string) => {
      files.set(path, contents);
    }),
    listDir: vi.fn(async (dir: string) =>
      [...files.keys()]
        .filter((path) => path.startsWith(dir + '/') && !path.slice(dir.length + 1).includes('/'))
        .map((path) => path.slice(dir.length + 1)),
    ),
    listEntries: vi.fn(async (dir: string) => tree.get(dir) ?? []),
    readFileData: vi.fn(async () => ({ kind: 'binary' as const, size: 10, reason: 'unsupported' as const })),
    beginConvert: vi.fn(async () => null),
    readConvertImage: vi.fn(async () => 'data:image/png;base64,AAAA'),
    writeConvertedImage: vi.fn(async () => ({ target: 'foto.png' })),
    resetConvert: vi.fn(async () => undefined),
    writeTexture: vi.fn(async (name: string) => ({ status: 'written' as const, target: name + '.png' })),
    run: vi.fn(async () => ({ ok: true, executable: 'engine.exe' })),
    clearSave: vi.fn(async () => {
      files.delete(SAVE_FILE);
    }),
    exportGame: vi.fn(async (startLevel: string | null) => ({ ok: true, folder: 'D:/Juego', startLevel })),
    revealExport: vi.fn(async () => undefined),
    engineStatus: vi.fn(async () => ({ debug: true, release: false })),
    buildEngine: vi.fn(async () => {
      for (const listener of buildListeners) {
        listener('-- Build files have been written');
        listener('[100%] Built target engine');
      }
      return { ok: true };
    }),
    onEngineBuildLog: vi.fn((callback: (line: string) => void) => {
      buildListeners.push(callback);
      return () => buildListeners.splice(buildListeners.indexOf(callback), 1);
    }),
  };

  return {
    api,
    files,
    tree,
    buildListeners,
    setOpenResult: (result: OpenLevelResult) => (openResult = result),
  };
}

const GRID = { width: 10, height: 10, tileWidth: 64, tileHeight: 32 };
const FLOOR = { texture: 'textures/floor.png', sourceRect: { x: 0, y: 0, width: 64, height: 64 } };
const WALL = { texture: 'textures/wall.png', sourceRect: { x: 0, y: 0, width: 32, height: 32 } };

/** Un nivel con todo lo que el editor sabe guardar. */
function fullLevel(): Level {
  return {
    name: 'mazmorra',
    backgroundColor: { r: 12, g: 20, b: 30 },
    backgroundImage: { texture: 'textures/cielo.png', mode: 'tile' },
    camera: {
      mode: 'follow',
      zoom: 2,
      smoothing: 0.3,
      deadzone: { width: 40, height: 20 },
      clampToLevel: false,
      cullMargin: 4,
    },
    grid: GRID,
    entities: [
      {
        id: 'player_1',
        type: 'player',
        position: { col: 2, row: 2 },
        texture: 'textures/player.png',
        sourceRect: { x: 0, y: 0, width: 16, height: 16 },
        stats: { health: 100, damage: 10, speed: 3 },
      },
    ],
    events: [
      {
        trigger: { type: 'on_entity_destroyed', params: { entity: 'enemy_1' } },
        actions: [{ type: 'load_level', params: { level: 'nivel_2.json' } }],
      },
    ],
    visuals: { floor: FLOOR, wall: WALL },
    tiles: [
      { col: 1, row: 1 },
      { col: 2, row: 1, wall: true, floor: false },
    ],
    floorPaint: [{ col: 1, row: 1, texture: 'textures/metal.png' }],
    rooms: [{ id: 'sala_1', col: 1, row: 1, width: 3, height: 3, floorTexture: 'textures/madera.png' }],
    tunnels: [],
    tileEdits: [{ col: 3, row: 3, wall: true }],
    zones: [{ id: 'arena', col: 2, row: 2, width: 2, height: 2 }],
    items: [{ ...newItemDraft('coin'), id: 'moneda' }],
  };
}

describe('ProjectService', () => {
  let fake: ReturnType<typeof fakeProject>;
  let service: ProjectService;

  beforeEach(() => {
    fake = fakeProject();
    window.honeycombProject = fake.api;
    service = new ProjectService();
  });

  afterEach(() => {
    delete (window as Partial<Window>).honeycombProject;
  });

  describe('abrir un nivel', () => {
    it('un archivo que no es json da un error entendible con su nombre', async () => {
      fake.files.set('levels/roto.json', '{ "grid": ');
      await expect(service.readLevel('roto.json')).rejects.toThrow('"levels/roto.json" no es un JSON valido.');
    });

    it('un json que no es un nivel avisa que le falta la grilla', async () => {
      fake.files.set('levels/otro.json', JSON.stringify({ presets: [] }));
      await expect(service.readLevel('otro.json')).rejects.toThrow('le falta "grid"');
    });

    it('una grilla con medidas que no son numeros se rechaza', async () => {
      fake.files.set('levels/a.json', JSON.stringify({ grid: { width: '10', height: 10, tileWidth: 64, tileHeight: 32 } }));
      await expect(service.readLevel('a.json')).rejects.toThrow('le falta "grid"');
      fake.files.set('levels/b.json', JSON.stringify({ grid: { width: 10, height: 10, tileWidth: 64 } }));
      await expect(service.readLevel('b.json')).rejects.toThrow('le falta "grid"');
    });

    it('el json null o un numero suelto no rompen la lectura', async () => {
      fake.files.set('levels/null.json', 'null');
      await expect(service.readLevel('null.json')).rejects.toThrow('le falta "grid"');
      fake.files.set('levels/num.json', '42');
      await expect(service.readLevel('num.json')).rejects.toThrow('le falta "grid"');
    });

    it('un nivel minimo con solo la grilla se completa con listas vacias', async () => {
      fake.files.set('levels/min.json', JSON.stringify({ grid: GRID }));
      const level = await service.readLevel('min.json');
      expect(level.name).toBe('nivel');
      expect(level.entities).toEqual([]);
      expect(level.events).toEqual([]);
      expect(level.zones).toBeUndefined();
      expect(level.items).toBeUndefined();
    });

    it('entidades o eventos que no son listas se toman como vacios', async () => {
      fake.files.set('levels/mal.json', JSON.stringify({ name: 7, grid: GRID, entities: {}, events: 'x', zones: 3, items: {} }));
      const level = await service.readLevel('mal.json');
      expect(level.name).toBe('nivel');
      expect(level.entities).toEqual([]);
      expect(level.events).toEqual([]);
      expect(level.zones).toBeUndefined();
      expect(level.items).toBeUndefined();
    });

    it('un nivel viejo escrito a mano se abre tal cual, sin inventar bloques', async () => {
      const old = {
        name: 'test_level',
        grid: GRID,
        visuals: { floor: FLOOR, wall: WALL },
        entities: fullLevel().entities,
        events: fullLevel().events,
      };
      fake.files.set('levels/test_level.json', JSON.stringify(old));
      const level = await service.readLevel('test_level.json');
      expect(level.name).toBe('test_level');
      expect(level.visuals).toEqual(old.visuals);
      expect(level.entities).toEqual(old.entities);
      expect(level.rooms).toBeUndefined();
      expect(level.tiles).toBeUndefined();
      expect(level.camera).toBeUndefined();
    });

    it('los objetos del nivel se normalizan al abrir', async () => {
      fake.files.set(
        'levels/obj.json',
        JSON.stringify({ grid: GRID, items: [{ id: 'cura', kind: 'healing', heal: -5, name: '  Poción  ' }] }),
      );
      const level = await service.readLevel('obj.json');
      expect(level.items).toHaveLength(1);
      expect(level.items![0]).toMatchObject({ id: 'cura', kind: 'healing', name: 'Poción', heal: 0 });
    });

    it('readLevelAt lee la ruta completa y no solo dentro de levels/', async () => {
      fake.files.set('mundos/norte/a.json', JSON.stringify({ name: 'a', grid: GRID }));
      expect((await service.readLevelAt('mundos/norte/a.json')).name).toBe('a');
      expect(fake.api.readFile).toHaveBeenCalledWith('mundos/norte/a.json');
    });

    it('un nivel que no existe propaga el error del disco', async () => {
      await expect(service.readLevel('fantasma.json')).rejects.toThrow('ENOENT');
    });
  });

  describe('guardar y volver a abrir', () => {
    it('se escribe en levels/ con sangria de dos espacios', async () => {
      await service.saveLevel('a.json', { name: 'a', grid: GRID, entities: [], events: [] });
      const text = fake.files.get('levels/a.json')!;
      expect(text.split('\n')[1]).toBe('  "name": "a",');
    });

    it('vuelven iguales la grilla, las entidades, los eventos, el mapa, las zonas y los objetos', async () => {
      const level = fullLevel();
      await service.saveLevel('mazmorra.json', level);
      const back = await service.readLevel('mazmorra.json');
      expect(back.name).toBe(level.name);
      expect(back.backgroundColor).toEqual(level.backgroundColor);
      expect(back.grid).toEqual(level.grid);
      expect(back.entities).toEqual(level.entities);
      expect(back.events).toEqual(level.events);
      expect(back.visuals).toEqual(level.visuals);
      expect(back.tiles).toEqual(level.tiles);
      expect(back.rooms).toEqual(level.rooms);
      expect(back.tunnels).toEqual(level.tunnels);
      expect(back.tileEdits).toEqual(level.tileEdits);
      expect(back.zones).toEqual(level.zones);
      expect(back.items).toEqual(level.items);
    });

    it('un nivel sin bloques opcionales no gana claves al reabrirlo', async () => {
      const level: Level = { name: 'vacio', grid: GRID, entities: [], events: [] };
      await service.saveLevel('vacio.json', level);
      const back = await service.readLevel('vacio.json');
      // JSON.stringify descarta los undefined: el archivo queda igual de corto.
      expect(JSON.parse(JSON.stringify(back))).toEqual(level);
    });

    it('la camara vuelve igual al reabrir el nivel', async () => {
      await service.saveLevel('mazmorra.json', fullLevel());
      const back = await service.readLevel('mazmorra.json');
      expect(back.camera).toEqual(fullLevel().camera);
    });

    it('la imagen de fondo vuelve igual al reabrir el nivel', async () => {
      await service.saveLevel('mazmorra.json', fullLevel());
      const back = await service.readLevel('mazmorra.json');
      expect(back.backgroundImage).toEqual({ texture: 'textures/cielo.png', mode: 'tile' });
    });

    it('las casillas pintadas vuelven iguales al reabrir el nivel', async () => {
      await service.saveLevel('mazmorra.json', fullLevel());
      const back = await service.readLevel('mazmorra.json');
      expect(back.floorPaint).toEqual(fullLevel().floorPaint);
    });

    it('un campo que el editor no conoce vuelve igual al reabrir el nivel', async () => {
      fake.files.set('levels/futuro.json', JSON.stringify({ name: 'f', grid: GRID, weather: { rain: true } }));
      const back = (await service.readLevel('futuro.json')) as Level & { weather?: unknown };
      expect(back.weather).toEqual({ rain: true });
    });

    it('un bloque opcional con forma rota se descarta al abrir', async () => {
      fake.files.set(
        'levels/roto.json',
        JSON.stringify({ name: 'r', grid: GRID, camera: 'follow', backgroundImage: { mode: 'tile' }, floorPaint: {} }),
      );
      const back = await service.readLevel('roto.json');
      expect(back.camera).toBeUndefined();
      expect(back.backgroundImage).toBeUndefined();
      expect(back.floorPaint).toBeUndefined();
    });

    it('reabrir y volver a guardar no cambia lo que lee el motor', async () => {
      const level: Level = {
        name: 'pintado',
        grid: GRID,
        entities: [],
        events: [],
        visuals: { floor: FLOOR, wall: WALL },
        floorPaint: [{ col: 4, row: 4, texture: 'textures/metal.png' }],
      };
      await service.saveLevel('pintado.json', levelForDisk(level));
      const firstSave = fake.files.get('levels/pintado.json');
      const reopened = await service.readLevel('pintado.json');
      await service.saveLevel('pintado.json', levelForDisk(reopened));
      expect(fake.files.get('levels/pintado.json')).toBe(firstSave);
    });

    it('el nivel completo vuelve identico al reabrirlo', async () => {
      const level = fullLevel();
      await service.saveLevel('mazmorra.json', level);
      const back = await service.readLevel('mazmorra.json');
      expect(JSON.parse(JSON.stringify(back))).toEqual(level);
    });
  });

  describe('un nivel que cambio en el disco por fuera', () => {
    const level = (name: string): Level => ({ name, grid: GRID, entities: [], events: [] });

    it('guardar encima de un nivel que cambio desde que se abrio falla sin escribir', async () => {
      fake.files.set('levels/a.json', JSON.stringify(level('original')));
      await service.readLevel('a.json');
      fake.files.set('levels/a.json', JSON.stringify(level('de otro programa')));

      const error = await service.saveLevel('a.json', level('del editor')).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(LevelChangedOnDiskError);
      expect((error as LevelChangedOnDiskError).relativePath).toBe('levels/a.json');
      expect(JSON.parse(fake.files.get('levels/a.json')!).name).toBe('de otro programa');
    });

    it('con overwrite lo reemplaza igual', async () => {
      fake.files.set('levels/a.json', JSON.stringify(level('original')));
      await service.readLevel('a.json');
      fake.files.set('levels/a.json', JSON.stringify(level('de otro programa')));

      await service.saveLevel('a.json', level('del editor'), { overwrite: true });
      expect(JSON.parse(fake.files.get('levels/a.json')!).name).toBe('del editor');
    });

    it('guardar dos veces seguidas no se toma por un cambio de afuera', async () => {
      await service.saveLevel('b.json', level('uno'));
      await service.saveLevel('b.json', level('dos'));
      expect(JSON.parse(fake.files.get('levels/b.json')!).name).toBe('dos');
    });

    it('un nivel que se borro por fuera se vuelve a escribir sin preguntar', async () => {
      fake.files.set('levels/c.json', JSON.stringify(level('original')));
      await service.readLevel('c.json');
      fake.files.delete('levels/c.json');

      await service.saveLevel('c.json', level('del editor'));
      expect(JSON.parse(fake.files.get('levels/c.json')!).name).toBe('del editor');
    });

    it('un nivel que el editor nunca leyo se escribe sin mirar el disco', async () => {
      fake.files.set('levels/d.json', JSON.stringify(level('ajeno')));
      await service.saveLevel('d.json', level('del editor'));
      expect(JSON.parse(fake.files.get('levels/d.json')!).name).toBe('del editor');
    });
  });

  describe('abrir con el dialogo del sistema', () => {
    it('cancelar devuelve null y no lee nada', async () => {
      expect(await service.openLevelFile()).toBeNull();
    });

    it('devuelve la ruta relativa, el nivel ya leido y lo que se importo', async () => {
      const imported = { from: 'D:/otro/a.json', fileName: 'a.json', copied: 2, kept: 1, missing: ['textures/x.png'] };
      fake.setOpenResult({
        canceled: false,
        relativePath: 'levels/a.json',
        contents: JSON.stringify({ name: 'a', grid: GRID }),
        imported,
      });
      const result = await service.openLevelFile();
      expect(result?.relativePath).toBe('levels/a.json');
      expect(result?.level.name).toBe('a');
      expect(result?.imported).toEqual(imported);
    });

    it('un archivo elegido que no es un nivel falla con su ruta', async () => {
      fake.setOpenResult({ canceled: false, relativePath: 'levels/foto.json', contents: '[]' });
      await expect(service.openLevelFile()).rejects.toThrow('"levels/foto.json" no parece un nivel');
    });
  });

  describe('lista de niveles', () => {
    it('solo cuenta los .json de levels/', async () => {
      fake.files.set('levels/a.json', '{}');
      fake.files.set('levels/notas.txt', '');
      fake.files.set('levels/b.json', '{}');
      fake.files.set('assets/c.json', '{}');
      expect((await service.listLevels()).sort()).toEqual(['a.json', 'b.json']);
    });

    it('sin niveles devuelve una lista vacia', async () => {
      expect(await service.listLevels()).toEqual([]);
    });
  });

  describe('personajes configurados', () => {
    it('sin characters.json es una lista vacia, no un error', async () => {
      expect(await service.readCharacterPresets()).toEqual([]);
    });

    it('otro fallo de lectura se informa para no pisar el archivo', async () => {
      vi.mocked(fake.api.readFile).mockRejectedValueOnce(new Error('EACCES: permiso denegado'));
      await expect(service.readCharacterPresets()).rejects.toThrow('EACCES');
    });

    it('un characters.json roto se informa', async () => {
      fake.files.set(CHARACTERS_FILE, '{ presets: ');
      await expect(service.readCharacterPresets()).rejects.toThrow(`${CHARACTERS_FILE} no es un JSON valido.`);
    });

    it('un archivo sin la lista de presets es una lista vacia', async () => {
      fake.files.set(CHARACTERS_FILE, JSON.stringify({ otra: 1 }));
      expect(await service.readCharacterPresets()).toEqual([]);
      fake.files.set(CHARACTERS_FILE, 'null');
      expect(await service.readCharacterPresets()).toEqual([]);
    });

    it('guardar y leer devuelve los mismos personajes, ya normalizados', async () => {
      fake.files.set(CHARACTERS_FILE, JSON.stringify({ presets: [{ name: '  Orco ', kind: 'enemy', scale: -1 }] }));
      const [orco] = await service.readCharacterPresets();
      expect(orco.name).toBe('Orco');
      expect(orco.scale).toBe(0.1);
      await service.writeCharacterPresets([orco]);
      expect(await service.readCharacterPresets()).toEqual([orco]);
      expect(JSON.parse(fake.files.get(CHARACTERS_FILE)!)).toEqual({ presets: [orco] });
    });
  });

  describe('biblioteca de objetos', () => {
    it('sin items.json es una lista vacia', async () => {
      expect(await service.readItemLibrary()).toEqual([]);
    });

    it('otro fallo de lectura se informa', async () => {
      vi.mocked(fake.api.readFile).mockRejectedValueOnce(new Error('EBUSY'));
      await expect(service.readItemLibrary()).rejects.toThrow('EBUSY');
    });

    it('un items.json roto se informa', async () => {
      fake.files.set(ITEMS_FILE, 'no json');
      await expect(service.readItemLibrary()).rejects.toThrow(`${ITEMS_FILE} no es un JSON valido.`);
    });

    it('sin la lista de items es vacio', async () => {
      fake.files.set(ITEMS_FILE, JSON.stringify({ items: 'x' }));
      expect(await service.readItemLibrary()).toEqual([]);
    });

    it('guardar y leer devuelve los mismos objetos', async () => {
      const items = [
        { ...newItemDraft('weapon', 'ranged'), id: 'arco' },
        { ...newItemDraft('healing'), id: 'pocion' },
        { ...newItemDraft('coin'), id: 'moneda' },
      ];
      await service.writeItemLibrary(items);
      expect(await service.readItemLibrary()).toEqual(items);
    });
  });

  describe('configuracion del juego', () => {
    it('sin game.json es la configuracion de siempre y avisa que no existe', async () => {
      expect(await service.readGameConfig()).toEqual({ config: defaultGameConfig(), exists: false });
    });

    it('otro fallo de lectura se informa', async () => {
      vi.mocked(fake.api.readFile).mockRejectedValueOnce(new Error('EPERM'));
      await expect(service.readGameConfig()).rejects.toThrow('EPERM');
    });

    it('un game.json roto se informa en vez de tratarse como vacio', async () => {
      fake.files.set(GAME_FILE, '{');
      await expect(service.readGameConfig()).rejects.toThrow(`${GAME_FILE} no es un JSON valido.`);
    });

    it('guardar y leer devuelve la misma configuracion', async () => {
      const config = defaultGameConfig();
      config.name = 'Colmena';
      config.window = { width: 1280, height: 720, fullscreen: true };
      config.hud.healthBorder = { r: 1, g: 2, b: 3 };
      config.variables = { llaves: 0, puntos: 10 };
      config.screens.credits = ['# Equipo', 'Ana'];
      await service.writeGameConfig(config);
      expect(await service.readGameConfig()).toEqual({ config, exists: true });
    });

    it('sin borde de vida la clave no se escribe', async () => {
      await service.writeGameConfig(defaultGameConfig());
      const disk = JSON.parse(fake.files.get(GAME_FILE)!);
      expect('healthBorder' in disk.hud).toBe(false);
    });

    it('valores fuera de rango escritos a mano vuelven recortados', async () => {
      fake.files.set(GAME_FILE, JSON.stringify({ window: { width: 10, height: 99999 } }));
      const { config } = await service.readGameConfig();
      expect(config.window.width).toBe(320);
      expect(config.window.height).toBe(4320);
    });
  });

  describe('partida guardada', () => {
    it('sin partida devuelve null', async () => {
      expect(await service.readSaveInfo()).toBeNull();
    });

    it('devuelve el nivel en el que quedo', async () => {
      fake.files.set(SAVE_FILE, JSON.stringify({ level: 'nivel_3.json', coins: 4 }));
      expect(await service.readSaveInfo()).toEqual({ level: 'nivel_3.json' });
    });

    it('una partida sin nivel o rota no rompe el editor', async () => {
      fake.files.set(SAVE_FILE, JSON.stringify({ level: 3 }));
      expect(await service.readSaveInfo()).toEqual({ level: '' });
      fake.files.set(SAVE_FILE, '{{');
      expect(await service.readSaveInfo()).toBeNull();
    });

    it('borrarla la quita del proyecto', async () => {
      fake.files.set(SAVE_FILE, JSON.stringify({ level: 'a.json' }));
      await service.clearSave();
      expect(await service.readSaveInfo()).toBeNull();
    });
  });

  describe('carpeta del editor', () => {
    it('workspaceInfo recuerda la raiz del proyecto', async () => {
      expect(service.projectRoot()).toBeNull();
      const info = await service.workspaceInfo();
      expect(info.seeded).toEqual(['levels/test_level.json']);
      expect(service.projectRoot()).toBe('C:/proyecto');
    });

    it('cancelar el cambio de carpeta deja la raiz como estaba', async () => {
      await service.ensureRoot();
      expect(await service.changeWorkspace()).toBeNull();
      expect(service.projectRoot()).toBe('C:/proyecto');
    });

    it('elegir otra carpeta la toma como raiz', async () => {
      vi.mocked(fake.api.changeWorkspace).mockResolvedValueOnce('D:/otro');
      expect(await service.changeWorkspace()).toBe('D:/otro');
      expect(service.projectRoot()).toBe('D:/otro');
    });

    it('ensureRoot sin raiz no pisa la que habia', async () => {
      await service.workspaceInfo();
      vi.mocked(fake.api.ensureRoot).mockResolvedValueOnce(null);
      expect(await service.ensureRoot()).toBeNull();
      expect(service.projectRoot()).toBe('C:/proyecto');
    });

    it('las operaciones sueltas pasan sus argumentos al proceso principal', async () => {
      await service.revealWorkspace();
      await service.createDir('levels/mundo_2');
      await service.listEntries('assets');
      await service.readFileData('assets/a.bin');
      await service.beginConvert('project-jpg');
      await service.readConvertImage(2);
      await service.writeConvertedImage(2, null);
      await service.resetConvert();
      await service.writeTexture('sprite', 'AAAA', true);
      expect(fake.api.revealWorkspace).toHaveBeenCalled();
      expect(fake.api.createDir).toHaveBeenCalledWith('levels/mundo_2');
      expect(fake.api.listEntries).toHaveBeenCalledWith('assets');
      expect(fake.api.readFileData).toHaveBeenCalledWith('assets/a.bin');
      expect(fake.api.beginConvert).toHaveBeenCalledWith('project-jpg');
      expect(fake.api.readConvertImage).toHaveBeenCalledWith(2);
      expect(fake.api.writeConvertedImage).toHaveBeenCalledWith(2, null);
      expect(fake.api.resetConvert).toHaveBeenCalled();
      expect(fake.api.writeTexture).toHaveBeenCalledWith('sprite', 'AAAA', true);
    });
  });

  describe('motor', () => {
    it('el catalogo de eventos se lee y se parsea', async () => {
      expect(await service.readEventCatalog()).toEqual({ triggers: [], conditions: [], actions: [] });
    });

    it('ejecutar arranca en el nivel si no se dice otra cosa', async () => {
      await service.runLevel('C:/proyecto/levels/a.json', 'release');
      expect(fake.api.run).toHaveBeenCalledWith('C:/proyecto/levels/a.json', 'release', 'level');
      await service.runLevel('C:/proyecto/levels/a.json', 'debug', 'title');
      expect(fake.api.run).toHaveBeenLastCalledWith('C:/proyecto/levels/a.json', 'debug', 'title');
    });

    it('dice que motores estan compilados', async () => {
      expect(await service.engineStatus()).toEqual({ debug: true, release: false });
    });

    it('compilar pasa cada linea de la salida y despues deja de escuchar', async () => {
      const lines: string[] = [];
      const result = await service.buildEngine('debug', (line) => lines.push(line));
      expect(result).toEqual({ ok: true });
      expect(lines).toEqual(['-- Build files have been written', '[100%] Built target engine']);
      expect(fake.buildListeners).toHaveLength(0);
    });

    it('una compilacion que falla tambien deja de escuchar', async () => {
      vi.mocked(fake.api.buildEngine).mockRejectedValueOnce(new Error('cmake no encontrado'));
      await expect(service.buildEngine('release', () => undefined)).rejects.toThrow('cmake no encontrado');
      expect(fake.buildListeners).toHaveLength(0);
    });
  });

  describe('recursos del proyecto', () => {
    const file = (dir: string, name: string): ProjectNode => ({ name, path: dir + '/' + name, kind: 'file' });
    const folder = (dir: string, name: string): ProjectNode => ({ name, path: dir + '/' + name, kind: 'dir' });

    it('las texturas incluyen subcarpetas con su ruta y solo imagenes', async () => {
      fake.tree.set('assets/textures', [
        folder('assets/textures', 'presentacion'),
        file('assets/textures', 'floor.png'),
        file('assets/textures', 'notas.txt'),
        file('assets/textures', 'FOTO.JPG'),
      ]);
      fake.tree.set('assets/textures/presentacion', [file('assets/textures/presentacion', 'piso_pasto.png')]);
      expect(await service.listTextures()).toEqual(['floor.png', 'FOTO.JPG', 'presentacion/piso_pasto.png']);
    });

    it('las texturas se buscan hasta tres niveles de carpetas', async () => {
      let dir = 'assets/textures';
      for (const name of ['a', 'b', 'c', 'd']) {
        fake.tree.set(dir, [folder(dir, name), file(dir, name + '.png')]);
        dir = dir + '/' + name;
      }
      fake.tree.set(dir, [file(dir, 'profunda.png')]);
      expect(await service.listTextures()).toEqual(['a.png', 'a/b.png', 'a/b/c.png', 'a/b/c/d.png']);
    });

    it('los sonidos se buscan en todo assets/ con su ruta', async () => {
      fake.tree.set('assets', [folder('assets', 'sounds'), file('assets', 'tema.OGG'), file('assets', 'x.png')]);
      fake.tree.set('assets/sounds', [file('assets/sounds', 'golpe.wav'), file('assets/sounds', 'fondo.mp3')]);
      // Una carpeta se recorre en el acto, antes que los archivos que vienen despues.
      expect(await service.listSounds()).toEqual(['sounds/golpe.wav', 'sounds/fondo.mp3', 'tema.OGG']);
    });

    it('sin carpeta de assets no hay texturas ni sonidos', async () => {
      expect(await service.listTextures()).toEqual([]);
      expect(await service.listSounds()).toEqual([]);
    });
  });
});
