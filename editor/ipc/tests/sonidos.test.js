// =============================================================================
// Importar sonidos (ipc/sounds.js) y escucharlos (project:readFileData)
// =============================================================================
//
// Los sonidos entran como las imagenes: elegidos con el dialogo, COPIADOS a
// assets/sounds/ con un nombre limpio y libre, y solo si de verdad son WAV,
// OGG o MP3.
// =============================================================================

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { prepararEntorno } = require('./support/entorno');

const WAV = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WAVEfmt '), Buffer.alloc(32)]);
const OGG = Buffer.concat([Buffer.from('OggS'), Buffer.alloc(40)]);
const MP3_ID3 = Buffer.concat([Buffer.from('ID3'), Buffer.alloc(40)]);
const MP3_CUADRO = Buffer.concat([Buffer.from([0xff, 0xfb, 0x90, 0x64]), Buffer.alloc(40)]);

describe('sounds:import', () => {
  let entorno;
  let elegidos = [];
  before(async () => {
    entorno = await prepararEntorno({ dialogo: () => ({ canceled: elegidos.length === 0, filePaths: elegidos }) });
  });
  after(() => entorno?.limpiar());

  const deAfuera = (nombre, bytes) => {
    const ruta = path.join(entorno.fuera, nombre);
    fs.writeFileSync(ruta, bytes);
    return ruta;
  };
  const sonidos = () => fs.readdirSync(path.join(entorno.root, 'assets', 'sounds')).sort();

  it('cancelar no copia nada', async () => {
    elegidos = [];
    const result = await entorno.invocar('sounds:import');
    assert.equal(result.canceled, true);
    assert.deepEqual(sonidos(), []);
  });

  it('copia WAV, OGG y MP3 a assets/sounds/ y devuelve la ruta como la guarda el nivel', async () => {
    elegidos = [deAfuera('golpe.wav', WAV), deAfuera('Tema Principal.OGG', OGG), deAfuera('voz.mp3', MP3_ID3), deAfuera('paso.mp3', MP3_CUADRO)];
    const result = await entorno.invocar('sounds:import');
    assert.equal(result.canceled, false);
    assert.deepEqual(
      result.imported.map((sonido) => sonido.target).sort(),
      ['sounds/Tema Principal.ogg', 'sounds/golpe.wav', 'sounds/paso.mp3', 'sounds/voz.mp3'],
    );
    assert.deepEqual(result.skipped, []);
    assert.deepEqual(fs.readFileSync(path.join(entorno.root, 'assets', 'sounds', 'golpe.wav')), WAV);
    assert.ok(fs.existsSync(path.join(entorno.fuera, 'golpe.wav')), 'el original queda donde estaba');
  });

  it('no pisa uno que ya estaba: le busca un nombre libre', async () => {
    elegidos = [deAfuera('golpe.wav', WAV)];
    const result = await entorno.invocar('sounds:import');
    assert.deepEqual(result.imported.map((sonido) => sonido.target), ['sounds/golpe-2.wav']);
  });

  it('limpia el nombre para que el motor lo pueda abrir', async () => {
    elegidos = [deAfuera('canción ♡.ogg', OGG)];
    const result = await entorno.invocar('sounds:import');
    assert.deepEqual(result.imported.map((sonido) => sonido.target), ['sounds/cancion.ogg']);
  });

  it('rechaza lo que no es audio aunque tenga la extension, y lo que no es WAV, OGG ni MP3', async () => {
    elegidos = [deAfuera('falso.ogg', Buffer.from('esto es un texto')), deAfuera('pista.flac', Buffer.from('fLaC'))];
    const result = await entorno.invocar('sounds:import');
    assert.deepEqual(result.imported, []);
    assert.equal(result.skipped.length, 2);
    assert.match(result.skipped[0].reason, /no es un OGG de verdad/);
    assert.match(result.skipped[1].reason, /no es WAV, OGG ni MP3/);
    assert.ok(!sonidos().includes('falso.ogg'));
  });
});

describe('project:readFileData con sonidos', () => {
  let entorno;
  before(async () => {
    entorno = await prepararEntorno();
  });
  after(() => entorno?.limpiar());

  it('devuelve el sonido como audio, para escucharlo en el editor', async () => {
    fs.writeFileSync(path.join(entorno.root, 'assets', 'sounds', 'tema.ogg'), OGG);
    const data = await entorno.invocar('project:readFileData', 'assets/sounds/tema.ogg');
    assert.equal(data.kind, 'audio');
    assert.equal(data.dataUrl, `data:audio/ogg;base64,${OGG.toString('base64')}`);
  });
});

describe('los niveles que usan musica', () => {
  let entorno;
  before(async () => {
    entorno = await prepararEntorno();
  });
  after(() => entorno?.limpiar());

  it('collectAssetRefs encuentra la musica del nivel y la de los eventos', () => {
    const { collectAssetRefs } = entorno.cargar('levels.js');
    const refs = collectAssetRefs({
      music: 'sounds/nivel.ogg',
      events: [{ trigger: { type: 'on_level_start', params: {} }, actions: [{ type: 'play_music', params: { music: 'sounds/jefe.ogg' } }] }],
    });
    assert.deepEqual([...refs].sort(), ['sounds/jefe.ogg', 'sounds/nivel.ogg']);
  });
});
