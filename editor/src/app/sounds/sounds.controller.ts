import { inject, signal } from '@angular/core';

import { ProjectService } from '../services/project.service';

/** Lo que el controlador de sonidos recibe del editor. */
export interface SoundsDeps {
  note: (message: string) => void;
  describe: (error: unknown) => string;
  /** false cuando el editor corre en un navegador sin Electron (sin disco). */
  hasFileSystem: boolean;
  /** Relee una carpeta del explorador de archivos (assets/sounds despues de importar). */
  reloadDir: (path: string) => Promise<void>;
}

/** "Volumen %" (0-100) como lo pide un <audio> (0-1). Lo que no es un numero suena entero. */
export function previewVolume(percent: unknown): number {
  const value = Number(percent);
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) / 100 : 1;
}

/** Nombre de archivo de un sonido, sin la carpeta: "sounds/tema.ogg" -> "tema.ogg". */
export function soundLabel(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/**
 * Los sonidos del proyecto: Recursos › Sonidos, la musica del nivel y los
 * parametros de sonido de los eventos (sound_ref) los eligen de aca.
 *
 * Las rutas son relativas a assets/ ("sounds/tema.ogg"), que es como las
 * guardan los niveles y game.json y como las busca el motor.
 *
 * Importar copia archivos elegidos con el dialogo del sistema a
 * assets/sounds/ (ver ipc/sounds.js). Escuchar los reproduce aca mismo con un
 * <audio> del navegador: uno a la vez, y el mismo boton lo corta.
 */
export class SoundsController {
  private readonly project = inject(ProjectService);

  /** Los sonidos de assets/, como rutas relativas a assets/. */
  readonly sounds = signal<string[]>([]);

  /** El que esta sonando en el editor, o null. */
  readonly playing = signal<string | null>(null);

  /** El elegido en Recursos › Sonidos (para "Usar como música del nivel"). */
  readonly selected = signal<string | null>(null);

  readonly busy = signal(false);

  private audio: HTMLAudioElement | null = null;

  readonly label = soundLabel;

  constructor(private readonly deps: SoundsDeps) {}

  /** Relee la lista de sonidos del disco. Sin disco, queda vacia. */
  async reload(): Promise<void> {
    if (!this.deps.hasFileSystem) {
      return;
    }
    try {
      this.sounds.set(await this.project.listSounds());
    } catch (error) {
      this.sounds.set([]);
      this.deps.note('No se pudieron leer los sonidos: ' + this.deps.describe(error));
    }
    const selected = this.selected();
    if (selected && !this.sounds().includes(selected)) {
      this.selected.set(null);
    }
  }

  /** Recursos › Sonidos › Importar: copia WAV, OGG o MP3 a assets/sounds/. */
  async importSounds(): Promise<void> {
    if (!this.deps.hasFileSystem) {
      this.deps.note('Importar sonidos necesita el editor de escritorio: en el navegador no hay carpeta del proyecto.');
      return;
    }
    if (this.busy()) {
      return;
    }
    this.busy.set(true);
    try {
      const result = await this.project.importSounds();
      if (result.canceled) {
        return;
      }
      await this.reload();
      await this.deps.reloadDir('assets/sounds');
      if (result.imported.length > 0) {
        const names = result.imported.map((sound) => soundLabel(sound.target));
        this.selected.set(result.imported[result.imported.length - 1].target);
        this.deps.note(
          (result.imported.length === 1 ? 'Sonido importado' : result.imported.length + ' sonidos importados') +
            ' a assets/sounds/: ' + names.join(', ') + '.',
        );
      }
      for (const skipped of result.skipped) {
        this.deps.note('No se importó ' + skipped.source + ': ' + skipped.reason + '.');
      }
    } catch (error) {
      this.deps.note('No se pudieron importar los sonidos: ' + this.deps.describe(error));
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Escucha un sonido en el editor; si ya estaba sonando, lo corta. volume es
   * el "Volumen %" con que se usa (100 = el del archivo), para oirlo como en
   * el juego.
   */
  async togglePreview(path: string, volume: unknown = 100): Promise<void> {
    if (this.playing() === path) {
      this.stop();
      return;
    }
    this.stop();
    if (!path || !this.deps.hasFileSystem) {
      return;
    }
    try {
      const data = await this.project.readFileData('assets/' + path);
      if (data.kind !== 'audio') {
        throw new Error(data.kind === 'binary' && data.reason === 'too-large' ? 'pesa demasiado para escucharlo acá' : 'no es un sonido');
      }
      const audio = new Audio(data.dataUrl);
      audio.volume = previewVolume(volume);
      this.audio = audio;
      this.playing.set(path);
      audio.addEventListener('ended', () => {
        if (this.audio === audio) {
          this.stop();
        }
      });
      await audio.play();
    } catch (error) {
      this.stop();
      this.deps.note('No se pudo escuchar ' + soundLabel(path) + ': ' + this.deps.describe(error));
    }
  }

  /** Si se esta escuchando ese sonido, le cambia el volumen sin cortarlo. */
  setPreviewVolume(path: string, volume: number): void {
    if (this.audio && this.playing() === path) {
      this.audio.volume = previewVolume(volume);
    }
  }

  /** Corta lo que este sonando. */
  stop(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio = null;
    }
    this.playing.set(null);
  }
}
