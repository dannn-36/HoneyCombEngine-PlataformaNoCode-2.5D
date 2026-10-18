// =============================================================================
// Guardar: project:writeFile no deja archivos a medias (ver ipc/safe-write.js)
// =============================================================================
//
// Se escribe a un temporal y se renombra encima del original, con la version
// anterior en .bak. Los fallos del disco se simulan reemplazando fs.rename por
// uno que falla: es el paso en el que, antes, el archivo ya estaba vaciado.
// =============================================================================

const { describe, it, before, after, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const { prepararEntorno, errorDe } = require('./support/entorno');

let entorno;
before(async () => {
  entorno = await prepararEntorno();
});
after(() => entorno?.limpiar());

const renameReal = fsp.rename;
afterEach(() => {
  fsp.rename = renameReal;
});

const enDisco = (relativa) => path.join(entorno.root, relativa);
const leer = (relativa) => fs.readFileSync(enDisco(relativa), 'utf-8');
const guardar = (relativa, contents) => entorno.invocar('project:writeFile', { filePath: relativa, contents });
/** Los temporales que quedaron en una carpeta del proyecto. */
const temporales = (carpeta) => fs.readdirSync(enDisco(carpeta)).filter((nombre) => nombre.endsWith('.tmp'));

/** Hace que fs.rename falle con "code" las primeras "veces" llamadas (Infinity = siempre). */
function renameQueFalla(code, veces = Infinity) {
  let llamadas = 0;
  fsp.rename = async (...args) => {
    llamadas += 1;
    if (llamadas <= veces) throw Object.assign(new Error(`${code}: simulado`), { code });
    return renameReal(...args);
  };
  return () => llamadas;
}

describe('project:writeFile escribe de forma atomica', () => {
  it('escribe el contenido y no deja temporales', async () => {
    await guardar('levels/a.json', '{"v":1}');
    assert.equal(leer('levels/a.json'), '{"v":1}');
    assert.deepEqual(temporales('levels'), []);
  });

  it('crea las carpetas que falten', async () => {
    await guardar('levels/mundo/nuevo.json', '{}');
    assert.equal(leer('levels/mundo/nuevo.json'), '{}');
  });

  it('el primer guardado no deja respaldo: no habia version anterior', async () => {
    await guardar('levels/primero.json', '{"v":1}');
    assert.equal(fs.existsSync(enDisco('levels/primero.json.bak')), false);
  });

  it('guardar de nuevo deja la version anterior en .bak', async () => {
    await guardar('levels/b.json', '{"v":1}');
    await guardar('levels/b.json', '{"v":2}');
    assert.equal(leer('levels/b.json'), '{"v":2}');
    assert.equal(leer('levels/b.json.bak'), '{"v":1}');
  });

  it('si la escritura falla, el archivo anterior queda entero y no quedan temporales', async () => {
    await guardar('levels/c.json', '{"v":"original"}');
    renameQueFalla('ENOSPC');
    const err = await errorDe(guardar('levels/c.json', '{"v":"nuevo"}'));
    assert.ok(err, 'el guardado tenia que fallar');
    assert.equal(leer('levels/c.json'), '{"v":"original"}');
    assert.deepEqual(temporales('levels'), []);
  });

  it('reintenta si otro programa tiene el archivo abierto un instante', async () => {
    await guardar('levels/d.json', '{"v":1}');
    const llamadas = renameQueFalla('EBUSY', 2);
    await guardar('levels/d.json', '{"v":2}');
    assert.equal(leer('levels/d.json'), '{"v":2}');
    assert.equal(llamadas(), 3);
  });

  it('sigue sin dejar salir de la carpeta del editor', async () => {
    const err = await errorDe(guardar('../fuera/escapado.json', '{}'));
    assert.ok(err, 'escribio fuera de la carpeta del editor');
    assert.equal(fs.existsSync(path.join(entorno.fuera, 'escapado.json')), false);
  });
});

describe('project:writeFile explica por que no pudo guardar', () => {
  it('sin espacio en el disco lo dice, y que el anterior no se toco', async () => {
    renameQueFalla('ENOSPC');
    const err = await errorDe(guardar('levels/e.json', '{}'));
    assert.match(err.message, /espacio/);
    assert.match(err.message, /levels\/e\.json/);
  });

  it('un archivo bloqueado de forma permanente dice que hacer', async () => {
    renameQueFalla('EPERM');
    const err = await errorDe(guardar('levels/f.json', '{}'));
    if (process.platform === 'win32') {
      assert.match(err.message, /Acceso controlado a carpetas/);
    } else {
      assert.match(err.message, /permiso/);
    }
  });

  it('un error sin causa conocida llega como vino', async () => {
    renameQueFalla('EIO');
    const err = await errorDe(guardar('levels/g.json', '{}'));
    assert.match(err.message, /EIO/);
  });
});
