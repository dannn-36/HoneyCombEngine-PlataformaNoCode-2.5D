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
  | { kind: 'audio'; size: number; dataUrl: string }
  | { kind: 'binary'; size: number; reason: 'too-large' | 'unsupported' };

/**
 * Lo que paso al importar un nivel suelto al proyecto abierto (ver
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

/**
 * Resultado de abrir un nivel con el dialogo. La ruta es relativa al proyecto
 * abierto. "project" esta si el nivel era de otro proyecto y el editor se
 * cambio a ese; "imported", si era un nivel suelto y se copio al abierto.
 */
export type OpenLevelResult =
  | { canceled: true }
  | { canceled: false; relativePath: string; contents: string; imported?: LevelImport; project?: ProjectInfo };

/**
 * Un proyecto abierto: su carpeta, su archivo .honey, el nombre del juego, y
 * el ultimo nivel que se edito en el (archivo de levels/), si se sabe.
 */
export interface ProjectInfo {
  root: string;
  file: string;
  name: string;
  lastLevel: string | null;
}

/**
 * Una fila de Proyectos recientes (ver ipc/project-root.js). "exists": la
 * carpeta sigue estando. "legacy": es de antes del .honey, y al abrirla se
 * ofrece convertirla.
 */
export interface RecentProject {
  root: string;
  name: string;
  lastLevel: string | null;
  openedAt: number;
  exists: boolean;
  legacy: boolean;
}

/**
 * El proyecto abierto (null: hay que elegir uno en Inicio), donde se crean
 * los proyectos nuevos, y por que no se pudo abrir el .honey con que se abrio
 * el editor, si paso.
 */
export interface WorkspaceInfo {
  project: ProjectInfo | null;
  location: string;
  error: string | null;
}

/** Un proyecto nuevo: el nombre del juego, y si es una copia del juego de ejemplo. */
export interface NewProjectOptions {
  name: string;
  example: boolean;
}

/** El proyecto recien creado, ya abierto, y lo que se copio de la instalacion. */
export interface CreatedProject {
  project: ProjectInfo;
  copied: string[];
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

/**
 * Lo que paso al importar sonidos (ver ipc/sounds.js). target es la ruta
 * relativa a assets/ (sounds/tema.ogg), como la guardan los niveles.
 */
export interface SoundImportResult {
  canceled: boolean;
  imported: { source: string; target: string; size: number }[];
  skipped: { source: string; reason: string }[];
}

/**
 * La copia del guardado automatico (ver ipc/recovery.js): el nivel sin
 * guardar, como estaba en el editor, y de que archivo era.
 */
export interface RecoveryPayload {
  /** El nivel en el editor, tal cual (no la forma en disco). */
  level: unknown;
  /** Archivo dentro de levels/, o null si el nivel nunca se guardo. */
  fileName: string | null;
  /** Ruta con que se abrio un nivel de una subcarpeta (ver ProjectController.lastSavedPath). */
  openedPath: string | null;
}

/** La copia leida del disco: lo que se mando, y cuando y en que carpeta se escribio. */
export interface RecoveryData extends RecoveryPayload {
  root: string;
  savedAt: string;
}

/** Lo que paso al guardar una textura de la herramienta de sprites. "target" es el nombre final, ya limpio. */
export interface TextureWriteResult {
  status: 'written' | 'exists';
  target: string;
}

export interface HoneycombProjectApi {
  /** Abre un nivel con el dialogo: uno de otro proyecto cambia a ese; uno suelto se importa a levels/. */
  open(): Promise<OpenLevelResult>;

  /** El proyecto abierto, si hay. */
  workspaceInfo(): Promise<WorkspaceInfo>;
  /** Los proyectos recientes, el ultimo primero. */
  recentProjects(): Promise<RecentProject[]>;
  /** Quita un proyecto de la lista de recientes (la carpeta no se toca). */
  forgetRecentProject(root: string): Promise<void>;
  /**
   * Abre un proyecto eligiendo su .honey con el dialogo (o un .json de un
   * juego de antes, que se ofrece convertir). Null si se cancelo.
   */
  openProject(): Promise<ProjectInfo | null>;
  /**
   * Vuelve a un proyecto reciente. Solo acepta los de la lista; si es de
   * antes del .honey pregunta si convertirlo (null si no). Falla con el
   * motivo si ya no existe.
   */
  openRecentProject(root: string): Promise<ProjectInfo | null>;
  /** Elige con el dialogo donde se crean los proyectos. Null si se cancelo. */
  chooseProjectsLocation(): Promise<string | null>;
  /** Crea un proyecto en la ubicacion de proyectos y lo deja abierto. */
  createProject(options: NewProjectOptions): Promise<CreatedProject>;
  /** Cierra el proyecto abierto: el editor queda sin proyecto. */
  closeProject(): Promise<void>;
  /** Anota el nivel que se esta editando (archivo de levels/) como el ultimo del proyecto. */
  rememberLevel(level: string): Promise<boolean>;
  /** Abre la carpeta del proyecto en el explorador del sistema. */
  revealWorkspace(): Promise<void>;
  /** Abre el .honey de un doble clic con el editor ya abierto (ver onOpenRequested). Null si no hay. */
  openRequestedProject(): Promise<ProjectInfo | null>;
  /** Avisa de un doble clic en un .honey con el editor abierto, con el nombre del archivo. */
  onOpenRequested(callback: (fileName: string) => void): () => void;
  /** schema/event_catalog.json de la instalacion. */
  readEventCatalog(): Promise<string>;
  /** La carpeta del proyecto abierto, o null si no hay. */
  ensureRoot(): Promise<string | null>;
  /** Crea una carpeta (relativa al proyecto). Falla si ya existe. */
  createDir(relativePath: string): Promise<void>;
  /** Ruta relativa al proyecto. */
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
  /** Copia sonidos elegidos con el dialogo a assets/sounds/ (ver ipc/sounds.js). */
  importSounds(): Promise<SoundImportResult>;

  /** Lo que el motor rechazaria del nivel (su texto, ya guardado), segun el schema. Vacio = nada. */
  checkLevel(contents: string): Promise<string[]>;

  /** Guarda la copia del nivel sin guardar (ver ipc/recovery.js). */
  writeRecovery(payload: RecoveryPayload): Promise<void>;
  /** La copia que haya del proyecto abierto, o null. */
  readRecovery(): Promise<RecoveryData | null>;
  /** Borra la copia: el nivel se guardo, o se eligio perder los cambios. */
  clearRecovery(): Promise<void>;

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

  /** Que motores estan compilados (ver ipc/engine-modes.js), y si se pueden compilar. */
  engineStatus(): Promise<EngineStatus>;
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

/**
 * Cuales motores estan compilados. "canBuild" es false en la app instalada:
 * trae los motores ya compilados y no tiene compilador (ver ipc/engine-build.js).
 */
export type EngineStatus = Record<EngineMode, boolean> & { canBuild?: boolean };

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
