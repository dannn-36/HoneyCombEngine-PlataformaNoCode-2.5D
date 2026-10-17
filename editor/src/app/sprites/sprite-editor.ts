import {
  Component,
  DestroyRef,
  ElementRef,
  ViewEncapsulation,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';

import { IsoAnchor, PixelPoint, SpriteDoc, brushOrigin, isoDiamond } from '../core/sprite-doc';
import { DialogBase } from '../dialogs/dialog-base';
import { ThemeService } from '../services/theme.service';
import { Icon } from '../ui/icon';

/** Lado de cada cuadro del tablero de transparencia, en pixeles de pantalla. */
const CHECKER = 8;
/** Desde este zoom se dibuja la cuadricula de pixeles: mas abajo las lineas tapan el dibujo. */
const PIXEL_GRID_MIN_ZOOM = 6;

/**
 * La herramienta de sprites en el area central: el lienzo, la barra de cuadros
 * y el panel de color, capas y guia. El estado y las acciones son de
 * SpriteEditorController (en App, para no perder el sprite al volver al mapa);
 * aca esta el dibujo del lienzo y la traduccion de punteros a pixeles.
 *
 * Es un componente aparte por PESO, como los dialogos grandes (ver
 * dialogs/dialog-base.ts): App lo monta con @defer la primera vez que se entra
 * a Sprites. Despues queda montado y se esconde con el host, asi el lienzo y su
 * ResizeObserver no se rearman cada vez que se cambia de modo.
 */
@Component({
  selector: 'app-sprite-editor',
  imports: [Icon],
  templateUrl: './sprite-editor.html',
  styleUrl: './sprite-editor.scss',
  // Sin encapsular, como App: los estilos usan las clases del tema de app.scss.
  encapsulation: ViewEncapsulation.None,
  host: {
    class: 'spritehost',
    '[class.is-hidden]': "app.centerMode() !== 'sprites'",
    '(window:keyup)': 'sprite.onKeyUp($event)',
  },
})
export class SpriteEditor extends DialogBase {
  readonly sprite = this.app.sprite;
  readonly tex = this.app.tex;
  readonly grid = this.app.grid;

  private readonly theme = inject(ThemeService);
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('spriteCanvas');

  /** Las capas de arriba hacia abajo, como se leen en una lista (el documento las guarda al reves). */
  readonly layersTopFirst = computed(() => [...(this.sprite.doc()?.layers ?? [])].reverse());

  // Formulario de la pantalla de arranque.
  readonly newWidth = signal(this.app.grid().tileWidth);
  readonly newHeight = signal(this.app.grid().tileWidth);
  readonly openName = signal(this.app.palette.activeTexture() ?? '');
  readonly openFrames = signal(1);

  /** Arrastrando el lienzo con el medio o con Espacio. */
  readonly panning = signal(false);
  private panFrom: PixelPoint | null = null;

  private observer?: ResizeObserver;
  private observed?: HTMLElement;

  /**
   * Los pixeles del cuadro a tamaño real, para escalarlos con drawImage. Se
   * vuelven a cargar solo cuando el cuadro cambia, no al mover el cursor.
   */
  private readonly frameBitmap = new FrameBitmap();
  private readonly onionBitmap = new FrameBitmap();

  constructor() {
    super();
    // El lienzo toma su tamaño del contenedor, igual que el viewport (ver
    // viewport/viewport.controller.ts). Se vuelve a observar si el canvas cambia.
    effect(() => {
      const host = this.canvas()?.nativeElement.parentElement;
      if (!host || host === this.observed || typeof ResizeObserver === 'undefined') {
        return;
      }
      this.observer?.disconnect();
      this.observed = host;
      this.observer = new ResizeObserver((entries) => {
        const rect = entries[0].contentRect;
        this.sprite.setHostSize(Math.floor(rect.width), Math.floor(rect.height));
      });
      this.observer.observe(host);
    });

    effect(() => this.draw());

    inject(DestroyRef).onDestroy(() => {
      this.observer?.disconnect();
      this.sprite.stopPlayback();
    });
  }

  // --- Pantalla de arranque -------------------------------------------------------

  createCustom(): void {
    this.sprite.newSprite(this.newWidth(), this.newHeight());
  }

  openSelected(): void {
    const name = this.openName();
    if (name) {
      void this.sprite.openTexture(name, this.openFrames());
    }
  }

  anchor(event: Event): IsoAnchor {
    const value = this.str(event);
    return value === 'centro' || value === 'pies' ? value : 'base';
  }

  // --- Punteros ---------------------------------------------------------------------

  /** El punto del evento en el lienzo y el pixel del sprite que cae debajo. */
  private locate(event: PointerEvent | WheelEvent): { screen: PixelPoint; pixel: PixelPoint } {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const zoom = this.sprite.zoom();
    const offset = this.sprite.offset();
    return { screen, pixel: { x: Math.floor((screen.x - offset.x) / zoom), y: Math.floor((screen.y - offset.y) / zoom) } };
  }

  onPointerDown(event: PointerEvent): void {
    const { screen, pixel } = this.locate(event);
    // Con el puntero capturado, soltar fuera del lienzo igual termina el trazo.
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    if (event.button === 1 || (event.button === 0 && this.sprite.spaceHeld())) {
      event.preventDefault();
      this.panFrom = screen;
      this.panning.set(true);
      return;
    }
    if (event.button === 0 || event.button === 2) {
      this.sprite.pointerDown(pixel, event.button === 2 ? 'secondary' : 'primary', {
        shift: event.shiftKey,
        alt: event.altKey,
      });
    }
  }

  onPointerMove(event: PointerEvent): void {
    const { screen, pixel } = this.locate(event);
    if (this.panFrom) {
      this.sprite.panBy(screen.x - this.panFrom.x, screen.y - this.panFrom.y);
      this.panFrom = screen;
      return;
    }
    this.setHover(pixel);
    this.sprite.pointerMove(pixel, { shift: event.shiftKey });
  }

  onPointerUp(event: PointerEvent): void {
    (event.currentTarget as HTMLElement).releasePointerCapture?.(event.pointerId);
    if (this.panFrom) {
      this.panFrom = null;
      this.panning.set(false);
      return;
    }
    this.sprite.pointerUp();
  }

  onPointerLeave(): void {
    this.sprite.hoverPixel.set(null);
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.sprite.zoomAt(event.deltaY < 0 ? 1 : -1, this.locate(event).screen);
  }

  /** Solo si cambio de pixel: cada cambio redibuja el lienzo. */
  private setHover(pixel: PixelPoint): void {
    const doc = this.sprite.doc();
    const inside = doc && pixel.x >= 0 && pixel.y >= 0 && pixel.x < doc.width && pixel.y < doc.height;
    const next = inside ? pixel : null;
    const current = this.sprite.hoverPixel();
    if (current?.x !== next?.x || current?.y !== next?.y) {
      this.sprite.hoverPixel.set(next);
    }
  }

  // --- Dibujo -----------------------------------------------------------------------

  private draw(): void {
    const canvas = this.canvas()?.nativeElement;
    const { w, h } = this.sprite.hostSize();
    const doc = this.sprite.doc();
    const composite = this.sprite.composite();
    const onion = this.sprite.onionComposite();
    const zoom = this.sprite.zoom();
    const offset = this.sprite.offset();
    const hover = this.sprite.hoverPixel();
    const palette = this.theme.canvas();
    if (!canvas || w === 0 || h === 0) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    const ratio = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * ratio) || canvas.height !== Math.round(h * ratio)) {
      canvas.width = Math.round(w * ratio);
      canvas.height = Math.round(h * ratio);
    }
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = palette.background;
    ctx.fillRect(0, 0, w, h);
    if (!doc || !composite) {
      return;
    }

    const width = doc.width * zoom;
    const height = doc.height * zoom;
    const style = getComputedStyle(canvas);
    this.drawChecker(ctx, offset, width, height, style.getPropertyValue('--checker-a').trim() || '#2b2b2b',
      style.getPropertyValue('--checker-b').trim() || '#1e1e1e');

    if (onion) {
      ctx.globalAlpha = 0.3;
      ctx.drawImage(this.onionBitmap.load(onion, doc), offset.x, offset.y, width, height);
      ctx.globalAlpha = 1;
    }
    ctx.drawImage(this.frameBitmap.load(composite, doc), offset.x, offset.y, width, height);

    if (this.sprite.showPixelGrid() && zoom >= PIXEL_GRID_MIN_ZOOM) {
      this.drawPixelGrid(ctx, doc, offset, zoom, w, h, palette.gridUnder);
    }
    if (this.sprite.showIsoGuide()) {
      this.drawIsoGuide(ctx, doc, offset, zoom, palette.active, palette.marqueeFill);
    }

    ctx.strokeStyle = palette.gridOver;
    ctx.globalAlpha = 0.6;
    ctx.lineWidth = 1;
    ctx.strokeRect(offset.x - 0.5, offset.y - 0.5, width + 1, height + 1);
    ctx.globalAlpha = 1;

    if (hover && !this.sprite.playing()) {
      this.drawCursor(ctx, hover, offset, zoom, palette.hoverStroke, palette.halo);
    }
  }

  /** El tablero de transparencia, solo dentro del sprite y de lo que se ve. */
  private drawChecker(ctx: CanvasRenderingContext2D, offset: PixelPoint, width: number, height: number, a: string, b: string): void {
    ctx.save();
    ctx.beginPath();
    ctx.rect(offset.x, offset.y, width, height);
    ctx.clip();
    ctx.fillStyle = b;
    ctx.fillRect(offset.x, offset.y, width, height);
    ctx.fillStyle = a;
    const { w, h } = this.sprite.hostSize();
    // Solo las casillas que caen en pantalla: un sprite grande a zoom alto
    // mide decenas de miles de pixeles, y dibujarlo entero no tiene sentido.
    const startX = Math.max(0, Math.floor(-offset.x / CHECKER));
    const startY = Math.max(0, Math.floor(-offset.y / CHECKER));
    const endX = Math.min(Math.ceil(width / CHECKER), Math.ceil((w - offset.x) / CHECKER));
    const endY = Math.min(Math.ceil(height / CHECKER), Math.ceil((h - offset.y) / CHECKER));
    for (let row = startY; row < endY; row += 1) {
      for (let col = startX + ((startX + row) % 2); col < endX; col += 2) {
        ctx.fillRect(offset.x + col * CHECKER, offset.y + row * CHECKER, CHECKER, CHECKER);
      }
    }
    ctx.restore();
  }

  private drawPixelGrid(
    ctx: CanvasRenderingContext2D,
    doc: SpriteDoc,
    offset: PixelPoint,
    zoom: number,
    viewWidth: number,
    viewHeight: number,
    color: string,
  ): void {
    const firstX = Math.max(1, Math.ceil(-offset.x / zoom));
    const lastX = Math.min(doc.width - 1, Math.floor((viewWidth - offset.x) / zoom));
    const firstY = Math.max(1, Math.ceil(-offset.y / zoom));
    const lastY = Math.min(doc.height - 1, Math.floor((viewHeight - offset.y) / zoom));
    ctx.beginPath();
    for (let x = firstX; x <= lastX; x += 1) {
      ctx.moveTo(offset.x + x * zoom + 0.5, offset.y);
      ctx.lineTo(offset.x + x * zoom + 0.5, offset.y + doc.height * zoom);
    }
    for (let y = firstY; y <= lastY; y += 1) {
      ctx.moveTo(offset.x, offset.y + y * zoom + 0.5);
      ctx.lineTo(offset.x + doc.width * zoom, offset.y + y * zoom + 0.5);
    }
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /**
   * El rombo de la casilla del nivel y, mas suave, la red de lineas
   * isometricas que pasa por sus lados: con eso una pieza dibujada encaja en
   * la grilla del motor.
   */
  private drawIsoGuide(
    ctx: CanvasRenderingContext2D,
    doc: SpriteDoc,
    offset: PixelPoint,
    zoom: number,
    stroke: string,
    fill: string,
  ): void {
    const grid = this.grid();
    const { cx, cy, halfWidth, halfHeight } = isoDiamond(doc.width, doc.height, grid.tileWidth, grid.tileHeight, this.sprite.isoAnchor());
    const toX = (x: number) => offset.x + x * zoom;
    const toY = (y: number) => offset.y + y * zoom;

    ctx.save();
    ctx.beginPath();
    ctx.rect(offset.x, offset.y, doc.width * zoom, doc.height * zoom);
    ctx.clip();

    // La red: rectas de pendiente +-alto/ancho que pasan por el vertice de
    // arriba, separadas un alto de casilla.
    const slope = halfHeight / halfWidth;
    const top = cy - halfHeight;
    const step = halfHeight * 2;
    const reach = slope * doc.width;
    const first = Math.floor((-top - reach) / step) - 1;
    const last = Math.ceil((doc.height - top + reach) / step) + 1;
    ctx.beginPath();
    for (let k = first; k <= last; k += 1) {
      for (const sign of [1, -1]) {
        const y0 = top + sign * slope * (0 - cx) + k * step;
        const y1 = top + sign * slope * (doc.width - cx) + k * step;
        ctx.moveTo(toX(0), toY(y0));
        ctx.lineTo(toX(doc.width), toY(y1));
      }
    }
    ctx.strokeStyle = stroke;
    // Lo justo para leerse tambien sobre el tablero crema del tema claro.
    ctx.globalAlpha = 0.32;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(toX(cx), toY(cy - halfHeight));
    ctx.lineTo(toX(cx + halfWidth), toY(cy));
    ctx.lineTo(toX(cx), toY(cy + halfHeight));
    ctx.lineTo(toX(cx - halfWidth), toY(cy));
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }

  /** El contorno del pincel (o del pixel) bajo el cursor, con halo para leerse sobre cualquier color. */
  private drawCursor(ctx: CanvasRenderingContext2D, hover: PixelPoint, offset: PixelPoint, zoom: number, color: string, halo: string): void {
    const tool = this.sprite.tool();
    const size = tool === 'bucket' || tool === 'picker' ? 1 : this.sprite.brushSize();
    const origin = brushOrigin(hover.x, hover.y, size);
    const x = offset.x + origin.x * zoom;
    const y = offset.y + origin.y * zoom;
    ctx.lineWidth = 3;
    ctx.strokeStyle = halo;
    ctx.strokeRect(x - 0.5, y - 0.5, size * zoom + 1, size * zoom + 1);
    ctx.lineWidth = 1;
    ctx.strokeStyle = color;
    ctx.strokeRect(x - 0.5, y - 0.5, size * zoom + 1, size * zoom + 1);
  }
}

/** Un canvas fuera de pantalla del tamaño del sprite con los pixeles de un cuadro. */
class FrameBitmap {
  private canvas: HTMLCanvasElement | null = null;
  private loaded: Uint8ClampedArray | null = null;

  load(pixels: Uint8ClampedArray, doc: SpriteDoc): HTMLCanvasElement {
    const canvas = (this.canvas ??= document.createElement('canvas'));
    if (canvas.width !== doc.width || canvas.height !== doc.height) {
      canvas.width = doc.width;
      canvas.height = doc.height;
      this.loaded = null;
    }
    // El mismo arreglo es el mismo cuadro: moverse por el lienzo no recarga nada.
    if (this.loaded !== pixels) {
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const image = ctx.createImageData(doc.width, doc.height);
        image.data.set(pixels);
        ctx.putImageData(image, 0, 0);
      }
      this.loaded = pixels;
    }
    return canvas;
  }
}
