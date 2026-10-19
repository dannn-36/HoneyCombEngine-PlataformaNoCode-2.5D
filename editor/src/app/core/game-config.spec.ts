import {
  creditsFromText,
  creditsToText,
  defaultGameConfig,
  gameConfigForDisk,
  heartFills,
  isVariableName,
  litSegments,
  normalizeGameConfig,
  variableNameFrom,
} from './game-config';

describe('configuracion del juego', () => {
  it('sin archivo queda lo de siempre: 800x450, portada centrada, barra de vida', () => {
    const config = normalizeGameConfig(undefined);
    expect(config).toEqual(defaultGameConfig());
    expect(config.window).toEqual({ width: 800, height: 450, fullscreen: false });
    expect(config.titleScreen.style).toBe('centered');
    expect(config.hud.healthStyle).toBe('bar');
    expect(config.hud.healthBorder).toBeNull();
  });

  it('el volumen de la musica de la portada va de 0 a 100, entero; sin el campo es 100', () => {
    expect(normalizeGameConfig({}).titleScreen.musicVolume).toBe(100);
    expect(normalizeGameConfig({ titleScreen: { musicVolume: 37.4 } }).titleScreen.musicVolume).toBe(37);
    expect(normalizeGameConfig({ titleScreen: { musicVolume: 900 } }).titleScreen.musicVolume).toBe(100);
    expect(normalizeGameConfig({ titleScreen: { musicVolume: -1 } }).titleScreen.musicVolume).toBe(0);
    expect(normalizeGameConfig({ titleScreen: { musicVolume: 'alto' } }).titleScreen.musicVolume).toBe(100);
  });

  it('cada llamada da una copia nueva: editar una no toca la otra', () => {
    const a = defaultGameConfig();
    a.variables['llaves'] = 3;
    a.screens.credits.push('Yo');
    expect(defaultGameConfig().variables).toEqual({});
    expect(defaultGameConfig().screens.credits).toEqual([]);
  });

  it('recorta lo que se pasa de rango, igual que el motor', () => {
    const config = normalizeGameConfig({
      window: { width: 100, height: 99999 },
      titleScreen: { titleSize: 500, subtitleSize: 1, titleColor: { r: 300, g: -4, b: 12.6 } },
      hud: { healthScale: 9, segments: 1, healthPerHeart: 0 },
    });
    expect(config.window.width).toBe(320);
    expect(config.window.height).toBe(4320);
    expect(config.titleScreen.titleSize).toBe(200);
    expect(config.titleScreen.subtitleSize).toBe(8);
    expect(config.titleScreen.titleColor).toEqual({ r: 255, g: 0, b: 13 });
    expect(config.hud.healthScale).toBe(3);
    expect(config.hud.segments).toBe(2);
    expect(config.hud.healthPerHeart).toBe(1);
  });

  it('un valor de otro tipo o un estilo desconocido vuelve al de siempre', () => {
    const config = normalizeGameConfig({
      name: 7,
      titleScreen: { style: 'diagonal', backgroundMode: 'zoom' },
      hud: { healthStyle: 'estrellas', healthPosition: 'centro', showCoins: 'no' },
    });
    expect(config.name).toBe('');
    expect(config.titleScreen.style).toBe('centered');
    expect(config.titleScreen.backgroundMode).toBe('cover');
    expect(config.hud.healthStyle).toBe('bar');
    expect(config.hud.healthPosition).toBe('top-left');
    expect(config.hud.showCoins).toBe(true);
  });

  it('los titulos de pausa y derrota vacios vuelven a los de siempre', () => {
    const config = normalizeGameConfig({ screens: { pauseTitle: '', gameOverTitle: 'Has caído' } });
    expect(config.screens.pauseTitle).toBe('Pausa');
    expect(config.screens.gameOverTitle).toBe('Has caído');
  });

  it('las variables guardan solo numeros', () => {
    const config = normalizeGameConfig({ variables: { llaves: 0, puntos: 5.5, nombre: 'x', roto: null } });
    expect(config.variables).toEqual({ llaves: 0, puntos: 5.5 });
  });

  it('el borde existe solo si el archivo lo trae, y al guardar sin borde no se escribe la clave', () => {
    const withBorder = normalizeGameConfig({ hud: { healthBorder: { r: 10, g: 20, b: 30 } } });
    expect(withBorder.hud.healthBorder).toEqual({ r: 10, g: 20, b: 30 });
    expect((gameConfigForDisk(withBorder)['hud'] as Record<string, unknown>)['healthBorder']).toEqual({ r: 10, g: 20, b: 30 });

    const disk = gameConfigForDisk(defaultGameConfig());
    expect('healthBorder' in (disk['hud'] as Record<string, unknown>)).toBe(false);
  });

  it('lo que se escribe se vuelve a leer igual', () => {
    const config = defaultGameConfig();
    config.name = 'Mi juego';
    config.window = { width: 1280, height: 720, fullscreen: true };
    config.startLevel = 'nivel_1.json';
    config.titleScreen.style = 'side';
    config.titleScreen.backgroundImage = 'textures/portada.png';
    config.hud.healthStyle = 'hearts';
    config.hud.healthPosition = 'bottom-right';
    config.hud.healthBorder = { r: 0, g: 0, b: 0 };
    config.screens.credits = ['# Programación', 'Ana'];
    config.variables = { llaves: 0, vidas: 3 };
    const reread = normalizeGameConfig(JSON.parse(JSON.stringify(gameConfigForDisk(config))));
    expect(reread).toEqual(config);
  });
});

describe('variables de la partida', () => {
  it('acepta letras con tildes, numeros y guion bajo, sin empezar con numero', () => {
    expect(isVariableName('llaves')).toBe(true);
    expect(isVariableName('puntos_nivel2')).toBe(true);
    expect(isVariableName('campaña')).toBe(true);
    expect(isVariableName('_oculta')).toBe(true);
    expect(isVariableName('2vidas')).toBe(false);
    expect(isVariableName('con espacio')).toBe(false);
    expect(isVariableName('')).toBe(false);
  });

  it('lo escrito se convierte en nombre cambiando espacios por guion bajo', () => {
    expect(variableNameFrom('  llaves de oro ')).toBe('llaves_de_oro');
  });
});

describe('creditos', () => {
  it('un renglon por linea, sin espacios ni lineas vacias sobrantes al final', () => {
    expect(creditsFromText('# Equipo\r\nAna  \n\nLuis\n\n\n')).toEqual(['# Equipo', 'Ana', '', 'Luis']);
    expect(creditsToText(['# Equipo', 'Ana'])).toBe('# Equipo\nAna');
    expect(creditsFromText('')).toEqual([]);
  });
});

describe('vista previa de la vida', () => {
  it('un corazon por cada tanto de vida, que se vacian de a partes', () => {
    expect(heartFills(100, 100, 20)).toEqual([1, 1, 1, 1, 1]);
    expect(heartFills(50, 100, 20)).toEqual([1, 1, 0.5, 0, 0]);
    expect(heartFills(0, 100, 20)).toEqual([0, 0, 0, 0, 0]);
  });

  it('entre 1 y 20 corazones, como en el motor', () => {
    expect(heartFills(5, 5, 20)).toHaveLength(1);
    expect(heartFills(1000, 1000, 1)).toHaveLength(20);
  });

  it('los segmentos: con algo de vida queda al menos uno encendido', () => {
    expect(litSegments(100, 100, 10)).toBe(10);
    expect(litSegments(1, 100, 10)).toBe(1);
    expect(litSegments(0, 100, 10)).toBe(0);
    expect(litSegments(55, 100, 10)).toBe(6);
  });
});
