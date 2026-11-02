// Cuentas de la lista de proyectos recientes de la pantalla de Inicio.

import { sameRoot, timeAgo } from './recent-files';

describe('recent-files', () => {
  it('compara carpetas sin importar barras ni mayusculas', () => {
    expect(sameRoot('C:\\Juegos\\X\\', 'c:/juegos/x')).toBe(true);
    expect(sameRoot('C:\\Juegos\\X', 'C:\\Juegos\\Y')).toBe(false);
  });

  it('cuando, en palabras', () => {
    const now = 1_000_000_000_000;
    const min = 60_000;
    expect(timeAgo(now - 10_000, now)).toBe('hace un momento');
    expect(timeAgo(now - 5 * min, now)).toBe('hace 5 min');
    expect(timeAgo(now - 3 * 60 * min, now)).toBe('hace 3 h');
    expect(timeAgo(now - 30 * 60 * min, now)).toBe('ayer');
    expect(timeAgo(now - 4 * 24 * 60 * min, now)).toBe('hace 4 días');
    expect(timeAgo(now - 30 * 24 * 60 * min, now)).toBe(new Date(now - 30 * 24 * 60 * min).toLocaleDateString());
  });
});
