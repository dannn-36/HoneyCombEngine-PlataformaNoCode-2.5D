import { IsoProjection } from './iso-projection';

describe('IsoProjection', () => {
  const iso = new IsoProjection(64, 32);

  describe('gridToScreen', () => {
    it('la celda 0,0 es el origen', () => {
      expect(iso.gridToScreen({ col: 0, row: 0 })).toEqual({ x: 0, y: 0 });
    });

    it('crecer la columna va abajo a la derecha y crecer la fila abajo a la izquierda', () => {
      expect(iso.gridToScreen({ col: 1, row: 0 })).toEqual({ x: 32, y: 16 });
      expect(iso.gridToScreen({ col: 0, row: 1 })).toEqual({ x: -32, y: 16 });
    });

    it('la diagonal col = row cae siempre en x = 0', () => {
      for (let n = 0; n < 20; n += 1) {
        expect(iso.gridToScreen({ col: n, row: n })).toEqual({ x: 0, y: n * 32 });
      }
    });

    it('acepta medias celdas, como el centro de un bloque de span par', () => {
      expect(iso.gridToScreen({ col: 2.5, row: 2.5 })).toEqual({ x: 0, y: 80 });
    });

    it('sigue el tamano de tile: con tiles cuadrados la proyeccion es mas alta', () => {
      const square = new IsoProjection(32, 32);
      expect(square.gridToScreen({ col: 3, row: 1 })).toEqual({ x: 32, y: 64 });
    });

    it('las celdas negativas se proyectan del otro lado del origen', () => {
      expect(iso.gridToScreen({ col: -1, row: -1 })).toEqual({ x: 0, y: -32 });
    });
  });

  describe('screenToGrid', () => {
    it('ida y vuelta: el punto de una celda, corrido medio tile hacia abajo, vuelve a ella', () => {
      // El punto proyectado es la punta de arriba del rombo de screenToGrid:
      // bajando medio tile se cae en su centro.
      for (const [w, h] of [[64, 32], [32, 32], [128, 64], [48, 24]]) {
        const projection = new IsoProjection(w, h);
        for (let col = -3; col < 12; col += 1) {
          for (let row = -3; row < 12; row += 1) {
            const point = projection.gridToScreen({ col, row });
            expect(projection.screenToGrid({ x: point.x, y: point.y + h / 2 })).toEqual({ col, row });
          }
        }
      }
    });

    it('todo punto dentro del rombo de la celda da la misma celda', () => {
      const top = iso.gridToScreen({ col: 4, row: 2 });
      const center = { x: top.x, y: top.y + 16 };
      for (const [dx, dy] of [[0, 0], [30, 0], [-30, 0], [0, 15], [0, -15], [14, 7], [-14, -7]]) {
        expect(iso.screenToGrid({ x: center.x + dx, y: center.y + dy })).toEqual({ col: 4, row: 2 });
      }
    });

    it('pasando el borde del rombo se cae en la vecina', () => {
      const top = iso.gridToScreen({ col: 4, row: 2 });
      // Mas alla de la punta derecha: columna siguiente, fila anterior.
      expect(iso.screenToGrid({ x: top.x + 33, y: top.y + 16 })).toEqual({ col: 5, row: 1 });
      // Mas abajo de la punta de abajo: la diagonal siguiente.
      expect(iso.screenToGrid({ x: top.x, y: top.y + 33 })).toEqual({ col: 5, row: 3 });
    });

    it('redondea hacia abajo tambien con coordenadas negativas', () => {
      expect(iso.screenToGrid({ x: 0, y: -1 })).toEqual({ col: -1, row: -1 });
      expect(iso.screenToGrid({ x: -40, y: 8 })).toEqual({ col: -1, row: 0 });
    });
  });

  describe('isValidCoord', () => {
    it('acepta las cuatro esquinas de la grilla', () => {
      for (const coord of [{ col: 0, row: 0 }, { col: 9, row: 0 }, { col: 0, row: 7 }, { col: 9, row: 7 }]) {
        expect(iso.isValidCoord(coord, 10, 8)).toBe(true);
      }
    });

    it('rechaza lo que queda justo afuera de cada borde', () => {
      for (const coord of [{ col: -1, row: 0 }, { col: 10, row: 0 }, { col: 0, row: -1 }, { col: 0, row: 8 }]) {
        expect(iso.isValidCoord(coord, 10, 8)).toBe(false);
      }
    });

    it('en una grilla vacia no hay ninguna celda valida', () => {
      expect(iso.isValidCoord({ col: 0, row: 0 }, 0, 0)).toBe(false);
    });
  });
});
