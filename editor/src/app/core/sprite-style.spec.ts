import { spriteCropStyle, textureName } from './sprite-style';

describe('spriteCropStyle', () => {
  it('escala el recorte para que su lado mas largo llene la caja', () => {
    const style = spriteCropStyle('data:x', 256, 128, { x: 32, y: 16, width: 32, height: 64 }, 48);
    // Zoom 48 / 64 = 0.75.
    expect(style).toEqual({
      'background-image': 'url(data:x)',
      'background-size': '192px 96px',
      'background-position': '-24px -12px',
      width: '24px',
      height: '48px',
    });
  });

  it('agranda un recorte chico, como el pixel art de 16 px en una caja de 64', () => {
    const style = spriteCropStyle('data:x', 64, 16, { x: 16, y: 0, width: 16, height: 16 }, 64);
    expect(style['background-size']).toBe('256px 64px');
    expect(style['background-position']).toBe('-64px 0px');
    expect(style['width']).toBe('64px');
  });

  it('un recorte vacio no divide por cero', () => {
    const style = spriteCropStyle('data:x', 10, 10, { x: 0, y: 0, width: 0, height: 0 }, 32);
    expect(style['background-size']).toBe('320px 320px');
    expect(style['width']).toBe('0px');
    expect(Object.values(style).some((value) => value.includes('Infinity') || value.includes('NaN'))).toBe(false);
  });
});

describe('textureName', () => {
  it('le saca el prefijo de carpeta que guarda el nivel', () => {
    expect(textureName('textures/heroe.png')).toBe('heroe.png');
  });

  it('conserva las subcarpetas de assets/textures/', () => {
    expect(textureName('textures/presentacion/piso_pasto.png')).toBe('presentacion/piso_pasto.png');
  });

  it('solo quita el prefijo del principio', () => {
    expect(textureName('otros/textures/a.png')).toBe('otros/textures/a.png');
    expect(textureName('a.png')).toBe('a.png');
  });
});
