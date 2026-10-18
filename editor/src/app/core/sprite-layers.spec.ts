// Las capas de un sprite dentro de su PNG: que viajen con el archivo, que no
// molesten al resto, y que no se usen si la imagen cambio por fuera.

import { docFromLayers, layerStripPixels } from './sprite-doc';
import { base64ToBytes, bytesToBase64, readSpriteFrames, withSpriteFrames } from './sprite-frames';
import { StoredLayers, readSpriteLayers, withSpriteLayers } from './sprite-layers';

/** Un PNG de 1x1 valido (firma, IHDR, IDAT, IEND). */
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYPj/HwADAgH/kr6YxgAAAABJRU5ErkJggg==';
const dataUrl = (base64: string) => 'data:image/png;base64,' + base64;

const STORED: StoredLayers = {
  width: 1,
  height: 1,
  frames: 1,
  layers: [
    { name: 'Fondo', visible: true, png: PNG_1X1 },
    { name: 'Boceto ñandú', visible: false, png: PNG_1X1 },
  ],
};

/** Los tipos de bloque de un PNG, en orden. */
function chunkTypes(base64: string): string[] {
  const bytes = base64ToBytes(base64);
  const types: string[] = [];
  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length = new DataView(bytes.buffer, bytes.byteOffset).getUint32(offset);
    types.push(String.fromCharCode(...bytes.subarray(offset + 4, offset + 8)));
    offset += 12 + length;
  }
  return types;
}

describe('capas dentro del PNG', () => {
  it('se guardan antes del final del archivo y se vuelven a leer iguales', () => {
    const png = withSpriteLayers(PNG_1X1, STORED);
    expect(chunkTypes(png)).toEqual(['IHDR', 'IDAT', 'hcLY', 'IEND']);
    expect(readSpriteLayers(dataUrl(png))).toEqual(STORED);
  });

  it('conviven con el bloque de los cuadros', () => {
    const png = withSpriteLayers(withSpriteFrames(PNG_1X1, { frames: 2, frameDuration: 0.2 }), STORED);
    expect(chunkTypes(png)).toEqual(['IHDR', 'tEXt', 'IDAT', 'hcLY', 'IEND']);
    expect(readSpriteFrames(dataUrl(png))).toEqual({ frames: 2, frameDuration: 0.2 });
    expect(readSpriteLayers(dataUrl(png))?.layers).toHaveLength(2);
  });

  it('guardar de nuevo reemplaza el bloque, no lo suma', () => {
    const once = withSpriteLayers(PNG_1X1, STORED);
    const twice = withSpriteLayers(once, { ...STORED, layers: [STORED.layers[0]] });
    expect(chunkTypes(twice).filter((type) => type === 'hcLY')).toHaveLength(1);
    expect(readSpriteLayers(dataUrl(twice))?.layers).toHaveLength(1);
  });

  it('una imagen sin el bloque no trae capas', () => {
    expect(readSpriteLayers(dataUrl(PNG_1X1))).toBeNull();
    expect(readSpriteLayers('data:image/jpeg;base64,AAAA')).toBeNull();
    expect(readSpriteLayers(dataUrl('no es base64 valido!'))).toBeNull();
  });

  it('si otro programa cambio la imagen, las capas no se usan', () => {
    const bytes = base64ToBytes(withSpriteLayers(PNG_1X1, STORED));
    // Un byte de la imagen (adentro del IDAT) distinto, con el bloque de capas intacto.
    const idat = 8 + 25 + 8;
    bytes[idat + 2] ^= 0xff;
    expect(readSpriteLayers(dataUrl(bytesToBase64(bytes)))).toBeNull();
  });

  it('un PNG que no se puede leer sale igual', () => {
    expect(withSpriteLayers('AAAA', STORED)).toBe('AAAA');
  });
});

describe('el sprite a partir de sus capas', () => {
  const rgba = (...values: number[]) => new Uint8ClampedArray(values);

  it('arma los cuadros de cada capa desde su tira, y layerStripPixels la vuelve a armar', () => {
    // Dos cuadros de 1x1: la capa "a" es roja y despues verde, la "b" transparente y azul.
    const doc = docFromLayers(1, 1, 2, [
      { name: 'a', visible: true, pixels: rgba(255, 0, 0, 255, 0, 255, 0, 255) },
      { name: 'b', visible: false, pixels: rgba(0, 0, 0, 0, 0, 0, 255, 255) },
    ]);
    expect(doc.frames).toHaveLength(2);
    expect(doc.layers.map((layer) => [layer.name, layer.visible])).toEqual([
      ['a', true],
      ['b', false],
    ]);
    expect([...doc.frames[1].cels[doc.layers[1].id]]).toEqual([0, 0, 255, 255]);
    expect([...layerStripPixels(doc, doc.layers[0].id)]).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  });

  it('rechaza tiras que no tienen el tamaño del sprite', () => {
    expect(() => docFromLayers(2, 2, 1, [{ name: 'x', visible: true, pixels: rgba(1, 2, 3, 4) }])).toThrow(/tamaño/);
    expect(() => docFromLayers(1, 1, 1, [])).toThrow(/capas/);
  });
});
