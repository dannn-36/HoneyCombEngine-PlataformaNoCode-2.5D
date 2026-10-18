// Declara la API que preload.js expone via contextBridge, para que el
// codigo Angular la use con tipos en vez de "window as any".

/** Un archivo o una carpeta del proyecto, tal como los devuelve listEntries(). */
export interface ProjectNode {
  name: string;
  /** Ruta relativa a la raiz del proyecto, siempre con "/" (tambien en Windows). */
  path: string;
  kind: 'dir' | 'file';
}

/**
 * Un archivo leido para mirarlo en el visor. El proceso principal decide por
 * extension cual de las tres formas devuelve: "binary" es lo que el editor no
 * sabe mostrar (o lo que pesa demasiado) y solo trae el tamano.
 */
export type ProjectFileData =
  | { kind: 'text'; size: number; text: string; truncated: boolean }
  | { kind: 'image'; size: number; dataUrl: string }
  | { kind: 'binary'; size: number; reason: 'too-large' | 'unsupported' };

/**
 * Lo que paso al importar un nivel de fuera de la carpeta del editor (ver
 * ipc/levels.js): de donde vino, como se llama la copia en levels/, y que
 * assets se copiaron, ya estaban, o no se encontraron.
 */
export interface LevelImport {
  from: string;
  fileName: string;
  copied: number;
  kept: number;
  missing: string[];
}

/** Resultado de abrir un nivel con el dialogo. La ruta es relativa a la carpeta del editor. */
export type OpenLevelResult =
  | { canceled: true }
  | { canceled: false; relativePath: string; contents: string; imported?: LevelImport };

/** La carpeta del editor, y lo que se copio del repositorio si se creo recien. */
export interface WorkspaceInfo {
  root: string;
  seeded: string[];
}

/** De donde salen las imagenes del convertidor: un dialogo, o los JPG de assets/textures/. */
export type ConvertSource = 'files' | 'project-jpg';

/**
 * Una imagen agregada al convertidor. "index" es su lugar en el plan del
 * proceso principal, y "target" el nombre PNG limpio y libre que se le
 * reservo en assets/textures/. Ver ipc/convert.js.
 */
export interface ConvertItem {
  index: number;
  source: string;
  target: string;
  size: number;
}

/** Resultado de agregar imagenes al convertidor. Trae la raiz aunque se cancele. */
export type ConvertSession =
  | { projectRoot: string; canceled: true }
  | { projectRoot: string; canceled: false; items: ConvertItem[] };

/** Lo que paso al guardar una textura de la herramienta de sprites. "target" es el nombre final, ya limpio. */
export interface TextureWriteResult {
  status: 'written' | 'exists';
  target: string;
}

export interface HoneycombProjectApi {
  /** Abre un nivel con el dialogo; uno de afuera se importa a levels/. */
  open(): Promise<OpenLevelResult>;

  /** La carpeta del editor. */
  workspaceInfo(): Promise<WorkspaceInfo>;
  /** Elige otra carpeta del editor con un dialogo y la recuerda. Null si se cancelo. */
  changeWorkspace(): Promise<string | null>;
  /** Abre la carpeta del editor en el explorador del sistema. */
  revealWorkspace(): Promise<void>;
  /** schema/event_catalog.json de la instalacion. */
  readEventCatalog(): Promise<string>;
  /** La raiz del proyecto, que es siempre la carpeta del editor. */
  ensureRoot(): Promise<string | null>;
  /** Crea una carpeta (relativa a la carpeta del editor). Falla si ya existe. */
  createDir(relativePath: string): Promise<void>;
  /** Ruta relativa a la carpeta del editor. */
  readFile(relativePath: string): Promise<string>;
  writeFile(relativePath: string, contents: string): Promise<void>;
  /** Lista los nombres de archivo (no subcarpetas) dentro de una carpeta relativa a la raiz del proyecto. */
  listDir(relativeDir: string): Promise<string[]>;
  /** Contenido de UNA carpeta del proyecto (carpetas primero). Vacio si no hay proyecto abierto. */
  listEntries(relativeDir: string): Promise<ProjectNode[]>;
  /** Lee un archivo del proyecto para mostrarlo en el visor. */
  readFileData(relativePath: string): Promise<ProjectFileData>;
  /** Agrega imagenes al plan del convertidor (la unica forma de importarlas). */
  beginConvert(from: ConvertSource): Promise<ConvertSession | null>;
  /** El original de una imagen del convertidor, como data URL. */
  readConvertImage(index: number): Promise<string>;
  /** Escribe el PNG de una imagen del convertidor. null = copiar el original (solo PNG). */
  writeConvertedImage(index: number, pngBase64: string | null): Promise<{ target: string }>;
  /** Olvida el plan del convertidor (al cerrar su ventana). */
  resetConvert(): Promise<void>;
  /**
   * Escribe un PNG de la herramienta de sprites en assets/textures/. El nombre
   * se limpia y termina en .png. Sin overwrite, un nombre ocupado no se pisa y
   * vuelve "exists".
   */
  writeTexture(name: string, pngBase64: string, overwrite: boolean): Promise<TextureWriteResult>;

  /**
   * Lanza el runtime con el nivel de esa ruta absoluta, con el motor del modo
   * elegido. El ejecutable lo localiza el proceso principal. "missing" dice que
   * ese motor no esta compilado, y que se puede compilar con buildEngine.
   * "start" elige donde arranca: en el nivel, o en la portada de game.json.
   */
  run(levelPath: string, mode: EngineMode, start: EngineStart): Promise<EngineRunResult>;

  /** Borra la partida guardada del juego (saves/partida.json). Sin partida no hace nada. */
  clearSave(): Promise<void>;

  /**
   * Exporta el juego para Windows (ver ipc/export.js): pide la carpeta con el
   * dialogo del sistema y arma ahi la carpeta del juego y su .zip. "startLevel"
   * es el nivel inicial (archivo dentro de levels/); sin el, el de game.json.
   */
  exportGame(startLevel: string | null): Promise<GameExportResult>;
  /** Muestra la ultima exportacion en el explorador de archivos. */
  revealExport(): Promise<void>;

  /** Que motores estan compilados (ver ipc/engine-modes.js). */
  engineStatus(): Promise<Record<EngineMode, boolean>>;
  /** Compila el motor de un modo con CMake. La salida llega por onEngineBuildLog. */
  buildEngine(mode: EngineMode): Promise<{ ok: boolean; executable?: string | null; error?: string }>;
  /** Escucha la salida de la compilacion, de a una linea. Devuelve como dejar de escucharla. */
  onEngineBuildLog(callback: (line: string) => void): () => void;
}

/**
 * Como termino una exportacion. "canceled": se cerro el dialogo. "missing": el
 * motor Release no esta compilado (se puede compilar con buildEngine). Con ok,
 * donde quedo y lo que le falta al juego (imagenes o niveles que no estan).
 */
export interface GameExportResult {
  ok: boolean;
  canceled?: boolean;
  missing?: boolean;
  error?: string;
  folder?: string;
  zip?: string;
  exe?: string;
  files?: number;
  zipBytes?: number;
  warnings?: string[];
}

/**
 * Con que motor se ejecuta: "debug" es la version de desarrollo (sin optimizar,
 * con las herramientas de F3) y "release" la optimizada, la que se juega.
 */
export type EngineMode = 'debug' | 'release';

/**
 * Donde arranca el juego: "level" directo en el nivel (probar lo que se esta
 * editando) o "title" en la portada, como el juego terminado.
 */
export type EngineStart = 'level' | 'title';

export interface EngineRunResult {
  ok: boolean;
  executable?: string;
  error?: string;
  missing?: boolean;
}

/** Control de la ventana, para lo que antes daba el menu nativo de Electron. */
export interface HoneycombWindowApi {
  toggleDevTools(): Promise<void>;
}

declare global {
  interface Window {
    honeycombProject: HoneycombProjectApi;
    honeycombWindow: HoneycombWindowApi;
  }
}
