// Genera las escenas del protocolo de rendimiento (plan de calidad, seccion 6.5)
// y las de estres, para medirlas con la sonda engine_perf (engine/perf).
//
// Uso:
//   node tools/gen-escenas-rendimiento.mjs [--salida <carpeta>] [--solo protocolo|estres|todo] [--validar]
//   node tools/gen-escenas-rendimiento.mjs --escena entidades:5000:128 --escena grilla:1024:tiles
//
// Por defecto escribe en engine/build-perf/escenas, FUERA de levels/: son
// archivos descartables y algunos pesan cientos de MB. La carpeta es un
// proyecto chico, porque el motor busca las texturas en <nivel>/../../assets:
//   escenas/levels/*.json         los niveles (y _arranque.json, uno vacio)
//   escenas/assets/textures/      copias de las texturas del repo que usan,
//   escenas/assets/textures/rendimiento/   y las generadas para el estres
//
// Las escenas son DETERMINISTAS (mismo sorteo con la misma semilla) y estan
// anidadas: las 100 entidades de la escena de 100 son las primeras 100 de la
// de 250, y asi. Entre las del protocolo cambia solo cuantas entidades hay:
// la grilla, el jugador y su recorrido son los mismos.
//
// Tipos de escena (--escena tipo:parametros):
//   entidades:N[:lado]   N entidades en una grilla lado x lado (64 por defecto)
//   grilla:L:tiles|rect  las 500 entidades del protocolo en una grilla L x L;
//                        "tiles" escribe cada casilla (como guarda el editor),
//                        "rect" no escribe "tiles" (rectangulo que arma el motor)
//   eventos:N            las 500 entidades y N eventos (con sus zonas)
//   combate:N            N enemigos armados alrededor del jugador
//   texturas:N           las 500 entidades y N texturas de piso distintas
//   serie:K              el nivel K de una serie con 300 texturas propias cada
//                        uno (para la cache de texturas al pasar de nivel)
//
// La mezcla de entidades: 40% enemigos (3 de cada 4 pegan por contacto, 1 con
// arco), 40% objetos solidos ("prop") y 20% pociones para juntar. Los enemigos
// persiguen al jugador (Combat::Chase) cuando lo tienen a 6 casillas. En el
// protocolo el dano es 0 y el jugador tiene vida de sobra: la escena no cambia
// sola a mitad de la medicion (nadie muere, las pociones con la vida llena no
// se juntan), y lo que se mide es siempre la misma cantidad de entidades.
//
// El jugador camina un cuadrado de LADO_RECORRIDO casillas (la sonda aprieta
// las flechas 4 s por lado a 3 casillas/s); ese pasillo queda libre.

import { copyFileSync, existsSync, mkdirSync, openSync, closeSync, writeSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deflateSync } from 'node:zlib';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const SALIDA_POR_DEFECTO = join(ROOT, 'engine', 'build-perf', 'escenas');

// --- Constantes de las escenas ------------------------------------------------

export const LADO_PROTOCOLO = 64;
export const ENTIDADES_PROTOCOLO = [100, 250, 500, 1000];
const LADO_RECORRIDO = 12;
const VELOCIDAD_JUGADOR = 3;
const SEMILLA = 65; // la seccion 6.5 del plan
const TEXTURAS_POR_NIVEL_SERIE = 300;

// Texturas del repo que usan las escenas (se copian al proyecto de escenas).
const TEXTURAS_REPO = ['floor.png', 'wall.png', 'player.png', 'player2.png', 'shapes.png'];

// --- Sorteo determinista --------------------------------------------------------

function mulberry32(semilla) {
  let estado = semilla >>> 0;
  return () => {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mezclar(lista, azar) {
  for (let i = lista.length - 1; i > 0; i -= 1) {
    const j = Math.floor(azar() * (i + 1));
    [lista[i], lista[j]] = [lista[j], lista[i]];
  }
  return lista;
}

// --- Piezas de un nivel ---------------------------------------------------------

const VISUALES = {
  floor: { texture: 'textures/floor.png', sourceRect: { x: 0, y: 0, width: 64, height: 64 } },
  wall: { texture: 'textures/wall.png', sourceRect: { x: 0, y: 0, width: 32, height: 32 } },
};

const CAMARA = { mode: 'follow', zoom: 1, smoothing: 0.15, deadzone: { width: 0, height: 0 }, clampToLevel: true };

function objetos(danoArco) {
  return [
    {
      id: 'pocion',
      name: 'Poción',
      kind: 'healing',
      texture: 'textures/shapes.png',
      sourceRect: { x: 132, y: 98, width: 64, height: 96 },
      scale: 0.3,
      heal: 30,
    },
    {
      id: 'arco_rend',
      name: 'Arco de prueba',
      kind: 'weapon',
      texture: 'textures/shapes.png',
      sourceRect: { x: 132, y: 0, width: 64, height: 96 },
      scale: 0.3,
      weapon: {
        category: 'ranged',
        attack: { pattern: 'projectile', damage: danoArco, cooldown: 1.4, range: 6, speed: 6, width: 0.35 },
      },
    },
  ];
}

function jugador(col, row) {
  return {
    id: 'player_1',
    type: 'player',
    position: { col, row },
    texture: 'textures/player.png',
    sourceRect: { x: 0, y: 0, width: 16, height: 16 },
    animation: 'player_idle',
    scale: 2,
    collider: { width: 16, height: 16 },
    // Vida de sobra: en la medicion nadie tiene que morir.
    stats: { health: 1000000000, damage: 0, speed: VELOCIDAD_JUGADOR },
  };
}

function enemigo(id, col, row, { armado = false, dano = 0 } = {}) {
  const entidad = {
    id,
    type: 'enemy',
    position: { col, row },
    texture: 'textures/player2.png',
    sourceRect: { x: 0, y: 0, width: 16, height: 16 },
    frames: 2,
    frameDuration: 0.2,
    scale: 2,
    collider: { width: 16, height: 16, solid: false },
    stats: { health: 30, damage: dano, speed: 1.5 },
  };
  if (armado) entidad.weapon = 'arco_rend';
  return entidad;
}

function prop(id, col, row) {
  return {
    id,
    type: 'prop',
    position: { col, row },
    texture: 'textures/shapes.png',
    sourceRect: { x: 0, y: 0, width: 64, height: 96 },
    scale: 0.5,
    collider: { width: 32, height: 16, solid: true },
  };
}

function pocion(id, col, row) {
  return {
    id,
    type: 'item',
    item: 'pocion',
    position: { col, row },
    texture: 'textures/shapes.png',
    sourceRect: { x: 132, y: 98, width: 64, height: 96 },
    scale: 0.3,
    collider: { width: 16, height: 16 },
  };
}

// --- La distribucion de las entidades ---------------------------------------------
//
// Dentro de una "ventana" de lado x lado casillas que empieza en (c0, r0): el
// jugador arranca en una esquina del cuadrado que recorre, cerca del centro, y
// las entidades se sortean entre las casillas libres del interior (sin el borde
// de la ventana, que en la grilla del protocolo es la pared).

function recorrido(c0, r0, lado) {
  const p = Math.floor(lado / 2) - Math.floor(LADO_RECORRIDO / 2);
  return { col: c0 + p, row: r0 + p };
}

function enPasillo(col, row, inicio) {
  const a = inicio.col;
  const b = inicio.row;
  const fin = LADO_RECORRIDO;
  const cercaFila = (Math.abs(row - b) <= 1 || Math.abs(row - (b + fin)) <= 1) && col >= a - 1 && col <= a + fin + 1;
  const cercaColumna = (Math.abs(col - a) <= 1 || Math.abs(col - (a + fin)) <= 1) && row >= b - 1 && row <= b + fin + 1;
  return cercaFila || cercaColumna;
}

const casillasCache = new Map();
function casillasLibres(lado) {
  if (!casillasCache.has(lado)) {
    const inicio = recorrido(0, 0, lado);
    const libres = [];
    for (let row = 1; row < lado - 1; row += 1) {
      for (let col = 1; col < lado - 1; col += 1) {
        if (!enPasillo(col, row, inicio)) libres.push([col, row]);
      }
    }
    casillasCache.set(lado, mezclar(libres, mulberry32(SEMILLA)));
  }
  return casillasCache.get(lado);
}

// El tipo sale del indice, asi la mezcla es la misma con cualquier N.
function entidadNumero(i, col, row) {
  const k = i % 10;
  if (k <= 2) return enemigo(`enemigo_${i}`, col, row);
  if (k === 3) return enemigo(`enemigo_${i}`, col, row, { armado: true });
  if (k <= 7) return prop(`prop_${i}`, col, row);
  return pocion(`pocion_${i}`, col, row);
}

export function distribuir(n, lado, c0 = 0, r0 = 0) {
  const libres = casillasLibres(lado);
  if (n > libres.length) {
    throw new Error(`No entran ${n} entidades en una grilla de ${lado}x${lado} (hay ${libres.length} casillas libres)`);
  }
  const inicio = recorrido(c0, r0, lado);
  const entidades = [jugador(inicio.col, inicio.row)];
  for (let i = 0; i < n; i += 1) {
    const [col, row] = libres[i];
    entidades.push(entidadNumero(i, c0 + col, r0 + row));
  }
  return entidades;
}

// --- Escritura ------------------------------------------------------------------
//
// Los niveles chicos van con JSON.stringify. Los que escriben cada casilla
// ("tiles") se escriben de a pedazos: una grilla de 2048x2048 son 4 millones de
// casillas, un texto de mas de 100 MB que no conviene armar entero en memoria.

function escribirNivel(ruta, nivel, casillas = null) {
  const { entities, events, ...cabecera } = nivel;
  const fd = openSync(ruta, 'w');
  try {
    writeSync(fd, JSON.stringify(cabecera).slice(0, -1));
    if (casillas) {
      writeSync(fd, ',"tiles":[');
      let pedazo = [];
      let primera = true;
      for (const casilla of casillas) {
        pedazo.push(casilla);
        if (pedazo.length >= 65536) {
          writeSync(fd, (primera ? '' : ',') + pedazo.join(','));
          primera = false;
          pedazo = [];
        }
      }
      if (pedazo.length) writeSync(fd, (primera ? '' : ',') + pedazo.join(','));
      writeSync(fd, ']');
    }
    writeSync(fd, `,"entities":${JSON.stringify(entities)},"events":${JSON.stringify(events)}}`);
  } finally {
    closeSync(fd);
  }
}

// Cada casilla de una grilla lado x lado, con pared en el borde (lo mismo que
// arma el motor cuando no hay "tiles"). "variante" da el floorVariant de cada una.
function* casillasRectangulo(lado, variante = null) {
  for (let row = 0; row < lado; row += 1) {
    for (let col = 0; col < lado; col += 1) {
      const borde = col === 0 || row === 0 || col === lado - 1 || row === lado - 1;
      const v = variante ? variante(col, row) : -1;
      yield `{"col":${col},"row":${row}${borde ? ',"wall":true' : ''}${v >= 0 ? `,"floorVariant":${v}` : ''}}`;
    }
  }
}

function nivelBase(nombre, lado, entidades, extra = {}) {
  return {
    name: nombre,
    backgroundColor: { r: 24, g: 24, b: 28 },
    camera: CAMARA,
    grid: { width: lado, height: lado, tileWidth: 64, tileHeight: 32 },
    visuals: { ...VISUALES },
    items: objetos(0),
    ...extra,
    entities: entidades,
    events: [],
  };
}

// --- Texturas generadas -------------------------------------------------------------
// Un PNG de 256x128 distinto por numero (un rombo de piso de otro color), con
// el mismo codificador minimo que tools/gen-shape-sprites.mjs.

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function pngPiso(numero) {
  const ancho = 256;
  const alto = 128;
  const raw = Buffer.alloc(alto * (1 + ancho * 4));
  const r = (numero * 97) % 256;
  const g = (numero * 57 + 80) % 256;
  const b = (numero * 31 + 160) % 256;
  for (let y = 0; y < alto; y += 1) {
    const fila = y * (1 + ancho * 4);
    for (let x = 0; x < ancho; x += 1) {
      // Dentro del rombo: |x - 128| / 128 + |y - 64| / 64 <= 1.
      const dentro = Math.abs(x - 128) / 128 + Math.abs(y - 64) / 64 <= 1;
      const i = fila + 1 + x * 4;
      const raya = ((x + y + numero) >> 3) & 1 ? 20 : 0;
      raw[i] = dentro ? Math.min(255, r + raya) : 0;
      raw[i + 1] = dentro ? g : 0;
      raw[i + 2] = dentro ? b : 0;
      raw[i + 3] = dentro ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ancho, 0);
  ihdr.writeUInt32BE(alto, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function texturaGenerada(salida, numero) {
  const relativa = `textures/rendimiento/piso_${String(numero).padStart(5, '0')}.png`;
  const ruta = join(salida, 'assets', relativa);
  if (!existsSync(ruta)) writeFileSync(ruta, pngPiso(numero));
  return relativa;
}

// --- El proyecto de escenas ------------------------------------------------------------

export function prepararProyecto(salida = SALIDA_POR_DEFECTO) {
  mkdirSync(join(salida, 'levels'), { recursive: true });
  mkdirSync(join(salida, 'assets', 'textures', 'rendimiento'), { recursive: true });
  for (const archivo of TEXTURAS_REPO) {
    copyFileSync(join(ROOT, 'assets', 'textures', archivo), join(salida, 'assets', 'textures', archivo));
  }
  // El nivel con que la sonda abre la ventana antes de cargar el de verdad
  // (ver engine/perf/SondaRendimiento.cpp): una casilla, sin nada.
  writeFileSync(
    join(salida, 'levels', '_arranque.json'),
    JSON.stringify({ name: '_arranque', grid: { width: 1, height: 1, tileWidth: 64, tileHeight: 32 }, entities: [], events: [] }),
  );
  return salida;
}

function eventos(n, entidades, lado) {
  const pociones = entidades.filter((e) => e.type === 'item').map((e) => e.id);
  const enemigos = entidades.filter((e) => e.type === 'enemy').map((e) => e.id);
  const azar = mulberry32(SEMILLA + 1);
  const zonas = [];
  const zona = () => {
    const id = `zona_${zonas.length}`;
    zonas.push({ id, col: 1 + Math.floor(azar() * (lado - 5)), row: 1 + Math.floor(azar() * (lado - 5)), width: 3, height: 3 });
    return id;
  };
  const lista = [];
  for (let i = 0; i < n; i += 1) {
    switch (i % 5) {
      case 0:
        lista.push({
          trigger: { type: 'on_collision', params: { entityA: 'player_1', entityB: pociones[i % pociones.length] } },
          actions: [{ type: 'add_variable', params: { variable: 'toques', amount: 1 } }],
        });
        break;
      case 1:
        lista.push({
          trigger: { type: 'on_player_enter_zone', params: { zone: zona() } },
          actions: [{ type: 'show_message', params: { text: `Zona ${i}` } }],
        });
        break;
      case 2:
        lista.push({
          trigger: { type: 'on_zone_cleared', params: { zone: zona() } },
          actions: [{ type: 'set_flag', params: { flag: `limpia_${i}` } }],
        });
        break;
      case 3:
        lista.push({
          trigger: { type: 'on_entity_destroyed', params: { entity: enemigos[i % enemigos.length] } },
          actions: [{ type: 'add_coins', params: { amount: 1 } }],
        });
        break;
      default:
        lista.push({
          trigger: { type: 'on_items_collected', params: { item: 'pocion', count: 0 } },
          conditions: [{ type: 'flag_is_not_set', params: { flag: `juntado_${i}` } }],
          actions: [{ type: 'set_flag', params: { flag: `juntado_${i}` } }],
        });
    }
  }
  return { lista, zonas };
}

// Genera una escena y devuelve la ruta del nivel. "spec" es el texto de --escena.
export function generarEscena(spec, salida = SALIDA_POR_DEFECTO) {
  const [tipo, a, b] = spec.split(':');
  const n = Number(a);
  const niveles = join(salida, 'levels');
  let archivo;
  switch (tipo) {
    case 'entidades': {
      // Cuarto parametro opcional, para separar causas (las mismas entidades):
      //   sin_collider  nadie tiene collider (sin pares de CollisionSystem)
      //   quietos       los enemigos no caminan (sin consultas de Movement)
      const lado = b ? Number(b) : LADO_PROTOCOLO;
      const variante = spec.split(':')[3] || '';
      archivo = lado === LADO_PROTOCOLO && !variante ? `rend_e${String(n).padStart(4, '0')}.json`
        : `rend_e${n}_g${lado}${variante ? `_${variante}` : ''}.json`;
      const entidades = distribuir(n, lado);
      for (const entidad of entidades) {
        if (variante === 'sin_collider' && entidad.id !== 'player_1') delete entidad.collider;
        if (variante === 'quietos' && entidad.type === 'enemy') entidad.stats.speed = 0;
      }
      escribirNivel(join(niveles, archivo), nivelBase(archivo.replace('.json', ''), lado, entidades));
      break;
    }
    case 'grilla': {
      const lado = n;
      const modo = b === 'rect' ? 'rect' : 'tiles';
      // "quietos" (cuarto parametro): los enemigos no caminan, para separar el
      // costo de recorrer el piso al dibujar del de las consultas de Movement.
      const quietos = spec.split(':')[3] === 'quietos';
      archivo = `rend_g${lado}_${modo}${quietos ? '_quietos' : ''}.json`;
      // Las 500 entidades del protocolo, en el centro de la grilla.
      const c0 = Math.floor((lado - LADO_PROTOCOLO) / 2);
      const entidades = distribuir(500, Math.min(lado, LADO_PROTOCOLO), Math.max(0, c0), Math.max(0, c0));
      if (quietos) for (const e of entidades) if (e.type === 'enemy') e.stats.speed = 0;
      escribirNivel(join(niveles, archivo), nivelBase(archivo.replace('.json', ''), lado, entidades),
        modo === 'tiles' ? casillasRectangulo(lado) : null);
      break;
    }
    case 'eventos': {
      archivo = `rend_ev${n}.json`;
      const entidades = distribuir(500, LADO_PROTOCOLO);
      const { lista, zonas } = eventos(n, entidades, LADO_PROTOCOLO);
      const nivel = nivelBase(archivo.replace('.json', ''), LADO_PROTOCOLO, entidades, { zones: zonas });
      nivel.events = lista;
      escribirNivel(join(niveles, archivo), nivel);
      break;
    }
    case 'combate': {
      // N enemigos armados (con dano: hay que ver golpes de verdad) en las
      // casillas a 2-5 de donde arranca el jugador; si no entran, se apilan
      // (no son solidos, asi que pueden compartir casilla).
      archivo = `rend_c${n}.json`;
      const inicio = recorrido(0, 0, LADO_PROTOCOLO);
      const cerca = [];
      for (let row = inicio.row - 5; row <= inicio.row + 5; row += 1) {
        for (let col = inicio.col - 5; col <= inicio.col + 5; col += 1) {
          const d = Math.hypot(col - inicio.col, row - inicio.row);
          if (d >= 2 && d <= 5 && col > 0 && row > 0) cerca.push([col, row]);
        }
      }
      mezclar(cerca, mulberry32(SEMILLA + 2));
      const entidades = [jugador(inicio.col, inicio.row)];
      for (let i = 0; i < n; i += 1) {
        const [col, row] = cerca[i % cerca.length];
        entidades.push(enemigo(`enemigo_${i}`, col, row, { armado: i % 2 === 0, dano: 1 }));
      }
      const nivel = nivelBase(archivo.replace('.json', ''), LADO_PROTOCOLO, entidades);
      nivel.items = objetos(1);
      escribirNivel(join(niveles, archivo), nivel);
      break;
    }
    case 'texturas':
    case 'serie': {
      // Las texturas van como pisos distintos ("floorVariants", como escribe el
      // editor las salas con piso propio), repartidos por las casillas.
      const cuantas = tipo === 'texturas' ? n : TEXTURAS_POR_NIVEL_SERIE;
      const desde = tipo === 'texturas' ? 0 : 100000 + n * TEXTURAS_POR_NIVEL_SERIE;
      archivo = tipo === 'texturas' ? `rend_t${n}.json` : `rend_serie${n}.json`;
      const variantes = [];
      for (let i = 0; i < cuantas; i += 1) variantes.push({ texture: texturaGenerada(salida, desde + i) });
      const nivel = nivelBase(archivo.replace('.json', ''), LADO_PROTOCOLO, distribuir(500, LADO_PROTOCOLO));
      nivel.visuals.floorVariants = variantes;
      escribirNivel(join(niveles, archivo), nivel,
        casillasRectangulo(LADO_PROTOCOLO, cuantas > 0 ? (col, row) => (row * LADO_PROTOCOLO + col) % cuantas : null));
      break;
    }
    default:
      throw new Error(`Tipo de escena desconocido: ${tipo} (ver el encabezado de este archivo)`);
  }
  return join(niveles, archivo);
}

// Valida un nivel contra schema/level.schema.json con el Ajv del editor.
export function validar(ruta) {
  const requerir = createRequire(join(ROOT, 'editor', 'package.json'));
  const Ajv = requerir('ajv');
  const ajv = new Ajv({ allErrors: true, strict: false });
  const esquema = JSON.parse(readFileSync(join(ROOT, 'schema', 'level.schema.json'), 'utf8'));
  const valido = ajv.validate(esquema, JSON.parse(readFileSync(ruta, 'utf8')));
  return valido ? [] : ajv.errors;
}

export const ESCENAS_PROTOCOLO = ENTIDADES_PROTOCOLO.map((n) => `entidades:${n}`);
export const ESCENAS_ESTRES = [
  ...[1000, 2500, 5000, 10000, 15000].map((n) => `entidades:${n}:128`),
  ...[64, 128, 256, 512, 1024].map((l) => `grilla:${l}:tiles`),
  ...[64, 128, 256, 512, 1024, 2048].map((l) => `grilla:${l}:rect`),
  ...[100, 1000, 5000].map((n) => `eventos:${n}`),
  ...[50, 250, 1000].map((n) => `combate:${n}`),
  ...[0, 100, 1000].map((n) => `texturas:${n}`),
];

// --- Linea de comandos ---------------------------------------------------------------

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  let salida = SALIDA_POR_DEFECTO;
  let solo = 'protocolo';
  const escenas = [];
  let validarTodo = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--salida') salida = resolve(args[++i]);
    else if (args[i] === '--solo') solo = args[++i];
    else if (args[i] === '--escena') escenas.push(args[++i]);
    else if (args[i] === '--validar') validarTodo = true;
    else throw new Error(`Opcion desconocida: ${args[i]}`);
  }
  if (escenas.length === 0) {
    if (solo === 'protocolo' || solo === 'todo') escenas.push(...ESCENAS_PROTOCOLO);
    if (solo === 'estres' || solo === 'todo') escenas.push(...ESCENAS_ESTRES);
  }
  prepararProyecto(salida);
  for (const spec of escenas) {
    const ruta = generarEscena(spec, salida);
    const mb = statSync(ruta).size / 1024 / 1024;
    let nota = '';
    if (validarTodo && mb < 50) {
      const errores = validar(ruta);
      nota = errores.length ? ` INVALIDO: ${JSON.stringify(errores.slice(0, 3))}` : ' (valido contra el schema)';
      if (errores.length) process.exitCode = 1;
    }
    console.log(`${spec} -> ${ruta} (${mb.toFixed(1)} MB)${nota}`);
  }
}
