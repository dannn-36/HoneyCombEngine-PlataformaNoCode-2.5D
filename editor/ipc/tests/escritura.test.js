// =============================================================================
// Seguridad: que se puede escribir dentro de la carpeta del editor
// =============================================================================
//
// Que una ruta quede dentro del proyecto (ver rutas.test.js) no alcanza: la UI
// solo necesita escribir niveles y configuracion (.json) y texturas (.png).
// Un canal que acepta cualquier nombre, extension o tamano deja que un bug o
// un renderer comprometido deje ejecutables, scripts o archivos enormes en una
// carpeta que la persona despues abre con doble clic o comparte.
//
//   SE-05  project:writeFile acepta cualquier extension y cualquier tamano.
//   SE-11  convert:writeImage escribe lo que llegue como .png, sin mirar que
//          sea un PNG ni cuanto pesa (textures:write si lo controla).
//   SE-12  project:writeFile y project:createDir aceptan nombres que Windows
//          trata distinto: reservados (CON, NUL, AUX, COM1...), flujos
//          alternativos de NTFS ("x.json:oculto") y nombres con punto o
//          espacio final.
// =============================================================================

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { prepararEntorno, errorDe, listarArbol } = require('./support/entorno');

const SE05 = 'Defecto conocido: SE-05 - project:writeFile no limita extension ni tamano';
const SE11 = 'Defecto conocido: SE-11 - convert:writeImage no valida el PNG ni su tamano';
const SE12 =
  'Defecto conocido: SE-12 - no se rechazan nombres reservados ni flujos alternativos de Windows';

const PNG_FIRMA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngDePrueba = () => Buffer.concat([PNG_FIRMA, Buffer.alloc(32, 1)]);

/** Un tope razonable: el nivel mas grande del repositorio pesa ~260 KB. */
const TAMANO_EXAGERADO = 64 * 1024 * 1024;

let entorno;

before(async () => {
  entorno = await prepararEntorno({
    // El convertidor elige sus archivos con el dialogo: se contesta con un PNG de afuera.
    dialogo: () => ({ canceled: false, filePaths: [path.join(entorno.fuera, 'imagen.png')] }),
  });
  fs.writeFileSync(path.join(entorno.fuera, 'imagen.png'), pngDePrueba());
});

after(() => entorno?.limpiar());

const existe = (relativa) => fs.existsSync(path.join(entorno.root, relativa));

describe('project:writeFile solo escribe archivos de datos (SE-05)', () => {
  for (const nombre of ['levels/ok.json', 'characters.json', 'items.json', 'game.json']) {
    it(`acepta ${nombre}`, async () => {
      await entorno.invocar('project:writeFile', { filePath: nombre, contents: '{}' });
      assert.ok(existe(nombre));
    });
  }

  // Defecto conocido: SE-05. El handler (ipc/files.js) solo valida que la
  // ruta este dentro del proyecto: no mira la extension.
  for (const extension of [
    '.exe',
    '.dll',
    '.bat',
    '.cmd',
    '.ps1',
    '.vbs',
    '.js',
    '.hta',
    '.lnk',
    '.scr',
  ]) {
    it(`rechaza un archivo ${extension}`, { todo: SE05 }, async () => {
      const nombre = `levels/programa${extension}`;
      await errorDe(
        entorno.invocar('project:writeFile', { filePath: nombre, contents: 'contenido' }),
      );
      assert.equal(existe(nombre), false, `escribio ${nombre}`);
    });
  }

  it(
    'rechaza desktop.ini, que cambia como el explorador muestra la carpeta',
    { todo: SE05 },
    async () => {
      await errorDe(
        entorno.invocar('project:writeFile', {
          filePath: 'desktop.ini',
          contents: '[.ShellClassInfo]',
        }),
      );
      assert.equal(existe('desktop.ini'), false);
    },
  );

  it('rechaza un contenido exageradamente grande', { todo: SE05 }, async () => {
    const contenido = 'x'.repeat(TAMANO_EXAGERADO);
    await errorDe(
      entorno.invocar('project:writeFile', { filePath: 'levels/enorme.json', contents: contenido }),
    );
    assert.equal(existe('levels/enorme.json'), false, 'escribio 64 MB sin quejarse');
  });
});

describe('nombres que windows trata distinto (SE-12)', () => {
  // Node escribe estos nombres tal cual (usa rutas \\?\ por dentro), pero el
  // explorador no puede abrirlos ni borrarlos, y el motor (fopen) abre el
  // dispositivo en vez del archivo.
  for (const nombre of [
    'levels/CON.json',
    'levels/NUL',
    'levels/aux.json',
    'levels/COM1.json',
    'levels/LPT1.json',
  ]) {
    it(
      `project:writeFile rechaza el nombre reservado ${path.basename(nombre)}`,
      { todo: SE12 },
      async () => {
        await errorDe(entorno.invocar('project:writeFile', { filePath: nombre, contents: '{}' }));
        assert.equal(existe(nombre), false);
      },
    );
  }

  it('project:writeFile rechaza un flujo alternativo de ntfs', { todo: SE12 }, async () => {
    // "nivel.json:oculto.exe" escribe datos que no se ven en el explorador ni
    // con dir: quedan pegados a nivel.json.
    await entorno.invocar('project:writeFile', { filePath: 'levels/visible.json', contents: '{}' });
    const err = await errorDe(
      entorno.invocar('project:writeFile', {
        filePath: 'levels/visible.json:oculto.exe',
        contents: 'MZ',
      }),
    );
    assert.ok(err, 'escribio un flujo alternativo');
  });

  it(
    'project:writeFile rechaza un nombre con punto o espacio al final',
    { todo: SE12 },
    async () => {
      const err = await errorDe(
        entorno.invocar('project:writeFile', { filePath: 'levels/raro.json. ', contents: '{}' }),
      );
      assert.ok(err);
    },
  );

  it('project:createDir rechaza un nombre reservado', { todo: SE12 }, async () => {
    const err = await errorDe(entorno.invocar('project:createDir', 'levels/CON'));
    assert.ok(err);
  });

  it('project:createDir rechaza los caracteres que windows no admite', async () => {
    for (const nombre of [
      'levels/a:b',
      'levels/a*b',
      'levels/a?b',
      'levels/a<b',
      'levels/a|b',
      'levels/a"b',
    ]) {
      assert.ok(await errorDe(entorno.invocar('project:createDir', nombre)), nombre);
    }
  });
});

describe('textures:write solo deja PNG con nombre limpio en assets/textures', () => {
  const nombresTramposos = [
    '../../fuera/sprite',
    '..\\..\\fuera\\sprite',
    'C:\\Windows\\Temp\\sprite',
    '\\\\127.0.0.1\\c$\\sprite',
    'sprite.exe',
    'sprite.png.exe',
    'sprite\u0000.exe',
    'a/b/c/sprite',
    '%2e%2e%2fsprite',
    '',
    '   ',
    '♡',
  ];
  for (const name of nombresTramposos) {
    it(`el nombre ${JSON.stringify(name)} termina como un png dentro de assets/textures`, async () => {
      const antes = new Set(listarArbol(entorno.root));
      const resultado = await entorno.invocar('textures:write', {
        name,
        pngBase64: pngDePrueba().toString('base64'),
        overwrite: true,
      });
      assert.match(resultado.target, /^[A-Za-z0-9 _()-]+\.png$/);
      const nuevos = listarArbol(entorno.root).filter((f) => !antes.has(f));
      for (const nuevo of nuevos) {
        assert.ok(nuevo.startsWith(path.join('assets', 'textures')), `escribio ${nuevo}`);
      }
      assert.deepEqual(entorno.contenidoFuera(), ['imagen.png', 'secreto.txt']);
    });
  }

  for (const reservado of ['CON', 'nul', 'AUX', 'COM1']) {
    it(`el nombre reservado ${reservado} no se usa tal cual`, { todo: SE12 }, async () => {
      const resultado = await entorno.invocar('textures:write', {
        name: reservado,
        pngBase64: pngDePrueba().toString('base64'),
        overwrite: true,
      });
      assert.notEqual(path.parse(resultado.target).name.toUpperCase(), reservado.toUpperCase());
    });
  }

  it('un nombre larguisimo no escribe nada fuera de la carpeta (falla o se recorta)', async () => {
    const antes = new Set(listarArbol(entorno.root));
    await errorDe(
      entorno.invocar('textures:write', {
        name: 'a'.repeat(400),
        pngBase64: pngDePrueba().toString('base64'),
      }),
    );
    for (const nuevo of listarArbol(entorno.root).filter((f) => !antes.has(f))) {
      assert.ok(nuevo.startsWith(path.join('assets', 'textures')), `escribio ${nuevo}`);
    }
    assert.deepEqual(entorno.contenidoFuera(), ['imagen.png', 'secreto.txt']);
  });

  it('rechaza lo que no es un png', async () => {
    for (const datos of [
      Buffer.from('MZ\x90\x00 ejecutable'),
      Buffer.from('<svg onload=alert(1)>'),
      Buffer.alloc(0),
    ]) {
      assert.ok(
        await errorDe(
          entorno.invocar('textures:write', { name: 'falso', pngBase64: datos.toString('base64') }),
        ),
      );
    }
    assert.equal(existe('assets/textures/falso.png'), false);
  });

  it('rechaza un png mas grande que el tope de importacion', async () => {
    const enorme = Buffer.concat([PNG_FIRMA, Buffer.alloc(41 * 1024 * 1024)]);
    assert.ok(
      await errorDe(
        entorno.invocar('textures:write', { name: 'enorme', pngBase64: enorme.toString('base64') }),
      ),
    );
    assert.equal(existe('assets/textures/enorme.png'), false);
  });

  it('sin overwrite no pisa una textura que ya existe', async () => {
    const pngBase64 = pngDePrueba().toString('base64');
    await entorno.invocar('textures:write', { name: 'unica', pngBase64, overwrite: true });
    const resultado = await entorno.invocar('textures:write', {
      name: 'unica',
      pngBase64,
      overwrite: false,
    });
    assert.equal(resultado.status, 'exists');
  });

  it('falla si faltan el nombre o la imagen, o no son texto', async () => {
    for (const caso of [
      undefined,
      {},
      { name: 1, pngBase64: 'x' },
      { name: 'a', pngBase64: 7 },
      { name: ['a'], pngBase64: 'x' },
    ]) {
      assert.ok(await errorDe(entorno.invocar('textures:write', caso)), JSON.stringify(caso));
    }
  });
});

describe('el convertidor solo trabaja con su plan (convert:*)', () => {
  it('convert:begin siempre pide los archivos con el dialogo, aunque la UI mande una ruta', async () => {
    const dialogosAntes = entorno.electron.__prueba.dialogos.length;
    const sesion = await entorno.invocar('convert:begin', entorno.fuera);
    assert.equal(entorno.electron.__prueba.dialogos.length, dialogosAntes + 1);
    assert.equal(sesion.items.length, 1);
    assert.equal(sesion.items[0].source, 'imagen.png');
  });

  it('convert:readImage y convert:writeImage rechazan indices que no son del plan', async () => {
    await entorno.invocar('convert:reset');
    await entorno.invocar('convert:begin', 'files');
    const antes = listarArbol(entorno.root);
    for (const index of [
      -1,
      1,
      1.5,
      1e9,
      NaN,
      null,
      undefined,
      {},
      [],
      '1',
      'length',
      'constructor',
      '__proto__',
      'toString',
    ]) {
      assert.ok(
        await errorDe(entorno.invocar('convert:readImage', index)),
        `readImage ${String(index)}`,
      );
      assert.ok(
        await errorDe(
          entorno.invocar('convert:writeImage', {
            index,
            pngBase64: pngDePrueba().toString('base64'),
          }),
        ),
        `writeImage ${String(index)}`,
      );
    }
    assert.deepEqual(listarArbol(entorno.root), antes);
  });

  it('convert:writeImage escribe siempre en assets/textures con el nombre del plan', async () => {
    await entorno.invocar('convert:reset');
    await entorno.invocar('convert:begin', 'files');
    const { target } = await entorno.invocar('convert:writeImage', {
      index: 0,
      pngBase64: pngDePrueba().toString('base64'),
      target: '../../fuera/pisado.png',
    });
    assert.match(target, /^imagen(-\d+)?\.png$/);
    assert.ok(existe(path.join('assets', 'textures', target)));
    assert.deepEqual(entorno.contenidoFuera(), ['imagen.png', 'secreto.txt']);
  });

  it('convert:writeImage rechaza lo que no es un png', { todo: SE11 }, async () => {
    await entorno.invocar('convert:reset');
    await entorno.invocar('convert:begin', 'files');
    const err = await errorDe(
      entorno.invocar('convert:writeImage', {
        index: 0,
        pngBase64: Buffer.from('MZ ejecutable').toString('base64'),
      }),
    );
    assert.ok(err, 'guardo como .png algo que no es un PNG');
  });

  it(
    'convert:writeImage rechaza una imagen mas grande que el tope de importacion',
    { todo: SE11 },
    async () => {
      await entorno.invocar('convert:reset');
      await entorno.invocar('convert:begin', 'files');
      const enorme = Buffer.concat([PNG_FIRMA, Buffer.alloc(41 * 1024 * 1024)]);
      const err = await errorDe(
        entorno.invocar('convert:writeImage', { index: 0, pngBase64: enorme.toString('base64') }),
      );
      assert.ok(err, 'guardo 41 MB sin tope');
    },
  );

  it('convert:begin ignora archivos que no son imagenes aunque el dialogo los devuelva', async () => {
    fs.writeFileSync(path.join(entorno.fuera, 'programa.exe'), 'MZ');
    const otro = await prepararEntorno({
      dialogo: () => ({ canceled: false, filePaths: [path.join(entorno.fuera, 'programa.exe')] }),
    });
    try {
      const sesion = await otro.invocar('convert:begin', 'files');
      assert.deepEqual(sesion.items, []);
    } finally {
      otro.limpiar();
      fs.rmSync(path.join(entorno.fuera, 'programa.exe'));
    }
  });
});
