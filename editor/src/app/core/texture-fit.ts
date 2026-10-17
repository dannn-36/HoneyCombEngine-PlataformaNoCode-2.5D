// Ajuste de imagenes a lo que el motor puede usar como textura de una entidad.
//
// POR QUE HACE FALTA. El motor dibuja cada sprite al tamano de su recorte, uno
// a uno (ZSortSystem::Flush: destinationSize en 0 significa "sin escalar"). No
// hay en el contrato ningun campo de "tamano de dibujo" que lo compense, asi
// que una captura de pantalla de 2377x1837 px usada como textura ocuparia
// decenas de celdas de una grilla de 64 px. La imagen tiene que llegar chica.
//
// LOS REQUISITOS:
//   1. Tamano: el lado mas largo no pasa del ancho de un tile del nivel. Asi el
//      sprite entra en su casilla, que es lo que se ve "dentro de la entidad".
//      Se reduce conservando la proporcion; nunca se agranda.
//   2. Formato: PNG. Es el que el cargador de texturas del motor soporta seguro;
//      JPG, WebP o BMP dependen de con que opciones se compilo la libreria.
//
// Una imagen que ya cumple los dos no se toca.

export interface FittedSize {
  width: number;
  height: number;
  /** true si hubo que reducirla para que entre. */
  scaled: boolean;
}

/** Medidas que tiene que tener una imagen para no pasar de "maxSide" en su lado mas largo. */
export function fitTextureSize(width: number, height: number, maxSide: number): FittedSize {
  const longest = Math.max(width, height);
  if (longest <= maxSide) {
    return { width, height, scaled: false };
  }
  const factor = longest / maxSide;
  return {
    // Minimo 1: una imagen muy alargada no puede quedar con un lado en cero.
    width: Math.max(1, Math.round(width / factor)),
    height: Math.max(1, Math.round(height / factor)),
    scaled: true,
  };
}

/**
 * Si conviene reducir SIN interpolar. Pixel art reducido a la mitad o a un
 * cuarto conserva sus bordes duros con vecino mas cercano; una captura o una
 * foto reducida treinta veces asi queda hecha ruido, y necesita suavizado.
 * Por eso cuenta solo un factor entero y chico.
 */
export function usesNearestNeighbor(sourceWidth: number, fitted: FittedSize): boolean {
  if (!fitted.scaled) {
    return true;
  }
  const factor = sourceWidth / fitted.width;
  return Number.isInteger(factor) && factor <= 4;
}

// --- Convertidor de imagenes ------------------------------------------------
//
// El convertidor (textures/image-converter.controller.ts) aplica las mismas
// dos reglas, pero deja elegir el tamano y como se reduce, en vez de fijarlos
// al tile del nivel abierto.

/**
 * Hasta donde se reduce:
 *   tile      el lado mas largo al ancho del tile, como Importar
 *   custom    el lado mas largo a un tope elegido a mano
 *   original  sin reducir: solo cambia el formato
 */
export type ConvertSizeMode = 'tile' | 'custom' | 'original';

/**
 * Como se reduce:
 *   auto    como Importar (ver usesNearestNeighbor)
 *   pixel   siempre vecino mas cercano: bordes duros, para pixel art
 *   smooth  siempre suavizado: para fotos y capturas
 */
export type ConvertFilter = 'auto' | 'pixel' | 'smooth';

/** Tope del lado elegido a mano: mas chico no se ve, mas grande no tiene sentido como sprite. */
export const CONVERT_SIDE_MIN = 1;
export const CONVERT_SIDE_MAX = 4096;

/** Medidas finales de una imagen segun el modo de tamano del convertidor. */
export function convertedSize(
  width: number,
  height: number,
  mode: ConvertSizeMode,
  tileWidth: number,
  customSide: number,
): FittedSize {
  if (mode === 'original') {
    return { width, height, scaled: false };
  }
  const side = mode === 'tile' ? tileWidth : customSide;
  // Un tope roto (vacio, 0, NaN) no puede dejar la imagen en 0x0.
  const maxSide = Number.isFinite(side)
    ? Math.min(CONVERT_SIDE_MAX, Math.max(CONVERT_SIDE_MIN, Math.round(side)))
    : CONVERT_SIDE_MAX;
  return fitTextureSize(width, height, maxSide);
}

/** Si el convertidor reduce sin interpolar. */
export function convertsWithNearest(filter: ConvertFilter, sourceWidth: number, fitted: FittedSize): boolean {
  if (filter === 'pixel') {
    return true;
  }
  if (filter === 'smooth') {
    return false;
  }
  return usesNearestNeighbor(sourceWidth, fitted);
}

/** Decodifica una imagen que llega como data URL. */
export function decodeImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('no se pudo decodificar la imagen'));
    image.src = dataUrl;
  });
}

/** Dibuja la imagen al tamano pedido y la devuelve como data URL PNG. */
export function renderPng(
  image: HTMLImageElement,
  size: { width: number; height: number },
  nearest: boolean,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('el navegador no dio un contexto 2D para convertir la imagen');
  }
  ctx.imageSmoothingEnabled = !nearest;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, 0, 0, size.width, size.height);
  return canvas.toDataURL('image/png');
}

/** Lo mismo, pero solo el base64, que es lo que se escribe a disco. */
export function renderPngBase64(
  image: HTMLImageElement,
  size: { width: number; height: number },
  nearest: boolean,
): string {
  return renderPng(image, size, nearest).slice('data:image/png;base64,'.length);
}

/** Una textura ya decodificada: su imagen como data URL y sus medidas reales. */
export interface TextureAsset {
  dataUrl: string;
  width: number;
  height: number;
  /** Cuadros que la imagen dice tener (ver core/sprite-frames.ts); 1 si no dice nada. */
  frames: number;
  frameDuration: number;
}
