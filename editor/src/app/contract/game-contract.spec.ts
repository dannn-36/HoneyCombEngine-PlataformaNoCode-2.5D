/// <reference types="node" />
// Contrato de game.json (schema/game.schema.json): lo que escribe el editor con
// gameConfigForDisk tiene que cumplirlo siempre, venga de donde venga la
// configuracion, y volver igual al leerlo con normalizeGameConfig.
//
// Los archivos se leen con node:fs (ver level-contract.spec.ts).

import Ajv from 'ajv';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import {
  HEALTH_STYLES,
  HUD_CORNERS,
  RESOLUTION_PRESETS,
  TITLE_STYLES,
  defaultGameConfig,
  gameConfigForDisk,
  normalizeGameConfig,
} from '../core/game-config';
import { GameConfig } from '../models/game-config.model';

function raizDelRepo(): string {
  let dir = process.cwd();
  while (!existsSync(join(dir, 'schema', 'game.schema.json'))) {
    const arriba = dirname(dir);
    if (arriba === dir) {
      throw new Error('No se encontro schema/game.schema.json subiendo desde ' + process.cwd());
    }
    dir = arriba;
  }
  return dir;
}

const SCHEMA = JSON.parse(readFileSync(join(raizDelRepo(), 'schema', 'game.schema.json'), 'utf8')) as Record<string, unknown>;
const ajv = new Ajv({ strict: true, allErrors: true });
const validar = ajv.compile(SCHEMA);
const mensajeDe = (datos: unknown) => (validar(datos) ? '' : ajv.errorsText(validar.errors, { dataVar: 'game' }));

/** Lo que queda en game.json: el texto que escribe ProjectService.writeGameConfig, ya leido. */
const enDisco = (config: GameConfig) => JSON.parse(JSON.stringify(gameConfigForDisk(config), null, 2)) as unknown;

/** Una configuracion con todo lo opcional puesto. */
function configuracionCompleta(): GameConfig {
  const config = defaultGameConfig();
  return {
    ...config,
    name: 'La colmena',
    icon: 'textures/player.png',
    window: { width: 1280, height: 720, fullscreen: true },
    startLevel: 'test_level.json',
    titleScreen: { ...config.titleScreen, style: 'side', title: 'La colmena', subtitle: 'Demo', backgroundImage: 'textures/floor.png', backgroundMode: 'tile', music: 'sounds/hit.wav' },
    hud: { ...config.hud, healthStyle: 'hearts', healthPosition: 'bottom-right', healthBorder: { r: 255, g: 255, b: 255 }, heartFull: 'textures/player.png', heartEmpty: 'textures/player2.png' },
    screens: { ...config.screens, credits: ['# Equipo', 'Programacion', ''] },
    variables: { llaves: 0, puntaje: 10.5, deuda: -3 },
  };
}

describe('contrato de game.json', () => {
  it('es draft-07 y compila en modo estricto', () => {
    expect(SCHEMA['$schema']).toBe('http://json-schema.org/draft-07/schema#');
    expect(typeof validar).toBe('function');
  });

  it('la configuracion por defecto se escribe valida', () => {
    expect(mensajeDe(enDisco(defaultGameConfig()))).toBe('');
  });

  it('una configuracion con todo lo opcional se escribe valida', () => {
    expect(mensajeDe(enDisco(configuracionCompleta()))).toBe('');
  });

  it.each(TITLE_STYLES)('el estilo de portada $id se escribe valido', ({ id }) => {
    const config = defaultGameConfig();
    expect(mensajeDe(enDisco({ ...config, titleScreen: { ...config.titleScreen, style: id } }))).toBe('');
  });

  it.each(HEALTH_STYLES)('el estilo de vida $id se escribe valido', ({ id }) => {
    const config = defaultGameConfig();
    expect(mensajeDe(enDisco({ ...config, hud: { ...config.hud, healthStyle: id } }))).toBe('');
  });

  it.each(HUD_CORNERS)('la esquina $id se escribe valida', ({ id }) => {
    const config = defaultGameConfig();
    expect(mensajeDe(enDisco({ ...config, hud: { ...config.hud, healthPosition: id } }))).toBe('');
  });

  it.each(RESOLUTION_PRESETS)('la resolucion $label se escribe valida', ({ width, height }) => {
    const config = defaultGameConfig();
    expect(mensajeDe(enDisco({ ...config, window: { ...config.window, width, height } }))).toBe('');
  });

  it.each([
    ['nada', undefined],
    ['un texto', 'game'],
    ['una lista', []],
    ['tipos cambiados', { name: 3, window: { width: 'ancho', fullscreen: 'si' }, hud: { healthStyle: 'barras', segments: '10' } }],
    ['valores fuera de rango', { window: { width: 99999, height: 10 }, titleScreen: { titleSize: 1000, titleColor: { r: 300, g: -5, b: 1.5 } }, hud: { segments: 1, healthScale: 50 } }],
    ['variables que no son numeros', { variables: { llaves: 'dos', vidas: 3, nada: null } }],
  ])('un game.json con %s se lee y se vuelve a escribir valido', (_, crudo) => {
    expect(mensajeDe(enDisco(normalizeGameConfig(crudo)))).toBe('');
  });

  it('escribir y volver a leer deja la misma configuracion', () => {
    for (const config of [defaultGameConfig(), configuracionCompleta()]) {
      const escrito = enDisco(config);
      expect(enDisco(normalizeGameConfig(escrito))).toEqual(escrito);
    }
  });

  it.each([
    ['una ventana mas chica que el minimo', { window: { width: 100 } }],
    ['un estilo de portada que no existe', { titleScreen: { style: 'raro' } }],
    ['un color con un canal de mas de 255', { hud: { healthFill: { r: 300, g: 0, b: 0 } } }],
    ['un color sin un canal', { screens: { gameOverColor: { r: 1, g: 2 } } }],
    ['una variable que no es un numero', { variables: { llaves: 'dos' } }],
    ['los segmentos en 1', { hud: { segments: 1 } }],
    ['los creditos como texto', { screens: { credits: 'Equipo' } }],
  ])('el schema rechaza %s con un mensaje', (_, datos) => {
    expect(mensajeDe(datos)).toMatch(/\S/);
  });
});
