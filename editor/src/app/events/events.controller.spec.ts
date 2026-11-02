// El panel Eventos filtrado por el objeto elegido en el mapa.

import { TestBed } from '@angular/core/testing';

import { EventCatalog } from '../models/event-catalog.model';
import { EventDefinition, LevelEntity } from '../models/level.model';
import { CatalogService } from '../services/catalog.service';
import { LevelService } from '../services/level.service';
import { SelectionService } from '../services/selection.service';
import { EventsController } from './events.controller';

const CATALOG: EventCatalog = {
  triggers: [
    { type: 'on_level_start', label: 'Al empezar el nivel', params: {} },
    {
      type: 'on_collision',
      label: 'Al colisionar',
      params: { entityA: { type: 'entity_ref' }, entityB: { type: 'entity_ref' } },
    },
  ],
  conditions: [],
  actions: [{ type: 'hide_entity', label: 'Ocultar entidad', params: { entity: { type: 'entity_ref' } } }],
};

const EVENTS: EventDefinition[] = [
  { trigger: { type: 'on_level_start', params: {} }, actions: [{ type: 'hide_entity', params: { entity: 'cofre' } }] },
  { trigger: { type: 'on_level_start', params: {} }, actions: [] },
  { trigger: { type: 'on_collision', params: { entityA: 'jugador', entityB: 'cofre' } }, actions: [] },
];

describe('EventsController, eventos de un objeto', () => {
  let ev: EventsController;
  let levels: LevelService;
  let selection: SelectionService;

  beforeEach(() => {
    TestBed.inject(CatalogService).catalog.set(CATALOG);
    levels = TestBed.inject(LevelService);
    selection = TestBed.inject(SelectionService);
    const entities = ['cofre', 'jugador'].map((id) => ({ id }) as LevelEntity);
    levels.level.update((level) => ({ ...level, entities, events: structuredClone(EVENTS) }));
    ev = TestBed.runInInjectionContext(() => new EventsController(() => {}, () => {}, () => {}));
  });

  it('de entrada muestra los del objeto: sin nada elegido, ninguno', () => {
    expect(ev.scope()).toBe('objeto');
    expect(ev.visibleEvents()).toEqual([]);
  });

  it('Todos muestra todos los del nivel', () => {
    selection.selectEntity('cofre');
    ev.scope.set('todos');
    expect(ev.visibleEvents().map((item) => item.index)).toEqual([0, 1, 2]);
  });

  it('+ Evento sin objeto elegido pasa a Todos, para que se vea el nuevo', () => {
    ev.addEvent();
    expect(ev.scope()).toBe('todos');
    expect(ev.visibleEvents().map((item) => item.index)).toEqual([0, 1, 2, 3]);
  });

  it('filtrado, muestra solo los que nombran al objeto, con su posicion real', () => {
    selection.selectEntity('cofre');
    ev.scope.set('objeto');
    expect(ev.relatedIndexes()).toEqual([0, 2]);
    expect(ev.visibleEvents().map((item) => item.index)).toEqual([0, 2]);
  });

  it('sigue a la seleccion', () => {
    ev.scope.set('objeto');
    selection.selectEntity('jugador');
    expect(ev.visibleEvents().map((item) => item.index)).toEqual([2]);
  });

  it('+ Evento con la lista filtrada crea uno que ya apunta al objeto', () => {
    selection.selectEntity('jugador');
    ev.scope.set('objeto');
    ev.addEvent();
    const created = levels.level().events[3];
    expect(created.trigger).toEqual({ type: 'on_collision', params: { entityA: 'jugador', entityB: '' } });
    expect(ev.visibleEvents().map((item) => item.index)).toEqual([2, 3]);
  });

  it('un evento editado que deja de nombrar al objeto se sigue viendo, marcado', () => {
    selection.selectEntity('cofre');
    ev.scope.set('objeto');
    ev.changeTrigger(2, 'on_level_start');
    expect(ev.visibleEvents().map((item) => item.index)).toEqual([0, 2]);
    expect(ev.isStale(2)).toBe(true);
    // Con otro objeto elegido ya no cuenta.
    selection.selectEntity('jugador');
    expect(ev.visibleEvents()).toEqual([]);
  });

  it('borrar un evento corre los fijados que venian despues', () => {
    selection.selectEntity('cofre');
    ev.scope.set('objeto');
    ev.changeTrigger(2, 'on_level_start');
    ev.removeEvent(1);
    expect(ev.visibleEvents().map((item) => item.index)).toEqual([0, 1]);
    expect(ev.isStale(1)).toBe(true);
  });

  it('resume un evento en una linea', () => {
    expect(ev.summary(EVENTS[0])).toBe('Al empezar el nivel → Ocultar entidad');
    expect(ev.summary(EVENTS[1])).toBe('Al empezar el nivel → (sin acciones)');
  });
});
