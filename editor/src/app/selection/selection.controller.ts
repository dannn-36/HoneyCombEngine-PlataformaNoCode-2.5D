import { computed, inject } from '@angular/core';

import { LevelService } from '../services/level.service';
import { SelectionService } from '../services/selection.service';

/**
 * Los GESTOS de seleccion: click, Shift/Ctrl+click, rango del outliner y
 * seleccionar todo.
 *
 * SelectionService guarda que ids estan seleccionados y en que orden; esto
 * traduce lo que hizo el usuario a cambios en esa lista. Son dos cosas
 * distintas a proposito: el servicio no sabe de teclas modificadoras ni de
 * outliners, y este controlador no guarda estado propio.
 *
 * Seleccionar algo trae al frente la pestana "objeto" del inspector, porque
 * seleccionar y que el inspector siga mostrando la escena seria un click
 * perdido. Eso lo resuelve App: se recibe por constructor.
 */
export class SelectionController {
  private readonly selection = inject(SelectionService);
  private readonly levels = inject(LevelService);

  /** Los ids seleccionados como conjunto, para preguntar "esta?" sin recorrer la lista. */
  readonly selectedSet = computed(() => new Set(this.selection.selectedEntityIds()));

  private readonly entityIds = computed(() => this.levels.level().entities.map((entity) => entity.id));

  constructor(private readonly showObjectTab: () => void) {}

  /**
   * Selecciona una entidad y trae al frente la pestana de propiedades del
   * objeto: seleccionar algo y que el inspector siga mostrando la escena seria
   * un click perdido.
   *
   * Con "additive" (Shift o Ctrl) la suma o la quita de la seleccion en vez de
   * reemplazarla.
   */
  selectEntity(id: string | null, additive = false): void {
    if (!id) {
      // Clickear el vacio con Shift no deberia tirar abajo lo que ya estaba
      // seleccionado: el gesto es "agregar", y ahi no hay nada que agregar.
      if (!additive) {
        this.selection.selectEntity(null);
      }
      return;
    }
    if (additive) {
      this.selection.toggleEntitySelection(id);
    } else {
      this.selection.selectEntity(id);
    }
    this.showObjectTab();
  }

  isEntitySelected(id: string): boolean {
    return this.selectedSet().has(id);
  }

  /**
   * Clic en una fila del outliner. Se comporta como cualquier lista de
   * escritorio: Ctrl suma o quita una, Shift selecciona el rango desde la
   * activa hasta la clickeada.
   */
  onOutlinerClick(id: string, event: MouseEvent): void {
    if (event.shiftKey) {
      this.selectRangeTo(id);
      return;
    }
    this.selectEntity(id, event.ctrlKey);
  }

  /** Selecciona de la entidad activa a la clickeada, en el orden del outliner. */
  private selectRangeTo(id: string): void {
    const ids = this.entityIds();
    const anchor = this.selection.selectedEntityId();
    const from = anchor ? ids.indexOf(anchor) : -1;
    const to = ids.indexOf(id);
    if (to < 0) {
      return;
    }
    // Sin ancla previa no hay rango que trazar: vale como un clic normal.
    if (from < 0) {
      this.selectEntity(id);
      return;
    }
    const range = ids.slice(Math.min(from, to), Math.max(from, to) + 1);
    // La clickeada queda al final para que sea la activa, sin importar hacia
    // que lado se trazo el rango.
    this.selection.selectEntities([...range.filter((other) => other !== id), id]);
    this.showObjectTab();
  }

  selectAllEntities(): void {
    this.selection.selectEntities(this.entityIds());
    this.showObjectTab();
  }
}
