// =============================================================================
// Revisar un nivel contra schema/level.schema.json al guardarlo
// =============================================================================
//
// El motor valida el nivel al cargarlo y rechaza lo que no cumple el contrato
// (ver engine/loader/LevelLoader.cpp). Sin esto, eso se descubria recien al
// Ejecutar, con el mensaje en la consola del motor. Ahora el editor lo revisa
// apenas se guarda y lo avisa en su Consola.
//
// SOLO AVISA: el nivel ya se guardo, tal cual, antes de revisarlo. Un nivel
// que no cumple el schema puede ser uno a medio armar, y no poder guardarlo
// seria peor que el aviso.
//
// Se valida aca y no en la UI porque Ajv compila el schema a codigo con
// new Function(), y el renderer no deberia necesitar permiso para eso. El
// schema es del PROGRAMA (schema/ de la instalacion), no del proyecto.
// =============================================================================

const path = require('node:path');
const fsSync = require('node:fs');
const { ipcMain } = require('electron');

const { INSTALL_ROOT } = require('./project-root');

/** Cuantos avisos se devuelven como mucho: con mas, el resto suele ser el mismo error repetido. */
const MAX_WARNINGS = 8;

let validator = null;

/** El validador del schema, compilado una sola vez. Null si Ajv o el schema no estan. */
function getValidator() {
  if (validator !== null) return validator || null;
  try {
    const Ajv = require('ajv');
    const schema = JSON.parse(fsSync.readFileSync(path.join(INSTALL_ROOT, 'schema', 'level.schema.json'), 'utf-8'));
    // allErrors: que se vean todos los problemas de una vez, no de a uno por guardado.
    validator = new Ajv({ allErrors: true, strict: false }).compile(schema);
  } catch (err) {
    console.warn('[honeycomb] no se puede revisar el nivel contra el schema:', err.message);
    validator = false;
  }
  return validator || null;
}

/** "/entities/3/position/col" -> "entities[3].position.col"; la raiz es "el nivel". */
function readablePath(instancePath) {
  if (!instancePath) return 'el nivel';
  return instancePath
    .split('/')
    .slice(1)
    .map((part) => part.replace(/~1/g, '/').replace(/~0/g, '~'))
    .reduce((out, part) => (/^\d+$/.test(part) ? `${out}[${part}]` : out ? `${out}.${part}` : part), '');
}

const TYPE_NAMES = {
  string: 'un texto',
  number: 'un número',
  integer: 'un número entero',
  boolean: 'sí o no (true/false)',
  object: 'un objeto',
  array: 'una lista',
  null: 'null',
};

/** Un error de Ajv dicho como para la Consola del editor. */
function describeError(error) {
  const where = readablePath(error.instancePath);
  const params = error.params ?? {};
  switch (error.keyword) {
    case 'required':
      return `${where === 'el nivel' ? 'al nivel' : 'a ' + where} le falta "${params.missingProperty}"`;
    case 'type': {
      const types = String(params.type).split(',').map((type) => TYPE_NAMES[type] ?? type);
      return `${where} tiene que ser ${types.join(' o ')}`;
    }
    case 'minimum':
      return `${where} tiene que ser ${params.comparison === '>' ? 'mayor que' : 'al menos'} ${params.limit}`;
    case 'exclusiveMinimum':
      return `${where} tiene que ser mayor que ${params.limit}`;
    case 'maximum':
      return `${where} tiene que ser ${params.comparison === '<' ? 'menor que' : 'como mucho'} ${params.limit}`;
    case 'exclusiveMaximum':
      return `${where} tiene que ser menor que ${params.limit}`;
    case 'enum':
      return `${where} no es ninguno de los valores permitidos (${(params.allowedValues ?? []).join(', ')})`;
    case 'minItems':
      return `${where} tiene que tener al menos ${params.limit} elementos`;
    case 'maxItems':
      return `${where} tiene que tener como mucho ${params.limit} elementos`;
    case 'minLength':
      return `${where} no puede estar vacío`;
    case 'additionalProperties':
      return `${where} tiene un campo que el motor no conoce: "${params.additionalProperty}"`;
    case 'const':
      return `${where} tiene que valer ${JSON.stringify(params.allowedValue)}`;
    default:
      return `${where}: ${error.message}`;
  }
}

/**
 * Lo que el motor rechazaria de este nivel, como lista de avisos (vacia si
 * cumple el schema). Los avisos repetidos se juntan, y se devuelven a lo sumo
 * MAX_WARNINGS mas una linea que dice cuantos quedaron afuera.
 */
function checkLevel(level) {
  const validate = getValidator();
  if (!validate || validate(level)) return [];
  // anyOf/oneOf repiten lo mismo de cada rama: se queda el mas concreto.
  const errors = (validate.errors ?? []).filter((error) => error.keyword !== 'anyOf' && error.keyword !== 'oneOf');
  const warnings = [...new Set(errors.map(describeError))];
  if (warnings.length > MAX_WARNINGS) {
    const rest = warnings.length - MAX_WARNINGS;
    return [...warnings.slice(0, MAX_WARNINGS), `… y ${rest} ${rest === 1 ? 'problema más' : 'problemas más'}`];
  }
  return warnings;
}

function register() {
  // Recibe el texto del nivel tal como se guardo, no una ruta: revisa lo que
  // el editor acaba de escribir, sin volver a leerlo.
  ipcMain.handle('level:check', (_event, contents) => {
    if (typeof contents !== 'string') return [];
    let level;
    try {
      level = JSON.parse(contents);
    } catch {
      return ['el archivo no es un JSON válido'];
    }
    return checkLevel(level);
  });
}

module.exports = { register, checkLevel, readablePath };
