// Corre el protocolo de rendimiento del plan de calidad (seccion 6.5) y las
// pruebas de estres del motor, con la sonda engine_perf (engine/perf).
//
// Uso (desde la raiz del repositorio, con engine/build-perf ya compilado):
//   node tools/medir-rendimiento.mjs protocolo [--repeticiones 3] [--segundos 60]
//   node tools/medir-rendimiento.mjs estres [entidades grilla_tiles grilla_rect eventos combate texturas serie]
//                                    [--repeticiones 3] [--segundos 10]
//   ... --datos <carpeta>   donde dejar los resultados (engine/build-perf/datos)
//
// Cada medicion es un proceso aparte (engine_perf), con tope de tiempo y con
// tope duro de memoria (--limite-mb de la sonda, 4096 MB): si una escena
// rompe el motor, se corta esa medicion y no la maquina. Las repeticiones van
// intercaladas (todas las escenas, despues otra vuelta) para que un rato de
// maquina ocupada no caiga entero sobre una sola escena, y se informa la
// MEDIANA de cada valor.
//
// En el estres, cada dimension crece hasta que algo se rompe. Se considera
// roto el primer valor con: FPS promedio < 30, carga > 10 s, pico de memoria
// > 2048 MB, o un error (se cayo, sin memoria, tiempo agotado). Despues de un
// error ya no se sigue subiendo esa dimension.

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESCENAS_PROTOCOLO, SALIDA_POR_DEFECTO, generarEscena, prepararProyecto } from './gen-escenas-rendimiento.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BUILD = join(ROOT, 'engine', 'build-perf');
const SONDA = join(BUILD, 'engine_perf.exe');
const ESCENAS = SALIDA_POR_DEFECTO;

const LIMITES_ROTURA = { fps: 30, cargaMs: 10000, memoriaMb: 2048 };

// --- Argumentos ----------------------------------------------------------------

const args = process.argv.slice(2);
const modo = args[0];
const opcion = (nombre, porDefecto) => {
  const i = args.indexOf(nombre);
  return i >= 0 ? args[i + 1] : porDefecto;
};
const repeticiones = Number(opcion('--repeticiones', 3));
const datos = resolve(opcion('--datos', join(BUILD, 'datos')));
mkdirSync(datos, { recursive: true });

if (!existsSync(SONDA)) {
  console.error(`No esta ${SONDA}: compilar antes (ver engine/perf/CMakeLists.txt)`);
  process.exit(1);
}

// --- Utilidades ------------------------------------------------------------------

function cargaCpu() {
  const r = spawnSync('powershell', ['-NoProfile', '-Command',
    '(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average'], { encoding: 'utf8' });
  return Number((r.stdout || '').trim()) || null;
}

function mediana(valores) {
  const lista = valores.filter((v) => typeof v === 'number' && Number.isFinite(v)).sort((a, b) => a - b);
  if (lista.length === 0) return null;
  const medio = Math.floor(lista.length / 2);
  return lista.length % 2 ? lista[medio] : (lista[medio - 1] + lista[medio]) / 2;
}

// Corre la sonda una vez y devuelve lo que imprimio en su linea PERF.
function sondear(nivel, extra = [], { segundos, topeS }) {
  const cpu = cargaCpu();
  const t0 = Date.now();
  const r = spawnSync(SONDA, [nivel, '--segundos', String(segundos), ...extra], {
    cwd: BUILD,
    encoding: 'utf8',
    timeout: topeS * 1000,
    maxBuffer: 512 * 1024 * 1024,
  });
  const linea = (r.stdout || '').split(/\r?\n/).find((l) => l.startsWith('PERF '));
  let resultado;
  try {
    resultado = linea ? JSON.parse(linea.slice(5)) : {};
  } catch {
    resultado = { error: 'salida ilegible' };
  }
  if (r.error && r.error.code === 'ETIMEDOUT') resultado.error = `tiempo agotado (${topeS} s)`;
  else if (!linea) resultado.error = resultado.error || `se cayo sin informar (codigo ${r.status}, 0x${(r.status >>> 0).toString(16)})`;
  resultado.codigo_salida = r.status;
  resultado.ms_reloj = Date.now() - t0;
  resultado.cpu_antes = cpu;
  return resultado;
}

const COLUMNAS = [
  'dimension', 'valor', 'repeticion', 'etiqueta', 'recorte', 'entidades', 'grilla', 'celdas_piso', 'celdas_pared',
  'eventos', 'zonas', 'texturas_nivel', 'carga_total_ms', 'carga_ms', 'preparar_ms', 'json_ms', 'json_mb_archivo',
  'arranque_ms', 'fps_promedio', 'fps_1pct_bajo', 'ms_promedio', 'ms_p50', 'ms_p90', 'ms_p99', 'ms_max', 'cuadros',
  'pico_residente_mb', 'pico_privada_mb', 'sprites_dibujados', 'sprites_recortados', 'colisiones_prom',
  'proyectiles_max', 'recorrido_celdas', 'entidades_activas_final', 'cpu_antes', 'ms_reloj', 'codigo_salida', 'error',
];

function csv(filas) {
  const celda = (v) => (v === undefined || v === null ? '' : typeof v === 'number' ? String(Math.round(v * 1000) / 1000)
    : `"${String(v).replace(/"/g, '""')}"`);
  return [COLUMNAS.join(','), ...filas.map((f) => COLUMNAS.map((c) => celda(f[c])).join(','))].join('\n') + '\n';
}

// Mediana de cada columna numerica de un grupo de repeticiones.
function resumir(grupo) {
  const fila = { ...grupo[0], repeticion: `mediana de ${grupo.length}` };
  for (const columna of COLUMNAS) {
    if (typeof grupo[0][columna] === 'number') fila[columna] = mediana(grupo.map((g) => g[columna]));
  }
  const conError = grupo.find((g) => g.error);
  fila.error = conError ? conError.error : undefined;
  return fila;
}

function rotura(fila) {
  if (fila.error) return fila.error;
  const motivos = [];
  if (fila.fps_promedio < LIMITES_ROTURA.fps) motivos.push(`FPS ${fila.fps_promedio.toFixed(1)} < ${LIMITES_ROTURA.fps}`);
  if (fila.carga_total_ms > LIMITES_ROTURA.cargaMs) motivos.push(`carga ${(fila.carga_total_ms / 1000).toFixed(1)} s > 10 s`);
  if (fila.pico_residente_mb > LIMITES_ROTURA.memoriaMb) motivos.push(`memoria ${fila.pico_residente_mb.toFixed(0)} MB > 2048 MB`);
  return motivos.join('; ');
}

function guardar(nombre, crudas, resumen) {
  writeFileSync(join(datos, `${nombre}_crudo.csv`), csv(crudas));
  writeFileSync(join(datos, `${nombre}_resumen.csv`), csv(resumen));
  writeFileSync(join(datos, `${nombre}.json`), JSON.stringify({ crudas, resumen }, null, 2));
}

function registrar(nombre, fila) {
  appendFileSync(join(datos, `${nombre}.jsonl`), JSON.stringify(fila) + '\n');
  const fps = typeof fila.fps_promedio === 'number' ? fila.fps_promedio.toFixed(0) : '-';
  const bajo = typeof fila.fps_1pct_bajo === 'number' ? fila.fps_1pct_bajo.toFixed(0) : '-';
  const carga = typeof fila.carga_total_ms === 'number' ? fila.carga_total_ms.toFixed(0) : '-';
  const mem = typeof fila.pico_residente_mb === 'number' ? fila.pico_residente_mb.toFixed(0) : '-';
  console.log(`[${fila.dimension} ${fila.valor} #${fila.repeticion}] FPS ${fps} | 1% ${bajo} | carga ${carga} ms | `
    + `pico ${mem} MB | cpu ${fila.cpu_antes}%${fila.error ? ` | ERROR ${fila.error}` : ''}`);
}

// --- Protocolo 6.5 -----------------------------------------------------------------

function protocolo() {
  const segundos = Number(opcion('--segundos', 60));
  prepararProyecto(ESCENAS);
  const casos = ESCENAS_PROTOCOLO.map((spec) => ({ spec, extra: [], valor: spec.split(':')[1] }));
  casos.push({ spec: 'entidades:500', extra: ['--sin-recorte'], valor: '500 sin recorte' });
  for (const caso of casos) caso.nivel = generarEscena(caso.spec, ESCENAS);

  const crudas = [];
  for (let rep = 1; rep <= repeticiones; rep += 1) {
    for (const caso of casos) {
      const fila = { dimension: 'protocolo', valor: caso.valor, repeticion: rep,
        ...sondear(caso.nivel, caso.extra, { segundos, topeS: segundos + 60 }) };
      registrar('protocolo', fila);
      crudas.push(fila);
    }
  }
  const resumen = casos.map((caso) => resumir(crudas.filter((f) => f.valor === caso.valor)));
  guardar('protocolo', crudas, resumen);
  console.table(resumen.map((f) => ({ escena: f.valor, carga_ms: f.carga_total_ms, fps: f.fps_promedio,
    fps_1pct: f.fps_1pct_bajo, p50: f.ms_p50, p99: f.ms_p99, pico_mb: f.pico_residente_mb,
    dibujados: f.sprites_dibujados, recortados: f.sprites_recortados })));
}

// --- Estres --------------------------------------------------------------------------

const DIMENSIONES = {
  entidades: { valores: [1000, 2500, 5000, 10000, 15000, 25000, 50000], spec: (n) => `entidades:${n}:${n <= 15000 ? 128 : 256}` },
  grilla_tiles: { valores: [64, 128, 256, 512, 1024, 2048, 3072, 4096], spec: (l) => `grilla:${l}:tiles` },
  grilla_rect: { valores: [64, 128, 256, 512, 1024, 2048, 4096, 8192], spec: (l) => `grilla:${l}:rect` },
  eventos: { valores: [100, 1000, 5000, 10000, 20000], spec: (n) => `eventos:${n}` },
  combate: { valores: [50, 100, 250, 500, 1000, 2000, 4000], spec: (n) => `combate:${n}`, extra: ['--atacar'] },
  texturas: { valores: [0, 100, 500, 1000, 2000, 4000], spec: (n) => `texturas:${n}` },
  // Para separar causas: las mismas entidades sin collider, y con los enemigos quietos.
  entidades_sin_collider: { valores: [1000, 5000, 10000, 15000], spec: (n) => `entidades:${n}:128:sin_collider` },
  entidades_quietos: { valores: [1000, 5000, 10000, 15000], spec: (n) => `entidades:${n}:128:quietos` },
  // La grilla con nadie caminando (enemigos quietos y, con --quieto, el jugador):
  // lo que queda es recorrer el piso para dibujarlo.
  grilla_rect_quietos: { valores: [512, 1024, 2048, 4096], spec: (l) => `grilla:${l}:rect:quietos`, extra: ['--quieto'] },
};

function estres() {
  const segundos = Number(opcion('--segundos', 10));
  const pedidas = args.slice(1).filter((a) => !a.startsWith('--') && (DIMENSIONES[a] || a === 'serie'));
  const lista = pedidas.length ? pedidas : [...Object.keys(DIMENSIONES), 'serie'];
  prepararProyecto(ESCENAS);
  for (const nombre of lista) {
    if (nombre === 'serie') {
      serie(segundos);
      continue;
    }
    const dim = DIMENSIONES[nombre];
    const crudas = [];
    const resumen = [];
    for (const valor of dim.valores) {
      const nivel = generarEscena(dim.spec(valor), ESCENAS);
      const grupo = [];
      for (let rep = 1; rep <= repeticiones; rep += 1) {
        const fila = { dimension: nombre, valor, repeticion: rep,
          ...sondear(nivel, dim.extra || [], { segundos, topeS: segundos + 80 }) };
        registrar(`estres_${nombre}`, fila);
        grupo.push(fila);
        crudas.push(fila);
        // Una que se cae o que tarda mucho no se repite: el dato ya esta.
        if (fila.error || fila.ms_reloj > 45000) break;
      }
      const fila = resumir(grupo);
      fila.rompe = rotura(fila);
      resumen.push(fila);
      // Los niveles enormes no se guardan: se regeneran igual con el script.
      if (statSync(nivel).size > 50 * 1024 * 1024) rmSync(nivel);
      if (fila.error || (typeof fila.fps_promedio === 'number' && fila.fps_promedio < 2)) break;
    }
    guardar(`estres_${nombre}`, crudas, resumen);
    console.table(resumen.map((f) => ({ valor: f.valor, carga_ms: f.carga_total_ms, json_ms: f.json_ms, fps: f.fps_promedio,
      fps_1pct: f.fps_1pct_bajo, p99: f.ms_p99, pico_mb: f.pico_residente_mb, rompe: f.rompe })));
  }
}

// La cache de texturas al pasar de nivel (EN-11): diez niveles seguidos con 300
// texturas propias cada uno, por el mismo camino que "Cargar nivel".
function serie(segundos) {
  const niveles = [];
  for (let k = 0; k < 10; k += 1) niveles.push(generarEscena(`serie:${k}`, ESCENAS));
  const extra = niveles.slice(1).flatMap((n) => ['--recargar', n]);
  const fila = { dimension: 'serie', valor: '10 niveles x 300 texturas', repeticion: 1,
    ...sondear(niveles[0], extra, { segundos: Math.min(segundos, 5), topeS: 180 }) };
  registrar('estres_serie', fila);
  const pasos = [{ nivel: fila.nivel, carga_total_ms: fila.carga_total_ms, residente_mb: fila.residente_final_mb,
    privada_mb: fila.privada_final_mb }, ...(fila.recargas || []).map((p) => ({ nivel: p.nivel,
    carga_total_ms: p.carga_total_ms, residente_mb: p.residente_mb, privada_mb: p.privada_mb }))];
  writeFileSync(join(datos, 'estres_serie.json'), JSON.stringify({ fila, pasos }, null, 2));
  writeFileSync(join(datos, 'estres_serie.csv'), ['nivel,carga_total_ms,residente_mb,privada_mb',
    ...pasos.map((p) => `${p.nivel},${p.carga_total_ms},${p.residente_mb},${p.privada_mb}`)].join('\n') + '\n');
  console.table(pasos);
}

if (modo === 'protocolo') protocolo();
else if (modo === 'estres') estres();
else {
  console.error('Uso: node tools/medir-rendimiento.mjs protocolo|estres [...] (ver el encabezado del archivo)');
  process.exit(1);
}
