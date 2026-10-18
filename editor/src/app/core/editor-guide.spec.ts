// La guia del editor: valores en rango, y que se recuerde sin romper si no hay donde.

import {
  GUIDE_MARGIN_MAX,
  GUIDE_MARGIN_MIN,
  GUIDE_OPACITY_MIN,
  defaultGuide,
  sanitizeGuide,
  storeGuide,
  storedGuide,
} from './editor-guide';

describe('guia del editor', () => {
  afterEach(() => localStorage.clear());

  it('arranca oculta', () => {
    expect(defaultGuide().visible).toBe(false);
    expect(sanitizeGuide(null)).toEqual(defaultGuide());
  });

  it('lleva los valores a rango y redondea las casillas', () => {
    expect(sanitizeGuide({ margin: 0, opacity: 0 })).toEqual({ ...defaultGuide(), margin: GUIDE_MARGIN_MIN, opacity: GUIDE_OPACITY_MIN });
    expect(sanitizeGuide({ margin: 500, opacity: 7 }).margin).toBe(GUIDE_MARGIN_MAX);
    expect(sanitizeGuide({ margin: 4.6 }).margin).toBe(5);
    expect(sanitizeGuide({ margin: Number.NaN, visible: 'si' })).toEqual(defaultGuide());
  });

  it('se recuerda en este equipo', () => {
    storeGuide({ visible: true, margin: 20, opacity: 0.8 });
    expect(storedGuide()).toEqual({ visible: true, margin: 20, opacity: 0.8 });
  });

  it('lo guardado roto vuelve a la de siempre', () => {
    localStorage.setItem('honeycomb.editorGuide', '{ roto');
    expect(storedGuide()).toEqual(defaultGuide());
  });
});
