import { NgTemplateOutlet } from '@angular/common';
import { Component } from '@angular/core';

import { TextureThumbDirective } from '../textures/texture-thumb.directive';
import { Icon } from '../ui/icon';
import { DialogBase } from './dialog-base';

/** Archivo > Configuración del juego. Ver game/game-config.controller.ts y dialogs/dialog-base.ts. */
@Component({
  selector: 'app-game-config-dialog',
  imports: [Icon, NgTemplateOutlet, TextureThumbDirective],
  templateUrl: './game-config-dialog.html',
  styleUrl: './game-config-dialog.scss',
})
export class GameConfigDialog extends DialogBase {
  readonly game = this.app.game;
  readonly tex = this.app.tex;
  readonly hasFileSystem = this.app.hasFileSystem;

  /**
   * Que hace cada selector de color, para la plantilla #colorField. Creadas una
   * vez: una funcion nueva en cada pasada rearmaria el contexto de la plantilla.
   */
  readonly setters = {
    titleColor: (hex: string) => this.game.setTitleColor('titleColor', hex),
    subtitleColor: (hex: string) => this.game.setTitleColor('subtitleColor', hex),
    backgroundColor: (hex: string) => this.game.setTitleColor('backgroundColor', hex),
    buttonColor: (hex: string) => this.game.setTitleColor('buttonColor', hex),
    buttonHighlight: (hex: string) => this.game.setTitleColor('buttonHighlight', hex),
    gameOverColor: (hex: string) => this.game.setGameOverColor(hex),
    healthFill: (hex: string) => this.game.setHudColor('healthFill', hex),
    healthEmpty: (hex: string) => this.game.setHudColor('healthEmpty', hex),
    healthBorder: (hex: string) => this.game.setHudColor('healthBorder', hex),
  } as const;
}
