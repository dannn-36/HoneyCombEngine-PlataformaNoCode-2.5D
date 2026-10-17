import { Component } from '@angular/core';

import { DialogBase } from './dialog-base';

/** Combate > Puzzle de sala. Ver combat/puzzle.controller.ts y dialogs/dialog-base.ts. */
@Component({
  selector: 'app-puzzle-dialog',
  templateUrl: './puzzle-dialog.html',
})
export class PuzzleDialog extends DialogBase {
  readonly puzzle = this.app.puzzle;
  readonly combat = this.app.combat;
  readonly items = this.app.items;
}
