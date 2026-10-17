import { Injectable, signal } from '@angular/core';

import { normalizePreset } from '../core/characters';
import { normalizeItem } from '../core/items';
import type {
  ConvertSession,
  ConvertSource,
  LevelImport,
  ProjectFileData,
  ProjectNode,
  TextureWriteResult,
  WorkspaceInfo,
} from '../electron-api';
import { CharacterPreset } from '../models/character-preset.model';
import { ItemDef } from '../models/item.model';

/** Archivo del proyecto con los personajes configurados, junto a levels/ y assets/. */
export const CHARACTERS_FILE = 'characters.json';
/** Archivo del proyecto con la biblioteca de objetos (armas, curaciones, monedas). */
export const ITEMS_FILE = 'items.json';
import { EventCatalog } from '../models/event-catalog.model';
import { Level } from '../models/level.model';

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

  return {
    name: typeof data.name === 'string' ? data.name : 'nivel',
    // Faltaba: abrir un nivel y volver a guardarlo le borraba el color de fondo.
    backgroundColor: data.backgroundColor,
    grid,
    entities: Array.isArray(data.entities) ? data.entities : [],
    events: Array.isArray(data.events) ? data.events : [],
    visuals: data.visuals,
    tiles: data.tiles,
    // Sin estas tres, abrir un nivel con mapa y volver a guardarlo borraria
    // sus salas y tuneles, dejando solo las celdas ya calculadas.
    rooms: data.rooms,
    tunnels: data.tunnels,
    tileEdits: data.tileEdits,
    // Y sin estas dos, las zonas de los puzzles y los objetos que usa el nivel.
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
    }
    return root;
  }

  /** Abre la carpeta del editor en el explorador de archivos del sistema. */
  async revealWorkspace(): Promise<void> {
    return window.honeycombProject.revealWorkspace();
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
    return parseLevel(contents, relativePath);
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
    return {
      relativePath: result.relativePath,
      level: parseLevel(result.contents, result.relativePath),
      imported: result.imported,
    };
  }

  // Indentado a 2 espacios y no minificado: el JSON del nivel se versiona en
  // git, y asi un cambio se lee como un diff entendible en vez de una sola
  // linea gigante.
  async saveLevel(fileName: string, level: Level): Promise<void> {
    await window.honeycombProject.writeFile(`levels/${fileName}`, JSON.stringify(level, null, 2));
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
    let contents: string;
    try {
      contents = await window.honeycombProject.readFile(CHARACTERS_FILE);
    } catch (error) {
      if (String(error).includes('ENOENT')) {
        return [];
      }
      throw error;
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

  async writeCharacterPresets(presets: CharacterPreset[]): Promise<void> {
    await window.honeycombProject.writeFile(CHARACTERS_FILE, JSON.stringify({ presets }, null, 2));
  }

  /**
   * Biblioteca de objetos del proyecto. Igual que los personajes: sin archivo
   * es una lista vacia, y cualquier otro fallo se informa para que el proximo
   * guardado no pise un archivo que solo no se pudo leer.
   */
  async readItemLibrary(): Promise<ItemDef[]> {
    let contents: string;
    try {
      contents = await window.honeycombProject.readFile(ITEMS_FILE);
    } catch (error) {
      if (String(error).includes('ENOENT')) {
        return [];
      }
      throw error;
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

  async writeItemLibrary(items: ItemDef[]): Promise<void> {
    await window.honeycombProject.writeFile(ITEMS_FILE, JSON.stringify({ items }, null, 2));
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
   * el propio motor para encontrar los assets.
   */
  async runLevel(levelPath: string): Promise<{ ok: boolean; executable?: string; error?: string }> {
    return window.honeycombProject.run(levelPath);
  }

  /** Imagenes de assets/textures/, que son las que aparecen en el panel Recursos. */
  async listTextures(): Promise<string[]> {
    const names = await window.honeycombProject.listDir('assets/textures');
    return names.filter((name) => /\.(png|jpg|jpeg|gif)$/i.test(name));
  }
}
