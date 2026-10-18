import { computed, inject, signal } from '@angular/core';

import { hexToRgb, rgbToHex } from '../core/color';
import {
  GAME_WINDOW_LIMITS,
  HEALTH_STYLES,
  HUD_CORNERS,
  RESOLUTION_PRESETS,
  TITLE_STYLES,
  creditsFromText,
  creditsToText,
  heartFills,
  isVariableName,
  litSegments,
  variableNameFrom,
} from '../core/game-config';
import { textureName } from '../core/sprite-style';
import { TextureAsset } from '../core/texture-fit';
import {
  GameConfig,
  GameWindowConfig,
  HudConfig,
  ScreensConfig,
  TitleScreenConfig,
} from '../models/game-config.model';
import { RgbColor } from '../models/level.model';
import { GameConfigService } from '../services/game-config.service';
import { ProjectService, writeOrConfirm } from '../services/project.service';
import { NamePromptRequest } from '../ui/name-prompt.controller';
import type { IconName } from '../ui/icons.generated';
import { BACKGROUND_MODES } from '../inspector/background-picker.controller';

/** Pestañas de la ventana, en el orden en que se ven. */
export type GameConfigTab = 'general' | 'portada' | 'pantallas' | 'hud' | 'progreso';

export const GAME_CONFIG_TABS: readonly { id: GameConfigTab; label: string; icon: IconName }[] = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'portada', label: 'Portada', icon: 'monitor-play' },
  { id: 'pantallas', label: 'Pausa y créditos', icon: 'scroll-text' },
  { id: 'hud', label: 'HUD', icon: 'heart' },
  { id: 'progreso', label: 'Progreso', icon: 'flag' },
];

/** Las imagenes que se eligen en la ventana, cada una con su lugar en la configuracion. */
export type GameImageSlot = 'icon' | 'titleBackground' | 'heartFull' | 'heartEmpty' | 'barFill' | 'barFrame';

/** Los colores de la configuracion, por seccion y clave. */
type TitleColorKey = 'titleColor' | 'subtitleColor' | 'backgroundColor' | 'buttonColor' | 'buttonHighlight';
type HudColorKey = 'healthFill' | 'healthEmpty' | 'healthBorder';

/** Vida maxima de la vista previa del HUD: la de un jugador sin cambiar. */
const PREVIEW_MAX_HEALTH = 100;

/** La disposicion de la portada en pixeles del juego (ver GameConfigController.titleLayout). */
export interface TitleLayout {
  /** Ancho del panel oscuro de la izquierda; 0 = sin panel. */
  panel: number;
  centered: boolean;
  x: number;
  titleY: number;
  subtitleY: number;
  menu: { x: number; y: number; row: boolean; centered: boolean; size: number; spacing: number };
}

export interface GameConfigDeps {
  note: (message: string) => void;
  describe: (error: unknown) => string;
  hasFileSystem: boolean;
  /** Los niveles del proyecto, para el nivel inicial. */
  levelFiles: () => string[];
  /** Las miniaturas ya cargadas de Recursos, para las vistas previas. */
  textureAssets: () => Record<string, TextureAsset>;
  ask: (request: NamePromptRequest) => Promise<string | null>;
}

/**
 * Archivo › Configuración del juego…: lo que es del JUEGO y no de un nivel --
 * nombre, ventana, nivel inicial, la portada, las pantallas de pausa, derrota y
 * créditos, el estilo del HUD y las variables de la partida --, guardado en
 * game.json (ver core/game-config.ts y engine/game/GameConfig.hpp).
 *
 * Se edita un BORRADOR: nada llega a game.json hasta Guardar, y Cancelar lo
 * descarta. A diferencia del nivel, no entra en deshacer y rehacer: es otro
 * archivo, y Guardar lo escribe en el momento.
 *
 * Las vistas previas de la portada y del HUD repiten las cuentas de
 * engine/game/Screens.cpp y HealthHud.cpp en pixeles del juego, y la plantilla
 * los escala al ancho de la caja con unidades cqw: la vista previa se ve igual
 * en cualquier resolucion elegida.
 *
 * Controlador y no componente por la misma razon que los demas: el markup vive
 * en dialogs/game-config-dialog.html con los estilos de App.
 */
export class GameConfigController {
  private readonly service = inject(GameConfigService);
  private readonly project = inject(ProjectService);

  constructor(private readonly deps: GameConfigDeps) {}

  readonly tabs = GAME_CONFIG_TABS;
  readonly titleStyles = TITLE_STYLES;
  readonly healthStyles = HEALTH_STYLES;
  readonly hudCorners = HUD_CORNERS;
  readonly resolutionPresets = RESOLUTION_PRESETS;
  readonly backgroundModes = BACKGROUND_MODES;
  readonly windowLimits = GAME_WINDOW_LIMITS;

  /** El borrador; null con la ventana cerrada. */
  readonly draft = signal<GameConfig | null>(null);

  readonly tab = signal<GameConfigTab>('general');

  /** El selector de imagen desplegado, si hay uno. */
  readonly imagePicker = signal<GameImageSlot | null>(null);

  /** Los audios de assets/, para la musica de la portada. */
  readonly sounds = signal<string[]>([]);

  /** La partida guardada del juego, si hay (Progreso). */
  readonly saveInfo = signal<{ level: string } | null>(null);

  /** El nombre que se esta escribiendo para una variable nueva (Progreso). */
  readonly newVariable = signal('');

  /** Vida del jugador en la vista previa del HUD, de 0 a 100. */
  readonly previewHealth = signal(70);

  readonly saving = signal(false);

  /** El borrador como estaba al abrir, para saber si hay cambios. */
  private readonly original = signal('');

  readonly dirty = computed(() => {
    const draft = this.draft();
    return draft !== null && JSON.stringify(draft) !== this.original();
  });

  readonly levelFiles = computed(() => this.deps.levelFiles());

  // --- Abrir y cerrar ---------------------------------------------------------

  async open(tab: GameConfigTab = 'general'): Promise<void> {
    // Se relee del disco: game.json se puede haber editado a mano desde que se
    // abrio el proyecto, y guardar encima de una version vieja lo pisaria.
    if (this.deps.hasFileSystem) {
      try {
        await this.service.load();
      } catch (error) {
        this.deps.note('No se pudo leer game.json: ' + this.deps.describe(error) + ' Se parte de la configuración de siempre.');
      }
    }
    const draft = structuredClone(this.service.config());
    this.draft.set(draft);
    this.original.set(JSON.stringify(draft));
    this.tab.set(tab);
    this.imagePicker.set(null);
    this.newVariable.set('');
    this.creditsText.set(creditsToText(draft.screens.credits));
    if (this.deps.hasFileSystem) {
      void this.project.listSounds().then(
        (sounds) => this.sounds.set(sounds),
        () => this.sounds.set([]),
      );
      void this.project.readSaveInfo().then((info) => this.saveInfo.set(info));
    }
  }

  /** Cierra sin guardar; con cambios, pregunta antes. */
  close(): void {
    if (this.dirty() && !window.confirm('Hay cambios sin guardar en la configuración del juego. ¿Cerrar y perderlos?')) {
      return;
    }
    this.draft.set(null);
    this.imagePicker.set(null);
  }

  async save(): Promise<void> {
    const draft = this.draft();
    if (!draft || this.saving()) {
      return;
    }
    if (!this.deps.hasFileSystem) {
      this.deps.note('Sin acceso a disco. Abre el editor con "npm run electron" para guardar game.json.');
      return;
    }
    this.saving.set(true);
    try {
      if (!(await writeOrConfirm((options) => this.service.save(draft, options), 'la configuración de esta ventana'))) {
        this.deps.note('No se guardó: game.json cambió en el disco. Tus cambios siguen en la ventana; ciérrala y vuelve a abrirla para ver la versión del disco.');
        return;
      }
      this.original.set(JSON.stringify(draft));
      this.draft.set(null);
      this.imagePicker.set(null);
      this.deps.note('Configuración del juego guardada en game.json. Se usa la próxima vez que se ejecute.');
    } catch (error) {
      this.deps.note('No se pudo guardar game.json: ' + this.deps.describe(error));
    } finally {
      this.saving.set(false);
    }
  }

  // --- Editar el borrador -----------------------------------------------------

  patch(changes: Partial<GameConfig>): void {
    this.draft.update((draft) => (draft ? { ...draft, ...changes } : draft));
  }

  patchWindow(changes: Partial<GameWindowConfig>): void {
    this.draft.update((draft) => (draft ? { ...draft, window: { ...draft.window, ...changes } } : draft));
  }

  patchTitle(changes: Partial<TitleScreenConfig>): void {
    this.draft.update((draft) => (draft ? { ...draft, titleScreen: { ...draft.titleScreen, ...changes } } : draft));
  }

  patchHud(changes: Partial<HudConfig>): void {
    this.draft.update((draft) => (draft ? { ...draft, hud: { ...draft.hud, ...changes } } : draft));
  }

  patchScreens(changes: Partial<ScreensConfig>): void {
    this.draft.update((draft) => (draft ? { ...draft, screens: { ...draft.screens, ...changes } } : draft));
  }

  hex(color: RgbColor | null): string {
    return color ? rgbToHex(color) : '#000000';
  }

  setTitleColor(key: TitleColorKey, hex: string): void {
    const color = hexToRgb(hex);
    if (color) {
      this.patchTitle({ [key]: color });
    }
  }

  setHudColor(key: HudColorKey, hex: string): void {
    const color = hexToRgb(hex);
    if (color) {
      this.patchHud({ [key]: color });
    }
  }

  setGameOverColor(hex: string): void {
    const color = hexToRgb(hex);
    if (color) {
      this.patchScreens({ gameOverColor: color });
    }
  }

  /** El borde de la vida: con o sin. Al encenderlo arranca en negro, que se ve sobre cualquier fondo claro. */
  setHealthBorder(on: boolean): void {
    this.patchHud({ healthBorder: on ? (this.draft()?.hud.healthBorder ?? { r: 0, g: 0, b: 0 }) : null });
  }

  /** Numero de un campo, dentro de su rango; lo que no es numero deja el valor de antes. */
  clamp(value: number, min: number, max: number, fallback: number): number {
    return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
  }

  // --- Ventana ---------------------------------------------------------------

  /** El valor del desplegable de resolucion: "ancho x alto" si es una de la lista, "custom" si no. */
  resolutionValue(window: GameWindowConfig): string {
    const preset = RESOLUTION_PRESETS.find((entry) => entry.width === window.width && entry.height === window.height);
    return preset ? preset.width + 'x' + preset.height : 'custom';
  }

  setResolution(value: string): void {
    const match = /^(\d+)x(\d+)$/.exec(value);
    if (match) {
      this.patchWindow({ width: Number(match[1]), height: Number(match[2]) });
    }
  }

  setWidth(value: number): void {
    const window = this.draft()?.window;
    if (window) {
      this.patchWindow({
        width: Math.round(this.clamp(value, GAME_WINDOW_LIMITS.minWidth, GAME_WINDOW_LIMITS.maxWidth, window.width)),
      });
    }
  }

  setHeight(value: number): void {
    const window = this.draft()?.window;
    if (window) {
      this.patchWindow({
        height: Math.round(this.clamp(value, GAME_WINDOW_LIMITS.minHeight, GAME_WINDOW_LIMITS.maxHeight, window.height)),
      });
    }
  }

  // --- Imagenes y musica ------------------------------------------------------

  imagePath(slot: GameImageSlot): string {
    const draft = this.draft();
    if (!draft) {
      return '';
    }
    switch (slot) {
      case 'icon':
        return draft.icon;
      case 'titleBackground':
        return draft.titleScreen.backgroundImage;
      default:
        return draft.hud[slot];
    }
  }

  /** El nombre de la imagen sin "textures/", como se ve en Recursos. */
  imageName(slot: GameImageSlot): string {
    return textureName(this.imagePath(slot));
  }

  /** La miniatura de la imagen elegida, si ya se cargo. */
  imageUrl(slot: GameImageSlot): string | null {
    const name = this.imageName(slot);
    return name ? (this.deps.textureAssets()[name]?.dataUrl ?? null) : null;
  }

  /** Para el estilo de un fondo: url(...) de la miniatura, o nada. */
  imageCss(slot: GameImageSlot): string | null {
    const url = this.imageUrl(slot);
    return url ? `url("${url}")` : null;
  }

  toggleImagePicker(slot: GameImageSlot): void {
    this.imagePicker.update((open) => (open === slot ? null : slot));
  }

  /** Elige una imagen de Recursos (el nombre de assets/textures/), o ninguna con ''. */
  setImage(slot: GameImageSlot, texture: string): void {
    const path = texture ? 'textures/' + texture : '';
    switch (slot) {
      case 'icon':
        this.patch({ icon: path });
        break;
      case 'titleBackground':
        this.patchTitle({ backgroundImage: path });
        break;
      default:
        this.patchHud({ [slot]: path });
    }
    this.imagePicker.set(null);
  }

  // --- Creditos --------------------------------------------------------------

  /**
   * El texto de los creditos tal como se escribe. Va aparte del borrador: el
   * borrador guarda los renglones ya limpios (sin lineas vacias al final), y si
   * el cuadro mostrara esa version, apretar Enter al final no haria nada.
   */
  readonly creditsText = signal('');

  setCredits(text: string): void {
    this.creditsText.set(text);
    this.patchScreens({ credits: creditsFromText(text) });
  }

  // --- Variables -------------------------------------------------------------

  readonly variableEntries = computed(() => {
    const variables = this.draft()?.variables ?? {};
    return Object.keys(variables)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ name, value: variables[name] }));
  });

  /** Por que no se puede agregar lo escrito, o null si se puede. */
  readonly newVariableError = computed(() => {
    const name = variableNameFrom(this.newVariable());
    if (!name) {
      return null;
    }
    return this.variableNameError(name, this.draft()?.variables ?? {});
  });

  addVariable(): void {
    const draft = this.draft();
    const name = variableNameFrom(this.newVariable());
    if (!draft || !name || this.variableNameError(name, draft.variables)) {
      return;
    }
    this.patch({ variables: { ...draft.variables, [name]: 0 } });
    this.newVariable.set('');
  }

  setVariableValue(name: string, value: number): void {
    const draft = this.draft();
    if (draft && name in draft.variables && Number.isFinite(value)) {
      this.patch({ variables: { ...draft.variables, [name]: value } });
    }
  }

  removeVariable(name: string): void {
    const draft = this.draft();
    if (!draft) {
      return;
    }
    const variables = { ...draft.variables };
    delete variables[name];
    this.patch({ variables });
  }

  /**
   * Crea una variable desde el panel Eventos ("+ Nueva variable…" del
   * desplegable) y la guarda en game.json en el momento: el evento que la usa
   * ya la nombra, y el desplegable tiene que poder mostrarla. Devuelve el
   * nombre, o null si se cancelo o no se pudo.
   */
  async createVariable(): Promise<string | null> {
    const typed = await this.deps.ask({
      title: 'Nueva variable de la partida',
      label: 'Nombre',
      value: '',
      confirmLabel: 'Crear',
      hint: 'Dura toda la partida y se guarda con ella. Empieza en 0; el valor inicial se cambia en Archivo › Configuración del juego › Progreso.',
    });
    if (typed === null) {
      return null;
    }
    const name = variableNameFrom(typed);
    const config = this.service.config();
    if (name in config.variables) {
      return name;
    }
    const error = this.variableNameError(name, config.variables);
    if (error) {
      this.deps.note(error);
      return null;
    }
    if (!this.deps.hasFileSystem) {
      this.deps.note('Sin acceso a disco: la variable no se puede guardar en game.json.');
      return null;
    }
    try {
      const next = { ...config, variables: { ...config.variables, [name]: 0 } };
      if (!(await writeOrConfirm((options) => this.service.save(next, options), 'la configuración con la variable nueva'))) {
        await this.service.load();
        this.deps.note('No se creó la variable: game.json cambió en el disco. Se cargó la versión del disco; vuelve a intentarlo.');
        return null;
      }
      this.deps.note('Variable "' + name + '" creada en game.json, empezando en 0.');
      return name;
    } catch (error) {
      this.deps.note('No se pudo guardar game.json: ' + this.deps.describe(error));
      return null;
    }
  }

  private variableNameError(name: string, variables: Record<string, number>): string | null {
    if (!isVariableName(name)) {
      return 'Un nombre de variable lleva letras, números y _, y no empieza con un número.';
    }
    if (name in variables) {
      return 'Ya hay una variable "' + name + '".';
    }
    return null;
  }

  // --- Partida guardada ------------------------------------------------------

  async clearSave(): Promise<void> {
    if (
      !window.confirm(
        '¿Borrar la partida guardada? También se borran la de prueba y las copias de respaldo. ' +
          '«Continuar» desaparece de la portada hasta el próximo punto de control.',
      )
    ) {
      return;
    }
    try {
      await this.project.clearSave();
      this.saveInfo.set(null);
      this.deps.note('Partida guardada borrada.');
    } catch (error) {
      this.deps.note('No se pudo borrar la partida guardada: ' + this.deps.describe(error));
    }
  }

  // --- Vistas previas ----------------------------------------------------------
  //
  // Todo se mide en pixeles del juego, a la resolucion elegida, y gp() lo pasa
  // a cqw: un porcentaje del ancho de la caja (container-type: inline-size).

  /** Un largo en pixeles del juego, como largo CSS proporcional a la caja. */
  gp(pixels: number): string {
    const width = this.draft()?.window.width ?? 800;
    return (pixels / width) * 100 + 'cqw';
  }

  /** La proporcion de la caja de vista previa: la de la ventana del juego. */
  aspect(window: GameWindowConfig): string {
    return window.width + ' / ' + window.height;
  }

  /** El titulo que se muestra: el propio de la portada, el nombre del juego, o el de siempre. */
  readonly displayTitle = computed(() => {
    const draft = this.draft();
    return draft?.titleScreen.title || draft?.name || 'HoneyComb';
  });

  /** Las opciones de la portada, como las arma el motor con una partida guardada. */
  readonly titleMenu = computed(() => {
    const draft = this.draft();
    return ['Nueva partida', 'Continuar', ...(draft?.screens.credits.length ? ['Créditos'] : []), 'Salir'];
  });

  /**
   * Donde va cada cosa de la portada, en pixeles del juego: las mismas cuentas
   * que Screens::RunTitle. "x" es el borde izquierdo si "centered" es false, y
   * el centro si es true; "y", el borde de arriba.
   */
  readonly titleLayout = computed<TitleLayout | null>(() => {
    const draft = this.draft();
    if (!draft) {
      return null;
    }
    const { width: w, height: h } = draft.window;
    const t = draft.titleScreen;
    switch (t.style) {
      case 'side':
        return {
          panel: w * 0.42,
          centered: false,
          x: w * 0.06,
          titleY: h * 0.18,
          subtitleY: h * 0.18 + t.titleSize + 10,
          menu: { x: w * 0.06 + 24, y: h * 0.5, row: false, centered: false, size: 26, spacing: 42 },
        };
      case 'minimal':
        return {
          panel: 0,
          centered: true,
          x: w / 2,
          titleY: h * 0.36,
          subtitleY: h * 0.36 + t.titleSize + 10,
          menu: { x: w / 2, y: h * 0.8, row: true, centered: true, size: 22, spacing: 36 },
        };
      default:
        return {
          panel: 0,
          centered: true,
          x: w / 2,
          titleY: h * 0.2,
          subtitleY: h * 0.2 + t.titleSize + 10,
          menu: { x: w / 2, y: h * 0.52, row: false, centered: true, size: 26, spacing: 42 },
        };
    }
  });

  /** Que pantalla muestra la vista previa de la pestaña Pausa y créditos. */
  readonly screenPreview = signal<'pause' | 'gameover' | 'credits'>('pause');

  /**
   * La pantalla de pausa o de derrota, como Screens::RunOverlay: el velo, el
   * titulo a 26% del alto y el menu desde 48%. La de derrota ofrece volver al
   * punto de control, como cuando hay una partida guardada.
   */
  readonly overlayPreview = computed(() => {
    const draft = this.draft();
    if (!draft) {
      return null;
    }
    const pause = this.screenPreview() !== 'gameover';
    return {
      title: pause ? draft.screens.pauseTitle : draft.screens.gameOverTitle,
      color: pause ? draft.titleScreen.titleColor : draft.screens.gameOverColor,
      veil: pause ? 'rgba(0, 0, 0, 0.63)' : 'rgba(20, 0, 0, 0.73)',
      titleY: draft.window.height * 0.26,
      menuY: draft.window.height * 0.48,
      menu: pause
        ? ['Continuar', 'Reiniciar el nivel', 'Volver a la portada', 'Salir del juego']
        : ['Volver al punto de control', 'Volver a la portada', 'Salir del juego'],
    };
  });

  /** Los creditos como los muestra el motor: los "# " son titulos de seccion. */
  readonly creditLines = computed(() =>
    (this.draft()?.screens.credits ?? []).map((line) =>
      line.startsWith('# ') ? { text: line.slice(2), heading: true } : { text: line, heading: false },
    ),
  );

  /** Los corazones de la vista previa: cuanto se llena cada uno. */
  readonly previewHearts = computed(() => {
    const hud = this.draft()?.hud;
    return hud ? heartFills(this.previewHealth(), PREVIEW_MAX_HEALTH, hud.healthPerHeart) : [];
  });

  /** Los segmentos de la vista previa: encendido o apagado. */
  readonly previewSegments = computed(() => {
    const hud = this.draft()?.hud;
    if (!hud) {
      return [];
    }
    const lit = litSegments(this.previewHealth(), PREVIEW_MAX_HEALTH, hud.segments);
    return Array.from({ length: hud.segments }, (_, index) => index < lit);
  });

  readonly previewNumber = computed(() => Math.ceil(this.previewHealth()) + ' / ' + PREVIEW_MAX_HEALTH);

  readonly previewRatio = computed(() => Math.min(1, Math.max(0, this.previewHealth() / PREVIEW_MAX_HEALTH)));

  /** Donde va la fila de monedas: debajo de la vida si la vida esta arriba a la izquierda, si no arriba. */
  readonly previewCoinsTop = computed(() => {
    const hud = this.draft()?.hud;
    if (!hud || hud.healthPosition !== 'top-left') {
      return 10;
    }
    const s = hud.healthScale;
    const height = hud.healthStyle === 'hearts' ? Math.max(20 * s, 22 * s) : 20 * s;
    return 10 + height + 7;
  });

  /** Estilo de posicion del bloque de vida, segun su esquina. */
  healthCornerStyle(hud: HudConfig): Record<string, string> {
    const margin = this.gp(10);
    const bottomReserve = hud.showControls ? 24 : 0;
    const right = hud.healthPosition.endsWith('right');
    const bottom = hud.healthPosition.startsWith('bottom');
    return {
      [right ? 'right' : 'left']: margin,
      [bottom ? 'bottom' : 'top']: bottom ? this.gp(10 + bottomReserve) : margin,
    };
  }

  /** El ancho de la barra del jefe, como en CombatView: hasta 420, con 20 de margen a cada lado. */
  bossBarWidth(windowWidth: number): number {
    return Math.min(420, windowWidth - 40);
  }

  /** El recorte de un corazon a medias: se ve de izquierda a derecha hasta "fill". */
  heartClip(fill: number): string {
    return `inset(0 ${(1 - fill) * 100}% 0 0)`;
  }

  /** rgb() de un color de la configuracion. */
  css(color: RgbColor | null, alpha = 1): string {
    return color ? `rgba(${color.r}, ${color.g}, ${color.b}, ${alpha})` : 'transparent';
  }

  /**
   * Como llena la caja la imagen de fondo de la portada, igual que en el juego.
   * En mosaico cada copia mide lo que la imagen en pixeles del juego: la
   * miniatura viene reducida, pero trae la medida real.
   */
  backgroundSize(mode: string): string {
    if (mode === 'stretch') {
      return '100% 100%';
    }
    if (mode === 'tile') {
      const asset = this.deps.textureAssets()[this.imageName('titleBackground')];
      return asset && asset.width > 0 ? this.gp(asset.width) + ' ' + this.gp(asset.height) : 'auto';
    }
    return 'cover';
  }
}
