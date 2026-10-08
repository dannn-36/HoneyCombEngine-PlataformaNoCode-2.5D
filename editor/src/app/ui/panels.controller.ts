import { signal } from '@angular/core';

// Limites del ancho de los dos paneles laterales al arrastrar su borde. El
// minimo es lo que necesita una fila para no cortar todos los nombres; el
// maximo, dejarle al viewport la mitad de una pantalla chica.
const SIDEBAR_MIN_WIDTH = 170;
const SIDEBAR_MAX_WIDTH = 560;
const SIDEBAR_DEFAULT_WIDTH = 230;
const INSPECTOR_DEFAULT_WIDTH = 290;

/**
 * La disposicion de la ventana: ancho y visibilidad de los paneles laterales,
 * y que paneles plegables estan plegados.
 *
 * Como en VS Code: se arrastra el borde interior de cada panel para cambiar su
 * ancho, y cada uno se esconde con su boton del topbar. Los anchos viven en
 * signals y la plantilla los inyecta en el grid-template-columns del cuerpo,
 * asi que no hace falta tocar el DOM a mano en ningun momento.
 *
 * No sabe nada del nivel abierto ni del proyecto: es puro estado de interfaz.
 * Por eso no inyecta ningun servicio y se puede construir con "new".
 *
 * Es un controlador y no un componente por la misma razon que
 * ItemEditorController: el markup vive en app.html para usar los estilos de
 * App (ver el comentario de cabecera de app.ts).
 */
export class PanelsController {
  readonly sidebarWidth = signal(SIDEBAR_DEFAULT_WIDTH);
  readonly sidebarVisible = signal(true);
  readonly inspectorWidth = signal(INSPECTOR_DEFAULT_WIDTH);
  readonly inspectorVisible = signal(true);

  /** Que borde se esta arrastrando, si alguno. La plantilla lo usa para resaltarlo. */
  private readonly resizing = signal<'sidebar' | 'inspector' | null>(null);

  /**
   * Paneles del inspector plegados, por id. Se guarda el conjunto de PLEGADOS y
   * no el de abiertos para que un panel nuevo aparezca desplegado sin tener que
   * inicializarlo en ningun lado.
   */
  private readonly collapsedPanels = signal<Record<string, boolean>>({});

  toggleSidebar(): void {
    this.sidebarVisible.update((visible) => !visible);
  }

  toggleInspector(): void {
    this.inspectorVisible.update((visible) => !visible);
  }

  /** Las columnas del cuerpo. Un panel escondido no ocupa columna: desaparece. */
  bodyColumns(): string {
    const columns: string[] = [];
    if (this.sidebarVisible()) {
      columns.push(this.sidebarWidth() + 'px');
    }
    columns.push('1fr');
    if (this.inspectorVisible()) {
      columns.push(this.inspectorWidth() + 'px');
    }
    return columns.join(' ');
  }

  isResizing(panel: 'sidebar' | 'inspector'): boolean {
    return this.resizing() === panel;
  }

  onResizeStart(panel: 'sidebar' | 'inspector', event: PointerEvent): void {
    event.preventDefault();
    this.resizing.set(panel);
    // Con captura el arrastre sigue aunque el cursor se vaya sobre el canvas,
    // que es justo lo que pasa al ensanchar un panel.
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
  }

  onResizeMove(event: PointerEvent): void {
    const panel = this.resizing();
    if (!panel) {
      return;
    }
    // No hace falta guardar donde arranco el gesto: cada panel esta pegado a un
    // borde de la ventana, asi que su ancho es la distancia del cursor a ese
    // borde. El izquierdo mide desde 0; el derecho, desde el ancho total.
    const width =
      panel === 'sidebar' ? event.clientX : window.innerWidth - event.clientX;
    const clamped = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
    if (panel === 'sidebar') {
      this.sidebarWidth.set(clamped);
    } else {
      this.inspectorWidth.set(clamped);
    }
  }

  onResizeEnd(event: PointerEvent): void {
    if (!this.resizing()) {
      return;
    }
    this.resizing.set(null);
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
  }

  /** Un panel del inspector esta plegado solo si figura en el mapa como true. */
  isCollapsed(id: string): boolean {
    return this.collapsedPanels()[id] === true;
  }

  togglePanel(id: string): void {
    this.collapsedPanels.update((state) => ({ ...state, [id]: !state[id] }));
  }

  /**
   * Despliega un panel, este como este. Lo usan las acciones que llevan a un
   * panel concreto (abrir el panel Mapa, cambiar de editor en la barra
   * izquierda, mostrar Recursos): de nada sirve llevar a alguien a un panel
   * que esta plegado.
   */
  expand(id: string): void {
    this.collapsedPanels.update((state) => ({ ...state, [id]: false }));
  }

  // Las secciones de la barra izquierda se pliegan con el mismo mapa que los
  // paneles del inspector, con ids "side-*". Plegada, una seccion queda en su
  // cabecera sola, como las vistas del explorador de VS Code.

  /**
   * Filas de la barra izquierda. Una seccion plegada mide lo que su cabecera,
   * y el alto que sobra va a la primera seccion abierta que lo aprovecha: la
   * escena o el explorador, o Recursos si esa esta plegada. Es el mismo reparto
   * que hace VS Code con sus vistas.
   */
  sidebarRows(): string {
    const mainOpen = !this.isCollapsed('side-main');
    const assetsOpen = !this.isCollapsed('side-assets');
    return [
      mainOpen ? 'minmax(0, 1fr)' : 'auto',
      !mainOpen && assetsOpen ? 'minmax(0, 1fr)' : 'auto',
      'auto',
      'auto',
      // Objetos
      'auto',
    ].join(' ');
  }
}
