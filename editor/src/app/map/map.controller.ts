import { computed, inject, signal } from '@angular/core';

import {
  implicitRoom,
  nextFreeId,
  oppositeSide,
  placeBeside,
  rectBetween,
  roomAt,
  roomCenter,
  sideFacing,
} from '../core/dungeon-layout';
import { GridCoord } from '../core/iso-projection';
import { GridPosition, MapRoom, RoomSide } from '../models/level.model';
import { LevelService } from '../services/level.service';

/** Herramienta activa del viewport, en lo que le importa al mapa. */
type MapTool = 'select' | 'place' | 'floor' | 'wall' | 'room' | 'tunnel';

/** Tamano inicial de una grilla nueva. */
const NEW_ROOM_SIZE = 6;

/**
 * Celdas libres entre una grilla nueva y la anterior: una de pared de cada
 * lado y una de pasillo en el medio, lo minimo para que un tunel se vea.
 */
const NEW_ROOM_GAP = 4;

/** Ancho de tunel que propone el dialogo: el 3×3 del ejemplo del diseño. */
const DEFAULT_TUNNEL_WIDTH = 3;

/** Borrador del dialogo "grilla del mapa". */
export interface RoomDraft {
  /** La grilla que se esta cambiando, o null si es una nueva. */
  editId: string | null;
  id: string;
  col: number;
  row: number;
  width: number;
  height: number;
  /** Grilla junto a la que se ubica. Vacio = posicion libre (columna y fila a mano). */
  anchor: string;
  side: RoomSide;
  /** Grilla con la que se une por un tunel. Vacio = sin tunel. */
  connectTo: string;
  tunnelWidth: number;
}

/** Borrador del dialogo "tunel". */
export interface TunnelDraft {
  /** El tunel que se esta cambiando, o null si es uno nuevo. */
  editId: string | null;
  from: string;
  to: string;
  width: number;
  fromSide: RoomSide | '';
  toSide: RoomSide | '';
  path: GridPosition[];
}

export const ROOM_SIDES: readonly { value: RoomSide; label: string; hint: string }[] = [
  { value: 'right', label: '↘ Abajo der.', hint: 'Hacia +columna: en pantalla, abajo a la derecha' },
  { value: 'bottom', label: '↙ Abajo izq.', hint: 'Hacia +fila: en pantalla, abajo a la izquierda' },
  { value: 'top', label: '↗ Arriba der.', hint: 'Hacia −fila: en pantalla, arriba a la derecha' },
  { value: 'left', label: '↖ Arriba izq.', hint: 'Hacia −columna: en pantalla, arriba a la izquierda' },
];

/**
 * Salas y tuneles del mapa: los dos dialogos, las herramientas del viewport que
 * los dibujan, y el estado del arrastre y del trazado en curso.
 *
 * Un nivel puede ser un MAPA de varias grillas (salas) unidas por tuneles.
 * Salas y tuneles se guardan en el JSON para seguir editandolos, y el editor
 * los traduce a las celdas de piso y pared que el motor ya sabe leer (ver
 * core/dungeon-layout.ts). Aca estan los dialogos y las herramientas; las
 * cuentas viven en LevelService y en ese modulo.
 *
 * Las herramientas reciben la celda YA proyectada: el controlador no sabe nada
 * de canvas ni de zoom, y asi la proyeccion sigue estando en un solo lugar
 * (core/iso-canvas-renderer.ts).
 *
 * Es un controlador y no un componente por la misma razon que
 * ItemEditorController: el markup vive en app.html para usar los estilos de
 * App (ver el comentario de cabecera de app.ts).
 */
export class MapController {
  private readonly levels = inject(LevelService);

  readonly rooms = computed(() => this.levels.level().rooms ?? []);
  readonly tunnels = computed(() => this.levels.level().tunnels ?? []);
  private readonly grid = computed(() => this.levels.level().grid);

  constructor(
    private readonly note: (message: string) => void,
    private readonly markDirty: () => void,
    private readonly frameAll: () => void,
    private readonly setTool: (tool: MapTool) => void,
    private readonly setHovered: (cell: GridCoord) => void,
  ) {}

  readonly roomDraft = signal<RoomDraft | null>(null);
  readonly tunnelDraft = signal<TunnelDraft | null>(null);
  readonly roomSides = ROOM_SIDES;

  /**
   * Arrastre en curso de la herramienta Grilla: dibujar el rectangulo de una
   * nueva, o mover una existente. Es un signal porque el canvas dibuja la
   * vista previa mientras dura.
   */
  readonly roomDrag = signal<
    | { kind: 'create'; start: GridCoord; end: GridCoord }
    | { kind: 'move'; id: string; grab: GridCoord; origin: GridCoord; delta: GridCoord }
    | null
  >(null);

  /**
   * Tunel a medio trazar con la herramienta Tunel: de que grilla sale, los
   * puntos marcados hasta ahora, el ancho que va a tener, y que tunel se esta
   * redibujando (null si es uno nuevo).
   */
  readonly tunnelTrace = signal<{
    from: string;
    points: GridCoord[];
    width: number;
    editId: string | null;
  } | null>(null);

  /**
   * Las salas con las que se puede conectar una grilla nueva. En un nivel que
   * todavia es una sola grilla, es la sala en la que se va a convertir: asi el
   * dialogo ya ofrece unir la nueva con el area de siempre.
   */
  connectableRooms() {
    return this.rooms().length > 0 ? this.rooms() : [implicitRoom(this.grid())];
  }

  /**
   * Abre el dialogo de grilla nueva. Sin argumentos propone pegarla a la
   * ultima grilla, del lado de siempre (↘, +columna) y unida por un tunel
   * recto; con un rectangulo -- el que se dibujo con la herramienta Grilla --
   * la deja justo ahi, sin tunel, para trazarlo despues a mano si se quiere.
   */
  openRoomDialog(area?: { col: number; row: number; width: number; height: number }): void {
    const existing = this.connectableRooms();
    const last = existing[existing.length - 1];
    const id = nextFreeId('sala', existing.map((room) => room.id));

    if (area) {
      this.roomDraft.set({
        editId: null,
        id,
        ...area,
        anchor: '',
        side: 'right',
        connectTo: '',
        tunnelWidth: DEFAULT_TUNNEL_WIDTH,
      });
      return;
    }
    this.roomDraft.set(
      this.placedDraft({
        editId: null,
        id,
        col: 0,
        row: 0,
        width: NEW_ROOM_SIZE,
        height: NEW_ROOM_SIZE,
        anchor: last.id,
        side: 'right',
        connectTo: last.id,
        tunnelWidth: DEFAULT_TUNNEL_WIDTH,
      }),
    );
  }

  /** El mismo dialogo, para cambiar una grilla que ya existe. */
  editRoom(id: string): void {
    const room = this.rooms().find((candidate) => candidate.id === id);
    if (!room) {
      return;
    }
    this.roomDraft.set({
      editId: id,
      ...room,
      anchor: '',
      side: 'right',
      connectTo: '',
      tunnelWidth: DEFAULT_TUNNEL_WIDTH,
    });
  }

  /** Grillas junto a las que se puede ubicar la del dialogo: todas menos ella misma. */
  anchorRooms(): MapRoom[] {
    const editing = this.roomDraft()?.editId;
    return this.connectableRooms().filter((room) => room.id !== editing);
  }

  /** Si el borrador esta pegado a otra grilla, recalcula su columna y fila. */
  private placedDraft(draft: RoomDraft): RoomDraft {
    const anchor = this.connectableRooms().find((room) => room.id === draft.anchor);
    return anchor ? { ...draft, ...placeBeside(anchor, draft.side, draft, NEW_ROOM_GAP) } : draft;
  }

  patchRoomDraft(changes: Partial<RoomDraft>): void {
    this.roomDraft.update((draft) => (draft ? { ...draft, ...changes } : draft));
  }

  /**
   * Columna o fila escritas a mano: la grilla deja de estar pegada a otra. Si
   * no, el numero que se escribio se pisaria al instante con la posicion de
   * al lado.
   */
  patchRoomPosition(changes: { col?: number; row?: number }): void {
    this.roomDraft.update((draft) => (draft ? { ...draft, ...changes, anchor: '' } : draft));
  }

  /**
   * El tamano mueve la posicion cuando la grilla esta pegada a la izquierda o
   * arriba de otra: tiene que seguir terminando justo antes del hueco.
   */
  patchRoomSize(changes: { width?: number; height?: number }): void {
    this.roomDraft.update((draft) => (draft ? this.placedDraft({ ...draft, ...changes }) : draft));
  }

  setRoomAnchor(id: string): void {
    this.roomDraft.update((draft) =>
      draft
        ? this.placedDraft({
            ...draft,
            anchor: id,
            // Pegarla a otra propone unirse con esa misma, que es lo que casi
            // siempre se quiere. Al editar una existente no hay tunel que tocar.
            connectTo: draft.editId ? draft.connectTo : id || draft.connectTo,
          })
        : draft,
    );
  }

  setRoomSide(side: RoomSide): void {
    this.roomDraft.update((draft) => (draft ? this.placedDraft({ ...draft, side }) : draft));
  }

  cancelRoomDialog(): void {
    this.roomDraft.set(null);
  }

  confirmRoomDialog(): void {
    const draft = this.roomDraft();
    if (!draft) {
      return;
    }
    const area = { col: draft.col, row: draft.row, width: draft.width, height: draft.height };

    if (draft.editId) {
      this.levels.updateRoom(draft.editId, area);
      this.roomDraft.set(null);
      this.markDirty();
      this.frameAll();
      this.note('Grilla "' + draft.editId + '" actualizada.');
      return;
    }

    const id = draft.id.trim();
    if (!id || this.connectableRooms().some((room) => room.id === id)) {
      this.note(id ? 'Ya hay una grilla llamada "' + id + '".' : 'La grilla necesita un nombre.');
      return;
    }

    // Unida a la grilla junto a la que se ubico, el tunel sale por ese lado y
    // entra por el opuesto: queda un pasillo recto entre las dos, en vez de
    // una L que arranca en el medio de la sala.
    const facing = draft.anchor !== '' && draft.connectTo === draft.anchor;
    const connection = draft.connectTo
      ? {
          to: draft.connectTo,
          width: Math.max(1, Math.round(draft.tunnelWidth) || 1),
          fromSide: facing ? draft.side : undefined,
          toSide: facing ? oppositeSide(draft.side) : undefined,
        }
      : null;

    this.levels.addRoom({ id, ...area }, connection);
    this.roomDraft.set(null);
    this.markDirty();
    // La grilla del nivel pudo haber crecido, o el mapa correrse: se encuadra.
    this.frameAll();
    this.note(
      'Grilla "' + id + '" agregada' +
        (connection
          ? ', unida a "' + connection.to + '" por un túnel de ' + connection.width + ' celdas.'
          : '.'),
    );
  }

  /** Propone unir las dos ultimas grillas, que suele ser la que se acaba de agregar. */
  openTunnelDialog(): void {
    const rooms = this.rooms();
    if (rooms.length < 2) {
      this.note('Hacen falta al menos dos grillas para conectarlas. Agregá una desde Mapa.');
      return;
    }
    this.tunnelDraft.set({
      editId: null,
      from: rooms[rooms.length - 2].id,
      to: rooms[rooms.length - 1].id,
      width: DEFAULT_TUNNEL_WIDTH,
      fromSide: '',
      toSide: '',
      path: [],
    });
  }

  /** El menu de un tunel que ya existe: lados, trazado y ancho. */
  editTunnel(id: string): void {
    const tunnel = this.tunnels().find((candidate) => candidate.id === id);
    if (!tunnel) {
      return;
    }
    this.tunnelDraft.set({
      editId: id,
      from: tunnel.from,
      to: tunnel.to,
      width: tunnel.width,
      fromSide: tunnel.fromSide ?? '',
      toSide: tunnel.toSide ?? '',
      path: [...(tunnel.path ?? [])],
    });
  }

  patchTunnelDraft(changes: Partial<TunnelDraft>): void {
    this.tunnelDraft.update((draft) => (draft ? { ...draft, ...changes } : draft));
  }

  cancelTunnelDialog(): void {
    this.tunnelDraft.set(null);
  }

  /** El <select> de lados devuelve texto: se valida antes de aceptarlo. */
  sideValue(event: Event): RoomSide | '' {
    const value = (event.target as HTMLInputElement).value;
    return value === 'top' || value === 'bottom' || value === 'left' || value === 'right' ? value : '';
  }

  confirmTunnelDialog(): void {
    const draft = this.tunnelDraft();
    if (!draft) {
      return;
    }
    if (draft.from === draft.to) {
      this.note('Un túnel tiene que unir dos grillas distintas.');
      return;
    }
    // Vacio pasa a undefined, no a '' ni a []: asi la clave desaparece del
    // JSON, y al editar un tunel "volver a automatico" borra el trazado viejo.
    const tunnel = {
      from: draft.from,
      to: draft.to,
      width: Math.max(1, Math.round(draft.width) || 1),
      fromSide: draft.fromSide || undefined,
      toSide: draft.toSide || undefined,
      path: draft.path.length > 0 ? draft.path : undefined,
    };
    if (draft.editId) {
      this.levels.updateTunnel(draft.editId, tunnel);
    } else {
      this.levels.addTunnel(tunnel);
    }
    this.tunnelDraft.set(null);
    this.markDirty();
    this.note(
      draft.editId
        ? 'Túnel "' + draft.editId + '" actualizado.'
        : 'Túnel de ' + tunnel.width + ' celdas entre "' + draft.from + '" y "' + draft.to + '".',
    );
  }

  /**
   * Cierra el menu del tunel y deja trazandolo a mano desde su grilla de
   * origen. Al terminar en otra grilla, el menu se vuelve a abrir con el
   * trazado nuevo; si era un tunel que ya existia, lo reemplaza al guardar.
   */
  retraceTunnel(): void {
    const draft = this.tunnelDraft();
    if (!draft) {
      return;
    }
    this.tunnelDraft.set(null);
    this.setTool('tunnel');
    this.tunnelTrace.set({ from: draft.from, points: [], width: draft.width, editId: draft.editId });
    this.note('Trazando desde "' + draft.from + '": clics para marcar el camino, y clic en la grilla de destino.');
  }

  roomToolDown(event: PointerEvent, cell: GridCoord): void {
    const room = roomAt(this.rooms(), cell);
    this.roomDrag.set(
      room
        ? { kind: 'move', id: room.id, grab: cell, origin: { col: room.col, row: room.row }, delta: { col: 0, row: 0 } }
        : { kind: 'create', start: cell, end: cell },
    );
    // Con captura, el arrastre sigue aunque el cursor salga del canvas.
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  roomToolMove(event: PointerEvent, cell: GridCoord): void {
    const drag = this.roomDrag();
    if (!drag) {
      return;
    }
    this.setHovered(cell);
    if (drag.kind === 'create') {
      this.roomDrag.set({ ...drag, end: cell });
      return;
    }
    const delta = { col: cell.col - drag.grab.col, row: cell.row - drag.grab.row };
    if (delta.col !== drag.delta.col || delta.row !== drag.delta.row) {
      this.roomDrag.set({ ...drag, delta });
    }
  }

  /**
   * Al soltar: una grilla movida se guarda en su lugar nuevo (el mapa se
   * recalcula una sola vez, no con cada celda del arrastre), y un rectangulo
   * dibujado abre el dialogo con ese lugar. Un clic sin arrastrar propone una
   * grilla del tamano de siempre en esa celda.
   */
  roomToolUp(event: PointerEvent, cell: GridCoord): void {
    const drag = this.roomDrag();
    if (!drag) {
      return;
    }
    this.roomDrag.set(null);
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);

    if (drag.kind === 'move') {
      if (drag.delta.col === 0 && drag.delta.row === 0) {
        return;
      }
      this.levels.updateRoom(drag.id, {
        col: drag.origin.col + drag.delta.col,
        row: drag.origin.row + drag.delta.row,
      });
      this.markDirty();
      this.note('Grilla "' + drag.id + '" movida.');
      return;
    }

    const area = rectBetween(drag.start, drag.end);
    const clickOnly = area.width === 1 && area.height === 1;
    this.openRoomDialog(
      clickOnly ? { col: area.col, row: area.row, width: NEW_ROOM_SIZE, height: NEW_ROOM_SIZE } : area,
    );
  }

  tunnelToolClick(event: PointerEvent, cell: GridCoord): void {
    if (this.rooms().length < 2) {
      this.note('Hacen falta al menos dos grillas para trazar un túnel. Agregá una desde Mapa.');
      return;
    }
    const room = roomAt(this.rooms(), cell);
    const trace = this.tunnelTrace();

    if (!trace) {
      if (!room) {
        this.note('Empezá el túnel con un clic dentro de una grilla.');
        return;
      }
      this.tunnelTrace.set({ from: room.id, points: [], width: DEFAULT_TUNNEL_WIDTH, editId: null });
      this.note('Túnel desde "' + room.id + '": clics para marcar el camino, y clic en otra grilla para terminar.');
      return;
    }

    if (room && room.id !== trace.from) {
      this.finishTunnelTrace(room.id);
      return;
    }
    if (room) {
      this.note('Esa es la grilla de origen: terminá el túnel en otra.');
      return;
    }
    this.tunnelTrace.set({ ...trace, points: [...trace.points, cell] });
  }

  /**
   * Termina el trazado y abre el menu del tunel con todo ya deducido. Los
   * lados salen de hacia donde se trazo: sale por el lado de "from" que mira
   * al primer punto marcado, y entra por el lado de "to" que mira al ultimo.
   * Sin puntos, cada una por el lado que da a la otra.
   */
  private finishTunnelTrace(toId: string): void {
    const trace = this.tunnelTrace();
    const from = this.rooms().find((room) => room.id === trace?.from);
    const to = this.rooms().find((room) => room.id === toId);
    if (!trace || !from || !to) {
      return;
    }
    const path = trace.points;
    this.tunnelTrace.set(null);
    this.tunnelDraft.set({
      editId: trace.editId,
      from: from.id,
      to: to.id,
      width: trace.width,
      fromSide: sideFacing(from, path[0] ?? roomCenter(to)),
      toSide: sideFacing(to, path[path.length - 1] ?? roomCenter(from)),
      path,
    });
  }

  updateRoom(id: string, changes: { col?: number; row?: number; width?: number; height?: number }): void {
    this.levels.updateRoom(id, changes);
    this.markDirty();
  }

  removeRoom(id: string): void {
    this.levels.removeRoom(id);
    this.markDirty();
    this.note(
      this.rooms().length === 0
        ? 'Se quitó la última grilla: el nivel vuelve a ser una sola grilla rectangular.'
        : 'Grilla "' + id + '" quitada, con sus túneles.',
    );
  }

  updateTunnel(id: string, width: number): void {
    this.levels.updateTunnel(id, { width });
    this.markDirty();
  }

  removeTunnel(id: string): void {
    this.levels.removeTunnel(id);
    this.markDirty();
    this.note('Túnel "' + id + '" quitado.');
  }

  clearTileEdits(): void {
    this.levels.clearTileEdits();
    this.markDirty();
    this.note('Retoques descartados: el mapa queda como lo generan las grillas y los túneles.');
  }
}
