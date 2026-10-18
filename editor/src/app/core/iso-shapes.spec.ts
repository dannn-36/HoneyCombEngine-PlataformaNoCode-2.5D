import { SHAPES, SHAPE_TEXTURE, shapeCollider, shapeDef, shapeOf, usesShapeSheet } from './iso-shapes';

describe('reconocer una figura de la paleta', () => {
  it('una entidad que apunta al sheet de figuras con un type conocido es esa figura', () => {
    expect(shapeOf({ type: 'cube', texture: SHAPE_TEXTURE })?.id).toBe('cube');
  });

  it('el sheet tambien se reconoce dentro de una subcarpeta', () => {
    expect(usesShapeSheet('pack/' + SHAPE_TEXTURE)).toBe(true);
    expect(shapeOf({ type: 'pillar', texture: 'pack/' + SHAPE_TEXTURE })?.id).toBe('pillar');
  });

  it('una entidad llamada cube con su propio arte no es una figura', () => {
    expect(shapeOf({ type: 'cube', texture: 'textures/mi_cubo.png' })).toBeUndefined();
  });

  it('un nombre parecido al del sheet no cuenta', () => {
    expect(usesShapeSheet(SHAPE_TEXTURE + '.bak')).toBe(false);
    expect(usesShapeSheet('my' + SHAPE_TEXTURE)).toBe(false);
  });

  it('un type desconocido sobre el sheet no es ninguna figura', () => {
    expect(shapeDef('dodecaedro')).toBeUndefined();
    expect(shapeOf({ type: 'dodecaedro', texture: SHAPE_TEXTURE })).toBeUndefined();
  });

  it('los ids de la paleta son unicos, porque se guardan como type de la entidad', () => {
    const ids = SHAPES.map((shape) => shape.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('shapeCollider', () => {
  const tile = { tileWidth: 64, tileHeight: 32 };

  it('un cubo bloquea la celda entera, igual que en levels/figuras.json', () => {
    expect(shapeCollider(shapeDef('cube')!, tile)).toEqual({ width: 64, height: 32, solid: true });
  });

  it('un pilar bloquea solo su base angosta', () => {
    expect(shapeCollider(shapeDef('pillar')!, tile)).toEqual({ width: 27, height: 13, solid: true });
  });

  it('las figuras redondas bloquean con una elipse un poco menor que la casilla', () => {
    expect(shapeCollider(shapeDef('cylinder')!, tile)).toEqual({ width: 52, height: 26, solid: true, shape: 'ellipse' });
    expect(shapeCollider(shapeDef('sphere')!, tile)).toEqual({ width: 51, height: 26, solid: true, shape: 'ellipse' });
    expect(shapeCollider(shapeDef('cone')!, tile).shape).toBe('ellipse');
  });

  it('crece con la cantidad de celdas que ocupa la figura', () => {
    expect(shapeCollider(shapeDef('cube')!, tile, 3)).toEqual({ width: 192, height: 96, solid: true });
    expect(shapeCollider(shapeDef('pillar')!, tile, 2)).toEqual({ width: 54, height: 27, solid: true });
  });

  it('sigue el tamano de tile del nivel', () => {
    expect(shapeCollider(shapeDef('cube')!, { tileWidth: 128, tileHeight: 64 })).toEqual({
      width: 128,
      height: 64,
      solid: true,
    });
  });

  it('toda figura de la paleta tiene una huella de mas de 0 y hasta 1 celda', () => {
    for (const shape of SHAPES) {
      expect(shape.footprint).toBeGreaterThan(0);
      expect(shape.footprint).toBeLessThanOrEqual(1);
    }
  });
});
