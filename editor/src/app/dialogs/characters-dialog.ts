import { Component } from '@angular/core';

import { TextureThumbDirective } from '../textures/texture-thumb.directive';
import { DialogBase } from './dialog-base';

/** Personajes > Configurar personajes. Ver characters/characters.controller.ts y dialogs/dialog-base.ts. */
@Component({
  selector: 'app-characters-dialog',
  imports: [TextureThumbDirective],
  templateUrl: './characters-dialog.html',
})
export class CharactersDialog extends DialogBase {
  readonly chars = this.app.chars;
  readonly tex = this.app.tex;
}
