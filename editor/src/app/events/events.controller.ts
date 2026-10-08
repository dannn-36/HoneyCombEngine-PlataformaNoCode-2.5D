import { computed, inject } from '@angular/core';

import { CatalogEntry, CatalogParamDef } from '../models/event-catalog.model';
import { EventStep } from '../models/level.model';

/** Una fila del formulario de parametros: su clave y como se edita. */
interface ParamRow {
  key: string;
  def: CatalogParamDef;
}
import { CatalogService } from '../services/catalog.service';
import { LevelService } from '../services/level.service';

/** Las tres secciones de event_catalog.json, para acceder a ellas por nombre. */
export type CatalogKind = 'triggers' | 'conditions' | 'actions';
/** Un paso de un evento, en singular: lo que edita cada fila del panel Eventos. */
export type StepKind = 'trigger' | 'condition' | 'action';

const CATALOG_KIND: Record<StepKind, CatalogKind> = {
  trigger: 'triggers',
  condition: 'conditions',
  action: 'actions',
};

/**
 * El panel Eventos: la lista de eventos del nivel y el formulario de cada paso.
 *
 * Un evento es un trigger, cero o mas condiciones y una o mas acciones. Los
 * tipos posibles y sus parametros NO estan escritos aca: salen de
 * schema/event_catalog.json (via CatalogService), que es el mismo contrato que
 * lee el runtime en game/EventBindings.cpp. Agregar un bloque al catalogo lo
 * hace aparecer en este panel sin tocar el editor.
 *
 * Los eventos no tienen id propio en el schema: se los identifica por su
 * posicion en el array, que es tambien el orden en que EventSystem los evalua.
 *
 * Es un controlador y no un componente por la misma razon que
 * ItemEditorController: el markup vive en app.html para usar los estilos de
 * App (ver el comentario de cabecera de app.ts).
 */
export class EventsController {
  private readonly levels = inject(LevelService);
  private readonly catalog = inject(CatalogService);

  constructor(
    private readonly note: (message: string) => void,
    private readonly markDirty: () => void,
    /** Un objeto elegido en un parametro item_ref precarga el inspector de combate. */
    private readonly useCombatParams: (itemId: string) => void,
  ) {}

  readonly events = computed(() => this.levels.level().events);
  readonly triggers = computed(() => this.catalog.catalog()?.triggers ?? []);
  readonly conditions = computed(() => this.catalog.catalog()?.conditions ?? []);
  readonly actions = computed(() => this.catalog.catalog()?.actions ?? []);

  //
  // Todo este bloque trabaja contra el CATALOGO, nunca contra una lista fija de
  // triggers y acciones. Un bloque nuevo en schema/event_catalog.json aparece
  // solo en la UI, con su formulario generado a partir de sus params. Es el
  // mismo trato que del lado de C++, donde EventSystem despacha por "type".
  //
  // Los eventos se identifican por su indice en el array del nivel; por eso
  // casi todos los metodos reciben "index" (y "actionIndex" para las acciones).

  /** Agrega un evento con el primer trigger del catalogo y sin acciones todavia. */
  addEvent(): void {
    const trigger = this.triggers()[0];
    if (!trigger) {
      this.note('Carga el catalogo de eventos antes de crear un evento.');
      return;
    }
    this.levels.addEvent({
      trigger: { type: trigger.type, params: this.defaultParams(trigger) },
      actions: [],
    });
    this.markDirty();
  }

  removeEvent(index: number): void {
    this.levels.removeEvent(index);
    this.markDirty();
  }

  /**
   * Cambia el trigger de un evento. Los params se reinician a los del bloque
   * nuevo: cada trigger declara los suyos, y conservar los del anterior
   * dejaria claves que el motor no espera.
   */
  changeTrigger(index: number, type: string): void {
    const entry = this.entryFor('triggers', type);
    this.levels.updateEvent(index, {
      trigger: { type, params: entry ? this.defaultParams(entry) : {} },
    });
    this.markDirty();
  }

  addAction(index: number): void {
    const entry = this.actions()[0];
    if (!entry) {
      this.note('El catalogo no declara ninguna accion.');
      return;
    }
    const event = this.events()[index];
    this.levels.updateEvent(index, {
      actions: [...event.actions, { type: entry.type, params: this.defaultParams(entry) }],
    });
    this.markDirty();
  }

  removeAction(index: number, actionIndex: number): void {
    const event = this.events()[index];
    this.levels.updateEvent(index, {
      actions: event.actions.filter((_, i) => i !== actionIndex),
    });
    this.markDirty();
  }

  changeAction(index: number, actionIndex: number, type: string): void {
    const entry = this.entryFor('actions', type);
    const event = this.events()[index];
    this.levels.updateEvent(index, {
      actions: event.actions.map((action, i) =>
        i === actionIndex ? { type, params: entry ? this.defaultParams(entry) : {} } : action,
      ),
    });
    this.markDirty();
  }

  /** Condiciones: el "si" del evento. Todas tienen que cumplirse (AND). */
  addCondition(index: number): void {
    const entry = this.conditions()[0];
    if (!entry) {
      this.note('El catalogo no declara ninguna condicion.');
      return;
    }
    const event = this.events()[index];
    this.levels.updateEvent(index, {
      conditions: [...(event.conditions ?? []), { type: entry.type, params: this.defaultParams(entry) }],
    });
    this.markDirty();
  }

  removeCondition(index: number, conditionIndex: number): void {
    const conditions = (this.events()[index].conditions ?? []).filter((_, i) => i !== conditionIndex);
    // Sin condiciones la clave desaparece del JSON, como en los eventos que nunca las tuvieron.
    this.levels.updateEvent(index, { conditions: conditions.length ? conditions : undefined });
    this.markDirty();
  }

  changeCondition(index: number, conditionIndex: number, type: string): void {
    const entry = this.entryFor('conditions', type);
    const event = this.events()[index];
    this.levels.updateEvent(index, {
      conditions: (event.conditions ?? []).map((condition, i) =>
        i === conditionIndex ? { type, params: entry ? this.defaultParams(entry) : {} } : condition,
      ),
    });
    this.markDirty();
  }

  catalogKindOf(kind: StepKind): CatalogKind {
    return CATALOG_KIND[kind];
  }

  /**
   * Cambia un parametro de cualquier paso de un evento. El formulario entrega
   * texto, y se guarda con el tipo que declara el catalogo: un number como
   * numero (antes quedaba como texto y el motor lo tenia que adivinar), y un
   * item_ref ademas copia la definicion del objeto al nivel.
   */
  updateStepParam(kind: StepKind, index: number, stepIndex: number, key: string, raw: string | boolean): void {
    const event = this.events()[index];
    const steps = kind === 'trigger' ? [event.trigger] : kind === 'condition' ? (event.conditions ?? []) : event.actions;
    const step = steps[stepIndex];
    if (!step) {
      return;
    }
    const def = this.entryFor(CATALOG_KIND[kind], step.type)?.params[key];
    let value: unknown = raw;
    if (def?.type === 'number') {
      const number = Number(raw);
      value = Number.isFinite(number) ? number : 0;
    } else if (def?.type === 'item_ref' && typeof raw === 'string' && raw) {
      this.useCombatParams(raw);
    }
    const updated: EventStep = { ...step, params: { ...step.params, [key]: value } };
    const replace = (list: EventStep[]) => list.map((current, i) => (i === stepIndex ? updated : current));
    if (kind === 'trigger') {
      this.levels.updateEvent(index, { trigger: updated });
    } else if (kind === 'condition') {
      this.levels.updateEvent(index, { conditions: replace(event.conditions ?? []) });
    } else {
      this.levels.updateEvent(index, { actions: replace(event.actions) });
    }
    this.markDirty();
  }

  /** Filas de parametros de un bloque del catalogo, para el formulario dinamico. */
  paramRows(kind: CatalogKind, type: string): ParamRow[] {
    const entry = this.entryFor(kind, type);
    if (!entry) {
      return [];
    }
    return Object.keys(entry.params).map((key) => ({ key, def: entry.params[key] }));
  }

  entryFor(kind: CatalogKind, type: string): CatalogEntry | undefined {
    const catalog = this.catalog.catalog();
    return catalog ? catalog[kind].find((entry) => entry.type === type) : undefined;
  }

  labelFor(kind: CatalogKind, type: string): string {
    const entry = this.entryFor(kind, type);
    return entry ? entry.label : type;
  }

  paramValue(step: EventStep, key: string): string {
    const value = step.params[key];
    return value === undefined || value === null ? '' : String(value);
  }

  /**
   * Valor inicial de cada parametro de un bloque, segun su tipo declarado.
   * Se rellenan todos aunque esten vacios para que el JSON guardado tenga
   * siempre la forma completa que el motor espera, y para que el formulario
   * dinamico tenga algo a que enlazarse desde el primer render.
   * entity_ref y string comparten default (''): un id vacio es "sin elegir".
   */
  private defaultParams(entry: CatalogEntry): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    for (const key of Object.keys(entry.params)) {
      const type = entry.params[key].type;
      params[key] = type === 'number' ? 0 : type === 'boolean' ? false : '';
    }
    return params;
  }
}
