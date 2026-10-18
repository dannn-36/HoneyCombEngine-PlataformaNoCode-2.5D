import { Injectable, computed, inject, signal } from '@angular/core';

import { defaultGameConfig } from '../core/game-config';
import { GameConfig } from '../models/game-config.model';
import { ProjectService } from './project.service';

/**
 * La configuracion del juego del proyecto abierto (game.json): ventana,
 * portada, pantallas, HUD y variables de la partida.
 *
 * Mismo trato que las bibliotecas de personajes y objetos: vive en memoria como
 * signal y save() escribe primero el archivo y recien despues la memoria, para
 * que un fallo de disco no deje el editor mostrando algo que no se guardo.
 */
@Injectable({ providedIn: 'root' })
export class GameConfigService {
  private readonly project = inject(ProjectService);

  readonly config = signal<GameConfig>(defaultGameConfig());

  /** true si el proyecto tiene game.json. Sin el, el motor arranca como siempre. */
  readonly exists = signal(false);

  /** Los nombres de las variables declaradas, en orden alfabetico: los desplegables de los eventos. */
  readonly variableNames = computed(() =>
    Object.keys(this.config().variables).sort((a, b) => a.localeCompare(b)),
  );

  async load(): Promise<void> {
    const { config, exists } = await this.project.readGameConfig();
    this.config.set(config);
    this.exists.set(exists);
  }

  async save(config: GameConfig): Promise<void> {
    await this.project.writeGameConfig(config);
    this.config.set(config);
    this.exists.set(true);
  }

  /** Sin proyecto (o al cambiar de carpeta), la de siempre. */
  reset(): void {
    this.config.set(defaultGameConfig());
    this.exists.set(false);
  }
}
