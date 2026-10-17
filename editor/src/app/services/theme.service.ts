// HoneyComb Engine - Editor (tema de color)
//
// Dos temas que comparten la misma regla: el amarillo de Ejecutar va como
// detalle (linea, icono, borde, anillo) y en las paredes del lienzo, y en los
// paneles nunca como fondo, salvo en Ejecutar y en el primario de los dialogos.
//
//   honeycomb  oscuro neutro, el de entrada.
//   pastel     claro, crema con miel mantequilla y detalles en dorado.
//
// Guarda el tema elegido entre sesiones. Los colores estan en app.scss (los
// paneles) y en core/themes.ts (los canvas).

import { Injectable, signal } from '@angular/core';

import { CANVAS_PALETTES, CanvasPalette, THEMES, ThemeId } from '../core/themes';

const STORAGE_KEY = 'honeycomb.theme';

function isTheme(value: unknown): value is ThemeId {
  return THEMES.some((theme) => theme.id === value);
}

/** Lee la preferencia guardada. Sin almacenamiento (tests, modo privado) queda el de siempre. */
function storedTheme(): ThemeId {
  try {
    const value = globalThis.localStorage?.getItem(STORAGE_KEY);
    return isTheme(value) ? value : 'honeycomb';
  } catch {
    return 'honeycomb';
  }
}

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<ThemeId>(storedTheme());

  /** La paleta de los canvas del tema actual. Leerla dentro de un effect() redibuja al cambiar de tema. */
  canvas(): CanvasPalette {
    return CANVAS_PALETTES[this.theme()];
  }

  set(theme: ThemeId): void {
    this.theme.set(theme);
    try {
      globalThis.localStorage?.setItem(STORAGE_KEY, theme);
    } catch {
      // Sin almacenamiento el tema vale para esta sesion y nada mas.
    }
  }
}
