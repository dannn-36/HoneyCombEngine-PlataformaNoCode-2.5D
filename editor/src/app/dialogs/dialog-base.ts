import { InjectionToken, inject } from '@angular/core';

// Solo el TIPO de App: importarla como valor cerraria un ciclo (App carga los
// dialogos y los dialogos cargarian App), y romperia la carga diferida.
import type { App } from '../app';

/**
 * El componente raiz, para los dialogos que viven en dialogs/. App lo provee
 * apuntando a si misma (ver "providers" en app.ts).
 */
export const EDITOR_HOST = new InjectionToken<App>('EDITOR_HOST');

/**
 * Base de los dialogos grandes del editor.
 *
 * POR QUE EXISTEN COMO COMPONENTES. Antes todo su markup vivia en app.html, y
 * Angular compila la plantilla de un componente entera dentro de su codigo: el
 * editor de objetos, el de personajes, el convertidor... se cargaban al
 * arrancar aunque nadie los abriera. Ahora cada uno es un componente que App
 * monta dentro de un @defer, y su codigo va en un archivo aparte que se baja
 * en segundo plano cuando el editor queda libre (ver app.html).
 *
 * Los controladores siguen siendo los de App -- el estado no se movio, solo el
 * markup --, asi que cada dialogo expone con el MISMO nombre los que usa su
 * plantilla, y la plantilla se paso tal cual estaba en app.html. Los estilos
 * tambien son los de App, que por eso no estan encapsulados (ver app.ts).
 */
export abstract class DialogBase {
  protected readonly app = inject(EDITOR_HOST);

  // Los helpers de plantilla de App, con los mismos nombres cortos.

  str(event: Event): string {
    return this.app.str(event);
  }

  int(event: Event): number {
    return this.app.int(event);
  }

  num(event: Event): number {
    return this.app.num(event);
  }

  checked(event: Event): boolean {
    return this.app.checked(event);
  }
}
