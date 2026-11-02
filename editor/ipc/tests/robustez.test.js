// =============================================================================
// Robustez del guardado: lo que no tiene que perderse si algo se corta
// =============================================================================
//
//   - textures:write (la herramienta de sprites) escribe atomico y respeta el
//     "no pisar" sin dejar nada a medias.
//   - honeycomb-settings.json se escribe atomico y, si se rompe, se lee el .bak.
//   - Los .tmp de un guardado cortado se borran al arrancar.
//   - La copia del guardado automatico (ipc/recovery.js).
//   - La revision del nivel contra el schema (ipc/level-check.js).
//   (Abrir, crear y convertir proyectos: ver proyectos.test.js.)
// =============================================================================

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { prepararEntorno, errorDe, EDITOR_DIR } = require('./support/entorno');

/** Un PNG de 1x1 valido. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/kr6YxgAAAABJRU5ErkJggg==',
  'base64',
);

const temporalesEn = (carpeta) => fs.readdirSync(carpeta).filter((nombre) => nombre.endsWith('.tmp'));

describe('textures:write escribe de forma atomica', () => {
  let entorno;
  before(async () => {
    entorno = await prepararEntorno();
  });
  after(() => entorno?.limpiar());

  const carpeta = () => path.join(entorno.root, 'assets', 'textures');
  const escribir = (name, bytes, overwrite) =>
    entorno.invocar('textures:write', { name, pngBase64: bytes.toString('base64'), overwrite });

  it('una textura nueva se escribe y no deja temporales', async () => {
    const result = await escribir('nuevo', PNG_1X1, false);
    assert.deepEqual(result, { status: 'written', target: 'nuevo.png' });
    assert.deepEqual(fs.readFileSync(path.join(carpeta(), 'nuevo.png')), PNG_1X1);
    assert.deepEqual(temporalesEn(carpeta()), []);
  });

  it('sin overwrite no pisa una que ya existe, y no deja temporales', async () => {
    const original = Buffer.concat([PNG_1X1, Buffer.from('original')]);
    fs.writeFileSync(path.join(carpeta(), 'ocupada.png'), original);
    const result = await escribir('ocupada', PNG_1X1, false);
    assert.deepEqual(result, { status: 'exists', target: 'ocupada.png' });
    assert.deepEqual(fs.readFileSync(path.join(carpeta(), 'ocupada.png')), original);
    assert.deepEqual(temporalesEn(carpeta()), []);
  });

  it('con overwrite la reemplaza y deja la anterior en .bak', async () => {
    const anterior = Buffer.concat([PNG_1X1, Buffer.from('anterior')]);
    fs.writeFileSync(path.join(carpeta(), 'reemplazo.png'), anterior);
    await escribir('reemplazo', PNG_1X1, true);
    assert.deepEqual(fs.readFileSync(path.join(carpeta(), 'reemplazo.png')), PNG_1X1);
    assert.deepEqual(fs.readFileSync(path.join(carpeta(), 'reemplazo.png.bak')), anterior);
  });
});

describe('honeycomb-settings.json', () => {
  let entorno;
  before(async () => {
    entorno = await prepararEntorno();
  });
  after(() => entorno?.limpiar());

  const ajustes = () => path.join(entorno.userData, 'honeycomb-settings.json');
  const leer = (archivo) => JSON.parse(fs.readFileSync(archivo, 'utf-8'));

  it('abrir otro proyecto lo escribe atomico, con la version anterior en .bak', async () => {
    const otra = path.join(entorno.base, 'otra');
    fs.mkdirSync(otra);
    fs.writeFileSync(path.join(otra, 'Otra.honey'), JSON.stringify({ format: 1, name: 'Otra' }));
    await entorno.projectRoot.openProjectFile(path.join(otra, 'Otra.honey'));
    assert.equal(leer(ajustes()).recentProjects[0].root, otra);
    assert.equal(leer(`${ajustes()}.bak`).recentProjects[0].root, entorno.root);
    assert.deepEqual(temporalesEn(entorno.userData), []);
  });

  it('si el archivo esta roto, se usa el .bak y no se olvidan los recientes', async () => {
    const elegida = path.join(entorno.base, 'elegida');
    fs.writeFileSync(`${ajustes()}.bak`, JSON.stringify({ recentProjects: [{ root: elegida, name: 'Elegida' }] }));
    fs.writeFileSync(ajustes(), '{"recentProjects": [{"root": "C:/a med');
    const recientes = await entorno.projectRoot.listRecentProjects();
    assert.deepEqual(
      recientes.map((r) => [r.root, r.name]),
      [[elegida, 'Elegida']],
    );
  });

  it('roto y sin .bak, no hay recientes', async () => {
    fs.writeFileSync(ajustes(), 'esto no es json');
    fs.rmSync(`${ajustes()}.bak`, { force: true });
    assert.deepEqual(await entorno.projectRoot.listRecentProjects(), []);
  });

  it('la configuracion de antes (una carpeta del editor) aparece en recientes, y se reemplaza al escribir', async () => {
    const vieja = path.join(entorno.base, 'vieja');
    const otraVieja = path.join(entorno.base, 'otra-vieja');
    fs.mkdirSync(path.join(vieja, 'levels'), { recursive: true });
    fs.writeFileSync(ajustes(), JSON.stringify({ workspaceRoot: vieja, recentWorkspaces: [otraVieja, vieja] }));
    const recientes = await entorno.projectRoot.listRecentProjects();
    assert.deepEqual(
      recientes.map((r) => [r.root, r.exists, r.legacy]),
      [
        [vieja, true, true],
        [otraVieja, false, false],
      ],
    );
    await entorno.projectRoot.openProjectFile(entorno.archivoProyecto);
    const escritos = leer(ajustes());
    assert.equal('workspaceRoot' in escritos, false);
    assert.equal('recentWorkspaces' in escritos, false);
    assert.deepEqual(
      escritos.recentProjects.map((r) => r.root),
      [entorno.root, vieja, otraVieja],
    );
  });
});

describe('los .tmp de un guardado cortado se borran', () => {
  let entorno;
  before(async () => {
    entorno = await prepararEntorno();
  });
  after(() => entorno?.limpiar());

  it('borra los viejos y deja los recientes y los que no son del editor', async () => {
    const { removeStaleTempFiles } = entorno.cargar('safe-write.js');
    const levels = path.join(entorno.root, 'levels');
    const viejo = path.join(levels, '.a.json.0123abcd.tmp');
    const reciente = path.join(levels, '.b.json.89abcdef.tmp');
    const ajeno = path.join(levels, 'notas.tmp');
    const hondo = path.join(entorno.root, 'assets', 'textures', 'sub', '.c.png.deadbeef.tmp');
    fs.mkdirSync(path.dirname(hondo), { recursive: true });
    for (const file of [viejo, reciente, ajeno, hondo]) fs.writeFileSync(file, 'x');
    const haceUnaHora = new Date(Date.now() - 60 * 60 * 1000);
    for (const file of [viejo, ajeno, hondo]) fs.utimesSync(file, haceUnaHora, haceUnaHora);

    const borrados = await removeStaleTempFiles(entorno.root);
    assert.equal(borrados, 2);
    assert.equal(fs.existsSync(viejo), false);
    assert.equal(fs.existsSync(hondo), false);
    assert.equal(fs.existsSync(reciente), true, 'uno reciente puede ser de otra ventana guardando ahora');
    assert.equal(fs.existsSync(ajeno), true, 'un .tmp con otro nombre no es del editor');
  });

  it('al abrir un proyecto se limpian sus temporales solos', async () => {
    const viejo = path.join(entorno.root, '.items.json.11112222.tmp');
    fs.writeFileSync(viejo, 'x');
    const haceUnaHora = new Date(Date.now() - 60 * 60 * 1000);
    fs.utimesSync(viejo, haceUnaHora, haceUnaHora);
    await entorno.projectRoot.openProjectFile(entorno.archivoProyecto);
    await entorno.projectRoot.tempCleanup();
    assert.equal(fs.existsSync(viejo), false);
  });
});

describe('guardado automatico (recovery:*)', () => {
  let entorno;
  before(async () => {
    entorno = await prepararEntorno();
  });
  after(() => entorno?.limpiar());

  const copia = { level: { name: 'a', grid: { width: 2, height: 2, tileWidth: 64, tileHeight: 32 } }, fileName: 'a.json', openedPath: null };

  it('sin copia, read devuelve null', async () => {
    assert.equal(await entorno.invocar('recovery:read'), null);
  });

  it('escribe la copia FUERA del proyecto y la vuelve a leer', async () => {
    await entorno.invocar('recovery:write', copia);
    const leida = await entorno.invocar('recovery:read');
    assert.deepEqual(leida.level, copia.level);
    assert.equal(leida.fileName, 'a.json');
    assert.equal(leida.root, entorno.root);
    assert.ok(!Number.isNaN(Date.parse(leida.savedAt)));
    const archivo = entorno.cargar('recovery.js').recoveryPath();
    assert.ok(archivo.startsWith(entorno.userData), archivo);
    assert.equal(fs.existsSync(`${archivo}.bak`), false, 'la copia no deja respaldo propio');
  });

  it('clear la borra', async () => {
    await entorno.invocar('recovery:clear');
    assert.equal(await entorno.invocar('recovery:read'), null);
  });

  it('la copia de un proyecto no se ofrece en otro', async () => {
    await entorno.invocar('recovery:write', copia);
    const otro = path.join(entorno.base, 'otro-proyecto');
    fs.mkdirSync(otro);
    fs.writeFileSync(path.join(otro, 'Otro.honey'), '{}');
    await entorno.projectRoot.openProjectFile(path.join(otro, 'Otro.honey'));
    assert.equal(await entorno.invocar('recovery:read'), null);
    await entorno.projectRoot.openProjectFile(entorno.archivoProyecto);
    assert.notEqual(await entorno.invocar('recovery:read'), null);
  });

  it('sin proyecto abierto no hay copia que leer ni donde escribirla', async () => {
    entorno.projectRoot.closeProject();
    try {
      assert.equal(await entorno.invocar('recovery:read'), null);
      await entorno.invocar('recovery:write', copia);
    } finally {
      await entorno.projectRoot.openProjectFile(entorno.archivoProyecto);
    }
  });

  it('rechaza lo que no es un objeto', async () => {
    assert.ok(await errorDe(entorno.invocar('recovery:write', 'texto')));
    assert.ok(await errorDe(entorno.invocar('recovery:write', [1, 2])));
  });
});

describe('level:check revisa el nivel contra el schema', () => {
  let entorno;
  before(async () => {
    entorno = await prepararEntorno();
  });
  after(() => entorno?.limpiar());

  const repo = path.dirname(EDITOR_DIR);
  const caso = (carpeta, nombre) => fs.readFileSync(path.join(repo, 'tests', 'contract', carpeta, `${nombre}.json`), 'utf-8');

  it('un nivel valido no tiene avisos', async () => {
    assert.deepEqual(await entorno.invocar('level:check', caso('valid', 'minimo')), []);
    assert.deepEqual(await entorno.invocar('level:check', caso('valid', 'combate_y_objetos')), []);
  });

  it('cada caso invalido del contrato da al menos un aviso en castellano', async () => {
    const carpeta = path.join(repo, 'tests', 'contract', 'invalid');
    for (const archivo of fs.readdirSync(carpeta).filter((nombre) => nombre.endsWith('.json'))) {
      const avisos = await entorno.invocar('level:check', fs.readFileSync(path.join(carpeta, archivo), 'utf-8'));
      assert.ok(avisos.length > 0, `${archivo} no dio avisos`);
      for (const aviso of avisos) assert.doesNotMatch(aviso, /\bmust\b/, `${archivo}: "${aviso}" quedo en ingles`);
    }
  });

  it('dice donde esta el problema', async () => {
    assert.deepEqual(await entorno.invocar('level:check', caso('invalid', 'entidad_sin_posicion')), [
      'a entities[0] le falta "position"',
    ]);
    assert.deepEqual(await entorno.invocar('level:check', caso('invalid', 'grid_ancho_texto')), [
      'grid.width tiene que ser un número entero',
    ]);
  });

  it('no repite el mismo aviso y corta los que sobran', async () => {
    const nivel = {
      name: 'x',
      grid: { width: 2, height: 2, tileWidth: 64, tileHeight: 32 },
      entities: Array.from({ length: 20 }, (_, i) => ({ id: `e${i}`, type: 'x', texture: 't', sourceRect: { x: 0, y: 0, width: 1, height: 1 } })),
      events: [],
    };
    const avisos = await entorno.invocar('level:check', JSON.stringify(nivel));
    assert.equal(avisos.length, 9);
    assert.match(avisos.at(-1), /^… y 12 problemas más$/);
  });
});
