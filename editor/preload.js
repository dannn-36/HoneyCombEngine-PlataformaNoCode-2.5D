// Puente entre el proceso principal (main.js, con acceso a disco) y la UI de
// Angular, que corre aislada. Es el UNICO lugar donde se decide que puede
// hacer el renderer: cada funcion de aca es un permiso concedido a mano.
//
// Se exponen funciones, nunca "ipcRenderer" entero ni "require": si la UI
// pudiera invocar cualquier canal, el aislamiento no serviria de nada.
//
// El contrato tipado de esta API vive en src/app/electron-api.d.ts, y quien la
// consume es ProjectService. Los tres archivos tienen que cambiar juntos.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('honeycombProject', {
  // Abrir un nivel con el dialogo. Uno de fuera de la carpeta del editor se
  // importa (se copia adentro con sus assets): ver ipc/levels.js.
  open: () => ipcRenderer.invoke('project:open'),

  // La carpeta del editor, que es siempre la raiz del proyecto (ver
  // ipc/project-root.js): cual es, cambiarla, y mostrarla en el sistema.
  workspaceInfo: () => ipcRenderer.invoke('workspace:info'),
  changeWorkspace: () => ipcRenderer.invoke('workspace:change'),
  // Archivo > Nuevo proyecto: una carpeta vacia con la estructura y las
  // imagenes basicas, que pasa a ser la carpeta del editor.
  createProject: () => ipcRenderer.invoke('workspace:createProject'),
  revealWorkspace: () => ipcRenderer.invoke('workspace:reveal'),
  // El catalogo de eventos es del programa, no del proyecto: se lee de la instalacion.
  readEventCatalog: () => ipcRenderer.invoke('workspace:readEventCatalog'),
  ensureRoot: () => ipcRenderer.invoke('project:ensureRoot'),
  createDir: (relativePath) => ipcRenderer.invoke('project:createDir', relativePath),
  readFile: (relativePath) => ipcRenderer.invoke('project:readFile', relativePath),
  writeFile: (relativePath, contents) =>
    ipcRenderer.invoke('project:writeFile', { filePath: relativePath, contents }),
  listDir: (relativeDir) => ipcRenderer.invoke('project:listDir', relativeDir),
  // Para el explorador de archivos: el contenido de UNA carpeta (se piden de a
  // una, al desplegarla), y la lectura de cualquier archivo para mirarlo.
  listEntries: (relativeDir) => ipcRenderer.invoke('project:listEntries', relativeDir),
  readFileData: (relativePath) => ipcRenderer.invoke('project:readFileData', relativePath),
  // Importar imagenes: el convertidor (ver ipc/convert.js), en tres pasos. Los
  // dos ultimos reciben un indice del plan, nunca una ruta. "from" es 'files'
  // (dialogo) o 'project-jpg'.
  beginConvert: (from) => ipcRenderer.invoke('convert:begin', from),
  readConvertImage: (index) => ipcRenderer.invoke('convert:readImage', index),
  writeConvertedImage: (index, pngBase64) => ipcRenderer.invoke('convert:writeImage', { index, pngBase64 }),
  resetConvert: () => ipcRenderer.invoke('convert:reset'),
  // El PNG de la herramienta de sprites, a assets/textures/ (ver ipc/textures.js).
  // Recibe un nombre, nunca una ruta.
  writeTexture: (name, pngBase64, overwrite) =>
    ipcRenderer.invoke('textures:write', { name, pngBase64, overwrite }),
  // Importar sonidos a assets/sounds/ con el dialogo del sistema (ver ipc/sounds.js).
  importSounds: () => ipcRenderer.invoke('sounds:import'),

  // Revisar un nivel ya guardado contra el schema: solo avisa (ver ipc/level-check.js).
  checkLevel: (contents) => ipcRenderer.invoke('level:check', contents),

  // Guardado automatico del nivel sin guardar, para recuperarlo si el editor
  // se cierra de golpe (ver ipc/recovery.js). Fuera de la carpeta del editor.
  writeRecovery: (payload) => ipcRenderer.invoke('recovery:write', payload),
  readRecovery: () => ipcRenderer.invoke('recovery:read'),
  clearRecovery: () => ipcRenderer.invoke('recovery:clear'),

  // Lanza el runtime con un nivel ya guardado. Recibe la ruta del nivel y no
  // la del ejecutable: quien decide que binario correr es el proceso principal,
  // no la UI. "mode" elige el motor: 'debug' o 'release' (ver ipc/engine-modes.js).
  // "start": 'level' arranca en el nivel, 'title' en la portada de game.json.
  run: (levelPath, mode, start) => ipcRenderer.invoke('project:run', { levelPath, mode, start }),
  // Borra la partida guardada del juego, y solo esa (ver ipc/run.js).
  clearSave: () => ipcRenderer.invoke('game:clearSave'),

  // Exportar el juego (ver ipc/export.js). Recibe solo el nivel inicial: la
  // carpeta de destino la elige el dialogo en el proceso principal.
  exportGame: (startLevel) => ipcRenderer.invoke('game:export', { startLevel }),
  revealExport: () => ipcRenderer.invoke('game:revealExport'),

  // Los dos motores: cuales estan compilados, y compilar uno (ver
  // ipc/engine-build.js). La salida de la compilacion llega de a una linea.
  engineStatus: () => ipcRenderer.invoke('engine:status'),
  buildEngine: (mode) => ipcRenderer.invoke('engine:build', mode),
  onEngineBuildLog: (callback) => {
    const listener = (_event, line) => callback(line);
    ipcRenderer.on('engine:build-log', listener);
    return () => ipcRenderer.removeListener('engine:build-log', listener);
  },
});

// Control de la ventana. Existe porque se quito el menu nativo de Electron
// (el editor tiene su propia barra de menus), y con el se iban las
// herramientas de desarrollo.
contextBridge.exposeInMainWorld('honeycombWindow', {
  toggleDevTools: () => ipcRenderer.invoke('window:toggleDevTools'),
});
