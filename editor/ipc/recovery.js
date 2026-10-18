// =============================================================================
// Guardado automatico: una copia del nivel sin guardar, para recuperarlo
// =============================================================================
//
// Mientras el nivel tiene cambios sin guardar, la UI manda cada pocos segundos
// una copia aca (recovery:write). Si el editor se cierra de golpe -- se cuelga,
// se corta la luz, se mata el proceso --, al volver a abrirlo la UI pregunta
// si se quiere recuperar (recovery:read). Guardar, o descartar los cambios a
// proposito, borra la copia (recovery:clear).
//
// La copia NO va a la carpeta del editor: no es parte del proyecto, no tiene
// que aparecer en el explorador ni viajar en una exportacion, y no puede pisar
// el nivel de verdad. Va a la carpeta de datos de Electron, una por carpeta del
// editor (el nombre sale de su ruta), asi que cambiar de carpeta no ofrece
// recuperar un nivel de otro proyecto.
//
// Se escribe con writeFileAtomic: un corte justo mientras se escribe la copia
// no la deja a medias.
// =============================================================================

const path = require('node:path');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const { createHash } = require('node:crypto');
const { app, ipcMain } = require('electron');

const { getProjectRoot } = require('./project-root');
const { writeFileAtomic } = require('./safe-write');

/** Tope de la copia: un nivel de verdad pesa unos cientos de KB. */
const RECOVERY_LIMIT = 32 * 1024 * 1024;

function recoveryDir() {
  return path.join(app.getPath('userData'), 'recuperacion');
}

/** El archivo de la copia de la carpeta del editor de ahora, o null si todavia no hay carpeta. */
function recoveryPath() {
  const root = getProjectRoot();
  if (!root) return null;
  // En minusculas: en Windows "C:\Docs" y "c:\docs" son la misma carpeta.
  const key = createHash('sha256').update(path.resolve(root).toLowerCase()).digest('hex').slice(0, 16);
  return path.join(recoveryDir(), `${key}.json`);
}

async function clearRecovery() {
  const file = recoveryPath();
  if (file) await fs.rm(file, { force: true });
}

/**
 * Lo mismo, sin esperar a nada: para cuando la ventana se esta cerrando y el
 * proceso puede terminar antes de que una promesa se cumpla.
 */
function clearRecoverySync() {
  const file = recoveryPath();
  if (file) fsSync.rmSync(file, { force: true });
}

function register() {
  // "payload" es lo que la UI quiera recuperar despues; aca solo se valida que
  // sea un objeto razonable y se le agrega cuando y de que carpeta es.
  ipcMain.handle('recovery:write', async (_event, payload) => {
    const file = recoveryPath();
    if (!file) return;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('La copia de recuperación no tiene la forma esperada.');
    }
    const contents = JSON.stringify({ ...payload, root: getProjectRoot(), savedAt: new Date().toISOString() });
    if (contents.length > RECOVERY_LIMIT) {
      throw new Error('El nivel es demasiado grande para la copia de recuperación.');
    }
    await writeFileAtomic(file, contents, { backup: false });
  });

  ipcMain.handle('recovery:read', async () => {
    const file = recoveryPath();
    if (!file) return null;
    try {
      const data = JSON.parse(await fs.readFile(file, 'utf-8'));
      // Una copia de otra carpeta (dos rutas con el mismo resumen, en teoria)
      // no se ofrece.
      if (!data || typeof data !== 'object' || path.resolve(String(data.root)).toLowerCase() !== path.resolve(getProjectRoot()).toLowerCase()) {
        return null;
      }
      return data;
    } catch {
      // Sin copia, o una rota: no hay nada que recuperar.
      return null;
    }
  });

  ipcMain.handle('recovery:clear', () => clearRecovery());
}

module.exports = { register, clearRecovery, clearRecoverySync, recoveryPath };
