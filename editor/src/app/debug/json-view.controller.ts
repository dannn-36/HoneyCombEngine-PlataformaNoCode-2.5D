import { computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import { levelForDisk } from '../core/floors';
import { highlightJson } from '../core/json-highlight';
import { LevelService } from '../services/level.service';
import { SelectionService } from '../services/selection.service';

/**
 * Hasta donde se colorea. Mas alla el texto va sin colores: un nivel con
 * salas grandes pasa de los 200 KB, y miles de <span> rehechos en cada
 * edicion se notarian al escribir en el inspector.
 */
const HIGHLIGHT_LIMIT = 150 * 1024;

export type JsonScope = 'nivel' | 'seleccion';

/**
 * La pestaña JSON del panel de abajo: el nivel abierto como texto, en vivo,
 * exactamente como lo escribe Guardar (ver ProjectService.saveLevel) y como lo
 * lee el motor. Sirve para depurar: ver que guardo de verdad un cambio, o por
 * que el motor no hace lo que el editor muestra.
 *
 * Es SOLO LECTURA y no cambia nada del resto. Todo es computed: Angular los
 * calcula recien cuando la pestaña esta a la vista, y con otra pestaña al
 * frente no cuesta nada.
 *
 * Es un controlador y no un componente por la misma razon que
 * ItemEditorController: el markup vive en app.html para usar los estilos de
 * App (ver el comentario de cabecera de app.ts).
 */
export class JsonViewController {
  private readonly levels = inject(LevelService);
  private readonly selection = inject(SelectionService);
  private readonly sanitizer = inject(DomSanitizer);

  constructor(private readonly note: (message: string) => void) {}

  /** El nivel entero, o solo las entidades seleccionadas. */
  readonly scope = signal<JsonScope>('nivel');

  readonly selectionCount = computed(() => this.selection.selectedEntityIds().length);

  /** El texto: con el mismo formato que el archivo (2 espacios), o null si no hay nada que mostrar. */
  readonly text = computed<string | null>(() => {
    const level = this.levels.level();
    if (this.scope() === 'nivel') {
      // El mismo nivel que escribe Guardar, con el piso ya resuelto (ver core/floors.ts).
      return JSON.stringify(levelForDisk(level), null, 2);
    }
    const ids = new Set(this.selection.selectedEntityIds());
    const picked = level.entities.filter((entity) => ids.has(entity.id));
    if (picked.length === 0) {
      return null;
    }
    return JSON.stringify(picked.length === 1 ? picked[0] : picked, null, 2);
  });

  /**
   * El texto coloreado, o null si es demasiado largo para colorearlo. Se salta
   * la sanitizacion de Angular a proposito: highlightJson escapa todo el texto
   * y solo agrega sus <span> (ver core/json-highlight.ts), y sanitizar 150 KB
   * en cada tecla costaria mas que colorearlos.
   */
  readonly html = computed<SafeHtml | null>(() => {
    const text = this.text();
    return text !== null && text.length <= HIGHLIGHT_LIMIT
      ? this.sanitizer.bypassSecurityTrustHtml(highlightJson(text))
      : null;
  });

  /** "412 líneas · 9,8 KB" para la cabecera de la pestaña. */
  readonly summary = computed(() => {
    const text = this.text();
    if (text === null) {
      return '';
    }
    let lines = 1;
    for (let i = 0; i < text.length; i += 1) {
      if (text.charCodeAt(i) === 10) {
        lines += 1;
      }
    }
    const kb = (new Blob([text]).size / 1024).toLocaleString('es', { maximumFractionDigits: 1 });
    return lines + ' líneas · ' + kb + ' KB';
  });

  async copy(): Promise<void> {
    const text = this.text();
    if (text === null) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      this.note(this.scope() === 'nivel' ? 'JSON del nivel copiado.' : 'JSON de la selección copiado.');
    } catch {
      this.note('No se pudo copiar al portapapeles.');
    }
  }
}
