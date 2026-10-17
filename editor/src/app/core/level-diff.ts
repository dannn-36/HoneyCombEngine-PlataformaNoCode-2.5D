// Que cambio entre dos versiones del nivel, en palabras: es lo que dicen los
// botones de deshacer y rehacer ("Deshacer: mover player_1").
//
// Compara REFERENCIAS, no contenido. LevelService nunca muta: cambiar una
// entidad arma un objeto nuevo para esa entidad y deja las demas como estaban,
// asi que "es otro objeto" quiere decir "cambio". Es lo que hace que comparar
// dos niveles de cientos de entidades no cueste nada.

import { Level, LevelEntity } from '../models/level.model';

/** "player_1" si es una, "3 entidades" si son varias. */
function whom(ids: readonly string[]): string {
  return ids.length === 1 ? ids[0] : ids.length + ' entidades';
}

/** true si dos versiones de una entidad solo difieren en la celda. */
function onlyMoved(before: LevelEntity, after: LevelEntity): boolean {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (key === 'position') {
      continue;
    }
    if (before[key as keyof LevelEntity] !== after[key as keyof LevelEntity]) {
      return false;
    }
  }
  return true;
}

function describeEntities(before: readonly LevelEntity[], after: readonly LevelEntity[]): string | null {
  if (before === after) {
    return null;
  }
  const oldById = new Map(before.map((entity) => [entity.id, entity]));
  const newIds = new Set(after.map((entity) => entity.id));

  const added = after.filter((entity) => !oldById.has(entity.id)).map((entity) => entity.id);
  const removed = before.filter((entity) => !newIds.has(entity.id)).map((entity) => entity.id);
  const changed = after.filter((entity) => {
    const old = oldById.get(entity.id);
    return old !== undefined && old !== entity;
  });

  // Renombrar es quitar un id y poner otro en el MISMO lugar de la lista;
  // reemplazar una entidad por otra en su celda la agrega al final.
  if (
    added.length === 1 &&
    removed.length === 1 &&
    before.findIndex((entity) => entity.id === removed[0]) === after.findIndex((entity) => entity.id === added[0])
  ) {
    return 'renombrar ' + removed[0] + ' → ' + added[0];
  }
  if (added.length > 0 && removed.length > 0) {
    return 'reemplazar ' + whom(removed);
  }
  if (added.length > 0) {
    return 'colocar ' + whom(added);
  }
  if (removed.length > 0) {
    return 'eliminar ' + whom(removed);
  }
  if (changed.length > 0) {
    const ids = changed.map((entity) => entity.id);
    const moved = changed.every((entity) => onlyMoved(oldById.get(entity.id) as LevelEntity, entity));
    return (moved ? 'mover ' : 'editar ') + whom(ids);
  }
  // Mismas entidades en otro orden.
  return 'reordenar las entidades';
}

/** El cambio de "before" a "after" contado en pocas palabras, en minuscula. */
export function describeLevelChange(before: Level, after: Level): string {
  const entities = describeEntities(before.entities, after.entities);
  if (entities) {
    return entities;
  }
  if (
    before.rooms !== after.rooms ||
    before.tunnels !== after.tunnels ||
    before.tileEdits !== after.tileEdits ||
    before.tiles !== after.tiles
  ) {
    return 'editar el mapa';
  }
  if (before.zones !== after.zones) {
    return 'editar las zonas';
  }
  if (before.events !== after.events) {
    return 'editar los eventos';
  }
  if (before.grid !== after.grid) {
    return 'cambiar la grilla';
  }
  if (before.camera !== after.camera) {
    return 'cambiar la cámara';
  }
  if (before.backgroundColor !== after.backgroundColor) {
    return 'cambiar el fondo';
  }
  if (before.name !== after.name) {
    return 'renombrar el nivel';
  }
  return 'cambiar el nivel';
}
