import { convertedSize, convertsWithNearest, fitTextureSize, usesNearestNeighbor } from './texture-fit';

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
