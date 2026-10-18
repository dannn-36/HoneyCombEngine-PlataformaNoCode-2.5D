import { CANVAS_PALETTES } from '../core/themes';
import { ThemeService } from './theme.service';

const KEY = 'honeycomb.theme';

describe('ThemeService', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('sin preferencia guardada arranca con el tema oscuro', () => {
    expect(new ThemeService().theme()).toBe('honeycomb');
  });

  it('recuerda el tema elegido entre sesiones', () => {
    new ThemeService().set('pastel');
    expect(localStorage.getItem(KEY)).toBe('pastel');
    expect(new ThemeService().theme()).toBe('pastel');
  });

  it('un valor guardado que no es un tema vuelve al de siempre', () => {
    localStorage.setItem(KEY, 'neon');
    expect(new ThemeService().theme()).toBe('honeycomb');
  });

  it('la paleta de los canvas sigue al tema', () => {
    const service = new ThemeService();
    expect(service.canvas()).toBe(CANVAS_PALETTES.honeycomb);
    service.set('pastel');
    expect(service.canvas()).toBe(CANVAS_PALETTES.pastel);
  });

  it('sin almacenamiento el tema vale para la sesion y no rompe', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    const service = new ThemeService();
    expect(service.theme()).toBe('honeycomb');
    expect(() => service.set('pastel')).not.toThrow();
    expect(service.theme()).toBe('pastel');
  });

  it('los dos temas tienen todos los colores de los canvas', () => {
    const keys = Object.keys(CANVAS_PALETTES.honeycomb).sort();
    expect(Object.keys(CANVAS_PALETTES.pastel).sort()).toEqual(keys);
    for (const palette of Object.values(CANVAS_PALETTES)) {
      for (const value of Object.values(palette)) {
        expect(value).toMatch(/^(#|rgba?\()/);
      }
    }
  });
});
