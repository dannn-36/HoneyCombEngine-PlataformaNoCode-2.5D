import {
  GameConfig,
  HealthStyle,
  HudConfig,
  HudCorner,
  ScreensConfig,
  TitleScreenConfig,
  TitleStyle,
} from '../models/game-config.model';
import { BackgroundMode, RgbColor } from '../models/level.model';

/**
 * La configuracion del juego (game.json): sus valores por defecto, como se
 * limpia lo que se lee del disco y como se escribe.
 *
 * Los valores por defecto son los MISMOS que los de engine/game/GameConfig.hpp,
 * y los rangos los mismos que aplica LoadGameConfig: un proyecto sin game.json
 * se ve en el editor exactamente como corre el motor.
 */

/** Limites de la ventana del juego, los mismos que recorta el motor. */
export const GAME_WINDOW_LIMITS = { minWidth: 320, maxWidth: 7680, minHeight: 240, maxHeight: 4320 } as const;

/** La configuracion de siempre: ventana de 800x450, portada centrada y la barra de vida de antes. */
export function defaultGameConfig(): GameConfig {
  return {
    name: '',
    icon: '',
    window: { width: 800, height: 450, fullscreen: false },
    startLevel: '',
    titleScreen: {
      style: 'centered',
      title: '',
      subtitle: '',
      titleColor: { r: 255, g: 214, b: 102 },
      subtitleColor: { r: 230, g: 230, b: 230 },
      titleSize: 56,
      subtitleSize: 22,
      backgroundColor: { r: 24, g: 24, b: 32 },
      backgroundImage: '',
      backgroundMode: 'cover',
      buttonColor: { r: 220, g: 220, b: 220 },
      buttonHighlight: { r: 255, g: 214, b: 102 },
      music: '',
      musicVolume: 100,
    },
    hud: {
      healthStyle: 'bar',
      healthPosition: 'top-left',
      healthScale: 1,
      healthFill: { r: 90, g: 200, b: 90 },
      healthEmpty: { r: 30, g: 30, b: 30 },
      healthBorder: null,
      showHealthLabel: true,
      showHealthNumber: true,
      healthPerHeart: 20,
      segments: 10,
      heartFull: '',
      heartEmpty: '',
      barFill: '',
      barFrame: '',
      showCoins: true,
      showInventory: true,
      showControls: true,
      showBossBar: true,
      showOverheadBars: true,
    },
    screens: {
      pauseTitle: 'Pausa',
      gameOverTitle: 'Derrotado',
      gameOverColor: { r: 230, g: 70, b: 70 },
      credits: [],
    },
    variables: {},
  };
}

/** Los estilos de portada, en el orden en que se ofrecen. */
export const TITLE_STYLES: readonly { id: TitleStyle; label: string; hint: string }[] = [
  { id: 'centered', label: 'Centrado', hint: 'Título arriba y el menú al centro de la pantalla.' },
  { id: 'side', label: 'Lateral', hint: 'Un panel oscuro a la izquierda con el título y el menú, como un RPG.' },
  { id: 'minimal', label: 'Minimalista', hint: 'Solo el título y las opciones en una fila abajo: deja ver el fondo.' },
];

export const HEALTH_STYLES: readonly { id: HealthStyle; label: string; hint: string }[] = [
  { id: 'bar', label: 'Barra', hint: 'Una barra que se vacía. Admite imagen de relleno y de marco.' },
  { id: 'hearts', label: 'Corazones', hint: 'Un corazón por cada tanto de vida; se vacían de a mitades. Admite imágenes propias.' },
  { id: 'segments', label: 'Segmentos', hint: 'Una barra cortada en bloques que se apagan.' },
  { id: 'number', label: 'Número', hint: 'Solo el número de vida, en el color de la vida.' },
];

export const HUD_CORNERS: readonly { id: HudCorner; label: string }[] = [
  { id: 'top-left', label: 'Arriba a la izquierda' },
  { id: 'top-right', label: 'Arriba a la derecha' },
  { id: 'bottom-left', label: 'Abajo a la izquierda' },
  { id: 'bottom-right', label: 'Abajo a la derecha' },
];

/** Resoluciones para elegir sin escribir. La primera es la de siempre. */
export const RESOLUTION_PRESETS: readonly { width: number; height: number; label: string }[] = [
  { width: 800, height: 450, label: '800 × 450 (16:9, la de siempre)' },
  { width: 1280, height: 720, label: '1280 × 720 (HD)' },
  { width: 1600, height: 900, label: '1600 × 900' },
  { width: 1920, height: 1080, label: '1920 × 1080 (Full HD)' },
  { width: 640, height: 480, label: '640 × 480 (4:3)' },
  { width: 1024, height: 768, label: '1024 × 768 (4:3)' },
];

const TITLE_STYLE_IDS = TITLE_STYLES.map((style) => style.id);
const HEALTH_STYLE_IDS = HEALTH_STYLES.map((style) => style.id);
const HUD_CORNER_IDS = HUD_CORNERS.map((corner) => corner.id);
const BACKGROUND_MODE_IDS: readonly BackgroundMode[] = ['cover', 'stretch', 'tile'];

type Raw = Record<string, unknown>;

function asObject(value: unknown): Raw {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Raw) : {};
}

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function number(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.min(max, Math.max(min, parsed));
}

function integer(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(number(value, fallback, min, max));
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function color(value: unknown, fallback: RgbColor): RgbColor {
  const raw = asObject(value);
  const channel = (key: 'r' | 'g' | 'b') => integer(raw[key], fallback[key], 0, 255);
  return { r: channel('r'), g: channel('g'), b: channel('b') };
}

/**
 * Lo que se lee de game.json, completo y dentro de rango. Igual que el motor:
 * lo que falta toma su valor por defecto y lo que se pasa se recorta, en vez de
 * rechazar el archivo entero por un campo.
 */
export function normalizeGameConfig(raw: unknown): GameConfig {
  const base = defaultGameConfig();
  const source = asObject(raw);
  const window = asObject(source['window']);
  const title = asObject(source['titleScreen']);
  const hud = asObject(source['hud']);
  const screens = asObject(source['screens']);

  const t = base.titleScreen;
  const titleScreen: TitleScreenConfig = {
    style: oneOf(title['style'], TITLE_STYLE_IDS, t.style),
    title: text(title['title'], t.title),
    subtitle: text(title['subtitle'], t.subtitle),
    titleColor: color(title['titleColor'], t.titleColor),
    subtitleColor: color(title['subtitleColor'], t.subtitleColor),
    titleSize: number(title['titleSize'], t.titleSize, 10, 200),
    subtitleSize: number(title['subtitleSize'], t.subtitleSize, 8, 120),
    backgroundColor: color(title['backgroundColor'], t.backgroundColor),
    backgroundImage: text(title['backgroundImage'], t.backgroundImage),
    backgroundMode: oneOf(title['backgroundMode'], BACKGROUND_MODE_IDS, t.backgroundMode),
    buttonColor: color(title['buttonColor'], t.buttonColor),
    buttonHighlight: color(title['buttonHighlight'], t.buttonHighlight),
    music: text(title['music'], t.music),
    musicVolume: Math.round(number(title['musicVolume'], t.musicVolume, 0, 100)),
  };

  const h = base.hud;
  const hudConfig: HudConfig = {
    healthStyle: oneOf(hud['healthStyle'], HEALTH_STYLE_IDS, h.healthStyle),
    healthPosition: oneOf(hud['healthPosition'], HUD_CORNER_IDS, h.healthPosition),
    healthScale: number(hud['healthScale'], h.healthScale, 0.5, 3),
    healthFill: color(hud['healthFill'], h.healthFill),
    healthEmpty: color(hud['healthEmpty'], h.healthEmpty),
    // Como en el motor: el borde existe solo si el archivo lo trae.
    healthBorder: hud['healthBorder'] ? color(hud['healthBorder'], { r: 255, g: 255, b: 255 }) : null,
    showHealthLabel: flag(hud['showHealthLabel'], h.showHealthLabel),
    showHealthNumber: flag(hud['showHealthNumber'], h.showHealthNumber),
    healthPerHeart: number(hud['healthPerHeart'], h.healthPerHeart, 1, 100000),
    segments: integer(hud['segments'], h.segments, 2, 40),
    heartFull: text(hud['heartFull'], h.heartFull),
    heartEmpty: text(hud['heartEmpty'], h.heartEmpty),
    barFill: text(hud['barFill'], h.barFill),
    barFrame: text(hud['barFrame'], h.barFrame),
    showCoins: flag(hud['showCoins'], h.showCoins),
    showInventory: flag(hud['showInventory'], h.showInventory),
    showControls: flag(hud['showControls'], h.showControls),
    showBossBar: flag(hud['showBossBar'], h.showBossBar),
    showOverheadBars: flag(hud['showOverheadBars'], h.showOverheadBars),
  };

  const s = base.screens;
  const screensConfig: ScreensConfig = {
    // Un titulo vacio no deja la pantalla sin titulo: vuelve el de siempre, igual que en el motor.
    pauseTitle: text(screens['pauseTitle'], '') || s.pauseTitle,
    gameOverTitle: text(screens['gameOverTitle'], '') || s.gameOverTitle,
    gameOverColor: color(screens['gameOverColor'], s.gameOverColor),
    credits: Array.isArray(screens['credits'])
      ? screens['credits'].filter((line): line is string => typeof line === 'string')
      : [],
  };

  const variables: Record<string, number> = {};
  for (const [name, value] of Object.entries(asObject(source['variables']))) {
    if (typeof value === 'number' && Number.isFinite(value)) {
      variables[name] = value;
    }
  }

  return {
    name: text(source['name'], base.name),
    icon: text(source['icon'], base.icon),
    window: {
      width: integer(window['width'], base.window.width, GAME_WINDOW_LIMITS.minWidth, GAME_WINDOW_LIMITS.maxWidth),
      height: integer(window['height'], base.window.height, GAME_WINDOW_LIMITS.minHeight, GAME_WINDOW_LIMITS.maxHeight),
      fullscreen: flag(window['fullscreen'], base.window.fullscreen),
    },
    startLevel: text(source['startLevel'], base.startLevel),
    titleScreen,
    hud: hudConfig,
    screens: screensConfig,
    variables,
  };
}

/**
 * Lo que se escribe en game.json. Todo explicito, para que el archivo se lea
 * entero sin mirar el schema; lo unico que se omite es el borde de la vida
 * cuando no hay, porque para el motor la clave misma es el "si".
 */
export function gameConfigForDisk(config: GameConfig): Record<string, unknown> {
  const { healthBorder, ...hud } = config.hud;
  return {
    name: config.name,
    icon: config.icon,
    window: { ...config.window },
    startLevel: config.startLevel,
    titleScreen: { ...config.titleScreen },
    hud: healthBorder ? { ...hud, healthBorder } : hud,
    screens: { ...config.screens, credits: [...config.screens.credits] },
    variables: { ...config.variables },
  };
}

/**
 * Un nombre de variable valido: letras (con tildes), numeros y guion bajo, sin
 * empezar con numero. Es lo que se escribe en los eventos, y asi se lee igual
 * en el JSON que en el desplegable.
 */
export function isVariableName(name: string): boolean {
  return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(name);
}

/** Convierte lo escrito en un nombre de variable: sin espacios a los costados y "_" en lugar de espacios. */
export function variableNameFrom(input: string): string {
  return input.trim().replace(/\s+/g, '_');
}

/** Los creditos como texto para editar: un renglon por linea. */
export function creditsToText(lines: readonly string[]): string {
  return lines.join('\n');
}

/** Del texto editado a los renglones: sin espacios al final ni lineas vacias sobrantes al final. */
export function creditsFromText(input: string): string[] {
  const lines = input.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/\s+$/, ''));
  while (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines;
}

/**
 * Cuanto se llena cada corazon (0 a 1), con la misma cuenta que
 * engine/game/HealthHud.cpp: un corazon por cada "perHeart" de vida maxima,
 * entre 1 y 20, que se vacian de derecha a izquierda.
 */
export function heartFills(health: number, maxHealth: number, perHeart: number): number[] {
  const per = Math.max(1, perHeart);
  const hearts = Math.min(20, Math.max(1, Math.ceil(maxHealth / per)));
  return Array.from({ length: hearts }, (_, i) => Math.min(1, Math.max(0, (health - i * per) / per)));
}

/** Cuantos segmentos quedan encendidos, como en el motor: con algo de vida, al menos uno. */
export function litSegments(health: number, maxHealth: number, segments: number): number {
  if (health <= 0 || maxHealth <= 0) {
    return 0;
  }
  return Math.ceil(Math.min(1, health / maxHealth) * segments);
}
