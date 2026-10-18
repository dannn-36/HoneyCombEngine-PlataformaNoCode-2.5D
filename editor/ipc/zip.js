// =============================================================================
// Un .zip para el juego exportado (ver export.js)
// =============================================================================
//
// Node trae zlib (deflate) pero no el formato ZIP, y sumar una dependencia
// solo para esto no vale la pena: el formato basico son tres registros por
// archivo. Lo que se escribe es lo que abre cualquier sistema (el explorador
// de Windows, 7-Zip, unzip): deflate o sin comprimir, nombres en UTF-8 (bit
// 11), sin ZIP64. Por eso tiene topes: 65535 archivos y 4 GB, de sobra para un
// juego de este motor.
//
// Se escribe a "<zip>.tmp" y se renombra al final: un .zip a medias no queda
// con el nombre del bueno.
// =============================================================================

const path = require('node:path');
const fs = require('node:fs/promises');
const zlib = require('node:zlib');

const MAX_ENTRIES = 0xffff;
const MAX_OFFSET = 0xffffffff;
const UTF8_FLAG = 0x0800;

/** Fecha y hora en el formato de MS-DOS que usa ZIP (resolucion de 2 segundos). */
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** Todos los archivos debajo de "dir", como rutas relativas con "/", en orden. */
async function listFiles(dir, prefix = '') {
  const out = [];
  const entries = await fs.readdir(path.join(dir, prefix), { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listFiles(dir, relative)));
    else if (entry.isFile()) out.push(relative);
  }
  return out;
}

/**
 * Comprime "sourceDir" entero en "zipPath". Dentro del .zip todo va debajo de
 * "rootName/", asi al descomprimir queda una carpeta y no los archivos sueltos.
 * Devuelve cuantos archivos guardo.
 */
async function zipDirectory(sourceDir, zipPath, rootName) {
  const files = await listFiles(sourceDir);
  if (files.length > MAX_ENTRIES) {
    throw new Error(`El juego tiene ${files.length} archivos: un .zip simple admite hasta ${MAX_ENTRIES}.`);
  }

  const tempPath = `${zipPath}.tmp`;
  const handle = await fs.open(tempPath, 'w');
  const central = [];
  let offset = 0;
  const write = async (buffer) => {
    await handle.write(buffer);
    offset += buffer.length;
    if (offset > MAX_OFFSET) throw new Error('El juego pesa mas de 4 GB: no entra en un .zip simple.');
  };

  try {
    for (const relative of files) {
      const fullPath = path.join(sourceDir, ...relative.split('/'));
      const data = await fs.readFile(fullPath);
      const { mtime } = await fs.stat(fullPath);
      const { time, date } = dosDateTime(mtime);
      const crc = zlib.crc32(data);
      // Lo que ya viene comprimido (un PNG) a veces crece con deflate: entonces se guarda tal cual.
      const deflated = zlib.deflateRawSync(data, { level: 9 });
      const stored = deflated.length >= data.length;
      const body = stored ? data : deflated;
      const method = stored ? 0 : 8;
      const name = Buffer.from(`${rootName}/${relative}`, 'utf-8');

      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4); // version necesaria: 2.0
      local.writeUInt16LE(UTF8_FLAG, 6);
      local.writeUInt16LE(method, 8);
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(date, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(body.length, 18);
      local.writeUInt32LE(data.length, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28); // sin campos extra
      const localOffset = offset;
      await write(Buffer.concat([local, name]));
      await write(body);

      const record = Buffer.alloc(46);
      record.writeUInt32LE(0x02014b50, 0);
      record.writeUInt16LE(20, 4); // hecho por: 2.0
      record.writeUInt16LE(20, 6);
      record.writeUInt16LE(UTF8_FLAG, 8);
      record.writeUInt16LE(method, 10);
      record.writeUInt16LE(time, 12);
      record.writeUInt16LE(date, 14);
      record.writeUInt32LE(crc, 16);
      record.writeUInt32LE(body.length, 20);
      record.writeUInt32LE(data.length, 24);
      record.writeUInt16LE(name.length, 28);
      // extra, comentario, disco, atributos internos y externos: en cero.
      record.writeUInt32LE(localOffset, 42);
      central.push(Buffer.concat([record, name]));
    }

    const centralOffset = offset;
    const centralDir = Buffer.concat(central);
    await write(centralDir);

    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(files.length, 8);
    end.writeUInt16LE(files.length, 10);
    end.writeUInt32LE(centralDir.length, 12);
    end.writeUInt32LE(centralOffset, 16);
    await write(end);
  } catch (err) {
    await handle.close();
    await fs.rm(tempPath, { force: true });
    throw err;
  }
  await handle.close();
  await fs.rename(tempPath, zipPath);
  return files.length;
}

/**
 * Los nombres de archivo que guarda un .zip, leidos de su directorio central.
 * Sirve para reconocer un .zip que hizo esta misma exportacion (ver export.js)
 * y para las pruebas. Devuelve null si no parece un .zip.
 */
async function zipEntryNames(zipPath) {
  const data = await fs.readFile(zipPath);
  const endAt = data.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (endAt < 0 || endAt + 22 > data.length) return null;
  const count = data.readUInt16LE(endAt + 10);
  let at = data.readUInt32LE(endAt + 16);
  const names = [];
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > data.length || data.readUInt32LE(at) !== 0x02014b50) return null;
    const nameLength = data.readUInt16LE(at + 28);
    const extraLength = data.readUInt16LE(at + 30);
    const commentLength = data.readUInt16LE(at + 32);
    names.push(data.subarray(at + 46, at + 46 + nameLength).toString('utf-8'));
    at += 46 + nameLength + extraLength + commentLength;
  }
  return names;
}

module.exports = { zipDirectory, zipEntryNames };
