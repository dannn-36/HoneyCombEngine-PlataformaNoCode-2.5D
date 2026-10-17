import { signal } from '@angular/core';

// Limites del ancho de los dos paneles laterales al arrastrar su borde. El
// minimo es lo que necesita una fila para no cortar todos los nombres; el
// maximo, dejarle al viewport la mitad de una pantalla chica.
const SIDEBAR_MIN_WIDTH = 170;
const SIDEBAR_MAX_WIDTH = 560;
// Elegidos para 1366x768: con 220 + 280 al viewport le quedan ~860px.
const SIDEBAR_DEFAULT_WIDTH = 220;
const INSPECTOR_DEFAULT_WIDTH = 280;

// El dock de abajo (recursos, eventos, consola, archivo). El minimo deja ver
// una fila de fichas; el maximo, que el viewport nunca quede mas chico que el
// dock.
const DOCK_MIN_HEIGHT = 120;
const DOCK_DEFAULT_HEIGHT = 200;
/** Lo que mide la barra de estado, que va debajo del dock. */
const STATUSBAR_HEIGHT = 24;

type ResizablePanel = 'sidebar' | 'inspector' | 'dock';

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
  readonly dockHeight = signal(DOCK_DEFAULT_HEIGHT);
  /** Plegado, el dock queda en su fila de pestañas y el viewport gana el alto. */
  readonly dockOpen = signal(true);

  /** Que borde se esta arrastrando, si alguno. La plantilla lo usa para resaltarlo. */
  private readonly resizing = signal<ResizablePanel | null>(null);

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

  toggleDock(): void {
    this.dockOpen.update((open) => !open);
  }

  isResizing(panel: ResizablePanel): boolean {
    return this.resizing() === panel;
  }

  onResizeStart(panel: ResizablePanel, event: PointerEvent): void {
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
    // El dock crece hacia arriba: su alto es lo que hay del cursor a la barra
    // de estado. El tope es la mitad de la ventana.
    if (panel === 'dock') {
      const height = window.innerHeight - STATUSBAR_HEIGHT - event.clientY;
      const max = Math.round(window.innerHeight / 2);
      this.dockHeight.set(Math.min(max, Math.max(DOCK_MIN_HEIGHT, Math.round(height))));
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

  /**
   * Un panel del inspector esta plegado si figura en el mapa como true. Los
   * que no figuran usan su valor de entrada: abiertos, salvo los de opciones
   * avanzadas, que se piden con collapsedByDefault.
   */
  isCollapsed(id: string, collapsedByDefault = false): boolean {
    return this.collapsedPanels()[id] ?? collapsedByDefault;
  }

  togglePanel(id: string, collapsedByDefault = false): void {
    this.collapsedPanels.update((state) => ({ ...state, [id]: !(state[id] ?? collapsedByDefault) }));
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

  /** Alto de la fila del dock en el grid de la ventana. Plegado, solo sus pestañas. */
  dockRow(): string {
    return this.dockOpen() ? this.dockHeight() + 'px' : 'auto';
  }
}
