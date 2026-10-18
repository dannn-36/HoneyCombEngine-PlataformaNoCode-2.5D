// Actualizar un objeto en todos los niveles: lo que se le hace al JSON de cada uno.

import { normalizeItem } from '../core/items';
import { replaceItemCopy } from './item-editor.controller';

describe('replaceItemCopy', () => {
  const espada = normalizeItem({ id: 'espada', name: 'Espada', kind: 'weapon' });
  const mejorada = { ...espada, name: 'Espada mejorada' };

  it('reemplaza la copia en el mismo lugar de la lista', () => {
    const otra = { id: 'moneda', name: 'Moneda' };
    const raw: Record<string, unknown> = { items: [otra, espada, { id: 'pocion' }] };
    expect(replaceItemCopy(raw, mejorada)).toBe(true);
    expect((raw['items'] as { id: string }[]).map((item) => item.id)).toEqual(['moneda', 'espada', 'pocion']);
    expect((raw['items'] as { name: string }[])[1].name).toBe('Espada mejorada');
    expect((raw['items'] as unknown[])[0]).toBe(otra);
  });

  it('un nivel sin copia del objeto no cambia', () => {
    const raw: Record<string, unknown> = { items: [{ id: 'moneda' }] };
    expect(replaceItemCopy(raw, mejorada)).toBe(false);
    expect(replaceItemCopy({ name: 'sin items' }, mejorada)).toBe(false);
  });

  it('una copia que ya esta al dia no cuenta como cambio', () => {
    const raw: Record<string, unknown> = { items: [structuredClone(mejorada)] };
    expect(replaceItemCopy(raw, mejorada)).toBe(false);
  });

  it('guarda una copia, no el mismo objeto de la biblioteca', () => {
    const raw: Record<string, unknown> = { items: [espada] };
    replaceItemCopy(raw, mejorada);
    expect((raw['items'] as unknown[])[0]).not.toBe(mejorada);
  });
});
