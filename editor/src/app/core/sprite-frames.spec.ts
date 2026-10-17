import { isStripRect, readSpriteFrames, stripRect, withSpriteFrames } from './sprite-frames';

/** Un PNG valido de 1x1, sin bloques de texto. */
const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

const asDataUrl = (base64: string) => 'data:image/png;base64,' + base64;

function bytesOf(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

describe('stripRect', () => {
  it('parte la imagen en cuadros iguales, uno al lado del otro', () => {
    expect(stripRect(128, 32, 4)).toEqual({ x: 0, y: 0, width: 32, height: 32 });
  });

  it('con un cuadro es la imagen entera', () => {
    expect(stripRect(64, 60, 1)).toEqual({ x: 0, y: 0, width: 64, height: 60 });
  });

  it('nunca deja el ancho en cero', () => {
    expect(stripRect(3, 3, 8).width).toBe(1);
  });
});

describe('isStripRect', () => {
  it('reconoce el recorte que se puso solo al elegir la imagen', () => {
    expect(isStripRect({ x: 0, y: 0, width: 32, height: 32 }, 128, 32, 4)).toBe(true);
  });

  it('no confunde un recorte hecho a mano con una tira', () => {
    expect(isStripRect({ x: 18, y: 15, width: 32, height: 30 }, 64, 60, 1)).toBe(false);
    expect(isStripRect({ x: 0, y: 0, width: 32, height: 32 }, 128, 32, 2)).toBe(false);
  });
});

describe('cuadros dentro del PNG', () => {
  it('ida y vuelta: lo que se escribe es lo que se lee', () => {
    const png = withSpriteFrames(PNG_1X1, { frames: 4, frameDuration: 0.12 });
    expect(readSpriteFrames(asDataUrl(png))).toEqual({ frames: 4, frameDuration: 0.12 });
  });

  it('el bloque va despues de IHDR, con su CRC, y el resto del PNG queda igual', () => {
    const original = bytesOf(PNG_1X1);
    const written = bytesOf(withSpriteFrames(PNG_1X1, { frames: 4, frameDuration: 0.12 }));
    const text = 'HoneyComb\0{"frames":4,"frameDuration":0.12}';
    const chunkLength = 12 + text.length;

    expect(written.length).toBe(original.length + chunkLength);
    expect(Array.from(written.subarray(0, 33))).toEqual(Array.from(original.subarray(0, 33)));
    expect(String.fromCharCode(...written.subarray(37, 41))).toBe('tEXt');
    // CRC de referencia calculado aparte, con zlib.crc32 de Node.
    const crc = new DataView(written.buffer).getUint32(41 + text.length);
    expect(crc).toBe(0x6e852a08);
    expect(Array.from(written.subarray(33 + chunkLength))).toEqual(Array.from(original.subarray(33)));
  });

  it('un PNG de un solo cuadro no cambia', () => {
    expect(withSpriteFrames(PNG_1X1, { frames: 1, frameDuration: 0.12 })).toBe(PNG_1X1);
  });

  it('una imagen sin el bloque no dice nada: se toma como un cuadro', () => {
    expect(readSpriteFrames(asDataUrl(PNG_1X1))).toBeNull();
  });

  it('no intenta leer lo que no es PNG', () => {
    expect(readSpriteFrames('data:image/jpeg;base64,/9j/4AAQSkZJRg==')).toBeNull();
    expect(readSpriteFrames('data:image/png;base64,no es base64!')).toBeNull();
  });
});
