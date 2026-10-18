/// <reference types="node" />
// Contrato JSON de niveles: lo que escribe el editor, los niveles de levels/ y
// los casos de tests/contract/ contra schema/level.schema.json, y contra las
// reglas que JSON Schema no puede expresar (referencias, ids, la grilla).
//
// Los archivos se leen con node:fs: Vitest corre en Node aunque el entorno sea
// jsdom. La referencia a los tipos de node va solo en este archivo para no
// sumarlos al resto del editor.
//
// Los casos de valid/ que arma el editor se comparan con toMatchFileSnapshot:
// si el archivo no existe se escribe, y si cambia lo que guarda el editor la
// prueba falla. Para regenerarlo, borrar el archivo y volver a correr.

import { TestBed } from '@angular/core/testing';
import Ajv from 'ajv';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { BackgroundPickerController } from '../inspector/background-picker.controller';
import { CombatInspectorController } from '../combat/combat-inspector.controller';
import { PuzzleController } from '../combat/puzzle.controller';
import { characterDef, entityFromPreset, normalizePreset, presetFromArchetype } from '../core/characters';
import { nextFreeId } from '../core/dungeon-layout';
import { levelForDisk } from '../core/floors';
import { defaultAbility, defaultWeapon, entityFromItem, newItemDraft, normalizeItem } from '../core/items';
import { SHAPE_TEXTURE, shapeCollider, shapeDef } from '../core/iso-shapes';
import { EventsController } from '../events/events.controller';
import { CharacterPreset } from '../models/character-preset.model';
import { CatalogParamDef, EventCatalog } from '../models/event-catalog.model';
import { EventStep, Level } from '../models/level.model';
import { CatalogService } from '../services/catalog.service';
import { ItemLibraryService } from '../services/item-library.service';
import { LevelService } from '../services/level.service';
import { ProjectService } from '../services/project.service';

// --- Archivos ----------------------------------------------------------------

/** La raiz del repositorio: la carpeta que tiene schema/. */
function raizDelRepo(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'schema', 'level.schema.json'))) {
    const arriba = dirname(dir);
    if (arriba === dir) {
      throw new Error('No se encontro schema/level.schema.json subiendo desde ' + process.cwd());
    }
    dir = arriba;
  }
  return dir;
}

const RAIZ = raizDelRepo();
const ASSETS = join(RAIZ, 'assets');
const NIVELES = join(RAIZ, 'levels');
const CASOS = join(RAIZ, 'tests', 'contract');

const leerJson = <T>(ruta: string): T => JSON.parse(readFileSync(ruta, 'utf8')) as T;
const jsonsDe = (dir: string) => readdirSync(dir).filter((nombre) => nombre.endsWith('.json')).sort();

const SCHEMA = leerJson<Record<string, unknown>>(join(RAIZ, 'schema', 'level.schema.json'));
const CATALOGO = leerJson<EventCatalog>(join(RAIZ, 'schema', 'event_catalog.json'));

interface Caso {
  descripcion: string;
  motor: string;
  editor: 'abre' | 'rechaza';
  origen?: 'editor' | 'a_mano';
  motivo?: 'no_expresable' | 'debilidad';
  semantica?: 'acepta' | 'rechaza';
  nota?: string;
}
type Carpeta = 'valid' | 'invalid' | 'limite';
const INDICE = leerJson<Record<Carpeta, Record<string, Caso>>>(join(CASOS, 'casos.json'));
const casosDe = (carpeta: Carpeta) => Object.keys(INDICE[carpeta]).sort();

// --- Schema ------------------------------------------------------------------

// Modo estricto: un schema con palabras clave desconocidas o mal combinadas no compila.
const ajv = new Ajv({ strict: true, allErrors: true });
const validarSchema = ajv.compile(SCHEMA);

interface Resultado {
  valido: boolean;
  mensaje: string;
  datos?: unknown;
}

function validarTexto(texto: string): Resultado {
  let datos: unknown;
  try {
    datos = JSON.parse(texto);
  } catch (error) {
    return { valido: false, mensaje: 'JSON invalido: ' + (error as Error).message };
  }
  const valido = validarSchema(datos);
  return { valido, mensaje: valido ? '' : ajv.errorsText(validarSchema.errors, { dataVar: 'nivel' }), datos };
}

const validarArchivo = (ruta: string) => validarTexto(readFileSync(ruta, 'utf8'));

// --- Validacion semantica ----------------------------------------------------
//
// Lo que el schema no puede pedir: que las casillas esten dentro de la grilla
// (el motor rechaza el nivel si no), que los ids no se repitan, que lo que se
// referencia exista, y que los eventos usen bloques y parametros del catalogo.

interface Contexto {
  /** Carpeta del nivel, para ver que exista el archivo de un level_ref. */
  carpeta?: string;
  /** Si se pasa, tambien se revisa que las texturas existan en assets/. */
  assets?: string;
}

function texturasDe(nivel: Level): string[] {
  const texturas = [
    ...nivel.entities.map((entidad) => entidad.texture),
    nivel.visuals?.floor?.texture,
    nivel.visuals?.wall?.texture,
    ...(nivel.visuals?.floorVariants ?? []).map((variante) => variante.texture),
    nivel.backgroundImage?.texture,
    ...(nivel.items ?? []).map((objeto) => objeto.texture),
    ...(nivel.rooms ?? []).map((sala) => sala.floorTexture),
    ...(nivel.tunnels ?? []).map((tunel) => tunel.floorTexture),
    ...(nivel.floorPaint ?? []).map((casilla) => casilla.texture),
  ];
  return [...new Set(texturas.filter((textura): textura is string => !!textura))];
}

function erroresSemanticos(nivel: Level, contexto: Contexto = {}): string[] {
  const errores: string[] = [];
  const { width, height } = nivel.grid;
  const dentro = (col: number, row: number) => col >= 0 && row >= 0 && col < width && row < height;

  const variantes = nivel.visuals?.floorVariants?.length ?? 0;
  for (const casilla of nivel.tiles ?? []) {
    if (!dentro(casilla.col, casilla.row)) {
      errores.push(`tiles: la casilla ${casilla.col},${casilla.row} queda fuera de la grilla de ${width}x${height}`);
    }
    if (casilla.floorVariant !== undefined && casilla.floorVariant >= variantes) {
      errores.push(`tiles: la casilla ${casilla.col},${casilla.row} usa el piso ${casilla.floorVariant} y hay ${variantes}`);
    }
  }

  const ids = new Set<string>();
  for (const entidad of nivel.entities) {
    if (ids.has(entidad.id)) {
      errores.push(`entities: el id "${entidad.id}" esta repetido`);
    }
    ids.add(entidad.id);
    const { col, row } = entidad.position;
    if (!dentro(col, row)) {
      errores.push(`entities: "${entidad.id}" esta en ${col},${row}, fuera de la grilla de ${width}x${height}`);
    }
    if (!(entidad.sourceRect.width > 0 && entidad.sourceRect.height > 0)) {
      errores.push(`entities: "${entidad.id}" tiene un recorte de ${entidad.sourceRect.width}x${entidad.sourceRect.height}`);
    }
  }

  const salas = new Set<string>();
  for (const sala of nivel.rooms ?? []) {
    if (salas.has(sala.id)) {
      errores.push(`rooms: el id "${sala.id}" esta repetido`);
    }
    salas.add(sala.id);
  }
  for (const tunel of nivel.tunnels ?? []) {
    for (const extremo of [tunel.from, tunel.to]) {
      if (!salas.has(extremo)) {
        errores.push(`tunnels: "${tunel.id}" va a la sala "${extremo}", que no existe`);
      }
    }
  }
  const zonas = new Set([...salas, ...(nivel.zones ?? []).map((zona) => zona.id)]);

  const objetos = new Set((nivel.items ?? []).map((objeto) => objeto.id));
  for (const entidad of nivel.entities) {
    const usados = [
      entidad.item,
      entidad.weapon,
      ...(entidad.drops ?? []).map((botin) => botin.item),
      ...(entidad.inventory?.items ?? []),
      ...(entidad.shop?.items ?? []).map((venta) => venta.item),
    ];
    for (const id of usados) {
      if (id && !objetos.has(id)) {
        errores.push(`entities: "${entidad.id}" usa el objeto "${id}", que no esta en items`);
      }
    }
  }

  const problemaDe = (param: CatalogParamDef, valor: unknown): string | null => {
    const texto = typeof valor === 'string';
    switch (param.type) {
      case 'number':
        return typeof valor === 'number' && Number.isFinite(valor) ? null : `deberia ser un numero y es ${JSON.stringify(valor)}`;
      case 'boolean':
        return typeof valor === 'boolean' ? null : `deberia ser true o false y es ${JSON.stringify(valor)}`;
      case 'choice':
        return (param.options ?? []).some((opcion) => opcion.value === valor) ? null : `${JSON.stringify(valor)} no es una de sus opciones`;
      case 'entity_ref':
        return texto && ids.has(valor) ? null : `la entidad ${JSON.stringify(valor)} no existe`;
      case 'zone_ref':
        return texto && zonas.has(valor) ? null : `la sala o zona ${JSON.stringify(valor)} no existe`;
      case 'item_ref':
        return texto && (valor === '' || objetos.has(valor)) ? null : `el objeto ${JSON.stringify(valor)} no esta en items`;
      case 'level_ref':
        if (!texto || !valor) {
          return `deberia ser un archivo de nivel y es ${JSON.stringify(valor)}`;
        }
        return !contexto.carpeta || existsSync(join(contexto.carpeta, valor)) ? null : `el nivel "${valor}" no existe junto a este`;
      default:
        return texto ? null : `deberia ser un texto y es ${JSON.stringify(valor)}`;
    }
  };

  const revisarPaso = (paso: EventStep, seccion: keyof EventCatalog, donde: string) => {
    const bloque = CATALOGO[seccion].find((entrada) => entrada.type === paso.type);
    if (!bloque) {
      errores.push(`${donde}: "${paso.type}" no esta en ${seccion} de event_catalog.json`);
      return;
    }
    for (const [clave, valor] of Object.entries(paso.params)) {
      const param = bloque.params[clave];
      if (!param) {
        errores.push(`${donde}: "${paso.type}" no declara el parametro "${clave}"`);
        continue;
      }
      const problema = problemaDe(param, valor);
      if (problema) {
        errores.push(`${donde}.params.${clave}: ${problema}`);
      }
    }
    // Sin la entidad, la zona o el nivel, el bloque no puede hacer nada.
    for (const [clave, param] of Object.entries(bloque.params)) {
      if (['entity_ref', 'zone_ref', 'level_ref'].includes(param.type) && !(clave in paso.params)) {
        errores.push(`${donde}: "${paso.type}" no trae el parametro "${clave}"`);
      }
    }
  };
  nivel.events.forEach((evento, i) => {
    revisarPaso(evento.trigger, 'triggers', `events[${i}].trigger`);
    (evento.conditions ?? []).forEach((paso, j) => revisarPaso(paso, 'conditions', `events[${i}].conditions[${j}]`));
    evento.actions.forEach((paso, j) => revisarPaso(paso, 'actions', `events[${i}].actions[${j}]`));
  });

  if (contexto.assets) {
    for (const textura of texturasDe(nivel)) {
      if (!existsSync(join(contexto.assets, textura))) {
        errores.push(`la textura "${textura}" no esta en assets/`);
      }
    }
  }
  return errores;
}

// --- El editor ---------------------------------------------------------------

/** Abre un texto con el parseLevel real de ProjectService, como el menu Abrir. */
async function abrirEnEditor(texto: string): Promise<Level> {
  const anterior = window.honeycombProject;
  window.honeycombProject = { readFile: async () => texto } as unknown as typeof window.honeycombProject;
  try {
    return await new ProjectService().readLevelAt('levels/caso.json');
  } finally {
    window.honeycombProject = anterior;
  }
}

/**
 * El editor armado con sus servicios y controladores reales. Solo el disco es
 * de mentira: un mapa con el texto que se escribiria en levels/.
 */
function armarEditor() {
  const disco = new Map<string, string>();
  const proyecto = {
    saveLevel: async (archivo: string, nivel: Level) => {
      disco.set(archivo, JSON.stringify(nivel, null, 2));
    },
    readLevel: async (archivo: string) => abrirEnEditor(disco.get(archivo) ?? ''),
  };
  TestBed.configureTestingModule({ providers: [{ provide: ProjectService, useValue: proyecto }] });
  TestBed.inject(CatalogService).catalog.set(CATALOGO);
  const nada = () => undefined;
  const crear = <T>(fabrica: () => T) => TestBed.runInInjectionContext(fabrica);
  const niveles = TestBed.inject(LevelService);

  const ids = () => new Set(niveles.level().entities.map((entidad) => entidad.id));
  const entidad = (id: string) => {
    const encontrada = niveles.level().entities.find((candidata) => candidata.id === id);
    if (!encontrada) {
      throw new Error('No hay una entidad ' + id);
    }
    return encontrada;
  };
  /** Como arrastrar un personaje de la paleta a la grilla. */
  const colocarPersonaje = (preset: CharacterPreset, col: number, row: number) => {
    const nueva = entityFromPreset(preset, { col, row }, ids());
    niveles.addEntity(nueva);
    return nueva.id;
  };
  const base = (tipo: string) => presetFromArchetype(characterDef(tipo) ?? (undefined as never));

  return {
    disco,
    niveles,
    biblioteca: TestBed.inject(ItemLibraryService),
    eventos: crear(() => new EventsController(nada, nada, nada)),
    combate: crear(() => new CombatInspectorController(nada)),
    puzzle: crear(() => new PuzzleController(nada, nada, nada)),
    fondo: crear(() => new BackgroundPickerController(nada)),
    entidad,
    colocarPersonaje,
    base,
    /** Como soltar un objeto de la paleta: copia la definicion y coloca la entidad. */
    colocarObjeto: (id: string, col: number, row: number) => {
      const definicion = TestBed.inject(ItemLibraryService).find(id);
      if (!definicion) {
        throw new Error('No hay un objeto ' + id);
      }
      niveles.upsertItems([definicion]);
      const nueva = entityFromItem(definicion, { col, row }, ids());
      niveles.addEntity(nueva);
      return nueva.id;
    },
    /** Como soltar una figura: la misma entidad que arma EntityOpsController.shapeEntity. */
    colocarFigura: (tipo: string, col: number, row: number) => {
      const figura = shapeDef(tipo) ?? (undefined as never);
      const id = nextFreeId(figura.id, ids());
      niveles.addEntity({
        id,
        type: figura.id,
        position: { col, row },
        texture: SHAPE_TEXTURE,
        sourceRect: { ...figura.sourceRect },
        groundOffset: figura.groundOffset,
      });
      return id;
    },
    async guardar(): Promise<string> {
      await niveles.save();
      return disco.get(niveles.fileName() ?? '') ?? '';
    },
  };
}
type Editor = ReturnType<typeof armarEditor>;
const GRILLA = (width: number, height: number) => ({ width, height, tileWidth: 64, tileHeight: 32 });

// Biblioteca de objetos del proyecto, leida como la lee el editor (normalizeItem).
function bibliotecaDeObjetos() {
  return [
    normalizeItem({
      ...newItemDraft('weapon', 'melee'),
      id: 'espada',
      name: 'Espada',
      texture: 'textures/shapes.png',
      weapon: { ...defaultWeapon('melee'), ability: defaultAbility('melee') },
    }),
    normalizeItem({
      ...newItemDraft('weapon', 'ranged'),
      id: 'arco',
      name: 'Arco',
      texture: 'textures/shapes.png',
      weapon: { ...defaultWeapon('ranged'), ability: defaultAbility('ranged') },
    }),
    normalizeItem({ ...newItemDraft('healing'), id: 'pocion', name: 'Poción', texture: 'textures/player2.png' }),
    normalizeItem({ ...newItemDraft('coin'), id: 'moneda', name: 'Moneda', value: 5, scale: 0.5 }),
  ];
}

interface Escenario {
  archivo: string;
  armar: (editor: Editor) => void;
}

const ESCENARIOS: Escenario[] = [
  {
    archivo: 'salas_y_tuneles.json',
    armar: (ed) => {
      ed.niveles.createNew('salas_y_tuneles', GRILLA(8, 8));
      // La grilla de 8x8 se vuelve "sala_1"; la nueva se engancha por los lados.
      ed.niveles.addRoom(
        { id: 'sala_2', col: 11, row: 2, width: 5, height: 4 },
        { to: 'sala_1', width: 2, fromSide: 'right', toSide: 'left' },
      );
      ed.niveles.addRoom({ id: 'sala_3', col: 2, row: 12, width: 4, height: 3 }, null);
      ed.niveles.addTunnel({ from: 'sala_1', to: 'sala_3', width: 1 });
      ed.niveles.updateTunnel('tunel_2', { path: [{ col: 4, row: 9 }, { col: 3, row: 10 }] });
      ed.niveles.toggleTile(3, 3, 'wall');
      ed.colocarPersonaje(ed.base('player'), 2, 2);
    },
  },
  {
    archivo: 'pisos_por_capas.json',
    armar: (ed) => {
      ed.niveles.createNew('pisos_por_capas', GRILLA(8, 8));
      ed.niveles.addRoom({ id: 'sala_2', col: 11, row: 2, width: 4, height: 4 }, { to: 'sala_1', width: 1 });
      ed.niveles.setRoomFloor('sala_2', 'textures/shapes.png');
      ed.niveles.setTunnelFloor('tunel_1', 'textures/wall.png');
      ed.niveles.paintFloor([{ col: 2, row: 2 }, { col: 3, row: 2 }], 'textures/player2.png');
      ed.colocarPersonaje(ed.base('player'), 4, 4);
    },
  },
  {
    archivo: 'camara_y_fondo.json',
    armar: (ed) => {
      ed.niveles.createNew('camara_y_fondo', GRILLA(12, 10));
      ed.colocarPersonaje(ed.base('player'), 5, 5);
      ed.niveles.updateCamera({
        mode: 'follow',
        zoom: 2,
        smoothing: 0.3,
        deadzone: { width: 96, height: 48 },
        clampToLevel: false,
        cullMargin: 3,
      });
      ed.fondo.patchBackground({ r: 30, g: 40, b: 60 });
      ed.fondo.setBackgroundImage('floor.png');
      ed.fondo.setBackgroundMode('tile');
    },
  },
  {
    archivo: 'combate_y_objetos.json',
    armar: (ed) => {
      ed.biblioteca.items.set(bibliotecaDeObjetos());
      ed.niveles.createNew('combate_y_objetos', GRILLA(12, 12));
      const jugador = ed.colocarPersonaje(ed.base('player'), 2, 2);
      const esqueleto = ed.colocarPersonaje(normalizePreset({ name: 'Esqueleto', kind: 'enemy', scale: 1.5 }), 8, 8);
      const vendedor = ed.colocarPersonaje(ed.base('npc'), 2, 9);
      ed.colocarObjeto('moneda', 5, 5);

      ed.combate.addStartItem(ed.entidad(jugador), 'espada');
      ed.combate.patchInventory(ed.entidad(jugador), { slots: 4, coins: 10, onFull: 'auto_replace' });
      ed.combate.setDashEnabled(ed.entidad(jugador), true);
      ed.combate.patchDash(ed.entidad(jugador), 'distance', 4);
      ed.combate.setDefenseEnabled(ed.entidad(jugador), true);
      ed.combate.patchDefensePercent(ed.entidad(jugador), 'reduction', 60);

      ed.combate.setWeapon(ed.entidad(esqueleto), 'arco');
      ed.combate.addDrop(ed.entidad(esqueleto));
      ed.combate.setDropItem(ed.entidad(esqueleto), 0, 'pocion');
      ed.combate.setDropPercent(ed.entidad(esqueleto), 0, 25);

      ed.combate.addShopItem(ed.entidad(vendedor));
      ed.combate.setShopItem(ed.entidad(vendedor), 0, { item: 'pocion', price: 7 });
    },
  },
  {
    archivo: 'puzzle_y_eventos.json',
    armar: (ed) => {
      ed.niveles.createNew('puzzle_y_eventos', GRILLA(8, 8));
      ed.niveles.addRoom({ id: 'sala_2', col: 11, row: 1, width: 5, height: 5 }, { to: 'sala_1', width: 1 });
      ed.niveles.addZone({ id: 'pasillo', col: 7, row: 3, width: 4, height: 1 });
      ed.colocarPersonaje(ed.base('player'), 2, 2);
      const jefe = ed.colocarPersonaje(ed.base('enemy'), 13, 3);
      const puerta = ed.colocarFigura('cube', 10, 3);
      // La casilla Pared del inspector.
      ed.niveles.updateEntity(puerta, { wall: true, collider: shapeCollider(shapeDef('cube') ?? (undefined as never), GRILLA(1, 1)) });

      // Puzzle: vencer al jefe abre la puerta, que se cierra al entrar a la sala.
      ed.puzzle.open();
      ed.puzzle.patch({ kind: 'boss', zone: 'sala_2', boss: jefe, lockOnEnter: true, message: '¡La puerta se abrió!' });
      ed.puzzle.toggleGate(puerta, true);
      ed.puzzle.confirm();

      // Un evento armado a mano en el panel Eventos.
      ed.eventos.addEvent();
      let i = ed.niveles.level().events.length - 1;
      ed.eventos.changeTrigger(i, 'on_items_collected');
      ed.eventos.updateStepParam('trigger', i, 0, 'count', '3');
      ed.eventos.addCondition(i);
      ed.eventos.changeCondition(i, 0, 'variable_compare');
      ed.eventos.updateStepParam('condition', i, 0, 'variable', 'llaves');
      ed.eventos.updateStepParam('condition', i, 0, 'value', '2');
      ed.eventos.addAction(i);
      ed.eventos.changeAction(i, 0, 'add_variable');
      ed.eventos.updateStepParam('action', i, 0, 'variable', 'llaves');
      ed.eventos.addAction(i);
      ed.eventos.changeAction(i, 1, 'set_flag');
      ed.eventos.updateStepParam('action', i, 1, 'flag', 'tesoro');
      ed.eventos.updateStepParam('action', i, 1, 'persist', true);

      // Y otro que pasa de nivel.
      ed.eventos.addEvent();
      i = ed.niveles.level().events.length - 1;
      ed.eventos.changeTrigger(i, 'on_all_enemies_defeated');
      ed.eventos.addAction(i);
      ed.eventos.changeAction(i, 0, 'load_level');
      ed.eventos.updateStepParam('action', i, 0, 'level', 'minimo.json');
      ed.eventos.updateStepParam('action', i, 0, 'message', '¡Sala superada!');
    },
  },
];

// Lo que guarda el editor en cada escenario, armado una sola vez.
const guardados = new Map<string, string>();
async function guardadoDe(escenario: Escenario): Promise<string> {
  let texto = guardados.get(escenario.archivo);
  if (texto === undefined) {
    const editor = armarEditor();
    escenario.armar(editor);
    texto = await editor.guardar();
    guardados.set(escenario.archivo, texto);
  }
  return texto;
}

// --- Excepciones conocidas en levels/ ------------------------------------------

// Texturas que no estan en assets/: los archivos no se subieron al repositorio.
// El motor carga igual el nivel (raylib avisa y la entidad queda sin sprite).
const TEXTURAS_FALTANTES: Record<string, string[]> = {
  'combate_demo.json': ['textures/WhatsApp Image 2026-09-28 at 6.02.02 PM.jpeg'],
  'Test_Ajuste.json': ['textures/♡.jpg'],
  'Test_imagen.json': ['textures/bf4f7e8e-9d8c-4503-8ed5-0d064c11ddd9.png', 'textures/(NieR Replicant).png'],
};

const NIVELES_DE_LEVELS = jsonsDe(NIVELES);

// ==============================================================================

describe('contrato de niveles', () => {
  describe('schema', () => {
    it('es draft-07 y compila en modo estricto', () => {
      expect(SCHEMA['$schema']).toBe('http://json-schema.org/draft-07/schema#');
      expect(typeof validarSchema).toBe('function');
    });

    it('pide name, grid, entities y events en la raiz', () => {
      expect(SCHEMA['required']).toEqual(['name', 'grid', 'entities', 'events']);
    });
  });

  describe('niveles de levels/', () => {
    it('hay niveles para revisar', () => {
      expect(NIVELES_DE_LEVELS.length).toBeGreaterThan(0);
    });

    it.each(NIVELES_DE_LEVELS)('%s cumple el schema', (archivo) => {
      const resultado = validarArchivo(join(NIVELES, archivo));
      expect(resultado.mensaje).toBe('');
      expect(resultado.valido).toBe(true);
    });

    it.each(NIVELES_DE_LEVELS)('%s pasa la validacion semantica', (archivo) => {
      const nivel = leerJson<Level>(join(NIVELES, archivo));
      const esperados = (TEXTURAS_FALTANTES[archivo] ?? []).map((textura) => `la textura "${textura}" no esta en assets/`);
      expect(erroresSemanticos(nivel, { carpeta: NIVELES, assets: ASSETS })).toEqual(esperados);
    });

    it.each(NIVELES_DE_LEVELS)('el editor abre %s', async (archivo) => {
      const nivel = await abrirEnEditor(readFileSync(join(NIVELES, archivo), 'utf8'));
      expect(nivel.grid).toEqual(leerJson<Level>(join(NIVELES, archivo)).grid);
    });

    it.each(NIVELES_DE_LEVELS)(
      'abrir y guardar %s en el editor deja el mismo nivel',
      async (archivo) => {
        const original = leerJson<Level>(join(NIVELES, archivo));
        const guardado = JSON.parse(JSON.stringify(levelForDisk(await abrirEnEditor(JSON.stringify(original)))));
        expect(guardado).toEqual(original);
      },
    );  });

  describe('indice de casos', () => {
    it.each(['valid', 'invalid', 'limite'] as const)('casos.json lista exactamente los archivos de %s/', (carpeta) => {
      expect(casosDe(carpeta)).toEqual(jsonsDe(join(CASOS, carpeta)));
    });

    it('cada caso dice que se espera del motor y del editor', () => {
      const motores = Object.keys(leerJson<Record<string, object>>(join(CASOS, 'casos.json'))['motor' as never]);
      for (const carpeta of ['valid', 'invalid', 'limite'] as const) {
        for (const [archivo, caso] of Object.entries(INDICE[carpeta])) {
          expect(caso.descripcion, archivo).toMatch(/\S/);
          expect(motores, archivo).toContain(caso.motor);
          expect(['abre', 'rechaza'], archivo).toContain(caso.editor);
        }
      }
    });
  });

  describe('casos validos', () => {
    it.each(casosDe('valid'))('%s cumple el schema y la validacion semantica', (archivo) => {
      const resultado = validarArchivo(join(CASOS, 'valid', archivo));
      expect(resultado.mensaje).toBe('');
      expect(erroresSemanticos(resultado.datos as Level, { carpeta: join(CASOS, 'valid'), assets: ASSETS })).toEqual([]);
    });

    it.each(casosDe('valid'))('el editor abre %s', async (archivo) => {
      await expect(abrirEnEditor(readFileSync(join(CASOS, 'valid', archivo), 'utf8'))).resolves.toBeTruthy();
    });

    it('los de origen editor son los escenarios que arma el editor', () => {
      const delEditor = casosDe('valid').filter((archivo) => INDICE.valid[archivo].origen === 'editor');
      expect(delEditor).toEqual(ESCENARIOS.map((escenario) => escenario.archivo).sort());
    });
  });

  describe('casos invalidos', () => {
    it.each(casosDe('invalid'))('%s se rechaza con un mensaje', (archivo) => {
      const resultado = validarArchivo(join(CASOS, 'invalid', archivo));
      expect(resultado.valido).toBe(false);
      expect(resultado.mensaje).toMatch(/\S/);
    });

    it.each(casosDe('invalid'))('el editor abre o rechaza %s como dice casos.json', async (archivo) => {
      const texto = readFileSync(join(CASOS, 'invalid', archivo), 'utf8');
      if (INDICE.invalid[archivo].editor === 'rechaza') {
        await expect(abrirEnEditor(texto)).rejects.toThrow(/\S/);
      } else {
        await expect(abrirEnEditor(texto)).resolves.toBeTruthy();
      }
    });
  });

  describe('casos limite', () => {
    const LIMITE = casosDe('limite');
    const caso = (archivo: string) => INDICE.limite[archivo];
    const semantica = (archivo: string) => {
      const resultado = validarArchivo(join(CASOS, 'limite', archivo));
      return erroresSemanticos(resultado.datos as Level, { carpeta: join(CASOS, 'limite'), assets: ASSETS });
    };

    it.each(LIMITE.filter((archivo) => caso(archivo).motivo === 'no_expresable'))(
      '%s cumple el schema: JSON Schema no lo puede expresar',
      (archivo) => {
        expect(validarArchivo(join(CASOS, 'limite', archivo)).valido).toBe(true);
      },
    );

    // Debilidad conocida del schema: acepta estos casos aunque podria rechazarlos
    // (ver "nota" en casos.json). Si el schema se ajusta, pasar el caso a invalid/.
    it.fails.each(LIMITE.filter((archivo) => caso(archivo).motivo === 'debilidad'))(
      'el schema deberia rechazar %s',
      (archivo) => {
        expect(validarArchivo(join(CASOS, 'limite', archivo)).valido).toBe(false);
      },
    );

    it.each(LIMITE.filter((archivo) => caso(archivo).semantica === 'rechaza'))(
      'la validacion semantica rechaza %s con un mensaje',
      (archivo) => {
        const errores = semantica(archivo);
        expect(errores.length).toBeGreaterThan(0);
        expect(errores.join('\n')).toMatch(/\S/);
      },
    );

    it.each(LIMITE.filter((archivo) => caso(archivo).semantica === 'acepta'))(
      'la validacion semantica tampoco atrapa %s',
      (archivo) => {
        expect(semantica(archivo)).toEqual([]);
      },
    );

    it.each(LIMITE)('el editor abre %s', async (archivo) => {
      expect(caso(archivo).editor).toBe('abre');
      await expect(abrirEnEditor(readFileSync(join(CASOS, 'limite', archivo), 'utf8'))).resolves.toBeTruthy();
    });
  });

  describe('niveles que arma el editor', () => {
    it.each(ESCENARIOS)('$archivo cumple el schema', async (escenario) => {
      const resultado = validarTexto(await guardadoDe(escenario));
      expect(resultado.mensaje).toBe('');
      expect(resultado.valido).toBe(true);
    });

    it.each(ESCENARIOS)('$archivo pasa la validacion semantica', async (escenario) => {
      const nivel = JSON.parse(await guardadoDe(escenario)) as Level;
      expect(erroresSemanticos(nivel, { carpeta: join(CASOS, 'valid'), assets: ASSETS })).toEqual([]);
    });

    it.each(ESCENARIOS)('$archivo es el caso de tests/contract/valid/', async (escenario) => {
      await expect(await guardadoDe(escenario)).toMatchFileSnapshot(join(CASOS, 'valid', escenario.archivo));
    });

    it.each(ESCENARIOS)('los objetos de $archivo ya vienen normalizados', async (escenario) => {
      const nivel = JSON.parse(await guardadoDe(escenario)) as Level;
      for (const objeto of nivel.items ?? []) {
        expect(JSON.parse(JSON.stringify(normalizeItem(objeto)))).toEqual(objeto);
      }
    });

    // Se compara el JSON ya leido y no el texto: parseLevel puede reordenar las
    // claves, y el orden no cambia lo que lee el motor.
    const reabrir = async (escenario: Escenario) => {
      const texto = await guardadoDe(escenario);
      const editor = armarEditor();
      editor.disco.set(escenario.archivo, texto);
      await editor.niveles.load(escenario.archivo);
      return { antes: JSON.parse(texto), despues: JSON.parse(await editor.guardar()) };
    };

    it.each(ESCENARIOS)(
      'guardar, abrir y volver a guardar $archivo deja el mismo nivel',
      async (escenario) => {
        const { antes, despues } = await reabrir(escenario);
        expect(despues).toEqual(antes);
      },
    );
  });
});
