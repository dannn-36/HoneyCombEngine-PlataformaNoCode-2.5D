import { Component } from '@angular/core';

import { levelTitle } from '../core/recent-files';
import { Icon } from '../ui/icon';
import { DialogBase } from './dialog-base';

/** La pantalla de Inicio. Ver start/start.controller.ts y dialogs/dialog-base.ts. */
@Component({
  selector: 'app-start-screen',
  imports: [Icon],
  templateUrl: './start-screen.html',
  styleUrl: './start-screen.scss',
})
export class StartScreen extends DialogBase {
  readonly start = this.app.start;
  readonly proj = this.app.proj;
  readonly brandLogo = this.app.brandLogo;
  readonly levelTitle = levelTitle;
}
