// =============================================================================
// Seguridad: importar un nivel de otra carpeta (ipc/levels.js)
// =============================================================================
//
// Abrir un .json de afuera lo IMPORTA: se copia a levels/ junto con las
// texturas y sonidos que nombra. Esos nombres salen del JSON, que puede venir
// de cualquier lado, asi que son datos no confiables: una referencia como
// "../../secreto.txt" no puede hacer copiar un archivo cualquiera al proyecto
// (para despues leerlo con el visor), ni escribir fuera de assets/.
// =============================================================================

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { prepararEntorno, listarArbol } = require('./support/entorno');

let entorno;
let origen;

/** Un nivel de afuera, con la forma <carpeta>/levels/<nivel>.json y sus assets al lado. */
function nivelDeAfuera(referencias, nombre = 'importado.json') {
  const levels = path.join(origen, 'levels');
  fs.mkdirSync(levels, { recursive: true });
  fs.mkdirSync(path.join(origen, 'assets', 'textures'), { recursive: true });
  fs.writeFileSync(path.join(origen, 'assets', 'textures', 'legal.png'), 'PNG legal');
  const level = {
    name: 'de afuera',
    grid: { width: 4, height: 4 },
    entities: referencias.map((texture, i) => ({
      id: `e${i}`,
      texture,
      position: { col: 0, row: 0 },
    })),
    events: [
      {
        trigger: { type: 'on_start' },
        actions: [{ type: 'play_sound', params: { soundPath: referencias[0] } }],
      },
    ],
  };
  const archivo = path.join(levels, nombre);
  fs.writeFileSync(archivo, JSON.stringify(level));
  return archivo;
}

beforeEach(async () => {
  let elegido = null;
  entorno = await prepararEntorno({ dialogo: () => ({ canceled: false, filePaths: [elegido] }) });
  origen = path.join(entorno.base, 'descargas');
  entorno.elegir = (archivo) => {
    elegido = archivo;
  };
});

afterEach(() => entorno?.limpiar());

/** Algun archivo del proyecto tiene el contenido del secreto. */
function secretoCopiado() {
  return listarArbol(entorno.root).some((relativa) => {
    const completa = path.join(entorno.root, relativa);
    return fs.statSync(completa).isFile() && fs.readFileSync(completa, 'utf-8') === 'SECRETO';
  });
}

describe('importar un nivel no copia archivos de fuera de sus assets', () => {
  const tramposas = (e) => [
    '../../fuera/secreto.txt',
    '..\\..\\fuera\\secreto.txt',
    'textures/../../../fuera/secreto.txt',
    path.join(e.fuera, 'secreto.txt'),
    path.join(e.fuera, 'secreto.txt').replace(/\\/g, '/'),
    `\\\\?\\${path.join(e.fuera, 'secreto.txt')}`,
    `\\\\.\\${path.join(e.fuera, 'secreto.txt')}`,
    path.join(e.fuera, 'secreto.txt').slice(2),
  ];

  it('las referencias tramposas quedan como faltantes y no se copian', async () => {
    const refs = ['textures/legal.png', ...tramposas(entorno)];
    entorno.elegir(nivelDeAfuera(refs));
    const resultado = await entorno.invocar('project:open');
    assert.equal(resultado.imported.copied, 1, 'solo se copia la textura legal');
    for (const ref of tramposas(entorno)) {
      assert.ok(resultado.imported.missing.includes(ref), `no marco como faltante ${ref}`);
    }
    assert.equal(secretoCopiado(), false, 'copio el secreto adentro del proyecto');
    assert.deepEqual(entorno.contenidoFuera(), ['secreto.txt']);
  });

  it('una referencia que sale de assets no escribe en otra carpeta del proyecto', async () => {
    // El archivo existe en el origen (<origen>/levels/otro.json), pero esta
    // fuera de sus assets, y su destino seria <proyecto>/levels/otro.json.
    const archivo = nivelDeAfuera(['textures/../../levels/otro.json']);
    fs.writeFileSync(path.join(origen, 'levels', 'otro.json'), '{"pisado":true}');
    entorno.elegir(archivo);
    const resultado = await entorno.invocar('project:open');
    assert.deepEqual(resultado.imported.missing, ['textures/../../levels/otro.json']);
    assert.equal(fs.existsSync(path.join(entorno.root, 'levels', 'otro.json')), false);
  });

  it('el nombre del nivel importado se limpia y no pisa otro', async () => {
    fs.writeFileSync(path.join(entorno.root, 'levels', 'importado.json'), '{"original":true}');
    entorno.elegir(nivelDeAfuera([], 'importado.json'));
    const resultado = await entorno.invocar('project:open');
    assert.equal(resultado.relativePath, 'levels/importado-2.json');
    assert.equal(
      fs.readFileSync(path.join(entorno.root, 'levels', 'importado.json'), 'utf-8'),
      '{"original":true}',
    );
  });

  it('un nivel que no es json valido se rechaza sin copiar nada', async () => {
    fs.mkdirSync(path.join(origen, 'levels'), { recursive: true });
    const roto = path.join(origen, 'levels', 'roto.json');
    fs.writeFileSync(roto, '{ "texture": "../../fuera/secreto.txt", ');
    entorno.elegir(roto);
    const antes = listarArbol(entorno.root);
    assert.ok(
      await entorno.invocar('project:open').then(
        () => null,
        (err) => err,
      ),
    );
    assert.deepEqual(listarArbol(entorno.root), antes);
  });

  it('project:open no usa una ruta mandada por la UI: siempre pasa por el dialogo', async () => {
    entorno.elegir(null);
    const otro = await prepararEntorno();
    try {
      const resultado = await otro.invocar('project:open', path.join(otro.fuera, 'secreto.txt'));
      assert.equal(resultado.canceled, true);
      assert.equal(otro.electron.__prueba.dialogos.length, 1);
    } finally {
      otro.limpiar();
    }
  });
});
