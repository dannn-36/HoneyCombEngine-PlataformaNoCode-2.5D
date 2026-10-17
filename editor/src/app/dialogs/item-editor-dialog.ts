import { Component } from '@angular/core';

import { AttackPreviewDirective } from '../combat/attack-preview.directive';
import { TextureThumbDirective } from '../textures/texture-thumb.directive';
import { DialogBase } from './dialog-base';

/** Combate > Objetos y armas. Ver combat/item-editor.controller.ts y dialogs/dialog-base.ts. */
@Component({
  selector: 'app-item-editor-dialog',
  // La vista previa del ataque solo se usa aca: viaja con el dialogo en su
  // archivo aparte, en vez de cargarse al arrancar.
  imports: [AttackPreviewDirective, TextureThumbDirective],
  templateUrl: './item-editor-dialog.html',
})
export class ItemEditorDialog extends DialogBase {
  readonly itemEditor = this.app.itemEditor;
  readonly items = this.app.items;
  readonly tex = this.app.tex;
}
