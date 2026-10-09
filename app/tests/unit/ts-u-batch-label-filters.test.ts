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

describe('TS-U A79 batch-label delivery time filter', () => {
  const timed = {
    ...options,
    orders: [
      { ...orders[0]!, time_id: 'Before 1 day', time: 'Before 1 day' },
      { ...orders[1]!, time_id: 'From 5 AM to 4 PM', time: 'From 5 AM to 4 PM' },
      { ...orders[2]!, time_id: 'Before 1 day', time: 'Before 1 day' },
    ],
    time_slots: [{ id: 'Before 1 day', label: 'Before 1 day', count: 2 }, { id: 'From 5 AM to 4 PM', label: 'From 5 AM to 4 PM', count: 1 }],
  };
  function timedBatch() {
    const state = batch();
    state.options = timed;
    state.showSelection = vi.fn();
    state.selectAllFiltered();
    return state;
  }

  it('narrows a driver to one time slot and keeps the slot when the driver changes', () => {
    const state = timedBatch();
    expect(state.dropdowns.map((d: { name: string }) => d.name)).toEqual(['group', 'scope', 'time', 'order']);
    state.chooseTime('Before 1 day');
    expect(state.selectionIds).toEqual(['day:o1']);
    expect(state.batchPayload()).toMatchObject({ filter_type: 'driver', filter_value: 'd1', selection_ids: ['day:o1'] });
    state.chooseFilterValue('d2');
    expect(state.timeValue).toBe('Before 1 day');
    expect(state.selectionIds).toEqual(['day:o3']);
    state.chooseTime('');
    expect(state.selectionIds).toEqual(['day:o3']);
    state.chooseTime('not a slot');
    expect(state.timeValue).toBe('');
  });

  it('prints one whole time slot across drivers, grouped by driver', () => {
    const state = timedBatch();
    state.chooseFilterType('time');
    expect(state.filterValue).toBe('Before 1 day');
    expect(state.filterOptions[0].label).toBe('Before 1 day (2)');
    expect(state.selectionIds).toEqual(['day:o1', 'day:o3']);
    expect(state.batchPayload()).toEqual({
      delivery_date: '2026-09-06', filter_type: 'time', filter_value: 'Before 1 day', selection_ids: ['day:o1', 'day:o3'],
    });
    expect(state.dropdowns.map((d: { name: string }) => d.name)).toEqual(['group', 'scope', 'order']);
  });

  it('shows no time dropdown on a day with a single slot or an older API answer', () => {
    const state = batch();
    expect(state.dropdowns.map((d: { name: string }) => d.name)).toEqual(['group', 'scope', 'order']);
    expect(state.filterTypes.map((t: { id: string }) => t.id)).toEqual(['driver', 'area', 'order']);
  });
});

describe('TS-U A83 WhatsApp subscribers print as their own group', () => {
  const mixed = {
    ...options,
    orders: [
      ...orders,
      { selection_id: 'day:w1', order_number: 'WA-55123456', area_id: 'a1', area: 'Salmiya', driver_id: 'd1', driver_label: 'Car 1', source: 'whatsapp' },
      { selection_id: 'day:w2', order_number: 'WA-55999999', area_id: 'a2', area: 'Bayan', driver_id: null, driver_label: null, source: 'whatsapp' },
    ],
    sources: [{ id: 'whatsapp', label: 'WhatsApp subscribers / مشتركين الواتساب', count: 2 }],
  };
  function mixedBatch() {
    const state = batch();
    state.options = mixed;
    state.showSelection = vi.fn();
    state.selectAllFiltered();
    return state;
  }

  it('keeps them out of the driver and area batches', () => {
    const state = mixedBatch();
    expect(state.selectionIds).toEqual(['day:o1', 'day:o2']);
    state.chooseFilterType('area');
    expect(state.selectionIds).toEqual(['day:o1', 'day:o3']);
  });

  it('prints all of them from the WhatsApp group', () => {
    const state = mixedBatch();
    state.chooseFilterType('source');
    expect(state.filterValue).toBe('whatsapp');
    expect(state.selectionIds).toEqual(['day:w2', 'day:w1']);
    expect(state.batchPayload()).toEqual({
      delivery_date: '2026-09-06', filter_type: 'source', filter_value: 'whatsapp', selection_ids: ['day:w2', 'day:w1'],
    });
  });

  it('offers no WhatsApp group on a day without them', () => {
    expect(batch().filterTypes.map((t: { id: string }) => t.id)).toEqual(['driver', 'area', 'order']);
  });
});

describe('TS-U A85 the page checks itself against the legacy admin', () => {
  const result = (over: Record<string, unknown> = {}) => ({
    status: 'ok', finished_at: '2026-09-05T21:50:00Z', age_seconds: 120, fresh: true,
    screen_orders: 773, labels: 773, differences: 0, without_driver: 0, whatsapp_labels: 33, detail: {}, ...over,
  });

  it('says green only for a fresh check with no difference, red with the fallback, amber while checking', () => {
    const state = batch();
    state.today = '2026-09-05';
    expect(state.printCheckText).toBe('');
    state.printCheck = { verified: true, pending: null, latest: result({ without_driver: 5 }) };
    expect(state.printCheckTone).toBe('ok');
    expect(state.printCheckText).toContain('773 = 773');
    expect(state.printCheckText).toContain('5 without a driver yet');
    state.printCheck = { verified: false, pending: null, latest: result({ status: 'differences', differences: 3 }) };
    expect(state.printCheckTone).toBe('bad');
    expect(state.printCheckText).toContain('اطبع من السيستم القديم');
    state.printCheck = { verified: false, pending: null, latest: result({ status: 'failed' }) };
    expect(state.printCheckTone).toBe('bad');
    state.printCheck = { verified: false, pending: { id: 'r1' }, latest: result({ fresh: false, age_seconds: 4000 }) };
    expect(state.printCheckTone).toBe('busy');
    state.printCheck = { verified: false, pending: null, latest: null };
    expect(state.printCheckTone).toBe('busy');
    // a day already delivered shows no line
    state.today = '2026-09-07';
    expect(state.printCheckText).toBe('');
  });

  it('a newer result reloads the labels and keeps the operator on the same driver, never during a print', async () => {
    const state = batch();
    state.today = '2026-09-05';
    state.showSelection = vi.fn();
    state.chooseFilterValue('d2');
    const moved = { ...options, orders: orders.map((order) => ({ ...order, driver_id: 'd2', driver_label: 'Car 2' })) };
    state.request = vi.fn(async (path: string) => (path.includes('print-check')
      ? { verified: true, pending: null, latest: result({ finished_at: '2026-09-05T21:55:00Z' }) }
      : moved));
    state.printCheckSeen = '2026-09-05T21:50:00Z';
    await state.readPrintCheck('GET', '2026-09-06');
    expect(state.filterValue).toBe('d2');
    expect(state.selectionIds).toEqual(['day:o1', 'day:o2', 'day:o3']);
    // same result again: nothing is reloaded
    const calls = state.request.mock.calls.length;
    await state.readPrintCheck('GET', '2026-09-06');
    expect(state.request.mock.calls.length).toBe(calls + 1);
    // while the operator is confirming a print, the list is left alone
    state.awaitingConfirmation = true;
    state.request = vi.fn(async (path: string) => (path.includes('print-check')
      ? { verified: true, pending: null, latest: result({ finished_at: '2026-09-05T22:00:00Z' }) }
      : options));
    await state.readPrintCheck('GET', '2026-09-06');
    expect(state.request).toHaveBeenCalledTimes(1);
    expect(state.selectionIds).toEqual(['day:o1', 'day:o2', 'day:o3']);
  });

  it('the first reading of a day never reloads, and a failed read leaves the page working', async () => {
    const state = batch();
    state.today = '2026-09-05';
    state.request = vi.fn(async () => ({ verified: true, pending: null, latest: result() }));
    await state.readPrintCheck('POST', '2026-09-06');
    expect(state.request).toHaveBeenCalledTimes(1);
    expect(state.request.mock.calls[0][1]).toMatchObject({ method: 'POST' });
    state.request = vi.fn(async () => { throw new Error('http_503'); });
    await expect(state.readPrintCheck('GET', '2026-09-06')).resolves.toBeUndefined();
    expect(state.printCheckTone).toBe('ok');
  });
});

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
    const state = batch();
    state.options = { ...options, drivers: [
      { id: 'd1', label: '21-56792 · Car 1' }, { id: 'd2', label: 'السالمية' },
    ] };
    const scope = () => state.dropdowns.find((field: { name: string }) => field.name === 'scope');
    state.searchDropdown('scope', { target: { value: '56792' } });
    expect(scope().choices.map((row: { id: string }) => row.id)).toEqual(['d1']);
    state.searchDropdown('scope', { target: { value: 'السالمية' } });
    expect(scope().choices.map((row: { id: string }) => row.id)).toEqual(['d2']);
    expect(scope().selectedLabel).toBe('21-56792 · Car 1');
    state.searchDropdown('scope', { target: { value: 'absent' } });
    expect(scope().choices).toEqual([]);
  });
});
