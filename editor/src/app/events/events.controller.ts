import { computed, inject, signal } from '@angular/core';

import { ParamTypeLookup, eventsUsingEntity } from '../core/entity-refs';
import { CatalogEntry, CatalogParamDef } from '../models/event-catalog.model';
import { EventDefinition, EventStep } from '../models/level.model';

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
/** Que lista el panel: todos los eventos del nivel o solo los que nombran al objeto elegido. */
export type EventScope = 'todos' | 'objeto';

/** Un evento con su posicion en level.events, que es lo que reciben los metodos de edicion. */
export interface IndexedEvent {
  event: EventDefinition;
  index: number;
}

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

  // --- Eventos de un objeto -------------------------------------------------------
  //
  // "De este objeto" son los eventos que lo nombran en algun parametro de
  // entidad (trigger, condicion o accion), con la misma busqueda que usa el
  // renombrado (core/entity-refs.ts). La lista sigue a la seleccion: elegir
  // otro objeto en el mapa cambia los eventos que se ven.

  /**
   * Lo que eligio la persona. De entrada, los del objeto: sin nada elegido en
   * el mapa la lista esta vacia, y al elegir algo aparecen sus eventos.
   */
  readonly scope = signal<EventScope>('objeto');

  /** El objeto activo de la seleccion, o null. */
  readonly selectedId = computed(() => this.levels.selectedEntity()?.id ?? null);

  /** Posiciones de los eventos que nombran al objeto elegido. */
  readonly relatedIndexes = computed(() => {
    const id = this.selectedId();
    return id ? eventsUsingEntity(this.events(), id, this.paramType) : [];
  });

  /** true si la lista muestra solo los eventos del objeto elegido (ninguno, si no hay). */
  readonly filtering = computed(() => this.scope() === 'objeto');

  /**
   * Eventos que se editaron con la lista filtrada. Siguen a la vista aunque ya
   * no nombren al objeto (por ejemplo, al cambiar el trigger se reinician sus
   * params): que un evento desaparezca mientras se lo edita desorienta. Valen
   * solo para el objeto con que se fijaron.
   */
  private readonly pinned = signal<{ id: string | null; indexes: number[] }>({ id: null, indexes: [] });

  /** Los eventos que muestra el panel, cada uno con su posicion real en el nivel. */
  readonly visibleEvents = computed<IndexedEvent[]>(() => {
    const events = this.events();
    if (!this.filtering()) {
      return events.map((event, index) => ({ event, index }));
    }
    const pinned = this.pinned();
    const extra = pinned.id === this.selectedId() ? pinned.indexes : [];
    const indexes = [...new Set([...this.relatedIndexes(), ...extra])]
      .filter((index) => index < events.length)
      .sort((a, b) => a - b);
    return indexes.map((index) => ({ event: events[index], index }));
  });

  /** true si el evento se ve en la lista filtrada solo porque se lo esta editando. */
  isStale(index: number): boolean {
    return this.filtering() && !this.relatedIndexes().includes(index);
  }

  /** El evento que se acaba de abrir desde el inspector, para resaltarlo un momento. */
  readonly focused = signal<number | null>(null);
  private focusTimer: ReturnType<typeof setTimeout> | undefined;

  /** Tipo de cada param segun el catalogo (ver core/entity-refs.ts). */
  private readonly paramType: ParamTypeLookup = (kind, stepType, param) =>
    this.entryFor(CATALOG_KIND[kind], stepType)?.params[param]?.type;

  /**
   * Lleva la lista a los eventos del objeto y resalta uno. La plantilla lo
   * busca por su id ("event-3") para traerlo a la vista.
   */
  reveal(index: number | null): void {
    this.scope.set('objeto');
    clearTimeout(this.focusTimer);
    this.focused.set(index);
    if (index !== null) {
      this.focusTimer = setTimeout(() => this.focused.set(null), 1600);
    }
  }

  /** Una linea para leer un evento sin abrirlo: "Al colisionar → Ocultar entidad, Reproducir sonido". */
  summary(event: EventDefinition): string {
    const trigger = this.labelFor('triggers', event.trigger.type);
    const actions = event.actions.map((action) => this.labelFor('actions', action.type));
    return actions.length ? `${trigger} → ${actions.join(', ')}` : `${trigger} → (sin acciones)`;
  }

  //
  // Todo este bloque trabaja contra el CATALOGO, nunca contra una lista fija de
  // triggers y acciones. Un bloque nuevo en schema/event_catalog.json aparece
  // solo en la UI, con su formulario generado a partir de sus params. Es el
  // mismo trato que del lado de C++, donde EventSystem despacha por "type".
  //
  // Los eventos se identifican por su indice en el array del nivel; por eso
  // casi todos los metodos reciben "index" (y "actionIndex" para las acciones).

  /**
   * Agrega un evento con el primer trigger del catalogo y sin acciones todavia.
   * Con la lista filtrada por un objeto, el evento nace apuntando a el (si no,
   * desapareceria de la lista apenas creado). Filtrada sin objeto elegido, la
   * lista pasa a Todos para que el evento nuevo se vea.
   */
  addEvent(): void {
    if (this.filtering()) {
      const id = this.selectedId();
      if (id) {
        this.addEventFor(id);
        return;
      }
      this.scope.set('todos');
    }
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

  /**
   * Agrega un evento cuyo trigger nombra a la entidad: el primero del catalogo
   * que tenga un parametro de entidad ("Al colisionar"), con ese parametro ya
   * puesto. Devuelve la posicion del evento nuevo, o null si no se pudo.
   */
  addEventFor(id: string): number | null {
    const trigger =
      this.triggers().find((entry) => Object.values(entry.params).some((def) => def.type === 'entity_ref')) ??
      this.triggers()[0];
    if (!trigger) {
      this.note('Carga el catalogo de eventos antes de crear un evento.');
      return null;
    }
    const params = this.defaultParams(trigger);
    const entityParam = Object.keys(trigger.params).find((key) => trigger.params[key].type === 'entity_ref');
    if (entityParam) {
      params[entityParam] = id;
    }
    this.levels.addEvent({ trigger: { type: trigger.type, params }, actions: [] });
    this.markDirty();
    const index = this.events().length - 1;
    this.pin(index, id);
    return index;
  }

  removeEvent(index: number): void {
    this.levels.removeEvent(index);
    // Los de despues corren un lugar: los fijados tambien.
    this.pinned.update(({ id, indexes }) => ({
      id,
      indexes: indexes.filter((i) => i !== index).map((i) => (i > index ? i - 1 : i)),
    }));
    this.markDirty();
  }

  /** Toda edicion de un evento pasa por aca, para fijarlo si la lista esta filtrada. */
  private update(index: number, changes: Partial<EventDefinition>): void {
    if (this.filtering()) {
      this.pin(index, this.selectedId());
    }
    this.levels.updateEvent(index, changes);
  }

  private pin(index: number, id: string | null): void {
    this.pinned.update((current) => ({
      id,
      indexes: current.id === id ? [...new Set([...current.indexes, index])] : [index],
    }));
  }

  /**
   * Cambia el trigger de un evento. Los params se reinician a los del bloque
   * nuevo: cada trigger declara los suyos, y conservar los del anterior
   * dejaria claves que el motor no espera.
   */
  changeTrigger(index: number, type: string): void {
    const entry = this.entryFor('triggers', type);
    this.update(index, {
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
    this.update(index, {
      actions: [...event.actions, { type: entry.type, params: this.defaultParams(entry) }],
    });
    this.markDirty();
  }

  removeAction(index: number, actionIndex: number): void {
    const event = this.events()[index];
    this.update(index, {
      actions: event.actions.filter((_, i) => i !== actionIndex),
    });
    this.markDirty();
  }

  changeAction(index: number, actionIndex: number, type: string): void {
    const entry = this.entryFor('actions', type);
    const event = this.events()[index];
    this.update(index, {
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
    this.update(index, {
      conditions: [...(event.conditions ?? []), { type: entry.type, params: this.defaultParams(entry) }],
    });
    this.markDirty();
  }

  removeCondition(index: number, conditionIndex: number): void {
    const conditions = (this.events()[index].conditions ?? []).filter((_, i) => i !== conditionIndex);
    // Sin condiciones la clave desaparece del JSON, como en los eventos que nunca las tuvieron.
    this.update(index, { conditions: conditions.length ? conditions : undefined });
    this.markDirty();
  }

  changeCondition(index: number, conditionIndex: number, type: string): void {
    const entry = this.entryFor('conditions', type);
    const event = this.events()[index];
    this.update(index, {
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
      // Un campo borrado vuelve al valor por defecto del catalogo (un volumen
      // vacio es 100, no 0: no tiene que dejar mudo el sonido).
      const number = raw === '' && typeof def.default === 'number' ? def.default : Number(raw);
      value = Number.isFinite(number) ? number : 0;
    } else if (def?.type === 'item_ref' && typeof raw === 'string' && raw) {
      this.useCombatParams(raw);
    }
    const updated: EventStep = { ...step, params: { ...step.params, [key]: value } };
    const replace = (list: EventStep[]) => list.map((current, i) => (i === stepIndex ? updated : current));
    if (kind === 'trigger') {
      this.update(index, { trigger: updated });
    } else if (kind === 'condition') {
      this.update(index, { conditions: replace(event.conditions ?? []) });
    } else {
      this.update(index, { actions: replace(event.actions) });
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
   * Un "choice" arranca en su primera opcion, y un parametro con "default"
   * en el catalogo, en ese ("Sumar a variable" suma 1, no 0).
   */
  private defaultParams(entry: CatalogEntry): Record<string, unknown> {
    const params: Record<string, unknown> = {};
    for (const key of Object.keys(entry.params)) {
      const def = entry.params[key];
      if (def.default !== undefined) {
        params[key] = def.default;
      } else if (def.type === 'choice') {
        params[key] = def.options?.[0]?.value ?? '';
      } else {
        params[key] = def.type === 'number' ? 0 : def.type === 'boolean' ? false : '';
      }
    }
    return params;
  }
}
