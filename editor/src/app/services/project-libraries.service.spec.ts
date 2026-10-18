// Pruebas de los servicios que guardan una parte del proyecto en memoria y en
// disco: configuracion del juego, catalogo de eventos, objetos y personajes.
//
// Todos siguen la misma regla: guardar escribe primero el archivo y recien
// despues la memoria, para que un fallo de disco no deje el editor mostrando
// algo que no se guardo. ProjectService se reemplaza por uno de mentira.

import { TestBed } from '@angular/core/testing';

import { defaultGameConfig } from '../core/game-config';
import { newItemDraft } from '../core/items';
import { presetFromArchetype, CHARACTERS } from '../core/characters';
import { EventCatalog } from '../models/event-catalog.model';
import { CatalogService } from './catalog.service';
import { CharacterPresetService } from './character-preset.service';
import { GameConfigService } from './game-config.service';
import { ItemLibraryService } from './item-library.service';
import { ProjectService } from './project.service';

function fakeProject() {
  return {
    readGameConfig: vi.fn(),
    writeGameConfig: vi.fn(async () => undefined),
    readEventCatalog: vi.fn(),
    readItemLibrary: vi.fn(),
    writeItemLibrary: vi.fn(async () => undefined),
    readCharacterPresets: vi.fn(),
    writeCharacterPresets: vi.fn(async () => undefined),
  };
}

let project: ReturnType<typeof fakeProject>;

beforeEach(() => {
  project = fakeProject();
  TestBed.configureTestingModule({ providers: [{ provide: ProjectService, useValue: project }] });
});

describe('GameConfigService', () => {
  it('sin cargar nada es la configuracion de siempre y no existe game.json', () => {
    const service = TestBed.inject(GameConfigService);
    expect(service.config()).toEqual(defaultGameConfig());
    expect(service.exists()).toBe(false);
    expect(service.variableNames()).toEqual([]);
  });

  it('cargar toma la configuracion del disco y si existia', async () => {
    const config = { ...defaultGameConfig(), name: 'Colmena' };
    project.readGameConfig.mockResolvedValue({ config, exists: true });
    const service = TestBed.inject(GameConfigService);
    await service.load();
    expect(service.config()).toBe(config);
    expect(service.exists()).toBe(true);
  });

  it('guardar escribe el archivo y despues la memoria', async () => {
    const service = TestBed.inject(GameConfigService);
    const config = { ...defaultGameConfig(), name: 'Nuevo' };
    await service.save(config);
    expect(project.writeGameConfig).toHaveBeenCalledWith(config);
    expect(service.config()).toBe(config);
    expect(service.exists()).toBe(true);
  });

  it('un fallo al guardar deja la memoria como estaba', async () => {
    const service = TestBed.inject(GameConfigService);
    project.writeGameConfig.mockRejectedValueOnce(new Error('disco lleno'));
    await expect(service.save({ ...defaultGameConfig(), name: 'x' })).rejects.toThrow('disco lleno');
    expect(service.config().name).toBe('');
    expect(service.exists()).toBe(false);
  });

  it('las variables salen en orden alfabetico, con las tildes en su lugar', () => {
    const service = TestBed.inject(GameConfigService);
    service.config.set({ ...defaultGameConfig(), variables: { vidas: 3, árboles: 0, llaves: 1, Zeta: 2 } });
    expect(service.variableNames()).toEqual(['árboles', 'llaves', 'vidas', 'Zeta']);
  });

  it('reiniciar vuelve a la configuracion de siempre', async () => {
    const service = TestBed.inject(GameConfigService);
    await service.save({ ...defaultGameConfig(), name: 'x', variables: { a: 1 } });
    service.reset();
    expect(service.config()).toEqual(defaultGameConfig());
    expect(service.exists()).toBe(false);
  });
});

describe('CatalogService', () => {
  const catalog: EventCatalog = {
    triggers: [{ type: 'on_start', label: 'Al empezar', params: {} }],
    conditions: [{ type: 'has_item', label: 'Tiene el objeto', params: {} }],
    actions: [{ type: 'show_message', label: 'Mostrar mensaje', params: {} }],
  };

  it('antes de cargar no encuentra ningun bloque', () => {
    const service = TestBed.inject(CatalogService);
    expect(service.catalog()).toBeNull();
    expect(service.findTrigger('on_start')).toBeUndefined();
    expect(service.findCondition('has_item')).toBeUndefined();
    expect(service.findAction('show_message')).toBeUndefined();
  });

  it('despues de cargar traduce cada type a su definicion', async () => {
    project.readEventCatalog.mockResolvedValue(catalog);
    const service = TestBed.inject(CatalogService);
    await service.load();
    expect(service.findTrigger('on_start')?.label).toBe('Al empezar');
    expect(service.findCondition('has_item')?.label).toBe('Tiene el objeto');
    expect(service.findAction('show_message')?.label).toBe('Mostrar mensaje');
  });

  it('un type de un catalogo mas nuevo no rompe: devuelve undefined', async () => {
    project.readEventCatalog.mockResolvedValue(catalog);
    const service = TestBed.inject(CatalogService);
    await service.load();
    expect(service.findTrigger('on_teleport')).toBeUndefined();
    // Cada busqueda mira solo su lista.
    expect(service.findTrigger('show_message')).toBeUndefined();
    expect(service.findAction('on_start')).toBeUndefined();
  });

  it('un catalogo que no se pudo leer deja el anterior', async () => {
    project.readEventCatalog.mockResolvedValueOnce(catalog).mockRejectedValueOnce(new Error('ENOENT'));
    const service = TestBed.inject(CatalogService);
    await service.load();
    await expect(service.load()).rejects.toThrow('ENOENT');
    expect(service.catalog()).toBe(catalog);
  });
});

describe('ItemLibraryService', () => {
  const sword = { ...newItemDraft('weapon'), id: 'espada' };
  const coin = { ...newItemDraft('coin'), id: 'moneda' };

  it('cargar trae la biblioteca del proyecto', async () => {
    project.readItemLibrary.mockResolvedValue([sword, coin]);
    const service = TestBed.inject(ItemLibraryService);
    await service.load();
    expect(service.items()).toEqual([sword, coin]);
  });

  it('busca un objeto por id, y uno que no esta da undefined', async () => {
    project.readItemLibrary.mockResolvedValue([sword, coin]);
    const service = TestBed.inject(ItemLibraryService);
    await service.load();
    expect(service.find('moneda')).toBe(coin);
    expect(service.find('escudo')).toBeUndefined();
  });

  it('guardar escribe el archivo y despues la memoria', async () => {
    const service = TestBed.inject(ItemLibraryService);
    await service.save([coin]);
    expect(project.writeItemLibrary).toHaveBeenCalledWith([coin]);
    expect(service.items()).toEqual([coin]);
  });

  it('un fallo al guardar no deja en la paleta objetos que no se guardaron', async () => {
    project.readItemLibrary.mockResolvedValue([sword]);
    const service = TestBed.inject(ItemLibraryService);
    await service.load();
    project.writeItemLibrary.mockRejectedValueOnce(new Error('EACCES'));
    await expect(service.save([sword, coin])).rejects.toThrow('EACCES');
    expect(service.items()).toEqual([sword]);
  });
});

describe('CharacterPresetService', () => {
  const hero = presetFromArchetype(CHARACTERS[0]);

  it('arranca vacio y cargar trae los personajes del proyecto', async () => {
    project.readCharacterPresets.mockResolvedValue([hero]);
    const service = TestBed.inject(CharacterPresetService);
    expect(service.presets()).toEqual([]);
    await service.load();
    expect(service.presets()).toEqual([hero]);
  });

  it('guardar escribe el archivo y despues la memoria', async () => {
    const service = TestBed.inject(CharacterPresetService);
    await service.save([hero]);
    expect(project.writeCharacterPresets).toHaveBeenCalledWith([hero]);
    expect(service.presets()).toEqual([hero]);
  });

  it('un fallo al guardar no deja personajes que no se guardaron', async () => {
    const service = TestBed.inject(CharacterPresetService);
    project.writeCharacterPresets.mockRejectedValueOnce(new Error('EBUSY'));
    await expect(service.save([hero])).rejects.toThrow('EBUSY');
    expect(service.presets()).toEqual([]);
  });

  it('un fallo al cargar no borra los que ya estaban', async () => {
    project.readCharacterPresets.mockResolvedValueOnce([hero]).mockRejectedValueOnce(new Error('JSON roto'));
    const service = TestBed.inject(CharacterPresetService);
    await service.load();
    await expect(service.load()).rejects.toThrow('JSON roto');
    expect(service.presets()).toEqual([hero]);
  });
});
