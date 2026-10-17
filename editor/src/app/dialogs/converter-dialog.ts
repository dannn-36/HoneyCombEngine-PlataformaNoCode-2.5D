import { Component } from '@angular/core';

import { Icon } from '../ui/icon';
import { DialogBase } from './dialog-base';

/** Herramientas > Convertidor de imagenes. Ver textures/image-converter.controller.ts y dialogs/dialog-base.ts. */
@Component({
  selector: 'app-converter-dialog',
  imports: [Icon],
  templateUrl: './converter-dialog.html',
})
export class ConverterDialog extends DialogBase {
  readonly converter = this.app.converter;
  readonly grid = this.app.grid;
}
