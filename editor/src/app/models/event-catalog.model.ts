// Espejo en TypeScript de schema/event_catalog.json.
//
// El panel de eventos del editor genera sus formularios DINAMICAMENTE a
// partir de esto -- no hay un formulario hardcodeado por cada trigger/accion.
// Agregar un bloque nuevo al catalogo (nuevo objeto en event_catalog.json)
// hace que aparezca disponible en el editor sin tocar codigo Angular, igual
// que EventSystem en C++ no necesita recompilarse para usar un type nuevo
// (siempre que alguien lo registre con RegisterTrigger/RegisterAction).

// Tipos de parametro que el editor sabe renderizar como control de
// formulario especifico. Un type no listado aca no rompe nada: el
// renderizador dinamico cae a un campo de texto simple.
// level_ref es el nombre de un archivo de levels/ (para "Pasar a otro nivel"):
// se elige de una lista, igual que entity_ref, para no escribir uno que no existe.
// variable_ref es una variable de la partida, de las declaradas en game.json;
// sound_ref, un sonido de assets/ ("sounds/golpe.wav"), que se elige de la
// lista de Recursos › Sonidos y se puede escuchar ahi mismo; y choice, una de
// las "options" que trae el propio parametro.
export type CatalogParamType =
  | 'entity_ref'
  | 'level_ref'
  | 'zone_ref'
  | 'item_ref'
  | 'variable_ref'
  | 'sound_ref'
  | 'choice'
  | 'string'
  | 'number'
  | 'boolean';

/** Una opcion de un parametro "choice": lo que se guarda y lo que se lee. */
export interface CatalogChoice {
  value: string;
  label: string;
}

export interface CatalogParamDef {
  type: CatalogParamType | string;
  description?: string;
  /** Solo para "choice": las opciones, la primera es la de entrada. */
  options?: CatalogChoice[];
  /** Valor con que arranca el parametro al agregar el bloque, si no es el de su tipo. */
  default?: string | number | boolean;
}

export interface CatalogEntry {
  /** Coincide con el 'type' que EventSystem espera en C++ (RegisterTrigger/RegisterCondition/RegisterAction). */
  type: string;
  label: string;
  description?: string;
  params: Record<string, CatalogParamDef>;
}

export interface EventCatalog {
  triggers: CatalogEntry[];
  conditions: CatalogEntry[];
  actions: CatalogEntry[];
}
