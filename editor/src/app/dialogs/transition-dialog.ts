import { Component } from '@angular/core';

import { Icon } from '../ui/icon';
import { DialogBase } from './dialog-base';

/** Niveles > Pasar a otro nivel. Ver events/transition.controller.ts y dialogs/dialog-base.ts. */
@Component({
  selector: 'app-transition-dialog',
  imports: [Icon],
  templateUrl: './transition-dialog.html',
})
export class TransitionDialog extends DialogBase {
  readonly transition = this.app.transition;
  readonly proj = this.app.proj;
  readonly entityIds = this.app.entityIds;
}
