import { Injectable, computed, signal } from '@angular/core';

/**
 * Que entidades estan seleccionadas en el editor.
 *
 * Es estado de la INTERFAZ, no del nivel: no se serializa nunca al JSON y no
 * cambia lo que el runtime va a ejecutar. Por eso vive aparte de LevelService,
 * que es el dueno del documento; antes estaban juntos y la misma clase
 * respondia a "que hay en el nivel" y a "que esta tocando el usuario".
 *
 * No depende de LevelService a proposito: guarda ids sueltos, sin mirar si
 * existen. Resolver un id a la entidad de verdad es un cruce de las dos cosas
 * y se hace en LevelService.selectedEntity, que es quien tiene el nivel. Si
 * este servicio inyectara LevelService habria un ciclo, porque LevelService
 * tiene que limpiar la seleccion al borrar entidades.
 */
@Injectable({ providedIn: 'root' })
export class SelectionService {
  /**
   * Entidades seleccionadas, por id. Se guardan ids y no entidades porque la
   * entidad se reemplaza entera en cada edicion (estado inmutable).
   *
   * El ORDEN importa: el ultimo de la lista es el objeto activo, el mismo
   * reparto que hace Blender. La seleccion puede tener muchos elementos y
   * sobre todos ellos actuan las operaciones de grupo (borrar, duplicar,
   * mover); el activo es el unico que muestra el inspector, porque los campos
   * de un formulario solo pueden mostrar un valor a la vez.
   */
  readonly selectedEntityIds = signal<string[]>([]);

  /** El objeto activo: el ultimo que se agrego a la seleccion. */
  readonly selectedEntityId = computed<string | null>(() => this.selectedEntityIds().at(-1) ?? null);

  /** Deja seleccionada solo esa entidad, o nada si llega null. */
  selectEntity(id: string | null): void {
    this.selectedEntityIds.set(id ? [id] : []);
  }

  selectEntities(ids: readonly string[]): void {
    this.selectedEntityIds.set([...ids]);
  }

  /**
   * Suma o quita una entidad de la seleccion, que es lo que hace Shift+clic.
   * Al sumarla queda al final, o sea que pasa a ser la activa: el inspector
   * muestra siempre la ultima que se toco.
   */
  toggleEntitySelection(id: string): void {
    this.selectedEntityIds.update((selected) =>
      selected.includes(id) ? selected.filter((other) => other !== id) : [...selected, id],
    );
  }

  /** Vacia la seleccion: al abrir o empezar un nivel no hay nada tocado. */
  clear(): void {
    this.selectedEntityIds.set([]);
  }

  /**
   * Saca de la seleccion las entidades que ya no existen. Lo llama
   * LevelService al borrarlas: sin esto quedaria una seleccion apuntando a
   * algo que ya no esta, y el inspector mostraria un panel vacio sin
   * explicacion.
   */
  forget(ids: ReadonlySet<string>): void {
    this.selectedEntityIds.update((selected) => selected.filter((id) => !ids.has(id)));
  }
}
