import { DestroyRef, Directive, ElementRef, effect, inject, input, signal, untracked } from '@angular/core';

import { textureName } from '../core/sprite-style';
import { EDITOR_HOST } from '../dialogs/dialog-base';

/**
 * Pide la miniatura de una textura cuando el elemento entra en pantalla.
 *
 *   <span [appTextureThumb]="texture">  ...  </span>
 *
 * Acepta el nombre suelto ("foo.png") o la ruta del nivel ("textures/foo.png").
 * La miniatura en si la sigue dibujando la plantilla con tex.textureAssets();
 * esto solo decide CUANDO se carga (ver TexturesController, "Miniaturas bajo
 * demanda"). Con un margen de 200 px: lo que esta por aparecer al desplazar ya
 * llega cargado.
 */
@Directive({ selector: '[appTextureThumb]' })
export class TextureThumbDirective {
  readonly appTextureThumb = input.required<string>();

  private readonly tex = inject(EDITOR_HOST).tex;
  private readonly visible = signal(false);

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    // Sin IntersectionObserver (las pruebas, en jsdom) se da por visible.
    if (typeof IntersectionObserver === 'undefined') {
      this.visible.set(true);
    } else {
      const observer = new IntersectionObserver(
        (entries) => this.visible.set(entries.some((entry) => entry.isIntersecting)),
        { rootMargin: '200px' },
      );
      observer.observe(host);
      inject(DestroyRef).onDestroy(() => observer.disconnect());
    }

    // Depende de la visibilidad, del nombre y de cacheVersion -- que sube
    // cuando el cache se descarta --, pero NO de textureAssets: si no, cada
    // miniatura que termina de cargar despertaria a todas las demas.
    effect(() => {
      this.tex.cacheVersion();
      const name = textureName(this.appTextureThumb());
      if (this.visible() && name) {
        untracked(() => this.tex.requestThumbnail(name));
      }
    });
  }
}
