// =============================================================================
// Seguridad: rutas que llegan del renderer (recorrido de directorios)
// =============================================================================
//
// La UI no es confiable: un bug o un nivel armado a mano pueden mandar
// cualquier ruta. Todo handler que recibe una ruta la pasa por
// resolveInProject (ipc/project-root.js), y ninguna puede salir de la carpeta
// del editor. Aca se le tira a cada handler un catalogo de rutas tramposas que
// apuntan a <base>/fuera/secreto.txt, al lado de la carpeta del proyecto:
// subir con "..", absolutas, de unidad, UNC, prefijos de Windows (\\?\ y
// \\.\), separadores mezclados, codificadas como URL, con bytes nulos, muy
// largas...
//
// Lo seguro es: o el handler falla, o lo que hace queda dentro del proyecto.
// Nunca devuelve el secreto, nunca lista la carpeta de afuera, nunca escribe
// en ella.
// =============================================================================

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { prepararEntorno, errorDe } = require('./support/entorno');

/** Las rutas tramposas, todas hacia "<base>/fuera/<archivo>". */
function rutasTramposas(entorno, archivo = 'secreto.txt') {
  const absoluta = path.join(entorno.fuera, archivo);
  const sinUnidad = absoluta.slice(2); // "\Users\...\fuera\secreto.txt"
  const unidad = absoluta.slice(0, 2);
  const rutas = [
    ['subir con barras normales', `../fuera/${archivo}`],
    ['subir con barras invertidas', `..\\fuera\\${archivo}`],
    ['subir desde una subcarpeta', `levels/../../fuera/${archivo}`],
    ['separadores mezclados', `levels\\../..\\fuera/${archivo}`],
    ['subir de mas', `${'../'.repeat(30)}${absoluta.slice(3).replace(/\\/g, '/')}`],
    ['ruta absoluta', absoluta],
    ['ruta absoluta con barras normales', absoluta.replace(/\\/g, '/')],
    ['ruta absoluta con la unidad en minuscula', absoluta[0].toLowerCase() + absoluta.slice(1)],
    ['ruta desde la raiz del disco sin unidad', sinUnidad],
    ['ruta relativa a la unidad', `${unidad}..\\fuera\\${archivo}`],
    ['prefijo de ruta larga de windows', `\\\\?\\${absoluta}`],
    ['espacio de nombres de dispositivos', `\\\\.\\${absoluta}`],
    ['ruta unc a un recurso compartido', `\\\\127.0.0.1\\${unidad[0]}$${sinUnidad}`],
    ['ruta unc con barras normales', `//127.0.0.1/${unidad[0]}$${sinUnidad.replace(/\\/g, '/')}`],
    ['url file', `file:///${absoluta.replace(/\\/g, '/')}`],
    ['codificada como url', `%2e%2e%2ffuera%2f${archivo}`],
    ['codificada como url con barras reales', `%2e%2e/fuera/${archivo}`],
    ['byte nulo al final', `../fuera/${archivo}\u0000.json`],
    ['byte nulo en el medio', `levels/nivel.json\u0000/../../../fuera/${archivo}`],
    ['puntos y espacios que windows recorta', `.. /fuera/${archivo}`],
    ['tres puntos', `.../fuera/${archivo}`],
    ['nombre muy largo', `${'a'.repeat(5000)}/../../fuera/${archivo}`],
  ];
  return rutas;
}

let entorno;

before(async () => {
  entorno = await prepararEntorno();
  fs.mkdirSync(path.join(entorno.fuera, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(entorno.root, 'levels', 'nivel.json'), '{"name":"ok"}');
});

after(() => entorno?.limpiar());

/** El secreto y la carpeta de afuera siguen como estaban. */
function afueraIntacto() {
  assert.equal(fs.readFileSync(path.join(entorno.fuera, 'secreto.txt'), 'utf-8'), 'SECRETO');
  assert.deepEqual(entorno.contenidoFuera(), ['secreto.txt', 'sub']);
}

describe('project:readFile no lee fuera de la carpeta del editor', () => {
  // Las rutas se arman con la base del entorno, que existe recien en before():
  // se generan con una base de mentira solo para los nombres de las pruebas.
  for (const [nombre] of rutasTramposas({ fuera: 'C:\\x\\fuera' })) {
    it(`rechaza: ${nombre}`, async () => {
      const ruta = rutasTramposas(entorno).find(([n]) => n === nombre)[1];
      const err = await errorDe(entorno.invocar('project:readFile', ruta));
      if (!err) {
        assert.fail('leyo algo con una ruta tramposa');
      }
      afueraIntacto();
    });
  }

  it('una ruta valida dentro del proyecto se sigue leyendo', async () => {
    assert.equal(await entorno.invocar('project:readFile', 'levels/nivel.json'), '{"name":"ok"}');
  });
});

describe('project:readFileData no muestra archivos de afuera', () => {
  for (const [nombre] of rutasTramposas({ fuera: 'C:\\x\\fuera' })) {
    it(`rechaza: ${nombre}`, async () => {
      const ruta = rutasTramposas(entorno).find(([n]) => n === nombre)[1];
      let resultado = null;
      const err = await errorDe(
        entorno.invocar('project:readFileData', ruta).then((r) => {
          resultado = r;
        }),
      );
      assert.ok(
        err || !JSON.stringify(resultado).includes('SECRETO'),
        'devolvio el contenido de afuera',
      );
      assert.ok(err, 'tendria que rechazar la ruta, no solo no mostrarla');
    });
  }
});

describe('project:writeFile no escribe fuera de la carpeta del editor', () => {
  for (const [nombre] of rutasTramposas({ fuera: 'C:\\x\\fuera' }, 'escrito.json')) {
    it(`rechaza: ${nombre}`, async () => {
      const ruta = rutasTramposas(entorno, 'escrito.json').find(([n]) => n === nombre)[1];
      await errorDe(entorno.invocar('project:writeFile', { filePath: ruta, contents: 'PISADO' }));
      afueraIntacto();
    });
  }

  it('tampoco pisa un archivo que ya existe afuera', async () => {
    await errorDe(
      entorno.invocar('project:writeFile', {
        filePath: '../fuera/secreto.txt',
        contents: 'PISADO',
      }),
    );
    afueraIntacto();
  });

  it('una ruta valida dentro del proyecto se sigue escribiendo', async () => {
    await entorno.invocar('project:writeFile', { filePath: 'levels/nuevo.json', contents: '{}' });
    assert.equal(fs.readFileSync(path.join(entorno.root, 'levels', 'nuevo.json'), 'utf-8'), '{}');
  });
});

describe('project:createDir no crea carpetas afuera', () => {
  for (const [nombre] of rutasTramposas({ fuera: 'C:\\x\\fuera' }, 'nueva')) {
    it(`rechaza: ${nombre}`, async () => {
      const ruta = rutasTramposas(entorno, 'nueva').find(([n]) => n === nombre)[1];
      await errorDe(entorno.invocar('project:createDir', ruta));
      afueraIntacto();
    });
  }
});

describe('project:listDir y project:listEntries no listan carpetas de afuera', () => {
  const carpetas = (e) => [
    ['subir con barras normales', '../fuera'],
    ['subir con barras invertidas', '..\\fuera'],
    ['separadores mezclados', 'levels\\../../fuera'],
    ['ruta absoluta', e.fuera],
    ['ruta absoluta con barras normales', e.fuera.replace(/\\/g, '/')],
    ['prefijo de ruta larga de windows', `\\\\?\\${e.fuera}`],
    ['espacio de nombres de dispositivos', `\\\\.\\${e.fuera}`],
    ['ruta desde la raiz del disco sin unidad', e.fuera.slice(2)],
    ['la raiz del disco', e.fuera.slice(0, 3)],
    ['la carpeta padre', '..'],
  ];
  for (const canal of ['project:listDir', 'project:listEntries']) {
    for (const [nombre] of carpetas({ fuera: 'C:\\x\\fuera' })) {
      it(`${canal} rechaza: ${nombre}`, async () => {
        const ruta = carpetas(entorno).find(([n]) => n === nombre)[1];
        let lista = null;
        const err = await errorDe(
          entorno.invocar(canal, ruta).then((r) => {
            lista = r;
          }),
        );
        assert.ok(err, `listo ${JSON.stringify(lista)}`);
      });
    }
  }
});

describe('los handlers de rutas no aceptan tipos inesperados', () => {
  const basura = [
    undefined,
    null,
    42,
    true,
    {},
    [],
    ['../fuera/secreto.txt'],
    { toString: () => '../fuera/secreto.txt' },
  ];
  for (const canal of [
    'project:readFile',
    'project:readFileData',
    'project:createDir',
    'project:listDir',
  ]) {
    it(`${canal} falla con valores que no son texto`, async () => {
      for (const valor of basura) {
        const err = await errorDe(entorno.invocar(canal, valor));
        assert.ok(err, `${canal} acepto ${JSON.stringify(valor)}`);
      }
      afueraIntacto();
    });
  }

  it('project:writeFile falla si la ruta o el contenido no son lo esperado', async () => {
    const casos = [
      undefined,
      null,
      {},
      { filePath: 42, contents: 'x' },
      { filePath: ['../fuera/x.json'], contents: 'x' },
      { filePath: { toString: () => '../fuera/x.json' }, contents: 'x' },
      { filePath: 'levels/tipos.json', contents: { a: 1 } },
      { filePath: 'levels/tipos.json', contents: 42 },
    ];
    for (const caso of casos) {
      const err = await errorDe(entorno.invocar('project:writeFile', caso));
      assert.ok(err, `acepto ${JSON.stringify(caso)}`);
    }
    afueraIntacto();
  });
});

describe('los canales sin rutas no usan lo que mande la UI', () => {
  it('workspace:change no cambia la carpeta a una ruta mandada por la UI', async () => {
    const resultado = await entorno.invocar('workspace:change', entorno.fuera);
    assert.equal(resultado, null, 'sin dialogo no hay cambio');
    assert.equal(entorno.projectRoot.getProjectRoot(), entorno.root);
  });

  it('workspace:reveal abre solo la carpeta del editor', async () => {
    await entorno.invocar('workspace:reveal', entorno.fuera);
    assert.deepEqual(entorno.electron.__prueba.abiertosShell, [entorno.root]);
  });

  it('workspace:readEventCatalog lee el catalogo de la instalacion y nada mas', async () => {
    const catalogo = await entorno.invocar('workspace:readEventCatalog', '../fuera/secreto.txt');
    assert.ok(!catalogo.includes('SECRETO'));
    assert.doesNotThrow(() => JSON.parse(catalogo));
  });

  it('game:clearSave borra solo saves/partida.json aunque reciba otra ruta', async () => {
    fs.mkdirSync(path.join(entorno.root, 'saves'), { recursive: true });
    fs.writeFileSync(path.join(entorno.root, 'saves', 'partida.json'), '{}');
    await entorno.invocar('game:clearSave', '../fuera/secreto.txt');
    assert.equal(fs.existsSync(path.join(entorno.root, 'saves', 'partida.json')), false);
    afueraIntacto();
  });

  it('game:clearSave borra tambien la partida de prueba y las copias, y nada mas de saves/', async () => {
    const saves = path.join(entorno.root, 'saves');
    fs.mkdirSync(saves, { recursive: true });
    const partidas = ['partida.json', 'partida.json.bak', 'prueba.json', 'prueba.json.bak', 'prueba.json.tmp'];
    for (const nombre of [...partidas, 'notas.txt']) fs.writeFileSync(path.join(saves, nombre), '{}');
    await entorno.invocar('game:clearSave');
    assert.deepEqual(fs.readdirSync(saves), ['notas.txt']);
  });
});
