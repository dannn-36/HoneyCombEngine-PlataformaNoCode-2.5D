// =============================================================================
// Exportar el juego (ipc/export.js)
// =============================================================================
//
// Con una instalacion COPIADA (ver support/entorno.js) que tiene un motor
// Release de mentira: un .exe minimo con la cabecera de Windows de verdad,
// para poder ver que la copia exportada queda sin consola y el original no.
// El dialogo de carpeta contesta lo que diga "respuesta".
// =============================================================================

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const zlib = require('node:zlib');

const { prepararEntorno } = require('./support/entorno');

const enWindows = process.platform === 'win32';

/** Un .exe minimo: cabecera MZ, PE32+ y el campo Subsystem en 3 (consola). */
function exeDeConsola() {
  const exe = Buffer.alloc(0x200);
  exe.write('MZ', 0, 'latin1');
  exe.writeUInt32LE(0x80, 0x3c);
  exe.write('PE\0\0', 0x80, 'latin1');
  exe.writeUInt16LE(0x20b, 0x80 + 24);
  exe.writeUInt16LE(3, 0x80 + 24 + 68);
  return exe;
}
const subsistema = (archivo) => fs.readFileSync(archivo).readUInt16LE(0x80 + 24 + 68);

/** Los archivos de un .zip con su contenido, leyendo el directorio central. */
function leerZip(archivo) {
  const data = fs.readFileSync(archivo);
  const fin = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const cantidad = data.readUInt16LE(fin + 10);
  let at = data.readUInt32LE(fin + 16);
  const archivos = new Map();
  for (let i = 0; i < cantidad; i += 1) {
    const metodo = data.readUInt16LE(at + 10);
    const crc = data.readUInt32LE(at + 16);
    const comprimido = data.readUInt32LE(at + 20);
    const largoNombre = data.readUInt16LE(at + 28);
    const local = data.readUInt32LE(at + 42);
    const nombre = data.subarray(at + 46, at + 46 + largoNombre).toString('utf-8');
    const inicio = local + 30 + data.readUInt16LE(local + 26) + data.readUInt16LE(local + 28);
    const cuerpo = data.subarray(inicio, inicio + comprimido);
    const contenido = metodo === 8 ? zlib.inflateRawSync(cuerpo) : Buffer.from(cuerpo);
    assert.equal(zlib.crc32(contenido), crc, `CRC de ${nombre}`);
    archivos.set(nombre, contenido);
    at += 46 + largoNombre + data.readUInt16LE(at + 30) + data.readUInt16LE(at + 32);
  }
  return archivos;
}

describe('exportar el juego', { skip: !enWindows && 'la exportacion es solo para Windows por ahora' }, () => {
  let entorno;
  let respuesta;
  let motor;

  before(async () => {
    entorno = await prepararEntorno({ instalacion: 'copia', dialogo: () => respuesta });
    const releaseDir = path.join(entorno.installRoot, 'engine', 'build-release');
    fs.mkdirSync(releaseDir, { recursive: true });
    motor = path.join(releaseDir, 'engine.exe');
    fs.writeFileSync(motor, exeDeConsola());
    for (const dll of ['SDL2.dll', 'libstdc++-6.dll']) fs.writeFileSync(path.join(releaseDir, dll), 'dll');
  });

  after(() => entorno?.limpiar());

  const enProyecto = (relativa, contenido) => {
    const archivo = path.join(entorno.root, ...relativa.split('/'));
    fs.mkdirSync(path.dirname(archivo), { recursive: true });
    fs.writeFileSync(archivo, typeof contenido === 'string' ? contenido : JSON.stringify(contenido));
  };
  const destino = (nombre) => {
    const carpeta = path.join(entorno.base, nombre);
    fs.mkdirSync(carpeta, { recursive: true });
    respuesta = { canceled: false, filePaths: [carpeta] };
    return carpeta;
  };
  const exportar = (startLevel = null) => entorno.invocar('game:export', { startLevel });

  beforeEach(() => {
    fs.rmSync(path.join(entorno.root, 'levels'), { recursive: true, force: true });
    fs.rmSync(path.join(entorno.root, 'assets'), { recursive: true, force: true });
    enProyecto('game.json', { name: 'La Cripta', startLevel: 'inicio.json', icon: 'textures/falta.png' });
    enProyecto('levels/inicio.json', {
      name: 'inicio',
      grid: { width: 4, height: 4 },
      entities: [{ id: 'player_1', texture: 'textures/heroe.png' }, { id: 'x', texture: 'textures/no_esta.png' }],
      events: [{ trigger: { type: 'on_collision' }, actions: [{ type: 'load_level', params: { level: 'segundo' } }] }],
    });
    enProyecto('levels/inicio.json.bak', '{}');
    enProyecto('levels/mundo/otro.json', { name: 'otro', grid: { width: 2, height: 2 }, entities: [], events: [] });
    enProyecto('assets/textures/heroe.png', 'png');
    enProyecto('assets/textures/.heroe.png.1234.tmp', 'tmp');
  });

  it('arma la carpeta del juego con el motor renombrado, sus dll, los niveles y los recursos', async () => {
    const padre = destino('destino-completo');
    const r = await exportar();
    assert.equal(r.ok, true, r.error);
    const juego = path.join(padre, 'La Cripta');
    assert.equal(r.folder, juego);
    for (const archivo of [
      'La Cripta.exe',
      'SDL2.dll',
      'libstdc++-6.dll',
      'game.json',
      'honeycomb-export.json',
      'LEEME.txt',
      'AVISOS-DE-TERCEROS.txt',
      'levels/inicio.json',
      'levels/mundo/otro.json',
      'assets/textures/heroe.png',
    ]) {
      assert.ok(fs.existsSync(path.join(juego, ...archivo.split('/'))), `falta ${archivo}`);
    }
  });

  it('no lleva los respaldos ni los temporales del editor', async () => {
    destino('destino-sin-bak');
    const r = await exportar();
    assert.equal(fs.existsSync(path.join(r.folder, 'levels', 'inicio.json.bak')), false);
    assert.equal(fs.existsSync(path.join(r.folder, 'assets', 'textures', '.heroe.png.1234.tmp')), false);
  });

  it('el exe exportado no abre consola, y el motor del editor sigue igual', async () => {
    destino('destino-exe');
    const r = await exportar();
    assert.equal(subsistema(path.join(r.folder, 'La Cripta.exe')), 2);
    assert.equal(subsistema(motor), 3);
  });

  it('la marca y game.json dicen el nombre y el nivel inicial', async () => {
    destino('destino-marca');
    const r = await exportar();
    const marca = JSON.parse(fs.readFileSync(path.join(r.folder, 'honeycomb-export.json'), 'utf-8'));
    const game = JSON.parse(fs.readFileSync(path.join(r.folder, 'game.json'), 'utf-8'));
    assert.equal(marca.name, 'La Cripta');
    assert.equal(marca.startLevel, 'inicio.json');
    assert.equal(game.startLevel, 'inicio.json');
    assert.equal(game.icon, 'textures/falta.png');
  });

  it('el nivel inicial que manda la UI gana sobre el de game.json', async () => {
    destino('destino-inicial');
    const r = await exportar('mundo/otro.json');
    assert.equal(r.ok, true, r.error);
    const marca = JSON.parse(fs.readFileSync(path.join(r.folder, 'honeycomb-export.json'), 'utf-8'));
    assert.equal(marca.startLevel, 'mundo/otro.json');
  });

  it('el .zip trae todo debajo de la carpeta del juego, intacto', async () => {
    destino('destino-zip');
    const r = await exportar();
    assert.equal(r.zip, `${r.folder}.zip`);
    const archivos = leerZip(r.zip);
    assert.equal(archivos.size, r.files);
    for (const nombre of archivos.keys()) assert.ok(nombre.startsWith('La Cripta/'), nombre);
    assert.deepEqual(
      JSON.parse(archivos.get('La Cripta/levels/inicio.json').toString('utf-8')),
      JSON.parse(fs.readFileSync(path.join(r.folder, 'levels', 'inicio.json'), 'utf-8')),
    );
    assert.equal(archivos.get('La Cripta/La Cripta.exe').readUInt16LE(0x80 + 24 + 68), 2);
  });

  it('avisa lo que le falta al juego, sin frenar la exportacion', async () => {
    destino('destino-avisos');
    const r = await exportar();
    assert.equal(r.ok, true);
    const avisos = r.warnings.join('\n');
    assert.match(avisos, /assets\/textures\/no_esta\.png/);
    assert.match(avisos, /"segundo"/);
    assert.match(avisos, /game\.json usa assets\/textures\/falta\.png/);
    assert.doesNotMatch(avisos, /heroe\.png/);
  });

  it('exportar de nuevo reemplaza la exportacion anterior entera', async () => {
    const padre = destino('destino-repetido');
    const primera = await exportar();
    fs.writeFileSync(path.join(primera.folder, 'viejo.txt'), 'de antes');
    const segunda = await exportar();
    assert.equal(segunda.ok, true, segunda.error);
    assert.equal(fs.existsSync(path.join(padre, 'La Cripta', 'viejo.txt')), false);
    assert.deepEqual(fs.readdirSync(padre).sort(), ['La Cripta', 'La Cripta.zip']);
  });

  it('no toca una carpeta con el mismo nombre que no es una exportacion', async () => {
    const padre = destino('destino-ajeno');
    const ajena = path.join(padre, 'La Cripta');
    fs.mkdirSync(ajena);
    fs.writeFileSync(path.join(ajena, 'mi_tarea.docx'), 'importante');
    const r = await exportar();
    assert.equal(r.ok, false);
    assert.match(r.error, /no es una exportación/);
    assert.deepEqual(fs.readdirSync(ajena), ['mi_tarea.docx']);
    assert.deepEqual(fs.readdirSync(padre), ['La Cripta']);
  });

  it('no pisa un .zip con el mismo nombre que no es una exportacion', async () => {
    const padre = destino('destino-zip-ajeno');
    fs.writeFileSync(path.join(padre, 'La Cripta.zip'), 'no soy de HoneyComb');
    const r = await exportar();
    assert.equal(r.ok, false);
    assert.equal(fs.readFileSync(path.join(padre, 'La Cripta.zip'), 'utf-8'), 'no soy de HoneyComb');
  });

  it('cancelar el dialogo no escribe nada', async () => {
    respuesta = { canceled: true, filePaths: [] };
    const r = await exportar();
    assert.equal(r.canceled, true);
  });

  it('no exporta adentro de la carpeta del editor', async () => {
    respuesta = { canceled: false, filePaths: [entorno.root] };
    const r = await exportar();
    assert.equal(r.ok, false);
    assert.equal(fs.existsSync(path.join(entorno.root, 'La Cripta')), false);
  });

  it('un nivel inicial que no esta, o que sale de levels, se rechaza', async () => {
    destino('destino-rechazo');
    for (const nivel of ['no_esta.json', '../game.json', '..\\..\\fuera.json', 'C:/Windows/win.ini']) {
      const r = await exportar(nivel);
      assert.equal(r.ok, false, nivel);
      assert.match(r.error, /no está en levels/, nivel);
    }
  });

  it('sin nivel inicial en ningun lado pide elegirlo', async () => {
    enProyecto('game.json', { name: 'Sin inicio' });
    destino('destino-sin-inicio');
    const r = await exportar();
    assert.equal(r.ok, false);
    assert.match(r.error, /nivel inicial/);
  });

  it('sin motor Release compilado lo dice, para que la UI ofrezca compilarlo', async () => {
    const guardado = fs.readFileSync(motor);
    fs.rmSync(motor);
    try {
      destino('destino-sin-motor');
      const r = await exportar();
      assert.equal(r.ok, false);
      assert.equal(r.missing, true);
    } finally {
      fs.writeFileSync(motor, guardado);
    }
  });

  it('muestra la ultima exportacion en el explorador', async () => {
    destino('destino-mostrar');
    const r = await exportar();
    await entorno.invocar('game:revealExport');
    assert.equal(entorno.electron.__prueba.abiertosShell.at(-1), r.zip);
  });

  // Tiene que dar lo mismo que ExportedGame::SafeFolderName (engine/tests/test_exported_game.cpp):
  // el motor usa ese nombre para la carpeta de partidas en %APPDATA%.
  it('el nombre de carpeta del juego coincide con el del motor', () => {
    const { safeFolderName } = entorno.cargar('export.js');
    assert.equal(safeFolderName('La Cripta'), 'La Cripta');
    assert.equal(safeFolderName('Año: 2/3 <final>?'), 'Año 23 final');
    assert.equal(safeFolderName('  juego. . '), 'juego');
    assert.equal(safeFolderName(''), 'HoneyComb');
    assert.equal(safeFolderName('???'), 'HoneyComb');
    assert.equal(safeFolderName('con'), 'HoneyComb');
    assert.equal(safeFolderName('NUL.txt'), 'HoneyComb');
    assert.equal(safeFolderName('Consola'), 'Consola');
  });
});
