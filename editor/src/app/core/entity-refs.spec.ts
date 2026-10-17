import { EventDefinition } from '../models/level.model';
import { ParamTypeLookup, eventsUsingEntity, renameEntityInEvents } from './entity-refs';

const events: EventDefinition[] = [
  {
    trigger: { type: 'on_collision', params: { entityA: 'player_1', entityB: 'cofre_1' } },
    actions: [{ type: 'destroy_entity', params: { entity: 'cofre_1' } }],
  },
  {
    trigger: { type: 'on_start', params: {} },
    conditions: [{ type: 'has_item', params: { item: 'cofre_1' } }],
    actions: [{ type: 'show_message', params: { text: 'cofre_1' } }],
  },
];

/** Catalogo con los params de entidad declarados, como el de verdad. */
const catalog: ParamTypeLookup = (_kind, stepType, param) => {
  const types: Record<string, Record<string, string>> = {
    on_collision: { entityA: 'entity_ref', entityB: 'entity_ref' },
    destroy_entity: { entity: 'entity_ref' },
    on_start: {},
    has_item: { item: 'item_ref' },
    show_message: { text: 'string' },
  };
  return types[stepType]?.[param];
};

/** Sin catalogo: no se conoce ningun param. */
const noCatalog: ParamTypeLookup = () => undefined;

describe('eventsUsingEntity', () => {
  it('encuentra solo los eventos que nombran la entidad en un param de entidad', () => {
    expect(eventsUsingEntity(events, 'cofre_1', catalog)).toEqual([0]);
    expect(eventsUsingEntity(events, 'player_1', catalog)).toEqual([0]);
    expect(eventsUsingEntity(events, 'nadie', catalog)).toEqual([]);
  });

  it('sin catalogo reconoce los params por el nombre', () => {
    expect(eventsUsingEntity(events, 'cofre_1', noCatalog)).toEqual([0]);
  });
});

describe('renameEntityInEvents', () => {
  it('cambia las referencias de entidad y deja el resto igual', () => {
    const { events: renamed, changed } = renameEntityInEvents(events, 'cofre_1', 'cofre_oro', catalog);
    expect(changed).toBe(1);
    expect(renamed[0].trigger.params).toEqual({ entityA: 'player_1', entityB: 'cofre_oro' });
    expect(renamed[0].actions[0].params).toEqual({ entity: 'cofre_oro' });
    // Un texto o un objeto que se llama igual no es una entidad.
    expect(renamed[1]).toBe(events[1]);
  });

  it('no toca nada si nadie la nombra', () => {
    const { events: renamed, changed } = renameEntityInEvents(events, 'nadie', 'otro', catalog);
    expect(changed).toBe(0);
    expect(renamed[0]).toBe(events[0]);
  });
});
