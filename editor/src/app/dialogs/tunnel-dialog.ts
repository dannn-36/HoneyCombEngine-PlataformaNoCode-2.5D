import { Component } from '@angular/core';

import { DialogBase } from './dialog-base';

/** Mapa > Conectar grillas con un tunel (o editar uno). Ver map/map.controller.ts y dialogs/dialog-base.ts. */
@Component({
  selector: 'app-tunnel-dialog',
  templateUrl: './tunnel-dialog.html',
})
export class TunnelDialog extends DialogBase {
  readonly map = this.app.map;
}
