// Espejo en TypeScript de schema/game.schema.json: la configuracion del JUEGO
// (no de un nivel), que vive en game.json en la raiz del proyecto. La arma la
// ventana Archivo › Configuración del juego… y la lee el runtime al arrancar
// (engine/game/GameConfig.cpp).

import { BackgroundMode, RgbColor } from './level.model';

/** Como se arma la portada: titulo y menu al centro, en un panel a la izquierda, o casi sin nada. */
export type TitleStyle = 'centered' | 'side' | 'minimal';

/** Como se dibuja la vida del jugador en el HUD. */
export type HealthStyle = 'bar' | 'hearts' | 'segments' | 'number';

/** Esquina de la pantalla donde va la vida. */
export type HudCorner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

export interface GameWindowConfig {
  width: number;
  height: number;
  /** Pantalla completa sin bordes, a la resolucion del monitor. */
  fullscreen: boolean;
}

export interface TitleScreenConfig {
  style: TitleStyle;
  /** Vacio = el nombre del juego. */
  title: string;
  subtitle: string;
  titleColor: RgbColor;
  subtitleColor: RgbColor;
  titleSize: number;
  subtitleSize: number;
  backgroundColor: RgbColor;
  /** "textures/x.png", relativo a assets/; vacio = solo el color. */
  backgroundImage: string;
  backgroundMode: BackgroundMode;
  buttonColor: RgbColor;
  buttonHighlight: RgbColor;
  /** "sounds/x.ogg", relativo a assets/; vacio = sin musica. */
  music: string;
  /** Volumen de esa musica en porcentaje (0-100). */
  musicVolume: number;
}

export interface HudConfig {
  healthStyle: HealthStyle;
  healthPosition: HudCorner;
  healthScale: number;
  healthFill: RgbColor;
  healthEmpty: RgbColor;
  /** null = sin borde. */
  healthBorder: RgbColor | null;
  showHealthLabel: boolean;
  showHealthNumber: boolean;
  healthPerHeart: number;
  segments: number;
  heartFull: string;
  heartEmpty: string;
  barFill: string;
  barFrame: string;
  showCoins: boolean;
  showInventory: boolean;
  showControls: boolean;
  showBossBar: boolean;
  showOverheadBars: boolean;
}

export interface ScreensConfig {
  pauseTitle: string;
  gameOverTitle: string;
  gameOverColor: RgbColor;
  /** Un renglon por linea; los que empiezan con "# " son titulos de seccion. */
  credits: string[];
}

export interface GameConfig {
  name: string;
  /** Icono de la ventana, "textures/x.png"; vacio = el de siempre. */
  icon: string;
  window: GameWindowConfig;
  /** Archivo de levels/ con el que empieza "Nueva partida"; vacio = el que se ejecuta. */
  startLevel: string;
  titleScreen: TitleScreenConfig;
  hud: HudConfig;
  screens: ScreensConfig;
  /** Variables de la partida y su valor al empezar una nueva. */
  variables: Record<string, number>;
}
