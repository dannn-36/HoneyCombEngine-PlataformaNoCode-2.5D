import { inject, signal } from '@angular/core';

import { Hsv, clampChannel, hexToRgb, hsvToRgb, rgbToHex, rgbToHsv } from '../core/color';
import { RgbColor } from '../models/level.model';
import { LevelService } from '../services/level.service';

/**
 * El selector de color del fondo de la escena.
 *
 * El nivel guarda un RGB ("backgroundColor"), que es lo que el motor pinta
 * antes de dibujar nada. El selector trabaja en HSV porque es con lo que se
 * elige un color a mano -- un cuadrado de saturacion/valor y una barra de tono,
 * como cualquier editor de imagen -- y el HSV vive aparte del nivel: dos HSV
 * distintos pueden dar el mismo RGB (todo lo negro tiene cualquier tono), y sin
 * recordar el elegido la barra de tono saltaria sola al mover el cuadrado.
 *
 * Es un controlador y no un componente por la misma razon que
 * ItemEditorController: el markup vive en app.html para usar los estilos de
 * App (ver el comentario de cabecera de app.ts).
 */
export class BackgroundPickerController {
  private readonly levels = inject(LevelService);

  constructor(private readonly markDirty: () => void) {}

  backgroundColor(): RgbColor {
    return this.levels.level().backgroundColor ?? { r: 245, g: 245, b: 245 };
  }

  backgroundHex(): string {
    return rgbToHex(this.backgroundColor());
  }

  /**
   * Ultimo HSV elegido en el selector. El RGB no alcanza para reconstruirlo:
   * un gris no tiene tono y el negro tampoco saturacion, y sin guardarlo el
   * cursor saltaria a una esquina al arrastrar por ahi.
   */
  private readonly backgroundPick = signal<Hsv | null>(null);

  /**
   * El color como lo dibuja el selector. Si el RGB cambio por otro lado (los
   * campos, el hex, otro nivel), el HSV guardado ya no corresponde y se
   * recalcula, conservando solo su tono para los grises.
   */
  backgroundHsv(): Hsv {
    const rgb = this.backgroundColor();
    const kept = this.backgroundPick();
    if (kept && rgbToHex(hsvToRgb(kept)) === rgbToHex(rgb)) {
      return kept;
    }
    return rgbToHsv(rgb, kept?.h ?? 0);
  }

  /** Color puro del tono actual: el fondo del cuadro de saturacion/brillo. */
  backgroundHueCss(): string {
    return `hsl(${this.backgroundHsv().h}, 100%, 50%)`;
  }

  /** Cuadro grande: X es la saturacion y Y el brillo (arriba = claro). */
  onBackgroundSquare(event: PointerEvent): void {
    const point = this.pickerPoint(event);
    if (point) {
      this.pickBackground({ ...this.backgroundHsv(), s: point.x, v: 1 - point.y });
    }
  }

  /** Barra de tono: arriba 0°, abajo 360°. */
  onBackgroundHue(event: PointerEvent): void {
    const point = this.pickerPoint(event);
    if (point) {
      this.pickBackground({ ...this.backgroundHsv(), h: point.y * 360 });
    }
  }

  setBackgroundHex(text: string): void {
    const rgb = hexToRgb(text);
    if (rgb) {
      this.storeBackground(rgb);
    }
  }

  patchBackground(changes: Partial<RgbColor>): void {
    // El schema exige enteros de 0 a 255; el campo numerico deja escribir cualquier cosa.
    const merged = { ...this.backgroundColor(), ...changes };
    this.storeBackground({ r: clampChannel(merged.r), g: clampChannel(merged.g), b: clampChannel(merged.b) });
  }

  private pickBackground(hsv: Hsv): void {
    this.backgroundPick.set(hsv);
    this.storeBackground(hsvToRgb(hsv));
  }

  private storeBackground(backgroundColor: RgbColor): void {
    this.levels.level.update((level) => ({ ...level, backgroundColor }));
    this.markDirty();
  }

  /**
   * Posicion del puntero dentro del control, de 0 a 1 por eje; null si se
   * mueve sin el boton apretado. Al apretar captura el puntero, asi el
   * arrastre sigue aunque el mouse se salga del cuadro.
   */
  private pickerPoint(event: PointerEvent): { x: number; y: number } | null {
    const target = event.currentTarget as HTMLElement;
    if (event.type === 'pointerdown') {
      target.setPointerCapture(event.pointerId);
      event.preventDefault();
    } else if ((event.buttons & 1) === 0) {
      return null;
    }
    const box = target.getBoundingClientRect();
    const unit = (value: number) => Math.min(1, Math.max(0, value));
    return {
      x: unit((event.clientX - box.left) / box.width),
      y: unit((event.clientY - box.top) / box.height),
    };
  }
}
