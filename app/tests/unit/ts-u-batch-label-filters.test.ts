import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const root = new URL('../../../ops/fleetbase/extensions/nutrezee-labels-engine/addon/components/', import.meta.url);
// Exercise the shipped component methods with only the Ember framework boundary replaced.
// The Console production build and browser proof cover template/decorator integration.
function component(name: string) {
  const source = readFileSync(new URL(`${name}.js`, root), 'utf8')
    .replace(/^import .*;\n/gm, '')
    .replace(/@(?:tracked|service) /g, '')
    .replace(/^\s*@action\s*$/gm, '')
    .replace('export default class', 'return class');
  return new Function('Component', 'normalizeLabel', 'describeFreshness', 'printDetached', source)(
    class {}, (value: unknown) => value, () => '', vi.fn(),
  );
}

const orders = [
  { selection_id: 'day:o1', order_number: '100', area_id: 'a1', area: 'Salmiya', driver_id: 'd1', driver_label: 'Car 1' },
  { selection_id: 'day:o2', order_number: '200', area_id: 'a2', area: 'Bayan', driver_id: 'd1', driver_label: 'Car 1' },
  { selection_id: 'day:o3', order_number: '300', area_id: 'a1', area: 'Salmiya', driver_id: 'd2', driver_label: 'Car 2' },
];
const options = {
  ready: true, delivery_date: '2026-09-06', today: '2026-09-05', orders,
  drivers: [{ id: 'd1', label: 'Car 1' }, { id: 'd2', label: 'Car 2' }],
  areas: [{ id: 'a1', label: 'Salmiya' }, { id: 'a2', label: 'Bayan' }],
};
function batch() {
  const Batch = component('batch-labels');
  Batch.prototype.loadOptions = vi.fn();
  const state = new Batch();
  state.loading = false;
  state.options = options;
  state.filterValue = 'd1';
  state.selectAllFiltered();
  return state;
}
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('TS-U A55 batch-label dropdown selection', () => {
  it('shows all driver orders and narrows/restores that group through the order dropdown', () => {
    const state = batch();
    state.showSelection = vi.fn();
    expect(state.selectionIds).toEqual(['day:o1', 'day:o2']);
    state.chooseOrder('day:o2');
    expect(state.selectionIds).toEqual(['day:o2']);
    expect(state.batchPayload()).toEqual({
      delivery_date: '2026-09-06', filter_type: 'driver', filter_value: 'd1', selection_ids: ['day:o2'],
    });
    state.chooseOrder('');
    expect(state.selectionIds).toEqual(['day:o1', 'day:o2']);
    expect(state.showSelection).toHaveBeenCalledTimes(2);
  });

  it('area filtering spans drivers and group changes clear the prior order and print confirmation', () => {
    const state = batch();
    state.showSelection = vi.fn();
    state.chooseOrder('day:o2');
    state.preview = { count: 1 };
    state.awaitingConfirmation = true;
    state.chooseFilterType('area');
    expect(state.selectionIds).toEqual(['day:o1', 'day:o3']);
    expect(state.orderValue).toBe('');
    expect(state.preview).toBeNull();
    expect(state.awaitingConfirmation).toBe(false);
    state.chooseFilterValue('a2');
    expect(state.selectionIds).toEqual(['day:o2']);
  });

  it('direct Orders mode searches the day and submits the exact order under its validated area', () => {
    const state = batch();
    state.showSelection = vi.fn();
    state.chooseFilterType('order');
    expect(state.orderOptions).toHaveLength(3);
    state.chooseOrder('day:o3');
    expect(state.batchPayload()).toEqual({
      delivery_date: '2026-09-06', filter_type: 'area', filter_value: 'a1', selection_ids: ['day:o3'],
    });
    state.chooseOrder('other-day:foreign');
    expect(state.selectionIds).toEqual(['day:o3']);
  });

  it('rejects an order outside the current driver and locks choices while recording a print', () => {
    const state = batch();
    state.showSelection = vi.fn();
    state.chooseOrder('day:o3');
    expect(state.selectionIds).toEqual(['day:o1', 'day:o2']);
    state.confirming = true;
    state.chooseFilterType('area');
    state.chooseFilterValue('d2');
    state.chooseOrder('day:o1');
    expect(state.filterType).toBe('driver');
    expect(state.filterValue).toBe('d1');
    expect(state.orderValue).toBe('');
  });

  it.each(['success', 'failure'])('ignores stale preview %s after selecting another order', async (outcome) => {
    const state = batch();
    const old = deferred();
    state.request = vi.fn().mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce({ count: 1, items: [{ label: { orderNumber: '200' } }] });
    const pending = state.prepareLabels();
    state.showSelection = vi.fn();
    state.chooseOrder('day:o2');
    await state.prepareLabels();
    if (outcome === 'success') old.resolve({ count: 2, items: [] });
    else old.reject(new Error('obsolete upstream error'));
    await pending;
    expect(state.preview.count).toBe(1);
    expect(state.preview.items[0].label.orderNumber).toBe('200');
    expect(state.error).toBeNull();
    expect(state.preparing).toBe(false);
  });

  it('invalidates an in-flight preview when the delivery date starts changing', async () => {
    const Batch = component('batch-labels');
    const loadOptions = Batch.prototype.loadOptions;
    const state = batch();
    const old = deferred();
    const day = deferred();
    state.request = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(day.promise);
    const preview = state.prepareLabels();
    const loading = loadOptions.call(state, '2026-09-07');
    old.resolve({ count: 2, items: [] });
    await preview;
    expect(state.preview).toBeNull();
    expect(state.selectionIds).toEqual([]);
    state.showSelection = vi.fn();
    state.request.mockResolvedValue(null);
    day.resolve({ ...options, delivery_date: '2026-09-07', orders: [], drivers: [], areas: [] });
    await loading;
    expect(state.selectedDate).toBe('2026-09-07');
    expect(state.preview).toBeNull();
  });

  it('searches dropdown labels without changing the active selection; supports Arabic and no matches', () => {
    const Dropdown = component('batch-filter-select');
    const dropdown = new Dropdown();
    dropdown.args = { value: '1', options: [
      { id: '1', label: '21-56792 · Car 1' }, { id: '2', label: 'السالمية' },
    ] };
    dropdown.search({ target: { value: '56792' } });
    expect(dropdown.choices.map((row: { id: string }) => row.id)).toEqual(['1']);
    dropdown.search({ target: { value: 'السالمية' } });
    expect(dropdown.choices.map((row: { id: string }) => row.id)).toEqual(['2']);
    expect(dropdown.selectedLabel).toBe('21-56792 · Car 1');
    dropdown.search({ target: { value: 'absent' } });
    expect(dropdown.choices).toEqual([]);
  });
});
