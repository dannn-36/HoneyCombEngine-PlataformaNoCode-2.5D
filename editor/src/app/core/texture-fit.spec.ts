import {
  convertedSize,
  convertsWithNearest,
  decodeImage,
  fitTextureSize,
  renderPng,
  renderPngBase64,
  usesNearestNeighbor,
} from './texture-fit';

describe('decodeImage', () => {
  /** Imagen de mentira: carga o falla apenas recibe el src, segun lo que diga. */
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private value = '';
    get src() {
      return this.value;
    }
    set src(value: string) {
      this.value = value;
      queueMicrotask(() => (value.startsWith('data:image/') ? this.onload?.() : this.onerror?.()));
    }
  }

  beforeEach(() => vi.stubGlobal('Image', FakeImage));
  afterEach(() => vi.unstubAllGlobals());

  it('devuelve la imagen ya decodificada, con su src', async () => {
    const image = await decodeImage('data:image/png;base64,AAAA');
    expect(image).toBeInstanceOf(FakeImage);
    expect(image.src).toBe('data:image/png;base64,AAAA');
  });

  it('un archivo que no es una imagen falla con un mensaje entendible', async () => {
    await expect(decodeImage('data:text/plain,hola')).rejects.toThrow('no se pudo decodificar la imagen');
  });
});

describe('renderPng', () => {
  const image = { name: 'origen' } as unknown as HTMLImageElement;

  /** Contexto que anota como se le pidio dibujar. */
  function stubCanvas(ctx: Record<string, unknown> | null) {
    let canvas: HTMLCanvasElement | null = null;
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
      canvas = this;
      return ctx as unknown as CanvasRenderingContext2D;
    } as never);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,QUJD');
    return () => canvas;
  }

  afterEach(() => vi.restoreAllMocks());

  it('dibuja la imagen entera al tamano pedido y devuelve un PNG', () => {
    const drawImage = vi.fn();
    const ctx: Record<string, unknown> = { drawImage };
    const canvas = stubCanvas(ctx);
    expect(renderPng(image, { width: 40, height: 30 }, true)).toBe('data:image/png;base64,QUJD');
    expect(canvas()?.width).toBe(40);
    expect(canvas()?.height).toBe(30);
    expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 40, 30);
    expect(HTMLCanvasElement.prototype.toDataURL).toHaveBeenCalledWith('image/png');
  });

  it('con vecino mas cercano apaga el suavizado, y sin el lo deja en alta calidad', () => {
    const pixel: Record<string, unknown> = { drawImage: vi.fn() };
    stubCanvas(pixel);
    renderPng(image, { width: 8, height: 8 }, true);
    expect(pixel['imageSmoothingEnabled']).toBe(false);

    vi.restoreAllMocks();
    const smooth: Record<string, unknown> = { drawImage: vi.fn() };
    stubCanvas(smooth);
    renderPng(image, { width: 8, height: 8 }, false);
    expect(smooth['imageSmoothingEnabled']).toBe(true);
    expect(smooth['imageSmoothingQuality']).toBe('high');
  });

  it('sin contexto 2D falla con un mensaje en vez de devolver un PNG vacio', () => {
    stubCanvas(null);
    expect(() => renderPng(image, { width: 8, height: 8 }, true)).toThrow('contexto 2D');
  });

  it('para escribir a disco deja solo el base64, sin el encabezado', () => {
    stubCanvas({ drawImage: vi.fn() });
    expect(renderPngBase64(image, { width: 8, height: 8 }, true)).toBe('QUJD');
  });
});

describe('fitTextureSize', () => {
  it('no toca una imagen que ya entra en el tile', () => {
    expect(fitTextureSize(32, 16, 64)).toEqual({ width: 32, height: 16, scaled: false });
  });

  it('deja igual una imagen justo del ancho del tile', () => {
    expect(fitTextureSize(64, 64, 64)).toEqual({ width: 64, height: 64, scaled: false });
  });

  it('reduce una captura de pantalla conservando la proporcion', () => {
    expect(fitTextureSize(2377, 1837, 64)).toEqual({ width: 64, height: 49, scaled: true });
  });

  it('usa el lado mas largo aunque sea el alto', () => {
    expect(fitTextureSize(100, 400, 64)).toEqual({ width: 16, height: 64, scaled: true });
  });

  it('nunca deja un lado en cero', () => {
    expect(fitTextureSize(10, 5000, 64)).toEqual({ width: 1, height: 64, scaled: true });
  });
});

describe('usesNearestNeighbor', () => {
  it('conserva los bordes duros del pixel art reducido a la mitad', () => {
    expect(usesNearestNeighbor(128, fitTextureSize(128, 128, 64))).toBe(true);
  });

  it('suaviza una captura reducida muchas veces', () => {
    expect(usesNearestNeighbor(2377, fitTextureSize(2377, 1837, 64))).toBe(false);
  });

  it('suaviza aunque el factor sea entero si es grande', () => {
    expect(usesNearestNeighbor(512, fitTextureSize(512, 512, 64))).toBe(false);
  });
});

describe('convertedSize', () => {
  it('en modo tile reduce igual que Importar', () => {
    expect(convertedSize(720, 960, 'tile', 64, 200)).toEqual(fitTextureSize(720, 960, 64));
  });

  it('en modo custom usa el tope elegido', () => {
    expect(convertedSize(720, 960, 'custom', 64, 128)).toEqual({ width: 96, height: 128, scaled: true });
  });

  it('en modo original no reduce nunca', () => {
    expect(convertedSize(2377, 1837, 'original', 64, 128)).toEqual({ width: 2377, height: 1837, scaled: false });
  });

  it('un tope roto no deja la imagen en cero', () => {
    expect(convertedSize(360, 360, 'custom', 64, Number.NaN)).toEqual({ width: 360, height: 360, scaled: false });
    expect(convertedSize(360, 360, 'custom', 64, 0)).toEqual({ width: 1, height: 1, scaled: true });
  });
});

describe('convertsWithNearest', () => {
  const photo = fitTextureSize(2377, 1837, 64);

  it('pixel fuerza bordes duros aunque sea una foto', () => {
    expect(convertsWithNearest('pixel', 2377, photo)).toBe(true);
  });

  it('smooth fuerza suavizado aunque sea pixel art', () => {
    expect(convertsWithNearest('smooth', 128, fitTextureSize(128, 128, 64))).toBe(false);
  });

  it('auto decide como Importar', () => {
    expect(convertsWithNearest('auto', 2377, photo)).toBe(usesNearestNeighbor(2377, photo));
  });
});
