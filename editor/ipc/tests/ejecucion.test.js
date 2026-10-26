// =============================================================================
// Seguridad: ejecutar el motor y compilarlo (ipc/run.js, ipc/engine-build.js)
// =============================================================================
//
// project:run es el unico canal que lanza un programa con datos de la UI (la
// ruta del nivel). Lo seguro es que el binario sea SIEMPRE el motor de la
// instalacion de HoneyComb, que el nivel sea un .json de la carpeta del
// editor, y que los argumentos viajen sin shell.
//
// Para que el resultado no dependa de si en esta maquina hay un motor
// compilado, ipc/ se carga desde una COPIA en una carpeta temporal: asi
// INSTALL_ROOT es una instalacion vacia, y cada prueba arma el motor que
// necesita (un engine.exe de mentira: spawn esta interceptado y no lanza nada).
// =============================================================================

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { prepararEntorno } = require('./support/entorno');

let entorno;

beforeEach(async () => {
  entorno = await prepararEntorno({ instalacion: 'copia' });
});

afterEach(() => entorno?.limpiar());

/** Un engine.exe de mentira en <raiz>/engine/<carpeta>/. */
function motorFalso(raiz, carpeta = 'build') {
  const exe = path.join(raiz, 'engine', carpeta, 'engine.exe');
  fs.mkdirSync(path.dirname(exe), { recursive: true });
  fs.writeFileSync(exe, 'MZ binario de prueba');
  return exe;
}

/** Un nivel valido en <raiz>/levels/<nombre>. */
function nivel(raiz, nombre = 'nivel.json') {
  const archivo = path.join(raiz, 'levels', nombre);
  fs.mkdirSync(path.dirname(archivo), { recursive: true });
  fs.writeFileSync(
    archivo,
    JSON.stringify({ name: 'prueba', grid: { width: 4, height: 4 }, entities: [], events: [] }),
  );
  return archivo;
}

/**
 * Una carpeta "compartida" con forma de proyecto que trae su propio
 * engine.exe: lo que alguien podria dejar en una carpeta de red, un pendrive
 * o un .zip descargado.
 */
function carpetaCompartida(carpetaMotor = 'build') {
  const compartida = path.join(entorno.base, 'compartida');
  return { exe: motorFalso(compartida, carpetaMotor), level: nivel(compartida) };
}

describe('project:run solo ejecuta el motor de la instalacion (SE-01)', () => {
  it(
    'un nivel de una carpeta ajena no hace ejecutar el engine.exe que trae al lado',
    {
      // Defecto conocido: SE-01. engineRoots() (ipc/run.js) agrega como raiz
      // de busqueda la carpeta que se deduce del nivel (<nivel>/../..), y
      // findEngineExecutable (ipc/engine-modes.js) devuelve el primer
      // engine.exe que encuentre. Sin motor en la instalacion, gana el de la
      // carpeta ajena.
      todo: 'Defecto conocido: SE-01 - run.js busca el motor junto al nivel recibido',
    },
    async () => {
      const ajena = carpetaCompartida();
      await entorno.invocar('project:run', {
        levelPath: ajena.level,
        mode: 'debug',
        start: 'level',
      });
      for (const lanzado of entorno.lanzados) {
        assert.notEqual(
          path.resolve(lanzado.command),
          path.resolve(ajena.exe),
          'ejecuto el binario de la carpeta ajena',
        );
      }
    },
  );

  it(
    'con el motor debug instalado, pedir release no ejecuta el release de una carpeta ajena',
    {
      // Defecto conocido: SE-01. Es el caso mas comun: el instalador deja solo
      // engine/build (Debug); el Release se compila la primera vez que se pide.
      // Hasta entonces, "Ejecutar con Release" busca build-release junto al
      // nivel y lanza el que haya.
      todo: 'Defecto conocido: SE-01 - el modo sin compilar cae en el motor de la carpeta del nivel',
    },
    async () => {
      motorFalso(entorno.installRoot, 'build');
      const ajena = carpetaCompartida('build-release');
      await entorno.invocar('project:run', {
        levelPath: ajena.level,
        mode: 'release',
        start: 'level',
      });
      for (const lanzado of entorno.lanzados) {
        assert.notEqual(path.resolve(lanzado.command), path.resolve(ajena.exe));
      }
    },
  );

  it(
    'un nivel fuera de la carpeta del editor se rechaza sin lanzar nada',
    {
      // Defecto conocido: SE-01. project:run no pasa levelPath por
      // resolveInProject: acepta cualquier ruta absoluta que exista.
      todo: 'Defecto conocido: SE-01 - levelPath no se valida contra la carpeta del editor',
    },
    async () => {
      motorFalso(entorno.installRoot);
      const ajena = carpetaCompartida();
      const resultado = await entorno.invocar('project:run', {
        levelPath: ajena.level,
        mode: 'debug',
        start: 'level',
      });
      assert.equal(resultado.ok, false);
      assert.equal(entorno.lanzados.length, 0);
    },
  );

  it(
    'un archivo que no es un nivel json no se le pasa al motor',
    {
      // Defecto conocido: SE-01. Basta con que el archivo exista: el motor
      // recibe, por ejemplo, un .txt o un .exe de otra carpeta como nivel.
      todo: 'Defecto conocido: SE-01 - project:run no mira la extension ni la carpeta del nivel',
    },
    async () => {
      motorFalso(entorno.installRoot);
      const resultado = await entorno.invocar('project:run', {
        levelPath: path.join(entorno.fuera, 'secreto.txt'),
        mode: 'debug',
        start: 'level',
      });
      assert.equal(resultado.ok, false);
      assert.equal(entorno.lanzados.length, 0);
    },
  );

  it(
    'una ruta relativa con subidas no se resuelve contra la carpeta de trabajo del editor',
    {
      // Defecto conocido: SE-01. existsSync() resuelve una ruta relativa contra
      // el directorio de trabajo del proceso principal, no contra la carpeta
      // del editor: "../.." alcanza cualquier archivo del disco.
      todo: 'Defecto conocido: SE-01 - las rutas relativas no pasan por resolveInProject',
    },
    async () => {
      motorFalso(entorno.installRoot);
      const relativa = path.relative(process.cwd(), path.join(entorno.fuera, 'secreto.txt'));
      const resultado = await entorno.invocar('project:run', {
        levelPath: relativa,
        mode: 'debug',
        start: 'level',
      });
      assert.equal(resultado.ok, false);
      assert.equal(entorno.lanzados.length, 0);
    },
  );

  it('con un nivel del proyecto ejecuta el motor de la instalacion', async () => {
    const exe = motorFalso(entorno.installRoot);
    const level = nivel(entorno.root);
    const resultado = await entorno.invocar('project:run', {
      levelPath: level,
      mode: 'debug',
      start: 'level',
    });
    assert.equal(resultado.ok, true);
    assert.equal(entorno.lanzados.length, 1);
    assert.equal(path.resolve(entorno.lanzados[0].command), path.resolve(exe));
    assert.deepEqual(entorno.lanzados[0].args, [level]);
  });

  it('sin motor en la instalacion ni en el proyecto contesta que falta, sin lanzar nada', async () => {
    const resultado = await entorno.invocar('project:run', {
      levelPath: nivel(entorno.root),
      mode: 'debug',
    });
    assert.equal(resultado.ok, false);
    assert.equal(resultado.missing, true);
    assert.equal(entorno.lanzados.length, 0);
  });

  it('sin nivel o con un valor que no es una ruta no lanza nada', async () => {
    motorFalso(entorno.installRoot);
    for (const levelPath of [undefined, null, '', 0, {}, [], ['a'], 'no/existe.json']) {
      const resultado = await entorno.invocar('project:run', { levelPath, mode: 'debug' });
      assert.equal(resultado.ok, false, JSON.stringify(levelPath));
    }
    assert.equal(entorno.lanzados.length, 0);
  });
});

describe('project:run arma el comando sin shell ni opciones de la UI', () => {
  it('lanza sin shell: los metacaracteres del nombre del nivel no se interpretan', async () => {
    motorFalso(entorno.installRoot);
    const level = nivel(entorno.root, 'a & calc.exe & b.json');
    await entorno.invocar('project:run', { levelPath: level, mode: 'debug', start: 'level' });
    const [lanzado] = entorno.lanzados;
    assert.ok(!lanzado.options.shell, 'spawn no debe usar shell');
    assert.deepEqual(lanzado.args, [level], 'el nivel viaja como un unico argumento');
  });

  it('un modo desconocido no elige carpetas de la UI: cae en debug', async () => {
    const exe = motorFalso(entorno.installRoot);
    const level = nivel(entorno.root);
    for (const mode of ['../../fuera', 'Release', { buildDir: '..' }, 'constructor', '__proto__']) {
      await entorno.invocar('project:run', { levelPath: level, mode, start: 'level' });
    }
    assert.equal(entorno.lanzados.length, 5);
    for (const lanzado of entorno.lanzados) {
      assert.equal(path.resolve(lanzado.command), path.resolve(exe));
    }
  });

  it('"start" solo agrega --portada; cualquier otro valor no agrega opciones', async () => {
    motorFalso(entorno.installRoot);
    const level = nivel(entorno.root);
    await entorno.invocar('project:run', { levelPath: level, mode: 'debug', start: 'title' });
    await entorno.invocar('project:run', {
      levelPath: level,
      mode: 'debug',
      start: '--captura C:/x.png',
    });
    await entorno.invocar('project:run', {
      levelPath: level,
      mode: 'debug',
      start: ['--bench', '1'],
    });
    assert.deepEqual(
      entorno.lanzados.map((l) => l.args),
      [[level, '--portada'], [level], [level]],
    );
  });

  it('el motor arranca en su propia carpeta, no en una que mande la UI', async () => {
    const exe = motorFalso(entorno.installRoot);
    await entorno.invocar('project:run', {
      levelPath: nivel(entorno.root),
      mode: 'debug',
      cwd: entorno.fuera,
    });
    assert.equal(path.resolve(entorno.lanzados[0].options.cwd), path.dirname(path.resolve(exe)));
  });
});

describe('engine:build solo corre la compilacion de la instalacion', () => {
  /** Un CMakeCache.txt de la instalacion, como lo deja el instalador. */
  function cacheDeCMake(modo = 'Debug') {
    const cmake = path.join(entorno.base, 'herramientas', 'cmake.exe');
    const carpeta = path.join(entorno.installRoot, 'engine', 'build');
    fs.mkdirSync(carpeta, { recursive: true });
    fs.writeFileSync(
      path.join(carpeta, 'CMakeCache.txt'),
      [
        `CMAKE_BUILD_TYPE:STRING=${modo}`,
        `CMAKE_COMMAND:INTERNAL=${cmake}`,
        'CMAKE_GENERATOR:INTERNAL=Ninja',
      ].join('\n'),
    );
    return cmake;
  }

  it('un modo desconocido se rechaza sin lanzar nada', async () => {
    cacheDeCMake();
    for (const mode of [
      undefined,
      null,
      '',
      'Debug',
      '../build',
      'debug; calc',
      { mode: 'debug' },
      ['debug'],
      'constructor',
    ]) {
      const resultado = await entorno.invocar('engine:build', mode);
      assert.equal(resultado.ok, false, JSON.stringify(mode));
    }
    assert.equal(entorno.lanzados.length, 0);
  });

  it('compila con el cmake de la instalacion, sin shell y en engine/', async () => {
    const cmake = cacheDeCMake();
    const resultado = await entorno.invocar('engine:build', 'debug');
    assert.equal(resultado.ok, true);
    assert.equal(entorno.lanzados.length, 1);
    const [lanzado] = entorno.lanzados;
    assert.equal(lanzado.command, cmake);
    assert.ok(!lanzado.options.shell);
    assert.equal(path.resolve(lanzado.options.cwd), path.join(entorno.installRoot, 'engine'));
    assert.deepEqual(lanzado.args, ['--build', path.join(entorno.installRoot, 'engine', 'build')]);
  });

  it('no le pasa al compilador ELECTRON_RUN_AS_NODE', async () => {
    cacheDeCMake();
    const anterior = process.env.ELECTRON_RUN_AS_NODE;
    process.env.ELECTRON_RUN_AS_NODE = '1';
    try {
      await entorno.invocar('engine:build', 'debug');
    } finally {
      if (anterior === undefined) delete process.env.ELECTRON_RUN_AS_NODE;
      else process.env.ELECTRON_RUN_AS_NODE = anterior;
    }
    assert.equal(entorno.lanzados[0].options.env.ELECTRON_RUN_AS_NODE, undefined);
  });

  it('sin una instalacion compilada antes no inventa un cmake: contesta el error', async () => {
    const resultado = await entorno.invocar('engine:build', 'release');
    assert.equal(resultado.ok, false);
    assert.equal(entorno.lanzados.length, 0);
  });

  it('engine:status mira solo la instalacion', async () => {
    // Un motor en la carpeta del editor no cuenta como "compilado".
    motorFalso(entorno.root);
    const estado = await entorno.invocar('engine:status', 'debug');
    assert.deepEqual(estado, { debug: false, release: false, canBuild: true });
  });
});

describe('la app instalada no compila el motor', () => {
  // La del instalador (scripts/build-installer.js): trae los motores ya
  // compilados y no tiene CMake ni compilador.
  beforeEach(async () => {
    entorno.limpiar();
    entorno = await prepararEntorno({ instalacion: 'copia', isPackaged: true });
  });

  it('engine:status dice que no se puede compilar', async () => {
    motorFalso(entorno.installRoot);
    motorFalso(entorno.installRoot, 'build-release');
    const estado = await entorno.invocar('engine:status');
    assert.deepEqual(estado, { debug: true, release: true, canBuild: false });
  });

  it('engine:build contesta el error sin lanzar nada, aunque haya un CMakeCache', async () => {
    const carpeta = path.join(entorno.installRoot, 'engine', 'build');
    fs.mkdirSync(carpeta, { recursive: true });
    fs.writeFileSync(path.join(carpeta, 'CMakeCache.txt'), 'CMAKE_BUILD_TYPE:STRING=Debug\n');
    const resultado = await entorno.invocar('engine:build', 'debug');
    assert.equal(resultado.ok, false);
    assert.match(resultado.error, /reinstala/i);
    assert.equal(entorno.lanzados.length, 0);
  });
});
