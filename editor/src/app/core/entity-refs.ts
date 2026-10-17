// HoneyComb Engine - Editor (referencias a entidades dentro de los eventos)
//
// Los eventos nombran entidades por su id, en los params de tipo entity_ref
// (ver schema/event_catalog.json). Renombrar una entidad sin tocar esos params
// deja eventos apuntando a algo que ya no existe, y el motor los ignora sin
// avisar. Aca se buscan y se reescriben esas referencias.

import { EventDefinition, EventStep } from '../models/level.model';

export type StepKind = 'trigger' | 'condition' | 'action';

/**
 * Tipo declarado de un param en el catalogo, o undefined si el catalogo no lo
 * conoce (no cargo, o el bloque no esta listado).
 */
export type ParamTypeLookup = (kind: StepKind, stepType: string, param: string) => string | undefined;

/**
 * Sin el catalogo (en el navegador, o con un bloque que no lista) se reconoce
 * por el nombre: los params de entidad del catalogo se llaman "entity",
 * "entityA", "entityB".
 */
function isEntityParam(lookup: ParamTypeLookup, kind: StepKind, step: EventStep, param: string): boolean {
  const declared = lookup(kind, step.type, param);
  return declared !== undefined ? declared === 'entity_ref' : /^entity/i.test(param);
}

function stepsOf(event: EventDefinition): { kind: StepKind; step: EventStep }[] {
  return [
    { kind: 'trigger', step: event.trigger },
    ...(event.conditions ?? []).map((step) => ({ kind: 'condition' as const, step })),
    ...event.actions.map((step) => ({ kind: 'action' as const, step })),
  ];
}

function stepUses(lookup: ParamTypeLookup, kind: StepKind, step: EventStep, id: string): boolean {
  return Object.entries(step.params ?? {}).some(
    ([param, value]) => value === id && isEntityParam(lookup, kind, step, param),
  );
}

/** Posiciones (en level.events) de los eventos que nombran a la entidad. */
export function eventsUsingEntity(
  events: readonly EventDefinition[],
  id: string,
  lookup: ParamTypeLookup,
): number[] {
  const found: number[] = [];
  events.forEach((event, index) => {
    if (stepsOf(event).some(({ kind, step }) => stepUses(lookup, kind, step, id))) {
      found.push(index);
    }
  });
  return found;
}

function renameInStep(
  lookup: ParamTypeLookup,
  kind: StepKind,
  step: EventStep,
  oldId: string,
  newId: string,
): EventStep {
  if (!stepUses(lookup, kind, step, oldId)) {
    return step;
  }
  const params: Record<string, unknown> = {};
  for (const [param, value] of Object.entries(step.params)) {
    params[param] = value === oldId && isEntityParam(lookup, kind, step, param) ? newId : value;
  }
  return { ...step, params };
}

/**
 * Los eventos con cada referencia a oldId cambiada por newId, y cuantos
 * eventos cambiaron. Los que no la nombran vuelven tal cual (misma referencia).
 */
export function renameEntityInEvents(
  events: readonly EventDefinition[],
  oldId: string,
  newId: string,
  lookup: ParamTypeLookup,
): { events: EventDefinition[]; changed: number } {
  let changed = 0;
  const renamed = events.map((event) => {
    const trigger = renameInStep(lookup, 'trigger', event.trigger, oldId, newId);
    const conditions = event.conditions?.map((step) => renameInStep(lookup, 'condition', step, oldId, newId));
    const actions = event.actions.map((step) => renameInStep(lookup, 'action', step, oldId, newId));
    const touched =
      trigger !== event.trigger ||
      actions.some((step, index) => step !== event.actions[index]) ||
      (conditions?.some((step, index) => step !== event.conditions?.[index]) ?? false);
    if (!touched) {
      return event;
    }
    changed += 1;
    return { ...event, trigger, actions, ...(conditions ? { conditions } : {}) };
  });
  return { events: renamed, changed };
}
