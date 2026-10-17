import {
  SPRITE_SIDE_MAX,
  TRANSPARENT,
  addFrame,
  addLayer,
  compositeFrame,
  createDoc,
  docFromImage,
  duplicateLayer,
  flipPixels,
  floodFill,
  isoDiamond,
  linePoints,
  moveFrame,
  moveLayer,
  patchLayer,
  pixelAt,
  rectPoints,
  removeFrame,
  removeLayer,
  setCel,
  snapLineEnd,
  splitIntoFrames,
  stampBrush,
  stripPixels,
  uniqueColors,
} from './sprite-doc';

const RED = { r: 255, g: 0, b: 0, a: 255 };
const BLUE = { r: 0, g: 0, b: 255, a: 255 };

/** Un cel de w x h con un solo pixel pintado. */
function celWith(w: number, h: number, x: number, y: number, color = RED): Uint8ClampedArray {
  const pixels = new Uint8ClampedArray(w * h * 4);
  stampBrush(pixels, w, h, x, y, 1, color);
  return pixels;
}

describe('createDoc', () => {
  it('arranca con una capa y un cuadro transparentes', () => {
    const doc = createDoc(4, 3);
    expect(doc.layers.length).toBe(1);
    expect(doc.frames.length).toBe(1);
    expect(doc.frames[0].cels[doc.layers[0].id].every((byte) => byte === 0)).toBe(true);
  });

  it('acota el lado entre 1 y el maximo', () => {
    expect(createDoc(0, 5000)).toMatchObject({ width: 1, height: SPRITE_SIDE_MAX });
  });
});

describe('docFromImage', () => {
  it('parte una tira en cuadros iguales', () => {
    const pixels = new Uint8ClampedArray(4 * 1 * 4);
    stampBrush(pixels, 4, 1, 3, 0, 1, RED);
    const doc = docFromImage(pixels, 4, 1, 2);
    expect(doc.width).toBe(2);
    expect(doc.frames.length).toBe(2);
    const layer = doc.layers[0].id;
    expect(pixelAt(doc.frames[1].cels[layer], 2, 1, 0)).toEqual(RED);
    expect(pixelAt(doc.frames[0].cels[layer], 2, 1, 0)).toEqual(TRANSPARENT);
  });

  it('falla si el ancho no se divide en partes iguales', () => {
    expect(() => docFromImage(new Uint8ClampedArray(5 * 4), 5, 1, 2)).toThrow();
  });
});

describe('splitIntoFrames', () => {
  it('parte un sprite de un cuadro en varios, en todas sus capas', () => {
    const base = createDoc(4, 1);
    const { doc } = addLayer(base);
    const split = splitIntoFrames(doc, 4);
    expect(split?.width).toBe(1);
    expect(split?.frames.length).toBe(4);
    expect(Object.keys(split!.frames[3].cels).length).toBe(2);
  });

  it('no parte si ya tiene varios cuadros o el ancho no da', () => {
    const doc = createDoc(4, 1);
    expect(splitIntoFrames(doc, 3)).toBeNull();
    expect(splitIntoFrames(addFrame(doc, 0, false).doc, 2)).toBeNull();
  });
});

describe('capas', () => {
  it('agrega una capa encima de la elegida con un nombre libre', () => {
    const doc = createDoc(2, 2);
    const first = doc.layers[0].id;
    const { doc: next, layerId } = addLayer(doc, first);
    expect(next.layers.map((layer) => layer.id)).toEqual([first, layerId]);
    expect(next.layers[1].name).toBe('Capa 2');
    expect(next.frames[0].cels[layerId]).toBeDefined();
  });

  it('no saca la ultima capa', () => {
    const doc = createDoc(2, 2);
    expect(removeLayer(doc, doc.layers[0].id)).toBe(doc);
  });

  it('saca una capa y sus cels', () => {
    const { doc, layerId } = addLayer(createDoc(2, 2));
    const next = removeLayer(doc, layerId);
    expect(next.layers.length).toBe(1);
    expect(next.frames[0].cels[layerId]).toBeUndefined();
  });

  it('mueve una capa y no se sale de la pila', () => {
    const { doc, layerId } = addLayer(createDoc(2, 2));
    const down = moveLayer(doc, layerId, -1);
    expect(down.layers[0].id).toBe(layerId);
    expect(moveLayer(down, layerId, -1)).toBe(down);
  });

  it('duplica compartiendo los pixeles', () => {
    const doc = createDoc(2, 2);
    const id = doc.layers[0].id;
    const { doc: next, layerId } = duplicateLayer(doc, id);
    expect(next.frames[0].cels[layerId]).toBe(next.frames[0].cels[id]);
    expect(next.layers[1].name).toBe('Capa 1 copia');
  });
});

describe('cuadros', () => {
  it('agrega un cuadro vacio o una copia despues del elegido', () => {
    const doc = createDoc(2, 2);
    const layer = doc.layers[0].id;
    const painted = setCel(doc, 0, layer, celWith(2, 2, 1, 1));
    const copy = addFrame(painted, 0, true);
    expect(copy.index).toBe(1);
    expect(copy.doc.frames[1].cels[layer]).toBe(painted.frames[0].cels[layer]);
    const blank = addFrame(painted, 0, false);
    expect(blank.doc.frames[1].cels[layer].every((byte) => byte === 0)).toBe(true);
  });

  it('no saca el ultimo cuadro, y mueve dentro de los limites', () => {
    const doc = createDoc(2, 2);
    expect(removeFrame(doc, 0)).toBe(doc);
    const two = addFrame(doc, 0, false).doc;
    const moved = moveFrame(two, 0, 1);
    expect(moved.frames[1].id).toBe(two.frames[0].id);
    expect(moveFrame(two, 1, 1)).toBe(two);
  });
});

describe('compositeFrame y stripPixels', () => {
  it('pone las capas de arriba encima y salta las ocultas', () => {
    const base = createDoc(1, 1);
    const bottom = base.layers[0].id;
    const { doc, layerId: top } = addLayer(base);
    const painted = setCel(setCel(doc, 0, bottom, celWith(1, 1, 0, 0, RED)), 0, top, celWith(1, 1, 0, 0, BLUE));
    expect(pixelAt(compositeFrame(painted, 0), 1, 0, 0)).toEqual(BLUE);
    const hidden = patchLayer(painted, top, { visible: false });
    expect(pixelAt(compositeFrame(hidden, 0), 1, 0, 0)).toEqual(RED);
  });

  it('mezcla un pixel semitransparente con el de abajo', () => {
    const base = createDoc(1, 1);
    const withRed = setCel(base, 0, base.layers[0].id, celWith(1, 1, 0, 0, RED));
    const { doc, layerId } = addLayer(withRed);
    const half = setCel(doc, 0, layerId, celWith(1, 1, 0, 0, { r: 0, g: 0, b: 255, a: 128 }));
    const pixel = pixelAt(compositeFrame(half, 0), 1, 0, 0);
    expect(pixel.a).toBe(255);
    expect(pixel.r).toBeGreaterThan(100);
    expect(pixel.b).toBeGreaterThan(100);
  });

  it('usa los pixeles del trazo en curso en vez de los del documento', () => {
    const doc = createDoc(1, 1);
    const layerId = doc.layers[0].id;
    expect(pixelAt(compositeFrame(doc, 0, { layerId, pixels: celWith(1, 1, 0, 0) }), 1, 0, 0)).toEqual(RED);
  });

  it('pone los cuadros uno al lado del otro', () => {
    const doc = createDoc(1, 1);
    const layer = doc.layers[0].id;
    const two = addFrame(doc, 0, false).doc;
    const painted = setCel(two, 1, layer, celWith(1, 1, 0, 0));
    const strip = stripPixels(painted);
    expect(strip.width).toBe(2);
    expect(pixelAt(strip.pixels, 2, 0, 0)).toEqual(TRANSPARENT);
    expect(pixelAt(strip.pixels, 2, 1, 0)).toEqual(RED);
  });
});

describe('dibujo', () => {
  it('el pincel cubre su lado alrededor del cursor y no se sale del lienzo', () => {
    const pixels = new Uint8ClampedArray(3 * 3 * 4);
    stampBrush(pixels, 3, 3, 0, 0, 3, RED);
    expect(pixelAt(pixels, 3, 0, 0)).toEqual(RED);
    expect(pixelAt(pixels, 3, 1, 1)).toEqual(RED);
    expect(pixelAt(pixels, 3, 2, 2)).toEqual(TRANSPARENT);
  });

  it('la linea va de punta a punta sin huecos', () => {
    const points = linePoints(0, 0, 5, 2);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[points.length - 1]).toEqual({ x: 5, y: 2 });
    expect(points.length).toBe(6);
  });

  it('la 2:1 exacta sale en pares de dos pixeles', () => {
    expect(linePoints(0, 0, 4, 2)).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 1 },
      { x: 3, y: 1 },
      { x: 4, y: 2 },
    ]);
  });

  it('Shift lleva la linea al angulo isometrico mas cercano', () => {
    expect(snapLineEnd({ x: 0, y: 0 }, { x: 10, y: 4 })).toEqual({ x: 10, y: 5 });
    expect(snapLineEnd({ x: 0, y: 0 }, { x: 10, y: 1 })).toEqual({ x: 10, y: 0 });
    expect(snapLineEnd({ x: 0, y: 0 }, { x: -6, y: 6 })).toEqual({ x: -6, y: 6 });
  });

  it('el rectangulo es el borde, o lleno con Shift', () => {
    expect(rectPoints(0, 0, 2, 2, false).length).toBe(8);
    expect(rectPoints(2, 2, 0, 0, true).length).toBe(9);
  });

  it('el balde rellena solo lo contiguo del mismo color', () => {
    // Una columna roja en x = 1 separa la izquierda de la derecha.
    const pixels = new Uint8ClampedArray(3 * 2 * 4);
    stampBrush(pixels, 3, 2, 1, 0, 1, RED);
    stampBrush(pixels, 3, 2, 1, 1, 1, RED);
    expect(floodFill(pixels, 3, 2, 0, 0, BLUE)).toBe(true);
    expect(pixelAt(pixels, 3, 0, 1)).toEqual(BLUE);
    expect(pixelAt(pixels, 3, 2, 0)).toEqual(TRANSPARENT);
    expect(floodFill(pixels, 3, 2, 0, 0, BLUE)).toBe(false);
  });

  it('espeja un cel', () => {
    const flipped = flipPixels(celWith(3, 1, 0, 0), 3, 1, 'horizontal');
    expect(pixelAt(flipped, 3, 2, 0)).toEqual(RED);
    expect(pixelAt(flipped, 3, 0, 0)).toEqual(TRANSPARENT);
  });
});

describe('uniqueColors', () => {
  it('junta los colores opacos sin repetir', () => {
    const doc = createDoc(2, 1);
    const pixels = celWith(2, 1, 0, 0);
    stampBrush(pixels, 2, 1, 1, 0, 1, RED);
    expect(uniqueColors(setCel(doc, 0, doc.layers[0].id, pixels), 10)).toEqual(['#ff0000']);
  });
});

describe('isoDiamond', () => {
  it('apoya el rombo segun lo que se dibuja', () => {
    expect(isoDiamond(64, 64, 64, 32, 'base')).toEqual({ cx: 32, cy: 48, halfWidth: 32, halfHeight: 16 });
    expect(isoDiamond(64, 32, 64, 32, 'centro').cy).toBe(16);
    expect(isoDiamond(32, 48, 64, 32, 'pies').cy).toBe(48);
  });
});
