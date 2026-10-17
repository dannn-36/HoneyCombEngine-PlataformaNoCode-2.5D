// =============================================================================
// Texturas hechas en el editor: la herramienta de sprites guarda su PNG
// =============================================================================
//
// La herramienta de sprites (src/app/sprites/) dibuja en la UI y manda el PNG
// ya armado. Este canal lo escribe en assets/textures/ de la carpeta del editor,
// que es donde lo busca el motor, y en ningun otro lado:
//
//   - La UI manda un NOMBRE, nunca una ruta. Se limpia igual que en el
//     convertidor (ver ipc/names.js) y siempre termina en .png.
//   - No pisa una textura que ya existe salvo que se pida (overwrite): si el
//     nombre esta ocupado contesta "exists" y la UI pregunta antes de
//     reemplazarla, porque las entidades que la usan cambian con ella.
//   - Solo acepta un PNG de verdad (la firma de los primeros 8 bytes).

const path = require('node:path');
const fs = require('node:fs/promises');
const { ipcMain } = require('electron');

const { getProjectRoot, ensureProjectRoot } = require('./project-root');
const { IMAGE_IMPORT_LIMIT } = require('./media-types');
const { safeTextureName } = require('./names');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function register() {
  ipcMain.handle('textures:write', async (_event, { name, pngBase64, overwrite }) => {
    if (typeof name !== 'string' || typeof pngBase64 !== 'string') {
      throw new Error('Falta el nombre o la imagen de la textura.');
    }
    const bytes = Buffer.from(pngBase64, 'base64');
    if (bytes.length > IMAGE_IMPORT_LIMIT) {
      throw new Error('La imagen pesa demasiado para guardarla como textura.');
    }
    if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      throw new Error('Lo que llegó para guardar no es un PNG.');
    }

    await ensureProjectRoot();
    const folder = path.join(getProjectRoot(), 'assets', 'textures');
    await fs.mkdir(folder, { recursive: true });

    const target = safeTextureName(name);
    try {
      // "wx" no pisa nunca: si el nombre ya esta, la UI decide.
      await fs.writeFile(path.join(folder, target), bytes, { flag: overwrite ? 'w' : 'wx' });
    } catch (err) {
      if (err.code === 'EEXIST') return { status: 'exists', target };
      throw err;
    }
    return { status: 'written', target };
  });
}

module.exports = { register };
