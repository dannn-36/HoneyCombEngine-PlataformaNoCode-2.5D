// =============================================================================
// Proyectos: cada juego en su carpeta, con su archivo .honey
// =============================================================================
//
//   - Sin proyecto abierto el editor no lee ni escribe nada.
//   - Nuevo proyecto (vacio o de ejemplo) en la ubicacion de proyectos.
//   - Abrir proyecto con el dialogo, y convertir una carpeta de antes.
//   - Abrir un nivel de otro proyecto cambia a ese proyecto (no lo copia).
//   - Proyectos recientes y el ultimo nivel editado.
//   - Doble clic en un .honey, al arrancar y con el editor ya abierto.
// =============================================================================

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { prepararEntorno, cargarMain, crearBase, errorDe, listarArbol } = require('./support/entorno');

const NIVEL = JSON.stringify({ name: 'n', grid: { width: 2, height: 2, tileWidth: 64, tileHeight: 32 }, entities: [], events: [] });

/** Un proyecto con .honey en <base>/<carpeta>, con un nivel. Devuelve su .honey. */
function crearProyecto(base, carpeta, nombre = carpeta) {
  const root = path.join(base, carpeta);
  fs.mkdirSync(path.join(root, 'levels'), { recursive: true });
  fs.writeFileSync(path.join(root, 'levels', 'uno.json'), NIVEL);
  const archivo = path.join(root, `${nombre}.honey`);
  fs.writeFileSync(archivo, JSON.stringify({ format: 1, name: nombre }));
  return archivo;
}

/** Una carpeta de antes del .honey: levels/ con un nivel y game.json. */
function crearCarpetaVieja(base, carpeta, nombreDelJuego) {
  const root = path.join(base, carpeta);
  fs.mkdirSync(path.join(root, 'levels'), { recursive: true });
  fs.writeFileSync(path.join(root, 'levels', 'viejo.json'), NIVEL);
  if (nombreDelJuego) fs.writeFileSync(path.join(root, 'game.json'), JSON.stringify({ name: nombreDelJuego }));
  return root;
}

let entorno;
/** Lo que contesta el dialogo de abrir (una ruta, o null para cancelar). */
let elegido;
/** El boton que se elige en el dialogo de convertir. */
let boton;

beforeEach(async () => {
  elegido = null;
  boton = 'Cancelar';
  entorno = await prepararEntorno({
    dialogo: () => (elegido ? { canceled: false, filePaths: [elegido] } : { canceled: true, filePaths: [] }),
    mensaje: (opciones) => opciones.buttons.indexOf(boton),
  });
});

afterEach(() => entorno?.limpiar());

describe('sin proyecto abierto', () => {
  beforeEach(() => entorno.projectRoot.closeProject());

  it('workspace:info dice que no hay proyecto', async () => {
    const info = await entorno.invocar('workspace:info');
    assert.equal(info.project, null);
    assert.equal(info.location, path.join(entorno.base, 'documentos', 'Juegos HoneyComb'));
  });

  it('no se lee ni se escribe nada, con un mensaje que se entiende', async () => {
    const err = await errorDe(entorno.invocar('project:readFile', 'levels/a.json'));
    assert.match(err.message, /No hay ningún proyecto abierto/);
    assert.ok(await errorDe(entorno.invocar('project:writeFile', { filePath: 'levels/a.json', contents: '{}' })));
    assert.deepEqual(await entorno.invocar('project:listEntries', ''), []);
    assert.equal(await entorno.invocar('project:ensureRoot'), null);
  });

  it('al arrancar sin doble clic no se abre ni se crea ninguna carpeta', async () => {
    const { project } = await entorno.projectRoot.initWorkspace({ argv: ['electron.exe', '.'] });
    assert.equal(project, null);
    assert.equal(fs.existsSync(path.join(entorno.base, 'documentos')), false);
  });
});

describe('Nuevo proyecto', () => {
  const ubicacion = () => path.join(entorno.base, 'documentos', 'Juegos HoneyComb');

  it('crea <ubicacion>/<Nombre>/ con su .honey, game.json, las carpetas y las imagenes basicas', async () => {
    const { project, copied } = await entorno.invocar('workspace:createProject', { name: 'La Cripta', example: false });
    const root = path.join(ubicacion(), 'La Cripta');
    assert.equal(project.root, root);
    assert.equal(project.name, 'La Cripta');
    assert.equal(project.file, path.join(root, 'La Cripta.honey'));
    assert.equal(project.lastLevel, null);
    assert.deepEqual(copied.sort(), ['floor.png', 'player.png', 'shapes.png', 'wall.png']);
    for (const dir of ['levels', 'assets/textures', 'assets/sounds']) {
      assert.ok(fs.statSync(path.join(root, dir)).isDirectory(), dir);
    }
    assert.deepEqual(JSON.parse(fs.readFileSync(project.file, 'utf-8')), { format: 1, name: 'La Cripta' });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'game.json'), 'utf-8')), { name: 'La Cripta' });
    assert.equal(entorno.projectRoot.getProjectRoot(), root);
    const [reciente] = await entorno.invocar('workspace:recentProjects');
    assert.equal(reciente.root, root);
  });

  it('el nombre del juego conserva los acentos, pero la carpeta y el archivo quedan en ASCII', async () => {
    const { project } = await entorno.invocar('workspace:createProject', { name: 'Canción ♡ del Sol', example: false });
    assert.equal(path.basename(project.root), 'Cancion _ del Sol');
    assert.equal(path.basename(project.file), 'Cancion _ del Sol.honey');
    assert.equal(project.name, 'Canción ♡ del Sol');
  });

  it('no usa una carpeta que ya tiene algo, y no la toca', async () => {
    const ocupada = path.join(ubicacion(), 'Mi juego');
    fs.mkdirSync(ocupada, { recursive: true });
    fs.writeFileSync(path.join(ocupada, 'tarea.docx'), 'mia');
    const err = await errorDe(entorno.invocar('workspace:createProject', { name: 'Mi juego', example: false }));
    assert.match(err.message, /tiene archivos/);
    assert.deepEqual(fs.readdirSync(ocupada), ['tarea.docx']);
    assert.equal(entorno.projectRoot.getProjectRoot(), entorno.root);
  });

  it('rechaza un nombre vacio o sin letras ni numeros', async () => {
    for (const name of ['', '   ', '..', '♡♡', undefined, 42]) {
      assert.ok(await errorDe(entorno.invocar('workspace:createProject', { name, example: false })), `acepto ${name}`);
    }
    assert.equal(fs.existsSync(ubicacion()), false);
  });

  it('la ubicacion elegida con el dialogo se recuerda para los proximos', async () => {
    elegido = path.join(entorno.base, 'mis-juegos');
    assert.equal(await entorno.invocar('workspace:chooseLocation'), elegido);
    const { project } = await entorno.invocar('workspace:createProject', { name: 'Otro', example: false });
    assert.equal(project.root, path.join(elegido, 'Otro'));
    assert.equal((await entorno.invocar('workspace:info')).location, elegido);
  });

  it('el proyecto de ejemplo trae el juego de muestra y lo deja como nivel inicial', async () => {
    const { project, copied } = await entorno.invocar('workspace:createProject', { name: 'Ejemplo', example: true });
    assert.ok(copied.includes('levels/HoneyComb_Showcase.json'));
    assert.deepEqual(fs.readdirSync(path.join(project.root, 'levels')), ['HoneyComb_Showcase.json']);
    assert.ok(fs.existsSync(path.join(project.root, 'assets', 'textures', 'personajes', 'jugador.png')));
    assert.ok(fs.existsSync(path.join(project.root, 'characters.json')));
    const game = JSON.parse(fs.readFileSync(path.join(project.root, 'game.json'), 'utf-8'));
    assert.deepEqual(game, { name: 'Ejemplo', startLevel: 'HoneyComb_Showcase.json' });
  });
});

describe('Abrir proyecto', () => {
  it('con el .honey elegido en el dialogo', async () => {
    elegido = crearProyecto(entorno.base, 'otro', 'Otro juego');
    const project = await entorno.invocar('workspace:openProject');
    assert.equal(project.root, path.join(entorno.base, 'otro'));
    assert.equal(project.name, 'Otro juego');
    assert.equal(entorno.projectRoot.getProjectRoot(), project.root);
  });

  it('cancelar el dialogo no cambia nada', async () => {
    assert.equal(await entorno.invocar('workspace:openProject'), null);
    assert.equal(entorno.projectRoot.getProjectRoot(), entorno.root);
  });

  it('un .honey roto se abre igual, con el nombre del archivo', async () => {
    elegido = crearProyecto(entorno.base, 'roto', 'Roto');
    fs.writeFileSync(elegido, '{ esto no');
    const project = await entorno.invocar('workspace:openProject');
    assert.equal(project.name, 'Roto');
  });

  it('una carpeta de antes se convierte si se acepta: solo se agrega el .honey', async () => {
    const vieja = crearCarpetaVieja(entorno.base, 'hooneycomb', 'La Catedral del Eclipse');
    const antes = listarArbol(vieja);
    elegido = path.join(vieja, 'game.json');
    boton = 'Convertir en proyecto';
    const project = await entorno.invocar('workspace:openProject');
    assert.equal(project.root, vieja);
    assert.equal(project.name, 'La Catedral del Eclipse');
    assert.equal(project.file, path.join(vieja, 'La Catedral del Eclipse.honey'));
    const nuevos = listarArbol(vieja).filter((f) => !antes.includes(f));
    // El .honey, y las carpetas de assets que le faltaban (vacias).
    assert.deepEqual(nuevos.sort(), ['La Catedral del Eclipse.honey', 'assets', path.join('assets', 'sounds'), path.join('assets', 'textures')].sort());
  });

  it('una carpeta de antes sin game.json toma el nombre de la carpeta', async () => {
    const vieja = crearCarpetaVieja(entorno.base, 'Mi Juego Viejo', null);
    elegido = path.join(vieja, 'levels', 'viejo.json');
    boton = 'Convertir en proyecto';
    const project = await entorno.invocar('workspace:openProject');
    assert.equal(path.basename(project.file), 'Mi Juego Viejo.honey');
  });

  it('si no se quiere convertir, no se abre ni se crea nada', async () => {
    const vieja = crearCarpetaVieja(entorno.base, 'vieja', 'Vieja');
    const antes = listarArbol(vieja);
    elegido = path.join(vieja, 'game.json');
    assert.equal(await entorno.invocar('workspace:openProject'), null);
    assert.deepEqual(listarArbol(vieja), antes);
    assert.equal(entorno.projectRoot.getProjectRoot(), entorno.root);
  });

  it('un .json que no es de ningun proyecto se rechaza', async () => {
    fs.writeFileSync(path.join(entorno.fuera, 'suelto.json'), NIVEL);
    elegido = path.join(entorno.fuera, 'suelto.json');
    const err = await errorDe(entorno.invocar('workspace:openProject'));
    assert.match(err.message, /no está dentro de ningún proyecto/);
    assert.equal(entorno.projectRoot.getProjectRoot(), entorno.root);
  });
});

describe('Abrir nivel de otro proyecto', () => {
  it('cambia a ese proyecto y lo abre ahi, sin copiar nada al de ahora', async () => {
    const archivo = crearProyecto(entorno.base, 'otro', 'Otro');
    const antes = listarArbol(entorno.root);
    elegido = path.join(path.dirname(archivo), 'levels', 'uno.json');
    const resultado = await entorno.invocar('project:open');
    assert.equal(resultado.relativePath, 'levels/uno.json');
    assert.equal(resultado.project.root, path.dirname(archivo));
    assert.equal(resultado.imported, undefined);
    assert.equal(entorno.projectRoot.getProjectRoot(), path.dirname(archivo));
    assert.deepEqual(listarArbol(entorno.root), antes);
  });

  it('un nivel de una subcarpeta de levels/ tambien encuentra su proyecto', async () => {
    const archivo = crearProyecto(entorno.base, 'otro', 'Otro');
    const sub = path.join(path.dirname(archivo), 'levels', 'mundo2');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'dos.json'), NIVEL);
    elegido = path.join(sub, 'dos.json');
    const resultado = await entorno.invocar('project:open');
    assert.equal(resultado.relativePath, 'levels/mundo2/dos.json');
    assert.equal(resultado.project.root, path.dirname(archivo));
  });

  it('uno del proyecto abierto se abre sin cambiar nada', async () => {
    fs.writeFileSync(path.join(entorno.root, 'levels', 'propio.json'), NIVEL);
    elegido = path.join(entorno.root, 'levels', 'propio.json');
    const resultado = await entorno.invocar('project:open');
    assert.equal(resultado.relativePath, 'levels/propio.json');
    assert.equal(resultado.project, undefined);
  });

  it('uno de la instalacion (los de ejemplo del repositorio) se importa: el repositorio no es un proyecto', async () => {
    const instalacion = entorno.projectRoot.INSTALL_ROOT;
    const ejemplo = fs.readdirSync(path.join(instalacion, 'levels')).find((nombre) => nombre.endsWith('.json'));
    elegido = path.join(instalacion, 'levels', ejemplo);
    const resultado = await entorno.invocar('project:open');
    assert.equal(resultado.project, undefined);
    assert.equal(resultado.imported.from, elegido);
    assert.equal(entorno.projectRoot.getProjectRoot(), entorno.root);
    assert.deepEqual(entorno.electron.__prueba.mensajes, [], 'no ofrecio convertir la instalacion');
    assert.equal(fs.readdirSync(instalacion).some((nombre) => nombre.endsWith('.honey')), false);
  });

  it('la carpeta de la instalacion no se abre como proyecto', async () => {
    const err = await errorDe(entorno.projectRoot.openProjectAt(entorno.projectRoot.INSTALL_ROOT, { confirmConvert: async () => true }));
    assert.match(err.message, /no un proyecto/);
  });

  it('sin proyecto abierto, uno suelto se rechaza en vez de importarse', async () => {
    entorno.projectRoot.closeProject();
    fs.writeFileSync(path.join(entorno.base, 'suelto.json'), NIVEL);
    elegido = path.join(entorno.base, 'suelto.json');
    const err = await errorDe(entorno.invocar('project:open'));
    assert.match(err.message, /no está dentro de ningún proyecto/);
  });

  it('de una carpeta de antes, sin proyecto abierto, no se ofrece importar', async () => {
    entorno.projectRoot.closeProject();
    const vieja = crearCarpetaVieja(entorno.base, 'vieja', 'Vieja');
    elegido = path.join(vieja, 'levels', 'viejo.json');
    assert.deepEqual(await entorno.invocar('project:open'), { canceled: true });
    const [pregunta] = entorno.electron.__prueba.mensajes;
    assert.deepEqual(pregunta.buttons, ['Convertir en proyecto', 'Cancelar']);
  });
});

describe('Proyectos recientes', () => {
  it('no abre una carpeta que la UI manda y nunca se eligio', async () => {
    crearProyecto(entorno.base, 'nunca', 'Nunca');
    const err = await errorDe(entorno.invocar('workspace:openRecent', path.join(entorno.base, 'nunca')));
    assert.match(err.message, /no está entre los recientes/);
    assert.equal(entorno.projectRoot.getProjectRoot(), entorno.root);
  });

  it('rechaza lo que no es una ruta absoluta', async () => {
    for (const caso of [undefined, null, 42, {}, ['x'], '', 'levels', '../proyecto']) {
      assert.ok(await errorDe(entorno.invocar('workspace:openRecent', caso)), `acepto ${JSON.stringify(caso)}`);
    }
    assert.equal(entorno.projectRoot.getProjectRoot(), entorno.root);
  });

  it('vuelve al anterior despues de abrir otro', async () => {
    elegido = crearProyecto(entorno.base, 'otro');
    await entorno.invocar('workspace:openProject');
    const pedida = process.platform === 'win32' ? entorno.root.toUpperCase() : entorno.root;
    const project = await entorno.invocar('workspace:openRecent', pedida);
    assert.equal(project.root, entorno.root);
    assert.equal(entorno.projectRoot.getProjectRoot(), entorno.root);
  });

  it('uno que se borro no se vuelve a crear, y la lista lo marca', async () => {
    elegido = crearProyecto(entorno.base, 'borrado');
    await entorno.invocar('workspace:openProject');
    await entorno.projectRoot.openProjectFile(entorno.archivoProyecto);
    fs.rmSync(path.join(entorno.base, 'borrado'), { recursive: true });
    const lista = await entorno.invocar('workspace:recentProjects');
    assert.equal(lista.find((r) => r.root.endsWith('borrado')).exists, false);
    const err = await errorDe(entorno.invocar('workspace:openRecent', path.join(entorno.base, 'borrado')));
    assert.match(err.message, /ya no existe/);
    assert.equal(fs.existsSync(path.join(entorno.base, 'borrado')), false);
  });

  it('quitar uno de la lista no toca la carpeta', async () => {
    elegido = crearProyecto(entorno.base, 'otro');
    await entorno.invocar('workspace:openProject');
    await entorno.invocar('workspace:forgetRecent', path.join(entorno.base, 'otro'));
    const lista = await entorno.invocar('workspace:recentProjects');
    assert.deepEqual(lista.map((r) => r.root), [entorno.root]);
    assert.ok(fs.existsSync(elegido));
  });

  it('recuerda el ultimo nivel editado de cada proyecto', async () => {
    fs.writeFileSync(path.join(entorno.root, 'levels', 'nivel_2.json'), NIVEL);
    assert.equal(await entorno.invocar('workspace:rememberLevel', 'nivel_2.json'), true);
    elegido = crearProyecto(entorno.base, 'otro');
    await entorno.invocar('workspace:openProject');
    const project = await entorno.invocar('workspace:openRecent', entorno.root);
    assert.equal(project.lastLevel, 'nivel_2.json');
  });

  it('no anota un nivel que no esta en el proyecto, ni rutas', async () => {
    assert.equal(await entorno.invocar('workspace:rememberLevel', 'no_existe.json'), false);
    for (const caso of ['../x.json', 'sub/x.json', '..\\x.json', '', null, 3]) {
      assert.ok(await errorDe(entorno.invocar('workspace:rememberLevel', caso)), `acepto ${JSON.stringify(caso)}`);
    }
  });
});

describe('doble clic en un .honey', () => {
  it('al arrancar, abre ese proyecto', async () => {
    const archivo = crearProyecto(entorno.base, 'doble', 'Doble');
    const { project, error } = await entorno.projectRoot.initWorkspace({ argv: ['HoneyComb.exe', archivo] });
    assert.equal(error, null);
    assert.equal(project.root, path.dirname(archivo));
  });

  it('un .honey que ya no esta no abre nada', async () => {
    const { project } = await entorno.projectRoot.initWorkspace({
      argv: ['HoneyComb.exe', path.join(entorno.base, 'no-esta.honey')],
    });
    assert.equal(project, null);
  });

  it('con el editor abierto, queda pendiente hasta que la UI lo pide (una vez)', async () => {
    const archivo = crearProyecto(entorno.base, 'doble', 'Doble');
    entorno.canalesWorkspace.requestOpen(archivo);
    const project = await entorno.invocar('workspace:openRequested');
    assert.equal(project.root, path.dirname(archivo));
    assert.equal(await entorno.invocar('workspace:openRequested'), null);
  });
});

describe('main.js: una sola ventana del editor', () => {
  it('doble clic en un .honey con el editor abierto avisa a la UI, y la UI lo abre', async () => {
    const main = await cargarMain();
    const base = crearBase('hc-doble-');
    try {
      const archivo = crearProyecto(base, 'doble', 'Doble');
      const [segundaInstancia] = main.electron.__prueba.eventosApp.get('second-instance');
      segundaInstancia({}, ['HoneyComb.exe', '--flag-de-chromium', archivo]);
      assert.deepEqual(main.ventana.webContents.enviados, [['workspace:open-requested', 'Doble.honey']]);
      assert.equal(main.ventana.enfocada, 1);
      const abrir = main.electron.__prueba.handlers.get('workspace:openRequested');
      const project = await abrir({ sender: main.ventana.webContents });
      assert.equal(project.root, path.dirname(archivo));
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
      main.limpiar();
    }
  });

  it('sin .honey en los argumentos solo enfoca la ventana', async () => {
    const main = await cargarMain();
    try {
      const [segundaInstancia] = main.electron.__prueba.eventosApp.get('second-instance');
      segundaInstancia({}, ['HoneyComb.exe', 'C:/no/es/un/proyecto.txt']);
      assert.deepEqual(main.ventana.webContents.enviados, []);
      assert.equal(main.ventana.enfocada, 1);
    } finally {
      main.limpiar();
    }
  });
});

describe('Cerrar proyecto', () => {
  it('deja el editor sin proyecto', async () => {
    await entorno.invocar('workspace:close');
    assert.equal(entorno.projectRoot.getProjectRoot(), null);
    assert.equal((await entorno.invocar('workspace:info')).project, null);
  });
});
