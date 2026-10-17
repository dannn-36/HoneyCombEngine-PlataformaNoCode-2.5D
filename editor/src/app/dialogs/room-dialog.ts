import { Component } from '@angular/core';

import { DialogBase } from './dialog-base';

/** Mapa > Agregar grilla al mapa (o editar una). Ver map/map.controller.ts y dialogs/dialog-base.ts. */
@Component({
  selector: 'app-room-dialog',
  templateUrl: './room-dialog.html',
})
export class RoomDialog extends DialogBase {
  readonly map = this.app.map;
}
