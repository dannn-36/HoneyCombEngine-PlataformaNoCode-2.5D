// Niveles recientes de la pantalla de Inicio.

import {
  RECENT_LIMIT,
  RecentFile,
  addRecent,
  folderName,
  levelTitle,
  parseRecents,
  removeRecent,
  sameRoot,
  timeAgo,
} from './recent-files';

const entry = (level: string, openedAt = 1, root = 'C:\\Juegos\\Mi juego'): RecentFile => ({ root, level, openedAt });

describe('recent-files', () => {
  it('lo nuevo va primero y no se repite', () => {
    const list = addRecent(addRecent([], entry('a.json', 1)), entry('b.json', 2));
    expect(list.map((item) => item.level)).toEqual(['b.json', 'a.json']);
    const again = addRecent(list, entry('a.json', 3, 'c:/juegos/mi juego/'));
    expect(again.map((item) => item.level)).toEqual(['a.json', 'b.json']);
    expect(again[0].openedAt).toBe(3);
  });

  it('el mismo nivel en otra carpeta es otra entrada', () => {
    const list = addRecent([entry('a.json')], entry('a.json', 2, 'D:\\Otro'));
    expect(list).toHaveLength(2);
  });

  it('se queda con los mas nuevos', () => {
    let list: RecentFile[] = [];
    for (let i = 0; i < RECENT_LIMIT + 5; i++) {
      list = addRecent(list, entry(`n${i}.json`, i));
    }
    expect(list).toHaveLength(RECENT_LIMIT);
    expect(list[0].level).toBe(`n${RECENT_LIMIT + 4}.json`);
  });

  it('quita una entrada', () => {
    const list = [entry('a.json'), entry('b.json')];
    expect(removeRecent(list, { root: 'c:/juegos/mi juego', level: 'A.json' })).toEqual([entry('b.json')]);
  });

  it('lee lo guardado y descarta lo roto', () => {
    expect(parseRecents(null)).toEqual([]);
    expect(parseRecents('no es json')).toEqual([]);
    expect(parseRecents('{"root": "x"}')).toEqual([]);
    const text = JSON.stringify([entry('a.json'), { root: 'x' }, { ...entry('b.json'), extra: true }, null]);
    expect(parseRecents(text)).toEqual([entry('a.json'), entry('b.json')]);
  });

  it('compara carpetas sin importar barras ni mayusculas', () => {
    expect(sameRoot('C:\\Juegos\\X\\', 'c:/juegos/x')).toBe(true);
    expect(sameRoot('C:\\Juegos\\X', 'C:\\Juegos\\Y')).toBe(false);
  });

  it('nombres cortos para la lista', () => {
    expect(folderName('C:\\Users\\yo\\Documents\\HoneyComb')).toBe('HoneyComb');
    expect(folderName('/home/yo/juegos/')).toBe('juegos');
    expect(levelTitle('nivel_1.json')).toBe('nivel_1');
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
