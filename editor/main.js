// =============================================================================
// HoneyComb Engine - Editor (proceso principal de Electron)
// =============================================================================
//
// Este es el unico proceso con acceso real al disco. La UI (Angular) corre en
// el proceso "renderer", aislado en un sandbox de navegador, y no puede tocar
// archivos: le pide todo a este por IPC.
//
//   Angular (app.ts)  ->  ProjectService  ->  window.honeycombProject
//                                                    |  (contextBridge)
//                                              preload.js
//                                                    |  (ipcRenderer.invoke)
//                                              ipc/*.js      ->  disco
//
// Ese ida y vuelta parece rebuscado, pero es lo que permite tener
// contextIsolation activado: la UI nunca ve "require" ni el modulo fs, asi que
// un bug (o un nivel malicioso) no puede escribir donde se le antoje.
// =============================================================================

const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('node:path');
const fsSync = require('node:fs');

// Los handlers de IPC, uno por dominio. Cada modulo registra sus propios
// canales; los nombres de canal siguen siendo los mismos que declara
// preload.js, que es el contrato con la UI y no cambia.
const ipcLevels = require('./ipc/levels');
const ipcFiles = require('./ipc/files');
const ipcImport = require('./ipc/import');
const ipcRun = require('./ipc/run');

const ANGULAR_DEV_SERVER_URL = 'http://localhost:4200';
const ANGULAR_BUILD_INDEX = path.join(__dirname, 'dist/editor/browser/index.html');

// Pantalla de diagnostico: sin esto, un dev server caido deja la ventana en
// blanco sin ninguna pista de que fue lo que fallo.
function diagnosticPage(reason) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>HoneyComb Engine</title></head>
<body style="margin:0;padding:40px;background:#14171d;color:#c7cdd8;
             font:14px/1.6 'Segoe UI',system-ui,sans-serif">
  <h1 style="margin:0 0 6px;color:#f5a623;font-size:20px">⬢ HoneyComb Engine — Editor</h1>
  <p style="color:#79818f;margin:0 0 24px">No se pudo cargar la interfaz.</p>
  <p style="background:#1e222a;border-left:3px solid #e05a5a;padding:10px 14px;
            font-family:ui-monospace,monospace;font-size:12px">${reason}</p>
  <p>Hay dos formas de abrir el editor:</p>
  <ol>
    <li><b>Con recarga en vivo</b> — deja <code>npm start</code> corriendo en otra
        terminal y volve a abrir <code>npm run electron</code>.</li>
    <li><b>Sin dev server</b> — compila una vez con <code>npm run build</code>;
        esta ventana usara <code>dist/</code> automaticamente.</li>
  </ol>
  <p style="color:#79818f;font-size:12px">Si <code>npm</code> falla en PowerShell con
     "la ejecucion de scripts esta deshabilitada", corre una sola vez:
     <code style="color:#f5a623">Set-ExecutionPolicy -Scope CurrentUser RemoteSigned</code></p>
</body></html>`;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#14171d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      // Las dos banderas de seguridad estandar de Electron. Con esto, el codigo
      // de Angular solo ve lo que preload.js decide exponer: nada de require(),
      // nada de fs, nada de acceso directo a Node.
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Los errores del renderer (Angular) no llegan solos a esta consola: sin
  // esto, un fallo al arrancar la UI se ve como una ventana vacia.
  win.webContents.on('console-message', (...args) => {
    const details = typeof args[0] === 'object' && args[0] !== null && 'message' in args[0]
      ? args[0]
      : { level: args[1], message: args[2], lineNumber: args[3], sourceId: args[4] };
    const level = String(details.level);
    if (level === 'error' || level === '3' || level === '2') {
      console.error(`[renderer] ${details.message} (${details.sourceId}:${details.lineNumber})`);
    }
  });

  if (process.env.HONEYCOMB_DEVTOOLS) {
    win.webContents.openDevTools({ mode: 'right' });
  }

  // Si el dev server no responde, caemos al build de dist/ y, si tampoco
  // existe, mostramos que hacer en vez de una ventana vacia.
  win.webContents.on('did-fail-load', (_event, _code, description, url, isMainFrame) => {
    if (!isMainFrame || url.startsWith('file://') || url.startsWith('data:')) {
      return;
    }
    if (fsSync.existsSync(ANGULAR_BUILD_INDEX)) {
      console.warn(`[honeycomb] ${url} no respondio; usando dist/.`);
      win.loadFile(ANGULAR_BUILD_INDEX);
      return;
    }
    console.error(`[honeycomb] ${url} no respondio y no hay build en dist/.`);
    win.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(diagnosticPage(`${description} — ${url}`)),
    );
  });

  // De donde sale la UI, en orden de preferencia:
  //   1. ELECTRON_START_URL  - lo pone scripts/dev.js al arrancar con "npm run dev"
  //   2. localhost:4200      - un "ng serve" levantado a mano en otra terminal
  //   3. dist/               - la app ya empaquetada, sin dev server
  if (!app.isPackaged && process.env.ELECTRON_START_URL) {
    win.loadURL(process.env.ELECTRON_START_URL);
  } else if (!app.isPackaged) {
    win.loadURL(ANGULAR_DEV_SERVER_URL);
  } else {
    win.loadFile(ANGULAR_BUILD_INDEX);
  }
}

app.whenReady().then(() => {
  // Sin el menu nativo ("File Edit View Window"): el editor dibuja su propia
  // barra de menus, y con las dos habria dos filas de menus que no se hablan.
  // Lo util que traia el nativo (recargar, herramientas de desarrollo) esta en
  // el menu Ver del editor.
  Menu.setApplicationMenu(null);

  // Antes de abrir la ventana: la UI puede pedir cosas apenas carga.
  ipcLevels.register();
  ipcFiles.register();
  ipcImport.register();
  ipcRun.register();

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// La ventana que pidio el cambio, y no "la primera": si algun dia hay dos, las
// herramientas se abren en la que se esta usando. Queda aca, y no en ipc/,
// porque es lo unico que toca la ventana y la ventana es cosa de este archivo.
ipcMain.handle('window:toggleDevTools', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.webContents.toggleDevTools();
});

app.on('window-all-closed', () => {
  // En macOS lo normal es que la app siga viva sin ventanas (queda en el Dock);
  // en Windows y Linux, cerrar la ultima ventana cierra la aplicacion.
  if (process.platform !== 'darwin') app.quit();
});
