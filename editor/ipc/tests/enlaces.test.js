// =============================================================================
// Seguridad: enlaces dentro de la carpeta del editor (SE-04)
// =============================================================================
//
// resolveInProject (ipc/project-root.js) valida la ruta como TEXTO: mira que
// "levels/enlace/x" no tenga "..", pero no que "levels/enlace" sea de verdad
// una carpeta del proyecto. Si es una union (junction) o un enlace simbolico
// hacia otro lado, todo lo que pase por ahi lee y escribe afuera.
//
// En Windows una union se crea sin permisos de administrador
// (fs.symlinkSync(destino, enlace, 'junction')), asi que basta con que el
// proyecto venga de un .zip o de una carpeta compartida que la traiga. Los
// enlaces simbolicos a archivo piden administrador o el modo desarrollador: si
// no se pueden crear, esa prueba se saltea. Los enlaces DUROS (fs.linkSync)
// tampoco piden nada, y ni siquiera se detectan con realpath: apuntan al mismo
// archivo, no a una ruta.
// =============================================================================

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { prepararEntorno, errorDe } = require('./support/entorno');

const SE04 = 'Defecto conocido: SE-04 - la validacion de rutas es lexica y sigue enlaces';

let entorno;

beforeEach(async () => {
  entorno = await prepararEntorno();
});

afterEach(() => entorno?.limpiar());

/** Reemplaza <proyecto>/<relativa> por una union hacia <base>/fuera. */
function unionHaciaAfuera(relativa) {
  const enlace = path.join(entorno.root, relativa);
  fs.rmSync(enlace, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(enlace), { recursive: true });
  fs.symlinkSync(entorno.fuera, enlace, 'junction');
  return enlace;
}

function puedeCrearEnlaceSimbolico() {
  const prueba = path.join(entorno.base, 'prueba-enlace');
  try {
    fs.symlinkSync(path.join(entorno.fuera, 'secreto.txt'), prueba, 'file');
    fs.unlinkSync(prueba);
    return true;
  } catch {
    return false;
  }
}

describe('una union dentro del proyecto no deja salir de el', () => {
  // Defecto conocido: SE-04. resolveInProject solo compara textos con
  // path.relative; no resuelve la ruta real (fs.realpath) antes de comparar.
  it('project:readFile no lee a traves de una union', { todo: SE04 }, async () => {
    unionHaciaAfuera('levels/enlace');
    const err = await errorDe(entorno.invocar('project:readFile', 'levels/enlace/secreto.txt'));
    assert.ok(err, 'leyo el secreto a traves de la union');
  });

  it(
    'project:readFileData no muestra un archivo a traves de una union',
    { todo: SE04 },
    async () => {
      unionHaciaAfuera('levels/enlace');
      const err = await errorDe(
        entorno.invocar('project:readFileData', 'levels/enlace/secreto.txt'),
      );
      assert.ok(err);
    },
  );

  it(
    'project:listEntries no lista una carpeta de afuera a traves de una union',
    { todo: SE04 },
    async () => {
      unionHaciaAfuera('levels/enlace');
      let lista = [];
      await errorDe(
        entorno.invocar('project:listEntries', 'levels/enlace').then((r) => {
          lista = r;
        }),
      );
      assert.ok(!lista.some((n) => n.name === 'secreto.txt'), 'listo el contenido de afuera');
    },
  );

  it(
    'project:listDir no lista una carpeta de afuera a traves de una union',
    { todo: SE04 },
    async () => {
      unionHaciaAfuera('levels/enlace');
      let lista = [];
      await errorDe(
        entorno.invocar('project:listDir', 'levels/enlace').then((r) => {
          lista = r;
        }),
      );
      assert.ok(!lista.includes('secreto.txt'));
    },
  );

  it('project:writeFile no escribe a traves de una union', { todo: SE04 }, async () => {
    unionHaciaAfuera('levels/enlace');
    await errorDe(
      entorno.invocar('project:writeFile', {
        filePath: 'levels/enlace/nuevo.json',
        contents: '{}',
      }),
    );
    assert.deepEqual(entorno.contenidoFuera(), ['secreto.txt']);
  });

  it(
    'project:writeFile no pisa un archivo de afuera a traves de una union',
    { todo: SE04 },
    async () => {
      unionHaciaAfuera('levels/enlace');
      await errorDe(
        entorno.invocar('project:writeFile', {
          filePath: 'levels/enlace/secreto.txt',
          contents: 'PISADO',
        }),
      );
      assert.equal(fs.readFileSync(path.join(entorno.fuera, 'secreto.txt'), 'utf-8'), 'SECRETO');
    },
  );

  it('project:createDir no crea carpetas a traves de una union', { todo: SE04 }, async () => {
    unionHaciaAfuera('levels/enlace');
    await errorDe(entorno.invocar('project:createDir', 'levels/enlace/nueva'));
    assert.deepEqual(entorno.contenidoFuera(), ['secreto.txt']);
  });

  it(
    'textures:write no escribe afuera si assets/textures es una union',
    { todo: SE04 },
    async () => {
      unionHaciaAfuera('assets/textures');
      const png = Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        Buffer.alloc(16),
      ]);
      await errorDe(
        entorno.invocar('textures:write', {
          name: 'sprite',
          pngBase64: png.toString('base64'),
          overwrite: false,
        }),
      );
      assert.deepEqual(entorno.contenidoFuera(), ['secreto.txt']);
    },
  );

  it('game:clearSave no borra afuera si saves es una union', { todo: SE04 }, async () => {
    fs.writeFileSync(path.join(entorno.fuera, 'partida.json'), 'IMPORTANTE');
    unionHaciaAfuera('saves');
    await errorDe(entorno.invocar('game:clearSave'));
    assert.ok(
      fs.existsSync(path.join(entorno.fuera, 'partida.json')),
      'borro un archivo de afuera',
    );
  });

  it(
    'convert:begin desde el proyecto no toma imagenes de afuera a traves de una union',
    { todo: SE04 },
    async () => {
      fs.writeFileSync(path.join(entorno.fuera, 'foto.jpg'), 'JPG de afuera');
      unionHaciaAfuera('assets/textures');
      const sesion = await entorno.invocar('convert:begin', 'project-jpg');
      assert.deepEqual(sesion.items ?? [], [], 'agrego al plan una imagen de afuera');
    },
  );

  it('una carpeta comun del proyecto sigue funcionando', async () => {
    await entorno.invocar('project:createDir', 'levels/sub');
    await entorno.invocar('project:writeFile', { filePath: 'levels/sub/a.json', contents: '{}' });
    assert.equal(await entorno.invocar('project:readFile', 'levels/sub/a.json'), '{}');
  });
});

describe('otros enlaces dentro del proyecto', () => {
  it(
    'project:readFile no lee a traves de un enlace simbolico a archivo',
    { todo: SE04 },
    async (t) => {
      if (!puedeCrearEnlaceSimbolico()) {
        t.skip('crear enlaces simbolicos pide administrador o el modo desarrollador');
        return;
      }
      fs.symlinkSync(
        path.join(entorno.fuera, 'secreto.txt'),
        path.join(entorno.root, 'levels', 'enlace.json'),
        'file',
      );
      const err = await errorDe(entorno.invocar('project:readFile', 'levels/enlace.json'));
      assert.ok(err);
    },
  );

  it(
    'project:writeFile no modifica un archivo de afuera enlazado con un enlace duro',
    { todo: SE04 },
    async () => {
      // Defecto conocido: SE-04. Un enlace duro es el MISMO archivo con dos
      // nombres: fs.writeFile lo trunca y escribe en el lugar, y el de afuera
      // cambia. realpath no lo detecta; hace falta mirar stat().nlink o
      // escribir en un temporal y renombrar.
      fs.linkSync(
        path.join(entorno.fuera, 'secreto.txt'),
        path.join(entorno.root, 'levels', 'duro.json'),
      );
      await errorDe(
        entorno.invocar('project:writeFile', { filePath: 'levels/duro.json', contents: 'PISADO' }),
      );
      assert.equal(fs.readFileSync(path.join(entorno.fuera, 'secreto.txt'), 'utf-8'), 'SECRETO');
    },
  );
});
