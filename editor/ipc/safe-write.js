// =============================================================================
// Escribir un archivo del proyecto sin poder dejarlo a medias
// =============================================================================
//
// fs.writeFile directo primero vacia el archivo y despues escribe. Si en el
// medio algo se corta -- se cierra el editor, se corta la luz, se llena el
// disco, el antivirus bloquea la escritura -- el nivel queda vacio o roto, y
// no queda ninguna version anterior para volver.
//
// Aca se escribe primero un archivo TEMPORAL en la misma carpeta, se lo baja
// al disco (fsync), y recien entonces se lo renombra encima del original.
// Renombrar dentro de una misma carpeta es atomico: quien lea el archivo (el
// motor al recargar con F8, por ejemplo) ve el viejo entero o el nuevo entero,
// nunca uno a medias. Si algo falla antes del renombrado, el original queda
// como estaba.
//
// Antes de reemplazarlo, el archivo anterior se copia a "<nombre>.bak": si lo
// que se acaba de guardar estaba mal, la version de antes sigue ahi.
// =============================================================================

const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');

/**
 * En Windows, renombrar encima de un archivo falla mientras otro programa lo
 * tiene abierto: el antivirus que lo esta revisando, o el motor que lo esta
 * leyendo. Suele durar milisegundos, asi que se reintenta unas veces antes de
 * darlo por perdido.
 */
const TRANSIENT_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const RENAME_ATTEMPTS = 5;
const RENAME_DELAY_MS = 40;

/** Donde queda la version anterior de un archivo. */
function backupPathOf(targetPath) {
  return `${targetPath}.bak`;
}

async function renameWithRetry(from, to) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      if (!TRANSIENT_CODES.has(err.code) || attempt >= RENAME_ATTEMPTS) {
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, RENAME_DELAY_MS * attempt));
    }
  }
}

/**
 * Copia la version actual a .bak. Sin archivo anterior no hay nada que copiar.
 * Si la copia falla por otra cosa, el guardado sigue igual: perder el respaldo
 * es menos grave que no poder guardar, y el motivo se anota en la consola.
 */
async function backupPrevious(targetPath) {
  try {
    await fs.copyFile(targetPath, backupPathOf(targetPath));
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn(`[honeycomb] no se pudo respaldar ${targetPath}: ${err.message}`);
    }
  }
}

/** El nombre del temporal de "targetPath": oculto y con un sufijo unico. */
function tempPathOf(targetPath) {
  return path.join(path.dirname(targetPath), `.${path.basename(targetPath)}.${randomUUID().slice(0, 8)}.tmp`);
}

/** Los temporales que deja writeFileAtomic: ".<nombre>.<8 hex>.tmp". */
const TEMP_FILE_PATTERN = /^\..+\.[0-9a-f]{8}\.tmp$/;

/**
 * Escribe "contents" (texto o Buffer) en "targetPath" de forma atomica,
 * dejando el anterior en .bak.
 *
 * Con "exclusive" no reemplaza nada: si el archivo ya existe falla con EEXIST,
 * como fs.writeFile con flag "wx", y no se toca. Es lo que usa quien tiene que
 * preguntar antes de pisar (la herramienta de sprites). Con "backup" en false
 * no deja .bak: para lo que ya es una copia (la recuperacion de ipc/recovery.js).
 */
async function writeFileAtomic(targetPath, contents, { exclusive = false, backup = true } = {}) {
  const dir = path.dirname(targetPath);
  // mkdir recursivo: guardar el primer nivel de un proyecto recien creado no
  // deberia fallar solo porque todavia no existe la carpeta levels/.
  await fs.mkdir(dir, { recursive: true });

  // Oculto (empieza con punto) y con un sufijo unico: dos guardados seguidos
  // del mismo archivo no se pisan el temporal.
  const tempPath = tempPathOf(targetPath);
  try {
    const handle = await fs.open(tempPath, 'w');
    try {
      await handle.writeFile(contents, typeof contents === 'string' ? 'utf-8' : undefined);
      // Sin esto, un corte de luz justo despues del renombrado puede dejar el
      // archivo nuevo vacio: el sistema todavia no lo habia bajado al disco.
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (exclusive && (await exists(targetPath))) {
      throw Object.assign(new Error(`Ya existe ${targetPath}`), { code: 'EEXIST' });
    }
    if (!exclusive && backup) {
      await backupPrevious(targetPath);
    }
    await renameWithRetry(tempPath, targetPath);
  } catch (err) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw err;
  }
}

async function exists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Borra los temporales que quedaron de un guardado que se corto (el editor se
 * cerro o se corto la luz justo en ese momento). Recorre "root" hasta "depth"
 * carpetas de profundidad, sin seguir enlaces.
 *
 * Solo los que tienen mas de "minAgeMs": uno reciente puede ser de otra
 * ventana del editor que esta guardando ahora mismo. Devuelve cuantos borro.
 * Nunca falla: limpiar es una comodidad, no puede impedir que el editor arranque.
 */
async function removeStaleTempFiles(root, { depth = 4, minAgeMs = 10 * 60 * 1000, now = Date.now() } = {}) {
  let removed = 0;
  const walk = async (dir, level) => {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // node_modules no es del proyecto, y recorrerlo tarda segundos.
        if (level < depth && entry.name !== 'node_modules') await walk(full, level + 1);
      } else if (entry.isFile() && TEMP_FILE_PATTERN.test(entry.name)) {
        try {
          const { mtimeMs } = await fs.stat(full);
          if (now - mtimeMs >= minAgeMs) {
            await fs.rm(full, { force: true });
            removed += 1;
          }
        } catch {
          // Se lo llevo otro, o no se puede borrar: queda para la proxima.
        }
      }
    }
  };
  await walk(root, 0);
  return removed;
}

/**
 * Un mensaje que se entienda para los fallos de escritura que tienen una causa
 * conocida, o null para dejar el error como vino. Llega tal cual a la consola
 * del editor, asi que dice que hacer y no solo el codigo del sistema.
 */
function describeWriteError(err, relativePath) {
  const file = `"${relativePath}"`;
  switch (err.code) {
    case 'EPERM':
    case 'EACCES':
      if (process.platform === 'win32') {
        return (
          `Windows no dejó escribir ${file}. Puede que otro programa lo tenga abierto, o que la ` +
          'protección contra ransomware (Acceso controlado a carpetas) esté bloqueando al editor: ' +
          'en Seguridad de Windows › Protección antivirus y contra amenazas › Protección contra ' +
          'ransomware, permite la aplicación del editor, o usa una carpeta del editor fuera de Documentos.'
        );
      }
      return `No hay permiso para escribir ${file}. Revisa los permisos de la carpeta del editor.`;
    case 'EBUSY':
      return `${file} está abierto en otro programa. Ciérralo y vuelve a guardar.`;
    case 'ENOSPC':
      return `No queda espacio en el disco para guardar ${file}. El archivo anterior no se tocó.`;
    case 'EROFS':
      return `La carpeta del editor está en un disco de solo lectura: no se puede guardar ${file}.`;
    default:
      return null;
  }
}

module.exports = { writeFileAtomic, backupPathOf, describeWriteError, removeStaleTempFiles, TEMP_FILE_PATTERN };
