import { Injectable, signal } from '@angular/core';

import { normalizePreset } from '../core/characters';
import { gameConfigForDisk, normalizeGameConfig } from '../core/game-config';
import { normalizeItem } from '../core/items';
import type {
  ConvertSession,
  ConvertSource,
  EngineMode,
  EngineRunResult,
  EngineStart,
  GameExportResult,
  LevelImport,
  ProjectFileData,
  ProjectNode,
  RecoveryPayload,
  SoundImportResult,
  TextureWriteResult,
  WorkspaceInfo,
} from '../electron-api';
import { CharacterPreset } from '../models/character-preset.model';
import { GameConfig } from '../models/game-config.model';
import { ItemDef } from '../models/item.model';

/** Archivo del proyecto con los personajes configurados, junto a levels/ y assets/. */
export const CHARACTERS_FILE = 'characters.json';
/** Archivo del proyecto con la biblioteca de objetos (armas, curaciones, monedas). */
export const ITEMS_FILE = 'items.json';
/** Archivo del proyecto con la configuracion del juego: ventana, portada, HUD, variables. */
export const GAME_FILE = 'game.json';
/** La partida guardada que escribe el motor (ver engine/game/Progress.hpp). */
export const SAVE_FILE = 'saves/partida.json';
import { EventCatalog } from '../models/event-catalog.model';
import { Level } from '../models/level.model';

/**
 * Un archivo del proyecto cambio en el disco desde que el editor lo leyo o lo
 * guardo por ultima vez (ver ProjectService.writeChecked). No se escribio nada.
 */
export class FileChangedOnDiskError extends Error {
  constructor(readonly relativePath: string) {
    super(`${relativePath} cambió en el disco desde que se abrió.`);
    this.name = 'FileChangedOnDiskError';
  }
}

/** El NIVEL cambio en el disco (ver ProjectService.saveLevel). */
export class LevelChangedOnDiskError extends FileChangedOnDiskError {
  constructor(relativePath: string) {
    super(relativePath);
    this.name = 'LevelChangedOnDiskError';
  }
}

/** Lo que guarda una biblioteca del proyecto: con overwrite, aunque el archivo haya cambiado en el disco. */
export type CheckedWrite = (options: { overwrite?: boolean }) => Promise<void>;

/**
 * Guarda con "write" y, si el archivo cambio en el disco por fuera (otro
 * programa, una copia del proyecto, git), pregunta antes de pisarlo. Devuelve
 * true si se escribio y false si la persona eligio no reemplazarlo; cualquier
 * otro error sigue de largo.
 *
 * Es el mismo trato que tiene el nivel al guardar (ver ProjectController), para
 * las bibliotecas: game.json, items.json y characters.json.
 */
export async function writeOrConfirm(write: CheckedWrite, what: string): Promise<boolean> {
  try {
    await write({});
    return true;
  } catch (error) {
    if (!(error instanceof FileChangedOnDiskError)) {
      throw error;
    }
    const replace = window.confirm(
      `${error.relativePath} cambió en el disco desde que el editor lo leyó (otro programa, una copia del ` +
        `proyecto o git). ¿Reemplazarlo con ${what}?\n\n` +
        `La versión del disco quedará en ${error.relativePath}.bak.`,
    );
    if (!replace) {
      return false;
    }
    await write({ overwrite: true });
    return true;
  }
}

/**
 * Convierte el texto de un archivo en un Level utilizable, o falla con un
 * mensaje que se entienda.
 *
 * Existe porque abrir un archivo es el unico lugar donde entra al editor algo
 * que nadie valido: puede ser un JSON roto, o uno valido que no sea un nivel.
 * Sin este control, un archivo cualquiera dejaba la pantalla en blanco al
 * dibujar (draw() lee level.grid.tileWidth sin preguntar).
 *
 * Lo obligatorio es la grilla, que es de lo unico que no se puede inventar un
 * default razonable. El resto se completa: un nivel sin entidades o sin
 * eventos es perfectamente valido, solo que esta vacio.
 */
function parseLevel(contents: string, source: string): Level {
  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch {
    throw new Error(`"${source}" no es un JSON valido.`);
  }

  const data = raw as Partial<Level>;
  const grid = data?.grid;
  const isNumber = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
  if (
    !grid ||
    !isNumber(grid.width) ||
    !isNumber(grid.height) ||
    !isNumber(grid.tileWidth) ||
    !isNumber(grid.tileHeight)
  ) {
    throw new Error(`"${source}" no parece un nivel de HoneyComb: le falta "grid".`);
  }

  const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

  // Se parte del archivo ENTERO y se corrige encima solo lo que el editor
  // necesita en una forma dada. Antes se copiaba campo por campo, y cada campo
  // que se agregaba al schema sin agregarlo aca se perdia al reabrir y guardar
  // (asi se perdieron "camera", "backgroundImage" y "floorPaint"). Ahora un
  // campo que el editor no conoce viaja tal cual hasta el disco.
  return {
    ...data,
    name: typeof data.name === 'string' ? data.name : 'nivel',
    grid,
    entities: Array.isArray(data.entities) ? data.entities : [],
    events: Array.isArray(data.events) ? data.events : [],
    // Los bloques opcionales se descartan si no tienen la forma que el editor
    // lee: uno roto haria fallar el inspector, y el motor tampoco lo usaria.
    camera: isObject(data.camera) ? data.camera : undefined,
    backgroundImage:
      isObject(data.backgroundImage) && typeof data.backgroundImage.texture === 'string'
        ? data.backgroundImage
        : undefined,
    floorPaint: Array.isArray(data.floorPaint) ? data.floorPaint : undefined,
    zones: Array.isArray(data.zones) ? data.zones : undefined,
    items: Array.isArray(data.items) ? data.items.map((item) => normalizeItem(item)) : undefined,
  };
}

// Unico punto de contacto entre Angular y la API de proyecto que expone
// preload.js. Ningun componente debe llamar window.honeycombProject
// directamente -- todo pasa por aca, para que el resto del editor trabaje
// con tipos (Level, EventCatalog) en vez de strings/JSON crudo.
@Injectable({ providedIn: 'root' })
export class ProjectService {
  /**
   * La carpeta del editor, que es la raiz del proyecto (ver
   * ipc/project-root.js). Null solo hasta que el editor termina de arrancar.
   */
  readonly projectRoot = signal<string | null>(null);

  /** Pregunta cual es la carpeta del editor, y que se copio a ella si se creo recien. */
  async workspaceInfo(): Promise<WorkspaceInfo> {
    const info = await window.honeycombProject.workspaceInfo();
    this.projectRoot.set(info.root);
    return info;
  }

  /** Elige otra carpeta del editor con el dialogo. Null si se cancelo. */
  async changeWorkspace(): Promise<string | null> {
    const root = await window.honeycombProject.changeWorkspace();
    if (root) {
      this.projectRoot.set(root);
      // Las rutas son relativas a la carpeta: lo conocido de la anterior no
      // dice nada de los archivos de esta.
      this.knownText.clear();
    }
    return root;
  }

  /** Abre la carpeta del editor en el explorador de archivos del sistema. */
  async revealWorkspace(): Promise<void> {
    return window.honeycombProject.revealWorkspace();
  }

  /**
   * Archivo › Nuevo proyecto: una carpeta vacia con la estructura y las
   * imagenes basicas, que pasa a ser la carpeta del editor. Null si se cancelo.
   */
  async createProject(): Promise<{ root: string; copied: string[] } | null> {
    const created = await window.honeycombProject.createProject();
    if (created) {
      this.projectRoot.set(created.root);
      this.knownText.clear();
    }
    return created;
  }

  /** Copia sonidos elegidos con el dialogo a assets/sounds/ (ver ipc/sounds.js). */
  async importSounds(): Promise<SoundImportResult> {
    return window.honeycombProject.importSounds();
  }

  /**
   * Lo que el motor rechazaria del nivel guardado en "fileName", segun
   * schema/level.schema.json. Se revisa el texto que el editor acaba de
   * escribir, sin volver a leerlo. Vacio = cumple el contrato.
   */
  async checkSavedLevel(relativePath: string): Promise<string[]> {
    const contents = this.knownText.get(relativePath);
    return contents ? window.honeycombProject.checkLevel(contents) : [];
  }

  // --- Guardado automatico (ver ipc/recovery.js) ------------------------------

  async writeRecovery(payload: RecoveryPayload): Promise<void> {
    return window.honeycombProject.writeRecovery(payload);
  }

  /**
   * La copia del guardado automatico, con el nivel ya revisado como al abrir
   * un archivo. Null si no hay, o si lo que hay no es un nivel que se pueda abrir.
   */
  async readRecovery(): Promise<{ level: Level; fileName: string | null; openedPath: string | null; savedAt: string } | null> {
    const data = await window.honeycombProject.readRecovery();
    if (!data) {
      return null;
    }
    try {
      const level = parseLevel(JSON.stringify(data.level), 'la copia de recuperación');
      const fileName = typeof data.fileName === 'string' && data.fileName ? data.fileName : null;
      const openedPath = typeof data.openedPath === 'string' && data.openedPath ? data.openedPath : null;
      return { level, fileName, openedPath, savedAt: data.savedAt };
    } catch {
      return null;
    }
  }

  async clearRecovery(): Promise<void> {
    return window.honeycombProject.clearRecovery();
  }

  /** Crea una carpeta dentro de la carpeta del editor. Falla si ya existe. */
  async createDir(relativePath: string): Promise<void> {
    return window.honeycombProject.createDir(relativePath);
  }

  // Las rutas de abajo ("levels/", "assets/textures/") son la convencion de
  // carpetas de un proyecto HoneyComb, relativas a la carpeta del editor:
  // main.js las resuelve contra ella y rechaza cualquiera que se salga.

  /** Nombres de archivo de los niveles del proyecto (solo .json). */
  async listLevels(): Promise<string[]> {
    const names = await window.honeycombProject.listDir('levels');
    return names.filter((name) => name.endsWith('.json'));
  }

  /**
   * Todos los niveles del proyecto, tambien los de subcarpetas de levels/
   * (hasta tres niveles), como ruta relativa completa: "levels/a.json",
   * "levels/mundo2/b.json". Para lo que tiene que recorrer el juego entero.
   */
  async listLevelPaths(): Promise<string[]> {
    const paths: string[] = [];
    // Primero los de cada carpeta y despues sus subcarpetas, como listTextures().
    const walk = async (dir: string, depth: number): Promise<void> => {
      const entries = await window.honeycombProject.listEntries(dir);
      for (const entry of entries) {
        if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.json')) {
          paths.push(entry.path);
        }
      }
      for (const entry of entries) {
        if (entry.kind === 'dir' && depth < 3) {
          await walk(entry.path, depth + 1);
        }
      }
    };
    await walk('levels', 0);
    return paths;
  }

  /**
   * Cambia un nivel del disco sin abrirlo en el editor: lee el JSON tal cual,
   * "change" lo modifica en su lugar y devuelve si cambio algo, y solo entonces
   * se escribe. Se toca el JSON crudo y no un Level ya normalizado, para que el
   * archivo quede igual salvo lo que se cambio (el diff en git es solo eso).
   * Devuelve si se escribio. Un archivo que no es un objeto JSON se deja como esta.
   */
  async rewriteLevelJson(relativePath: string, change: (raw: Record<string, unknown>) => boolean): Promise<boolean> {
    const contents = await window.honeycombProject.readFile(relativePath);
    this.knownText.set(relativePath, contents);
    let raw: unknown;
    try {
      raw = JSON.parse(contents);
    } catch {
      return false;
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !change(raw as Record<string, unknown>)) {
      return false;
    }
    await this.writeChecked(relativePath, JSON.stringify(raw, null, 2), false, (path) => new LevelChangedOnDiskError(path));
    return true;
  }

  async readLevel(fileName: string): Promise<Level> {
    return this.readLevelAt(`levels/${fileName}`);
  }

  /**
   * Igual que readLevel(), pero con la ruta relativa completa dentro del
   * proyecto. Lo usa el organizador de archivos, que abre el .json donde sea
   * que este y no solo el nivel de arriba de levels/.
   */
  async readLevelAt(relativePath: string): Promise<Level> {
    const contents = await window.honeycombProject.readFile(relativePath);
    const level = parseLevel(contents, relativePath);
    this.knownText.set(relativePath, contents);
    return level;
  }

  /**
   * Contenido de una carpeta del proyecto, para el explorador. Se piden de a
   * una, al desplegarla: ver el comentario del handler en main.js.
   */
  async listEntries(relativeDir: string): Promise<ProjectNode[]> {
    return window.honeycombProject.listEntries(relativeDir);
  }

  /** Lee un archivo cualquiera del proyecto para mirarlo en el visor. */
  async readFileData(relativePath: string): Promise<ProjectFileData> {
    return window.honeycombProject.readFileData(relativePath);
  }

  // Importar imagenes: el convertidor, en tres pasos porque el ajuste de tamano
  // lo hace la UI (ver ipc/convert.js).

  async beginConvert(from: ConvertSource): Promise<ConvertSession | null> {
    return window.honeycombProject.beginConvert(from);
  }

  async readConvertImage(index: number): Promise<string> {
    return window.honeycombProject.readConvertImage(index);
  }

  async writeConvertedImage(index: number, pngBase64: string | null): Promise<{ target: string }> {
    return window.honeycombProject.writeConvertedImage(index, pngBase64);
  }

  async resetConvert(): Promise<void> {
    return window.honeycombProject.resetConvert();
  }

  /** El PNG de la herramienta de sprites, a assets/textures/ (ver ipc/textures.js). */
  async writeTexture(name: string, pngBase64: string, overwrite: boolean): Promise<TextureWriteResult> {
    return window.honeycombProject.writeTexture(name, pngBase64, overwrite);
  }

  /**
   * Abre un nivel eligiendo el ARCHIVO con el dialogo del sistema, en vez de
   * elegirlo del desplegable del proyecto.
   *
   * El dialogo arranca en levels/, pero se puede elegir un .json de cualquier
   * parte: ese se importa (se copia a levels/ con sus texturas y sonidos) y lo
   * que vuelve es la copia. "relativePath" es siempre relativa a la carpeta del
   * editor. Null si se cancelo.
   */
  async openLevelFile(): Promise<{ relativePath: string; level: Level; imported?: LevelImport } | null> {
    const result = await window.honeycombProject.open();
    if (result.canceled) {
      return null;
    }
    const level = parseLevel(result.contents, result.relativePath);
    this.knownText.set(result.relativePath, result.contents);
    return { relativePath: result.relativePath, level, imported: result.imported };
  }

  /**
   * Lo ultimo que el editor leyo o escribio de cada archivo que guarda (los
   * niveles y las bibliotecas), tal cual estaba en el disco, por ruta relativa.
   * null = cuando se leyo, no existia. Es lo que permite darse cuenta, al
   * guardar, de que el archivo cambio por fuera desde entonces (ver writeChecked).
   */
  private readonly knownText = new Map<string, string | null>();

  /**
   * Escribe un archivo del proyecto sin pisar cambios hechos por fuera.
   *
   * Si el editor ya conocia ese archivo (lo leyo o lo guardo antes) y en el
   * disco ya no esta igual, NO lo pisa: falla con FileChangedOnDiskError (o
   * "changedError", para el nivel). Lo pudo cambiar otro programa, una copia
   * del proyecto o un "git pull", y guardar sin mirar borraria ese trabajo. Con
   * overwrite se escribe igual: la persona eligio reemplazarlo, y la version
   * del disco queda en .bak (ver ipc/safe-write.js).
   *
   * Un archivo que ya no esta no se pierde por escribirlo de nuevo, asi que
   * eso no cuenta como cambio. Uno que no existia y ahora si, cuenta.
   */
  private async writeChecked(
    relativePath: string,
    contents: string,
    overwrite: boolean,
    changedError: (path: string) => FileChangedOnDiskError = (path) => new FileChangedOnDiskError(path),
  ): Promise<void> {
    const known = this.knownText.get(relativePath);
    if (known !== undefined && !overwrite) {
      const onDisk = await this.readTextIfExists(relativePath);
      if (onDisk !== null && onDisk !== known) {
        throw changedError(relativePath);
      }
    }
    await window.honeycombProject.writeFile(relativePath, contents);
    this.knownText.set(relativePath, contents);
  }

  /**
   * Lee un archivo de biblioteca y lo anota como conocido. null si no existe
   * (que tambien se anota: si aparece por fuera antes de guardar, se pregunta).
   */
  private async readKnown(relativePath: string): Promise<string | null> {
    const contents = await this.readTextIfExists(relativePath);
    this.knownText.set(relativePath, contents);
    return contents;
  }

  /**
   * Guarda un nivel en levels/.
   *
   * Si el editor ya conocia ese archivo (lo abrio o lo guardo antes) y en el
   * disco ya no esta igual, NO lo pisa: falla con LevelChangedOnDiskError. Lo
   * pudo cambiar otro programa, una copia del proyecto o un "git pull", y
   * guardar sin mirar borraria ese trabajo. Con overwrite se escribe igual
   * (la persona eligio reemplazarlo; la version del disco queda en .bak).
   *
   * Indentado a 2 espacios y no minificado: el JSON del nivel se versiona en
   * git, y asi un cambio se lee como un diff entendible en vez de una sola
   * linea gigante.
   */
  async saveLevel(fileName: string, level: Level, options: { overwrite?: boolean } = {}): Promise<void> {
    await this.saveLevelAt(`levels/${fileName}`, level, options);
  }

  /** Igual que saveLevel(), con la ruta relativa completa (un nivel de una subcarpeta de levels/). */
  async saveLevelAt(relativePath: string, level: Level, options: { overwrite?: boolean } = {}): Promise<void> {
    const contents = JSON.stringify(level, null, 2);
    await this.writeChecked(relativePath, contents, !!options.overwrite, (path) => new LevelChangedOnDiskError(path));
  }

  /** El texto de un archivo del proyecto, o null si no existe. */
  private async readTextIfExists(relativePath: string): Promise<string | null> {
    try {
      return await window.honeycombProject.readFile(relativePath);
    } catch (error) {
      if (String(error).includes('ENOENT')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * La raiz del proyecto, que es siempre la carpeta del editor. Lo usa lo que
   * necesita escribir en el proyecto antes de que termine de arrancar.
   */
  async ensureRoot(): Promise<string | null> {
    const root = await window.honeycombProject.ensureRoot();
    if (root) {
      this.projectRoot.set(root);
    }
    return root;
  }

  /**
   * Personajes configurados del proyecto. Un proyecto que todavia no guardo
   * ninguno no tiene el archivo, y eso es una lista vacia, no un error. Otro
   * fallo de lectura SI se informa: tratarlo como vacio haria que el proximo
   * guardado pise un archivo que solo no se pudo leer.
   */
  async readCharacterPresets(): Promise<CharacterPreset[]> {
    const contents = await this.readKnown(CHARACTERS_FILE);
    if (contents === null) {
      return [];
    }

    let raw: unknown;
    try {
      raw = JSON.parse(contents);
    } catch {
      throw new Error(`${CHARACTERS_FILE} no es un JSON valido.`);
    }
    const list = (raw as { presets?: unknown } | null)?.presets;
    return Array.isArray(list) ? list.map((preset) => normalizePreset(preset)) : [];
  }

  /** Falla con FileChangedOnDiskError si characters.json cambio por fuera, salvo con overwrite. */
  async writeCharacterPresets(presets: CharacterPreset[], options: { overwrite?: boolean } = {}): Promise<void> {
    await this.writeChecked(CHARACTERS_FILE, JSON.stringify({ presets }, null, 2), !!options.overwrite);
  }

  /**
   * Biblioteca de objetos del proyecto. Igual que los personajes: sin archivo
   * es una lista vacia, y cualquier otro fallo se informa para que el proximo
   * guardado no pise un archivo que solo no se pudo leer.
   */
  async readItemLibrary(): Promise<ItemDef[]> {
    const contents = await this.readKnown(ITEMS_FILE);
    if (contents === null) {
      return [];
    }

    let raw: unknown;
    try {
      raw = JSON.parse(contents);
    } catch {
      throw new Error(`${ITEMS_FILE} no es un JSON valido.`);
    }
    const list = (raw as { items?: unknown } | null)?.items;
    return Array.isArray(list) ? list.map((item) => normalizeItem(item)) : [];
  }

  /** Falla con FileChangedOnDiskError si items.json cambio por fuera, salvo con overwrite. */
  async writeItemLibrary(items: ItemDef[], options: { overwrite?: boolean } = {}): Promise<void> {
    await this.writeChecked(ITEMS_FILE, JSON.stringify({ items }, null, 2), !!options.overwrite);
  }

  /**
   * La configuracion del juego (game.json). Sin archivo es la de siempre, y
   * "exists" dice si lo habia. Un JSON roto SI se informa, por lo mismo que
   * characters.json: tratarlo como vacio haria que guardar pise lo que habia.
   */
  async readGameConfig(): Promise<{ config: GameConfig; exists: boolean }> {
    const contents = await this.readKnown(GAME_FILE);
    if (contents === null) {
      return { config: normalizeGameConfig(undefined), exists: false };
    }
    try {
      return { config: normalizeGameConfig(JSON.parse(contents)), exists: true };
    } catch {
      throw new Error(`${GAME_FILE} no es un JSON valido.`);
    }
  }

  /** Falla con FileChangedOnDiskError si game.json cambio por fuera, salvo con overwrite. */
  async writeGameConfig(config: GameConfig, options: { overwrite?: boolean } = {}): Promise<void> {
    await this.writeChecked(GAME_FILE, JSON.stringify(gameConfigForDisk(config), null, 2), !!options.overwrite);
  }

  /**
   * La partida guardada del motor, si hay: en que nivel quedo. Solo se lee
   * para mostrarlo; la escribe el juego, nunca el editor.
   */
  async readSaveInfo(): Promise<{ level: string } | null> {
    try {
      const raw = JSON.parse(await window.honeycombProject.readFile(SAVE_FILE)) as { level?: unknown };
      return { level: typeof raw?.level === 'string' ? raw.level : '' };
    } catch {
      return null;
    }
  }

  /** Borra la partida guardada, para probar el juego desde cero. */
  async clearSave(): Promise<void> {
    await window.honeycombProject.clearSave();
  }

  /** Exporta el juego para Windows (ver ipc/export.js). La carpeta la elige el dialogo del sistema. */
  async exportGame(startLevel: string | null): Promise<GameExportResult> {
    return window.honeycombProject.exportGame(startLevel);
  }

  /** Muestra la ultima exportacion en el explorador de archivos. */
  async revealExport(): Promise<void> {
    return window.honeycombProject.revealExport();
  }

  /** El catalogo de eventos es del programa: se lee de la instalacion, no de la carpeta del editor. */
  async readEventCatalog(): Promise<EventCatalog> {
    const contents = await window.honeycombProject.readEventCatalog();
    return JSON.parse(contents) as EventCatalog;
  }

  /**
   * Lanza el runtime con un nivel ya guardado en disco.
   *
   * Se le pasa la ruta del NIVEL, no la del motor: el proceso principal deduce
   * de ella donde esta engine.exe, con la misma convencion de carpetas que usa
   * el propio motor para encontrar los assets. "mode" elige cual de los dos
   * motores (ver ipc/engine-modes.js).
   */
  async runLevel(levelPath: string, mode: EngineMode, start: EngineStart = 'level'): Promise<EngineRunResult> {
    return window.honeycombProject.run(levelPath, mode, start);
  }

  /** Que motores estan compilados. */
  async engineStatus(): Promise<Record<EngineMode, boolean>> {
    return window.honeycombProject.engineStatus();
  }

  /**
   * Compila el motor de un modo. Cada linea de la salida de CMake llega a
   * onLine mientras dura; al terminar se deja de escuchar.
   */
  async buildEngine(
    mode: EngineMode,
    onLine: (line: string) => void,
  ): Promise<{ ok: boolean; error?: string }> {
    const stop = window.honeycombProject.onEngineBuildLog(onLine);
    try {
      return await window.honeycombProject.buildEngine(mode);
    } finally {
      stop();
    }
  }

  /**
   * Imagenes de assets/textures/, que son las que aparecen en el panel
   * Recursos. Tambien las de sus subcarpetas, con la carpeta en el nombre
   * ("presentacion/piso_pasto.png"): el nivel las guarda igual, como
   * "textures/presentacion/piso_pasto.png", y el motor las encuentra. Antes
   * solo se listaba la carpeta de arriba, y lo de una subcarpeta no se podia
   * elegir en ningun lado. Primero las de cada carpeta y despues sus
   * subcarpetas, hasta tres niveles.
   */
  async listTextures(): Promise<string[]> {
    const names: string[] = [];
    const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
      const entries = await window.honeycombProject.listEntries(dir);
      for (const entry of entries) {
        if (entry.kind === 'file' && /\.(png|jpg|jpeg|gif)$/i.test(entry.name)) {
          names.push(prefix + entry.name);
        }
      }
      if (depth >= 3) {
        return;
      }
      for (const entry of entries) {
        if (entry.kind === 'dir') {
          await walk(entry.path, prefix + entry.name + '/', depth + 1);
        }
      }
    };
    await walk('assets/textures', '', 0);
    return names;
  }

  /**
   * Los audios de assets/ (OGG, MP3, WAV), con su ruta relativa a assets/
   * ("sounds/tema.ogg"), que es como los guarda game.json y como los busca
   * el motor. Se recorre assets/ entero hasta tres niveles: la musica no
   * tiene una carpeta obligatoria.
   */
  async listSounds(): Promise<string[]> {
    const names: string[] = [];
    const walk = async (dir: string, prefix: string, depth: number): Promise<void> => {
      const entries = await window.honeycombProject.listEntries(dir);
      for (const entry of entries) {
        if (entry.kind === 'file' && /\.(ogg|mp3|wav)$/i.test(entry.name)) {
          names.push(prefix + entry.name);
        } else if (entry.kind === 'dir' && depth < 3) {
          await walk(entry.path, prefix + entry.name + '/', depth + 1);
        }
      }
    };
    await walk('assets', '', 0);
    return names;
  }
}
