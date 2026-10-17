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
   * Lanza el runtime con el nivel de esa ruta absoluta. El ejecutable lo
   * localiza el proceso principal a partir de ella.
   */
  run(levelPath: string): Promise<{ ok: boolean; executable?: string; error?: string }>;
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
