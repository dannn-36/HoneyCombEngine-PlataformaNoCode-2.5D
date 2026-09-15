import { computed, inject, signal } from '@angular/core';

import type { ProjectFileData, ProjectNode } from '../electron-api';
import { LevelService } from '../services/level.service';
import { ProjectService } from '../services/project.service';

/**
 * Una fila del explorador de archivos ya aplanada: el nodo y a que profundidad
 * va sangrado. Ver rows().
 */
export interface TreeRow {
  node: ProjectNode;
  depth: number;
}

/** El archivo que se esta mirando en el visor, con su ruta. */
export interface OpenFile {
  path: string;
  data: ProjectFileData;
}

/**
 * El explorador de archivos del proyecto.
 *
 * Muestra la carpeta del proyecto entera, como el explorador de VS Code, y
 * deja ABRIR lo que encuentra: un nivel se carga en el viewport, una textura
 * queda elegida para colocar, y cualquier otro archivo se muestra en el visor
 * de abajo. Eso es lo que lo separa de una lista decorativa.
 *
 * Las carpetas se leen de a una, al desplegarlas (ver el handler en
 * ipc/files.js).
 *
 * Lo que NO decide el explorador se recibe por constructor: abrir un nivel
 * toca medio editor (encuadre, marca de sucio, ruta de Ejecutar) y elegir una
 * textura es cosa de la paleta. Aca solo se sabe QUE se clickeo.
 *
 * Es un controlador y no un componente por la misma razon que
 * ItemEditorController: el markup vive en app.html para usar los estilos de
 * App (ver el comentario de cabecera de app.ts).
 */
export class ExplorerController {
  private readonly project = inject(ProjectService);
  private readonly levels = inject(LevelService);

  /**
   * Hijos ya leidos de cada carpeta, indexados por su ruta ("" es la raiz del
   * proyecto). El arbol se llena de a una carpeta por vez, al desplegarla.
   */
  private readonly treeChildren = signal<Record<string, ProjectNode[]>>({});

  /**
   * Carpetas desplegadas. Aca se guardan las ABIERTAS -- al reves que los
   * paneles del inspector -- porque con carga perezosa abrir es la accion que
   * cuesta: lo que nadie desplego no se leyo del disco, y arrancar con todo
   * abierto significaria leer el proyecto entero.
   */
  private readonly expandedDirs = signal<Record<string, boolean>>({});

  /** El archivo que se esta mirando en el visor (workspace "archivo"). */
  readonly openFile = signal<OpenFile | null>(null);

  constructor(
    private readonly note: (message: string) => void,
    private readonly describe: (error: unknown) => string,
    private readonly openLevel: (node: ProjectNode) => Promise<void>,
    private readonly selectTexture: (name: string) => void,
    private readonly showFileWorkspace: () => void,
  ) {}

  /**
   * El arbol aplanado a filas con su profundidad, salteando lo que cuelga de
   * una carpeta cerrada.
   *
   * Se aplana aca en vez de dibujarlo recursivamente porque las plantillas de
   * Angular no tienen recursion: habria que montar un ng-template con
   * ngTemplateOutlet que se invoca a si mismo, mucha mas maquinaria que este
   * recorrido. De paso, la plantilla queda con un solo @for plano.
   */
  readonly rows = computed<TreeRow[]>(() => {
    const children = this.treeChildren();
    const expanded = this.expandedDirs();
    const rows: TreeRow[] = [];

    const walk = (parentPath: string, depth: number): void => {
      for (const node of children[parentPath] ?? []) {
        rows.push({ node, depth });
        if (node.kind === 'dir' && expanded[node.path]) {
          walk(node.path, depth + 1);
        }
      }
    };

    walk('', 0);
    return rows;
  });

  /**
   * Relee el proyecto desde la raiz y olvida lo que tenia cacheado, para que
   * aparezca lo que se creo o borro fuera del editor. Las carpetas que estaban
   * abiertas se vuelven a leer; las cerradas siguen sin costar nada.
   */
  async refreshTree(): Promise<void> {
    if (!this.project.projectRoot()) {
      this.note('No hay un proyecto abierto. Elige la carpeta raiz con "Carpeta...".');
      return;
    }
    try {
      const open = Object.keys(this.expandedDirs()).filter((path) => this.expandedDirs()[path]);
      const children: Record<string, ProjectNode[]> = { '': await this.project.listEntries('') };
      for (const path of open) {
        children[path] = await this.project.listEntries(path);
      }
      this.treeChildren.set(children);
      this.note('Proyecto releido: ' + this.project.projectRoot());
    } catch (error) {
      // La carpeta pudo haberse movido o borrado desde que se abrio.
      this.note('No se pudo leer el proyecto: ' + this.describe(error));
    }
  }

  /** Carga la raiz del arbol. Se llama al abrir una carpeta de proyecto. */
  async loadRoot(): Promise<void> {
    this.treeChildren.set({ '': await this.project.listEntries('') });
    this.expandedDirs.set({});
  }

  /**
   * Relee UNA carpeta si el explorador ya la tenia cargada. Se usa despues de
   * guardar, para que el nivel nuevo aparezca en la lista; si esa carpeta
   * nunca se desplego no hay nada que actualizar y no se toca el disco.
   */
  async reloadDir(path: string): Promise<void> {
    if (!this.treeChildren()[path]) {
      return;
    }
    const children = await this.project.listEntries(path);
    this.treeChildren.update((state) => ({ ...state, [path]: children }));
  }

  isDirExpanded(path: string): boolean {
    return this.expandedDirs()[path] === true;
  }

  /** true si esa fila es el nivel que esta abierto ahora, para marcarlo en la lista. */
  isOpenLevel(node: ProjectNode): boolean {
    const fileName = this.levels.fileName();
    return !!fileName && node.path.toLowerCase() === ('levels/' + fileName).toLowerCase();
  }

  /** true si es el archivo que se esta mirando en el visor. */
  isOpenFile(node: ProjectNode): boolean {
    return this.openFile()?.path === node.path;
  }

  /**
   * Glifo de la fila: la flecha de plegado si es carpeta, o un icono segun la
   * extension si es archivo. Los niveles y las imagenes llevan uno propio
   * porque son los dos tipos que el editor hace algo mas que mostrar.
   */
  treeGlyph(node: ProjectNode): string {
    if (node.kind === 'dir') {
      return this.isDirExpanded(node.path) ? '▾' : '▸';
    }
    if (/\.json$/i.test(node.name)) {
      return '◈';
    }
    if (/\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(node.name)) {
      return '▦';
    }
    return '·';
  }

  /**
   * Click sobre una fila. Una carpeta se abre o se cierra (leyendo su contenido
   * la primera vez); un archivo se abre con lo que corresponda a su tipo, y lo
   * que el editor no sabe editar se muestra igual en el visor -- que es el
   * punto de tener un explorador y no una lista de niveles.
   */
  async openTreeEntry(node: ProjectNode): Promise<void> {
    if (node.kind === 'dir') {
      await this.toggleDir(node);
      return;
    }

    if (/^levels\/.+\.json$/i.test(node.path)) {
      await this.openLevel(node);
      return;
    }

    // Solo las texturas de arriba de assets/textures/: lo que guarda
    // activeTexture es el nombre suelto, y en una subcarpeta perderia el camino.
    //
    // Ademas de elegirla se MUESTRA en el visor. Antes solo se elegia, y por
    // eso la pestana Archivo mostraba una imagen de cualquier otra carpeta pero
    // nunca las de texturas, que son justo las que uno quiere mirar.
    if (/^assets\/textures\/[^/]+\.(png|jpg|jpeg|gif)$/i.test(node.path)) {
      this.selectTexture(node.name);
      await this.viewFile(node);
      this.note('Textura activa: ' + node.name + '. Clic en la grilla para colocarla.');
      return;
    }

    await this.viewFile(node);
  }

  /** Abre o cierra una carpeta, leyendo su contenido la primera vez. */
  private async toggleDir(node: ProjectNode): Promise<void> {
    const open = this.isDirExpanded(node.path);
    this.expandedDirs.update((state) => ({ ...state, [node.path]: !open }));
    if (open || this.treeChildren()[node.path]) {
      return; // se cerro, o ya se habia leido antes
    }
    try {
      const children = await this.project.listEntries(node.path);
      this.treeChildren.update((state) => ({ ...state, [node.path]: children }));
    } catch (error) {
      this.note('No se pudo leer ' + node.path + ': ' + this.describe(error));
    }
  }

  /**
   * Muestra un archivo en el visor de abajo y trae esa workspace al frente.
   * El proceso principal decide si llega como texto, como imagen o si no se
   * puede mostrar (ver project:readFileData en ipc/files.js).
   */
  private async viewFile(node: ProjectNode): Promise<void> {
    try {
      const data = await this.project.readFileData(node.path);
      this.openFile.set({ path: node.path, data });
      this.showFileWorkspace();
      this.note(
        data.kind === 'binary'
          ? node.path + ': ' + this.fileSize(data.size) + ', no se puede mostrar aca.'
          : 'Mirando ' + node.path + ' (' + this.fileSize(data.size) + ').',
      );
    } catch (error) {
      this.note('No se pudo leer ' + node.path + ': ' + this.describe(error));
    }
  }

  closeOpenFile(): void {
    this.openFile.set(null);
  }

  /** Tamano legible para la cabecera del visor. */
  fileSize(bytes: number): string {
    if (bytes < 1024) {
      return bytes + ' B';
    }
    if (bytes < 1024 * 1024) {
      return Math.round(bytes / 1024) + ' KB';
    }
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  /** true si el archivo del visor es una imagen que no se muestra solo por su peso. */
  isTooLargeToPreview(file: OpenFile): boolean {
    return file.data.kind === 'binary' && file.data.reason === 'too-large';
  }
}
