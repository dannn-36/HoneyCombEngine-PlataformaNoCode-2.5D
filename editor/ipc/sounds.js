// =============================================================================
// Importar sonidos: archivos WAV, OGG o MP3 a assets/sounds/
// =============================================================================
//
// Recursos > Sonidos > Importar. Es la puerta de entrada de audio al proyecto,
// como el convertidor lo es de las imagenes (ver ipc/convert.js), con las
// mismas reglas:
//
//   - Se eligen ARCHIVOS con el dialogo del sistema, uno o varios, de
//     cualquier carpeta. Se COPIAN a assets/sounds/ de la carpeta del editor,
//     que es donde los busca el motor; el original no se toca.
//   - El nombre de destino se limpia (ver ipc/names.js: el motor abre con
//     fopen y no entiende cualquier caracter) y nunca pisa uno que ya estaba:
//     "tema.ogg" ocupado pasa a "tema-2.ogg".
//   - Solo entra lo que de verdad es WAV, OGG o MP3 (se miran los primeros
//     bytes, no solo la extension): un archivo renombrado a .ogg se importaria
//     bien y despues el juego quedaria mudo sin decir por que.
//
// No hace falta convertir nada: raylib lee los tres formatos tal cual.
// =============================================================================

const path = require('node:path');
const fs = require('node:fs/promises');
const { ipcMain, dialog, BrowserWindow } = require('electron');

const { getProjectRoot, ensureProjectRoot } = require('./project-root');
const { AUDIO_MIME_TYPES, AUDIO_LIMIT } = require('./media-types');
const { safeSoundName, freeName } = require('./names');

/**
 * true si los primeros bytes son los de un archivo de ese formato:
 *   WAV  "RIFF" .... "WAVE"
 *   OGG  "OggS"
 *   MP3  "ID3" (etiqueta al principio) o la marca de sincronia de un cuadro (11 bits en 1)
 */
function looksLikeAudio(extension, head) {
  switch (extension) {
    case '.wav':
      return head.length >= 12 && head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WAVE';
    case '.ogg':
      return head.length >= 4 && head.toString('latin1', 0, 4) === 'OggS';
    case '.mp3':
      return (
        (head.length >= 3 && head.toString('latin1', 0, 3) === 'ID3') ||
        (head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0)
      );
    default:
      return false;
  }
}

async function readHead(file, bytes = 16) {
  const handle = await fs.open(file, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Copia "sources" a "targetFolder". Devuelve lo que entro, con su ruta
 * relativa a assets/ ("sounds/tema.ogg", como lo guardan los niveles), y lo
 * que no, con el motivo.
 */
async function importSounds(sources, targetFolder) {
  const imported = [];
  const skipped = [];
  const reserved = new Set();
  for (const sourcePath of sources) {
    const source = path.basename(sourcePath);
    const extension = path.extname(sourcePath).toLowerCase();
    try {
      // El filtro del dialogo se puede saltear escribiendo el nombre a mano.
      if (!AUDIO_MIME_TYPES.has(extension)) {
        skipped.push({ source, reason: 'no es WAV, OGG ni MP3' });
        continue;
      }
      const stats = await fs.stat(sourcePath);
      if (stats.size > AUDIO_LIMIT) {
        skipped.push({ source, reason: `pesa más de ${Math.round(AUDIO_LIMIT / (1024 * 1024))} MB` });
        continue;
      }
      if (!looksLikeAudio(extension, await readHead(sourcePath))) {
        skipped.push({ source, reason: `no es un ${extension.slice(1).toUpperCase()} de verdad (¿se le cambió la extensión?)` });
        continue;
      }
      // COPYFILE_EXCL nunca pisa: si otro proceso creo el archivo entre la
      // eleccion del nombre y la copia, se prueba con el siguiente libre.
      let done = false;
      for (let attempt = 0; attempt < 20 && !done; attempt += 1) {
        const target = freeName(targetFolder, safeSoundName(sourcePath), reserved);
        try {
          await fs.copyFile(sourcePath, path.join(targetFolder, target), fs.constants.COPYFILE_EXCL);
          reserved.add(target.toLowerCase());
          imported.push({ source, target: `sounds/${target}`, size: stats.size });
          done = true;
        } catch (err) {
          if (err.code !== 'EEXIST') throw err;
          reserved.add(target.toLowerCase());
        }
      }
      if (!done) skipped.push({ source, reason: 'no se encontró un nombre libre' });
    } catch (err) {
      skipped.push({ source, reason: err.message });
    }
  }
  return { imported, skipped };
}

function register() {
  ipcMain.handle('sounds:import', async (event) => {
    await ensureProjectRoot();
    const targetFolder = path.join(getProjectRoot(), 'assets', 'sounds');
    await fs.mkdir(targetFolder, { recursive: true });

    const window = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: 'Elegí los sonidos a importar',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Sonidos (WAV, OGG, MP3)', extensions: ['wav', 'ogg', 'mp3'] }],
    };
    const { canceled, filePaths } = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (canceled || !filePaths || filePaths.length === 0) {
      return { canceled: true, imported: [], skipped: [] };
    }
    return { canceled: false, ...(await importSounds(filePaths, targetFolder)) };
  });
}

module.exports = { register, importSounds, looksLikeAudio };
