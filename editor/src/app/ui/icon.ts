import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { DomSanitizer } from '@angular/platform-browser';
import { entityKindStyle } from '../core/entity-kinds';
import { ICON_SPRITE, IconName } from './icons.generated';

/**
 * Un icono del sprite: <svg hcIcon="play"></svg>.
 *
 * Va sobre el propio <svg> (selector de atributo) para no sumar un elemento
 * envoltorio: el tamaño y el color se le ponen al svg desde CSS (.icon), y el
 * trazo toma currentColor, asi que sigue el color del texto del boton.
 */
@Component({
  selector: 'svg[hcIcon]',
  template: `<svg:use [attr.href]="'#i-' + hcIcon()" />`,
  host: {
    class: 'icon',
    viewBox: '0 0 24 24',
    'aria-hidden': 'true',
    focusable: 'false',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Icon {
  readonly hcIcon = input.required<IconName>();
}

/**
 * La celda: el hexagono de HoneyComb con el icono del tipo de entidad adentro.
 * Es como se reconoce un tipo en toda la interfaz: el color de relleno y la
 * forma del icono dicen lo mismo, para que no dependa solo del color.
 *
 * "active" le pone el anillo de miel: marca el objeto activo, el que muestra el
 * inspector.
 */
@Component({
  selector: 'svg[hcCell]',
  template: `
    <svg:path class="cell__hex" d="M12 1.6 21 6.8v10.4L12 22.4 3 17.2V6.8Z" />
    <svg:use class="cell__glyph" [attr.href]="'#i-' + style().icon" x="6.5" y="6.5" width="11" height="11" />
  `,
  host: {
    class: 'cell',
    viewBox: '0 0 24 24',
    role: 'img',
    '[attr.aria-label]': 'style().label',
    '[class.is-active]': 'active()',
    '[style.--cell]': 'style().color',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Cell {
  /** El "type" de la entidad (player, enemy...). Lo desconocido cae a un tipo neutro. */
  readonly hcCell = input.required<string>();
  readonly active = input(false);
  protected readonly style = computed(() => entityKindStyle(this.hcCell()));
}

/**
 * El sprite con todos los iconos, una sola vez en la pagina. Cada <use> de
 * arriba apunta a un <symbol> de aca por id. Va en el DOM y no en un archivo
 * aparte porque bajo Electron la app se sirve desde file://, y Chromium no
 * resuelve un <use> que apunte a otro archivo con ese origen.
 *
 * El contenido es fijo y sale del propio bundle (icons.generated.ts), por eso
 * se le puede saltear el sanitizador.
 */
@Component({
  selector: 'app-icon-sprite',
  template: `<div [innerHTML]="sprite"></div>`,
  host: { style: 'display: contents' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IconSprite {
  protected readonly sprite = inject(DomSanitizer).bypassSecurityTrustHtml(ICON_SPRITE);
}
