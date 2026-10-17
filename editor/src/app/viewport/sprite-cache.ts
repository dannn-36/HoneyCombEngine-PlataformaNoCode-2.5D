import { inject, signal } from '@angular/core';

import { textureName } from '../core/sprite-style';
import { decodeImage } from '../core/texture-fit';
import { ProjectService } from '../services/project.service';

/**
 * Las imagenes del proyecto, a tamaño real, para dibujar los sprites en el
 * viewport.
 *
 * No reusa las miniaturas de TexturesController: esas se achican a 64 px, y
 * un recorte de una hoja grande saldria borroso. Aca se carga la imagen entera
 * de assets/textures/, una sola vez por textura, y solo las que usa el nivel:
 * se piden la primera vez que el dibujo las necesita.
 *
 * Sin acceso a disco (el editor abierto en el navegador) no carga nada, y las
 * entidades se dibujan con su marcador de "sin sprite".
 */
export class SpriteCache {
  private readonly project = inject(ProjectService);

  private readonly images = new Map<string, HTMLImageElement | 'loading' | 'failed'>();

  /** Sube cuando termina de cargar una imagen: leerlo en el dibujo lo repite. */
  readonly version = signal(0);

  private readonly enabled = typeof window !== 'undefined' && 'honeycombProject' in window;

  /**
   * La imagen de una textura del nivel ("textures/x.png"), o null si todavia
   * no esta (en ese caso la pide) o no se puede leer.
   */
  get(texture: string): HTMLImageElement | null {
    const name = textureName(texture);
    if (!this.enabled || !name) {
      return null;
    }
    const entry = this.images.get(name);
    if (entry instanceof HTMLImageElement) {
      return entry;
    }
    if (entry === undefined) {
      this.images.set(name, 'loading');
      void this.load(name);
    }
    return null;
  }

  /** Olvida todo: se abrio otro proyecto y "x.png" puede ser otra imagen. */
  invalidate(): void {
    this.images.clear();
    this.version.update((value) => value + 1);
  }

  private async load(name: string): Promise<void> {
    try {
      const data = await this.project.readFileData('assets/textures/' + name);
      if (data.kind !== 'image') {
        throw new Error('no es una imagen');
      }
      this.images.set(name, await decodeImage(data.dataUrl));
    } catch {
      // Una imagen que falta o no se puede leer deja la entidad con su
      // marcador, y no se reintenta hasta que se abra el proyecto de nuevo.
      this.images.set(name, 'failed');
    }
    this.version.update((value) => value + 1);
  }
}
