// La textura del piso, por capas: nivel, sala o tunel, y casilla.
//
// TRES CAPAS, cada una pisa a la de abajo:
//   1. el nivel: visuals.floor, la de toda casilla que no diga otra cosa
//   2. la sala o el tunel: su "floorTexture". El de un tunel va solo en el
//      pasillo: adentro de una sala (el tunel arranca en su centro, ver
//      dungeon-layout.ts) manda la sala, con su piso propio o el del nivel.
//   3. la casilla: "floorPaint", lo pintado a mano desde Recursos › Texturas
//
// COMO LLEGA AL MOTOR. El motor no sabe de salas ni de tuneles: lee "tiles"
// (ver dungeon-layout.ts). Al guardar, levelForDisk resuelve las capas casilla
// por casilla y deja en el JSON lo unico que el motor necesita: la lista de
// texturas "visuals.floorVariants", y en cada casilla de "tiles" el indice de
// la suya, "floorVariant". Las que usan la del nivel no llevan nada.
//
// Lo resuelto se rehace ENTERO en cada guardado y el editor nunca lo lee: en
// memoria solo viven las capas, que es lo que se edita y lo que deshace Ctrl+Z.
// Asi no hay dos copias del mismo dato que se puedan desfasar.

import { FloorPaint, Level, MapTile } from '../models/level.model';
import { legacyTiles, roomAt, tunnelFloor } from './dungeon-layout';

const key = (col: number, row: number) => col + ',' + row;

type FloorLayers = Pick<Level, 'rooms' | 'tunnels' | 'floorPaint'>;

// Memoria de un solo lugar: el viewport pregunta en cada redibujo, y las capas
// casi nunca cambian entre dos redibujos. Se comparan las tres referencias:
// el nivel es inmutable, asi que la misma referencia es el mismo contenido.
let memo: { rooms: unknown; tunnels: unknown; paint: unknown; result: Map<string, string> } | null = null;

/**
 * La textura de cada casilla que NO usa la del nivel, por "col,row". Solo
 * mira las capas 2 y 3; quien la use cae a visuals.floor si no esta aca.
 */
export function floorOverrides(level: FloorLayers): Map<string, string> {
  if (memo && memo.rooms === level.rooms && memo.tunnels === level.tunnels && memo.paint === level.floorPaint) {
    return memo.result;
  }
  const result = sectionFloors(level);
  for (const cell of level.floorPaint ?? []) {
    result.set(key(cell.col, cell.row), cell.texture);
  }
  memo = { rooms: level.rooms, tunnels: level.tunnels, paint: level.floorPaint, result };
  return result;
}

/** Solo la capa 2: la textura que le dan a cada casilla su sala o su tunel. */
function sectionFloors(level: Pick<Level, 'rooms' | 'tunnels'>): Map<string, string> {
  const result = new Map<string, string>();
  const rooms = level.rooms ?? [];
  const roomsById = new Map(rooms.map((room) => [room.id, room]));
  // El piso de un tunel va solo en el pasillo: el tunel arranca y termina en
  // el centro de sus salas, y adentro de una sala manda la sala, tenga piso
  // propio o use el del nivel.
  for (const tunnel of level.tunnels ?? []) {
    const from = roomsById.get(tunnel.from);
    const to = roomsById.get(tunnel.to);
    if (!tunnel.floorTexture || !from || !to) {
      continue;
    }
    for (const cell of tunnelFloor(from, to, tunnel)) {
      if (!roomAt(rooms, cell)) {
        result.set(key(cell.col, cell.row), tunnel.floorTexture);
      }
    }
  }
  for (const room of rooms) {
    if (!room.floorTexture) {
      continue;
    }
    for (let col = room.col; col < room.col + room.width; col += 1) {
      for (let row = room.row; row < room.row + room.height; row += 1) {
        result.set(key(col, row), room.floorTexture);
      }
    }
  }
  return result;
}

/** La textura de piso de una casilla con todas sus capas, o null si el nivel no tiene piso. */
export function floorTextureAt(level: FloorLayers & Pick<Level, 'visuals'>, col: number, row: number): string | null {
  return floorOverrides(level).get(key(col, row)) ?? level.visuals?.floor?.texture ?? null;
}

/**
 * La pintura de piso con una casilla cambiada. Con textura la pinta; con null,
 * o con la misma textura que ya le darian su sala o el nivel, la despinta: no
 * se guarda pintura que no cambia nada.
 */
export function paintFloorCell(
  level: FloorLayers & Pick<Level, 'visuals'>,
  col: number,
  row: number,
  texture: string | null,
): FloorPaint[] {
  const others = (level.floorPaint ?? []).filter((cell) => cell.col !== col || cell.row !== row);
  const underneath = sectionFloors(level).get(key(col, row)) ?? level.visuals?.floor?.texture ?? null;
  return texture === null || texture === underneath ? others : [...others, { col, row, texture }];
}

/** Una casilla sin lo resuelto de un guardado anterior. */
function withoutVariant(tile: MapTile): MapTile {
  if (tile.floorVariant === undefined) {
    return tile;
  }
  const { floorVariant: _, ...rest } = tile;
  return rest;
}

/**
 * El nivel tal como se escribe en disco (y como lo muestra la pestaña JSON):
 * con las capas del piso resueltas en lo que lee el motor.
 *
 * Un nivel de una sola grilla sin "tiles" que tiene casillas pintadas recibe
 * sus "tiles": son las mismas que el motor arma solo para esos niveles (ver
 * legacyTiles), mas el indice de textura de las pintadas.
 */
export function levelForDisk(level: Level): Level {
  const overrides = floorOverrides(level);
  const { floorVariants: _old, ...visuals } = level.visuals ?? {};
  const cleanVisuals = level.visuals ? visuals : undefined;

  if (overrides.size === 0) {
    return { ...level, tiles: level.tiles?.map(withoutVariant), visuals: cleanVisuals };
  }

  const variants: string[] = [];
  const indexOf = new Map<string, number>();
  const tiles = (level.tiles ?? legacyTiles(level.grid)).map((source) => {
    const tile = withoutVariant(source);
    const texture = tile.floor === false ? undefined : overrides.get(key(tile.col, tile.row));
    if (texture === undefined) {
      return tile;
    }
    let index = indexOf.get(texture);
    if (index === undefined) {
      index = variants.length;
      variants.push(texture);
      indexOf.set(texture, index);
    }
    return { ...tile, floorVariant: index };
  });

  // Capas que no tocan ninguna casilla con piso (pintura fuera del mapa): no
  // hay nada que resolver, y un nivel sin "tiles" se queda sin ellos.
  if (variants.length === 0) {
    return { ...level, tiles: level.tiles?.map(withoutVariant), visuals: cleanVisuals };
  }
  return {
    ...level,
    tiles,
    visuals: { ...cleanVisuals, floorVariants: variants.map((texture) => ({ texture })) },
  };
}
