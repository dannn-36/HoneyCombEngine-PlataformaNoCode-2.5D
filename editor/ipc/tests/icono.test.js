// =============================================================================
// El icono del .exe exportado (ipc/exe-icon.js) y el del motor
// =============================================================================
//
// El motor trae el icono de HoneyComb como recurso (engine/resources/engine.rc)
// y al exportar se reemplaza por el del juego. Las pruebas que escriben un
// .exe de verdad corren solo en Windows y si el motor esta compilado: usan una
// COPIA en una carpeta temporal, nunca el motor del repositorio.
// =============================================================================

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const { prepararEntorno, EDITOR_DIR } = require('./support/entorno');

const REPO = path.dirname(EDITOR_DIR);
/** El primer motor compilado que haya, o null. */
const MOTOR = ['build-release', 'build']
  .map((dir) => path.join(REPO, 'engine', dir, 'engine.exe'))
  .find((exe) => fs.existsSync(exe));

/** Las imagenes de un .ico (el de HoneyComb), como las da iconImagesFrom. */
function imagenesDelIco(file) {
  const ico = fs.readFileSync(file);
  return Array.from({ length: ico.readUInt16LE(4) }, (_, i) => {
    const at = 6 + i * 16;
    const offset = ico.readUInt32LE(at + 12);
    return { size: ico[at] || 256, png: ico.subarray(offset, offset + ico.readUInt32LE(at + 8)) };
  });
}

describe('exe-icon.js', () => {
  let entorno;
  let icono;
  before(async () => {
    entorno = await prepararEntorno();
    icono = entorno.cargar('exe-icon.js');
  });
  after(() => entorno?.limpiar());

  it('el grupo de iconos dice el tamano y el id de cada imagen', () => {
    const png = (n) => Buffer.alloc(n, 1);
    const grupo = icono.buildIconGroup([
      { size: 16, png: png(10) },
      { size: 256, png: png(300) },
    ]);
    assert.equal(grupo.length, 6 + 2 * 14);
    assert.equal(grupo.readUInt16LE(2), 1);
    assert.equal(grupo.readUInt16LE(4), 2);
    assert.equal(grupo[6], 16);
    assert.equal(grupo.readUInt32LE(6 + 8), 10);
    assert.equal(grupo.readUInt16LE(6 + 12), 1);
    assert.equal(grupo[6 + 14], 0, '256 se escribe como 0');
    assert.equal(grupo.readUInt32LE(6 + 14 + 8), 300);
    assert.equal(grupo.readUInt16LE(6 + 14 + 12), 2);
  });

  it('un archivo que no es un .exe no tiene recursos', () => {
    assert.equal(icono.readExeResource(Buffer.from('hola'), 14, 1), null);
    assert.equal(icono.countIconImages(Buffer.alloc(100)), 0);
  });

  it('el motor compilado trae el icono de HoneyComb', { skip: !MOTOR && 'no hay motor compilado' }, () => {
    const exe = fs.readFileSync(MOTOR);
    const esperado = imagenesDelIco(path.join(REPO, 'engine', 'resources', 'honeycomb.ico'));
    assert.equal(icono.countIconImages(exe), esperado.length);
    assert.deepEqual(icono.readExeResource(exe, icono.RT_ICON, 1), esperado[0].png);
  });

  it(
    'setExeIcon reemplaza el icono en una copia y el .exe sigue siendo un ejecutable',
    { skip: (process.platform !== 'win32' || !MOTOR) && 'solo en Windows, con el motor compilado' },
    async () => {
      const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'hc-icono-'));
      try {
        const copia = path.join(carpeta, 'Juego.exe');
        fs.copyFileSync(MOTOR, copia);
        const todas = imagenesDelIco(path.join(REPO, 'engine', 'resources', 'honeycomb.ico'));
        const nuevas = [todas[0], todas.at(-1)];
        await icono.setExeIcon(copia, nuevas);

        const exe = fs.readFileSync(copia);
        assert.equal(exe.toString('latin1', 0, 2), 'MZ');
        assert.equal(icono.countIconImages(exe), 2);
        assert.deepEqual(icono.readExeResource(exe, icono.RT_GROUP_ICON, 1), icono.buildIconGroup(nuevas));
        assert.deepEqual(icono.readExeResource(exe, icono.RT_ICON, 2), nuevas[1].png);
        assert.equal(icono.readExeResource(exe, icono.RT_ICON, 3), null, 'las imagenes del icono anterior se borran');
      } finally {
        fs.rmSync(carpeta, { recursive: true, force: true });
      }
    },
  );
});

describe('applyGameIcon (al exportar)', () => {
  let entorno;
  let exportar;
  before(async () => {
    entorno = await prepararEntorno();
    exportar = entorno.cargar('export.js');
  });
  after(() => entorno?.limpiar());

  it('sin icono en game.json no hace nada', async () => {
    assert.equal(await exportar.applyGameIcon(entorno.root, {}, 'x.exe'), false);
    assert.equal(await exportar.applyGameIcon(entorno.root, { icon: '' }, 'x.exe'), false);
  });

  it('un icono que no esta, o que sale de assets/, se avisa sin frenar', async () => {
    assert.match(await exportar.applyGameIcon(entorno.root, { icon: 'textures/no_esta.png' }, 'x.exe'), /no está/);
    assert.match(await exportar.applyGameIcon(entorno.root, { icon: '../../fuera/secreto.txt' }, 'x.exe'), /no está/);
  });

  it('un motor de antes, sin icono propio, pide recompilarlo en vez de intentarlo', async () => {
    fs.writeFileSync(path.join(entorno.root, 'assets', 'textures', 'icono.png'), 'png');
    const viejo = path.join(entorno.base, 'viejo.exe');
    fs.writeFileSync(viejo, Buffer.alloc(512));
    assert.match(await exportar.applyGameIcon(entorno.root, { icon: 'textures/icono.png' }, viejo), /compílalo de nuevo/);
  });

  it('una imagen que no se puede leer se avisa sin frenar', { skip: !MOTOR && 'no hay motor compilado' }, async () => {
    fs.writeFileSync(path.join(entorno.root, 'assets', 'textures', 'roto.png'), 'no es png');
    entorno.electron.nativeImage = { createFromPath: () => ({ isEmpty: () => true }) };
    try {
      assert.match(await exportar.applyGameIcon(entorno.root, { icon: 'textures/roto.png' }, MOTOR), /No se pudo leer/);
    } finally {
      delete entorno.electron.nativeImage;
    }
  });
});
