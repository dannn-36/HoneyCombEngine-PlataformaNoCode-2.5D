import { signal } from '@angular/core';

/** Lo que muestra el dialogo: titulo, etiqueta del campo, valor inicial y boton. */
export interface NamePromptRequest {
  title: string;
  label: string;
  value: string;
  confirmLabel: string;
  hint?: string;
}

/**
 * Dialogo de "escribi un nombre" que se puede esperar con await: Guardar como
 * y Nueva carpeta lo usan para preguntar el nombre sin pasar por el dialogo
 * del sistema, que dejaria elegir una carpeta fuera de la del editor.
 *
 * Existe porque window.prompt() no anda en Electron. ask() devuelve una
 * promesa que se resuelve con el texto al confirmar, o con null al cancelar.
 *
 * Controlador y no componente por la misma razon que los demas: el markup vive
 * en app.html para usar los estilos de App.
 */
export class NamePromptController {
  readonly request = signal<NamePromptRequest | null>(null);

  private resolve: ((value: string | null) => void) | null = null;

  ask(request: NamePromptRequest): Promise<string | null> {
    // Uno solo a la vez: si habia otro abierto, se da por cancelado.
    this.finish(null);
    this.request.set({ ...request });
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  setValue(value: string): void {
    this.request.update((request) => (request ? { ...request, value } : request));
  }

  /** Confirma con el texto escrito. Vacio no confirma: no hay nombre que usar. */
  confirm(): void {
    const value = this.request()?.value.trim() ?? '';
    if (value !== '') {
      this.finish(value);
    }
  }

  cancel(): void {
    this.finish(null);
  }

  private finish(value: string | null): void {
    const resolve = this.resolve;
    this.resolve = null;
    this.request.set(null);
    resolve?.(value);
  }
}
