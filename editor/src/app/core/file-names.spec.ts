import { levelFileName, safeName } from './file-names';

describe('safeName', () => {
  it('deja igual un nombre que ya es seguro', () => {
    expect(safeName('nivel_1 (copia)', 'x')).toBe('nivel_1 (copia)');
  });

  it('cambia los acentos por su letra base', () => {
    expect(safeName('canción ñandú', 'x')).toBe('cancion nandu');
  });

  it('cambia simbolos y separadores de ruta por "_"', () => {
    expect(safeName('a/b\\c:d', 'x')).toBe('a_b_c_d');
  });

  it('usa el nombre de reserva si no queda nada', () => {
    expect(safeName('♡', 'imagen')).toBe('imagen');
    expect(safeName('..', 'carpeta')).toBe('carpeta');
  });
});

describe('levelFileName', () => {
  it('agrega .json', () => {
    expect(levelFileName('mi nivel')).toBe('mi nivel.json');
  });

  it('no duplica .json si ya lo trae', () => {
    expect(levelFileName('mi_nivel.JSON')).toBe('mi_nivel.json');
  });

  it('nunca deja un nombre vacio', () => {
    expect(levelFileName('   ')).toBe('nivel.json');
  });
});
