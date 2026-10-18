// =============================================================================
// El icono del .exe de un juego exportado
// =============================================================================
//
// El motor trae adentro el icono de HoneyComb (engine/resources/engine.rc): un
// grupo de iconos RT_GROUP_ICON con id 1, y sus imagenes RT_ICON 1, 2, 3...
// Al exportar un juego con su icono (Configuracion del juego > General > Icono),
// se reemplaza ese recurso en la COPIA del .exe, y el juego se ve con su icono
// en el Explorador, en el acceso directo y en la barra de tareas. La ventana
// tambien lo usa: el motor le pide a SDL el icono del propio .exe.
//
// Para escribir recursos se usa la API de Windows (BeginUpdateResource,
// UpdateResource, EndUpdateResource), que reescribe la seccion de recursos
// entera sin romper el ejecutable. Node no la puede llamar directo, asi que se
// llama desde PowerShell, que viene con Windows, compilando un poco de C# en
// el momento (Add-Type). Tarda uno o dos segundos.
//
// Las imagenes van como PNG dentro del recurso, que Windows lee desde Vista.
// =============================================================================

const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const { execFile } = require('node:child_process');

/** Los tamanos que Windows usa de un icono: lista, Explorador, barra de tareas, vistas grandes. */
const ICON_SIZES = [16, 24, 32, 48, 64, 128, 256];

const RT_ICON = 3;
const RT_GROUP_ICON = 14;

/**
 * Las imagenes del icono a partir de una imagen cualquiera (PNG o JPG), una
 * por tamano de ICON_SIZES, como PNG. Una que no es cuadrada se achica sin
 * deformarse y se centra sobre transparente. "nativeImage" es el de Electron.
 * Null si la imagen no se puede leer.
 */
function iconImagesFrom(nativeImage, imagePath) {
  const source = nativeImage.createFromPath(imagePath);
  if (source.isEmpty()) return null;
  const { width, height } = source.getSize();
  if (width <= 0 || height <= 0) return null;
  return ICON_SIZES.map((size) => {
    const scale = size / Math.max(width, height);
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const resized = source.resize({ width: w, height: h, quality: 'best' });
    if (w === size && h === size) return { size, png: resized.toPNG() };
    // toBitmap da los pixeles en el orden de la plataforma (BGRA en Windows);
    // se copian tal cual, asi que el orden no importa.
    const bitmap = resized.toBitmap();
    const square = Buffer.alloc(size * size * 4);
    const left = Math.floor((size - w) / 2);
    const top = Math.floor((size - h) / 2);
    for (let row = 0; row < h; row += 1) {
      bitmap.copy(square, ((top + row) * size + left) * 4, row * w * 4, (row + 1) * w * 4);
    }
    return { size, png: nativeImage.createFromBitmap(square, { width: size, height: size }).toPNG() };
  });
}

/**
 * El recurso RT_GROUP_ICON: la cabecera de un .ico, pero cada entrada dice el
 * id de su RT_ICON (1, 2, 3...) en vez de donde esta en el archivo.
 */
function buildIconGroup(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // 1 = icono
  header.writeUInt16LE(images.length, 4);
  const entries = images.map(({ size, png }, index) => {
    const entry = Buffer.alloc(14);
    entry[0] = size >= 256 ? 0 : size; // 0 = 256
    entry[1] = size >= 256 ? 0 : size;
    entry[2] = 0; // colores (0 = mas de 256)
    entry[3] = 0;
    entry.writeUInt16LE(1, 4); // planos
    entry.writeUInt16LE(32, 6); // bits por pixel
    entry.writeUInt32LE(png.length, 8);
    entry.writeUInt16LE(index + 1, 12); // el id de su RT_ICON
    return entry;
  });
  return Buffer.concat([header, ...entries]);
}

// El C# que escribe los recursos. Primero borra las imagenes que hubiera (el
// icono de HoneyComb puede tener mas tamanos que el nuevo) y despues escribe
// las nuevas y el grupo. EndUpdateResource con "discard" si algo fallo: el
// .exe queda como estaba.
const POWERSHELL_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
public static class HoneyCombExeIcon {
    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern IntPtr BeginUpdateResource(string file, bool deleteExisting);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool UpdateResource(IntPtr handle, IntPtr type, IntPtr name, ushort language, byte[] data, uint size);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool EndUpdateResource(IntPtr handle, bool discard);

    public static void Apply(string exe, string folder, int count, int previous) {
        IntPtr handle = BeginUpdateResource(exe, false);
        if (handle == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        bool ok = false;
        try {
            for (int id = 1; id <= previous; id++) {
                UpdateResource(handle, (IntPtr)3, (IntPtr)id, 0, null, 0);
            }
            for (int id = 1; id <= count; id++) {
                byte[] image = File.ReadAllBytes(Path.Combine(folder, "icon-" + id + ".png"));
                if (!UpdateResource(handle, (IntPtr)3, (IntPtr)id, 0, image, (uint)image.Length))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
            }
            byte[] group = File.ReadAllBytes(Path.Combine(folder, "group.bin"));
            if (!UpdateResource(handle, (IntPtr)14, (IntPtr)1, 0, group, (uint)group.Length))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            ok = true;
        } finally {
            if (!EndUpdateResource(handle, !ok) && ok) throw new Win32Exception(Marshal.GetLastWin32Error());
        }
    }
}
'@
[HoneyCombExeIcon]::Apply($env:HC_EXE, $env:HC_FOLDER, [int]$env:HC_COUNT, [int]$env:HC_PREVIOUS)
`;

function runPowerShell(scriptPath, env) {
  return new Promise((resolve, reject) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', scriptPath],
      { env: { ...process.env, ...env }, windowsHide: true, timeout: 60000 },
      (error, _stdout, stderr) => {
        if (error) {
          const detail = String(stderr || error.message).trim().split(/\r?\n/).find((line) => line.trim()) ?? error.message;
          reject(new Error(detail));
        } else {
          resolve();
        }
      },
    );
  });
}

/**
 * Reemplaza el icono del .exe por "images" (lo que da iconImagesFrom). Solo
 * en Windows. Las rutas viajan por variables de entorno y no armadas dentro
 * del script: una carpeta con comillas o "$" no puede cambiar lo que se ejecuta.
 */
async function setExeIcon(exePath, images) {
  if (process.platform !== 'win32') throw new Error('El icono del .exe solo se cambia en Windows.');
  if (!images || images.length === 0) throw new Error('No hay imágenes para el icono.');
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'honeycomb-icono-'));
  try {
    for (const [index, image] of images.entries()) {
      await fs.writeFile(path.join(folder, `icon-${index + 1}.png`), image.png);
    }
    await fs.writeFile(path.join(folder, 'group.bin'), buildIconGroup(images));
    const scriptPath = path.join(folder, 'icono.ps1');
    await fs.writeFile(scriptPath, POWERSHELL_SCRIPT, 'utf-8');
    // Cuantas imagenes tenia el icono anterior, para borrarlas todas.
    const previous = Math.max(ICON_SIZES.length, countIconImages(await fs.readFile(exePath)));
    await runPowerShell(scriptPath, {
      HC_EXE: exePath,
      HC_FOLDER: folder,
      HC_COUNT: String(images.length),
      HC_PREVIOUS: String(previous),
    });
  } finally {
    await fs.rm(folder, { recursive: true, force: true }).catch(() => {});
  }
}

// --- Leer los recursos de un .exe ---------------------------------------------
//
// Lo justo para saber que icono tiene un ejecutable: recorre el directorio de
// recursos del PE (tipo > id > idioma) y devuelve los bytes de uno. Lo usan
// las pruebas para comprobar que el icono quedo adentro, y setExeIcon para
// saber cuantas imagenes borrar.

function sectionOf(buffer) {
  if (buffer.length < 0x40 || buffer.toString('latin1', 0, 2) !== 'MZ') return null;
  const pe = buffer.readUInt32LE(0x3c);
  if (buffer.toString('latin1', pe, pe + 4) !== 'PE\0\0') return null;
  const sections = buffer.readUInt16LE(pe + 6);
  const optionalSize = buffer.readUInt16LE(pe + 20);
  const optional = pe + 24;
  const magic = buffer.readUInt16LE(optional);
  // El directorio de recursos es la entrada 2 de los directorios de datos.
  const directories = optional + (magic === 0x20b ? 112 : 96);
  const resourceRva = buffer.readUInt32LE(directories + 2 * 8);
  if (!resourceRva) return null;
  const table = optional + optionalSize;
  for (let i = 0; i < sections; i += 1) {
    const at = table + i * 40;
    const virtualAddress = buffer.readUInt32LE(at + 12);
    const virtualSize = buffer.readUInt32LE(at + 8);
    const rawPointer = buffer.readUInt32LE(at + 20);
    if (resourceRva >= virtualAddress && resourceRva < virtualAddress + Math.max(virtualSize, 1)) {
      return { rootOffset: rawPointer + (resourceRva - virtualAddress), toOffset: (rva) => rawPointer + (rva - virtualAddress) };
    }
  }
  return null;
}

/** Las entradas de un directorio de recursos: [{ id, offset, isDirectory }]. Solo ids numericos. */
function directoryEntries(buffer, rootOffset, offset) {
  const named = buffer.readUInt16LE(offset + 12);
  const numbered = buffer.readUInt16LE(offset + 14);
  const entries = [];
  for (let i = 0; i < named + numbered; i += 1) {
    const at = offset + 16 + i * 8;
    const name = buffer.readUInt32LE(at);
    const target = buffer.readUInt32LE(at + 4);
    if (name & 0x80000000) continue;
    entries.push({ id: name, offset: rootOffset + (target & 0x7fffffff), isDirectory: (target & 0x80000000) !== 0 });
  }
  return entries;
}

/** Los bytes del recurso type/id (el primer idioma que tenga), o null si no esta. */
function readExeResource(buffer, type, id) {
  const section = sectionOf(buffer);
  if (!section) return null;
  const { rootOffset, toOffset } = section;
  const typeEntry = directoryEntries(buffer, rootOffset, rootOffset).find((entry) => entry.id === type && entry.isDirectory);
  if (!typeEntry) return null;
  const idEntry = directoryEntries(buffer, rootOffset, typeEntry.offset).find((entry) => entry.id === id && entry.isDirectory);
  if (!idEntry) return null;
  const [language] = directoryEntries(buffer, rootOffset, idEntry.offset);
  if (!language || language.isDirectory) return null;
  const dataRva = buffer.readUInt32LE(language.offset);
  const size = buffer.readUInt32LE(language.offset + 4);
  const start = toOffset(dataRva);
  return buffer.subarray(start, start + size);
}

/** Cuantas imagenes tiene el icono 1 del .exe (0 si no tiene). */
function countIconImages(buffer) {
  const group = readExeResource(buffer, RT_GROUP_ICON, 1);
  return group && group.length >= 6 ? group.readUInt16LE(4) : 0;
}

module.exports = {
  ICON_SIZES,
  RT_ICON,
  RT_GROUP_ICON,
  iconImagesFrom,
  buildIconGroup,
  setExeIcon,
  readExeResource,
  countIconImages,
};
