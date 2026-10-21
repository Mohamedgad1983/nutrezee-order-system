import { describe, expect, it, vi } from 'vitest';
import {
  PartnerLabelProfileSource, addressFromPartner, daysRemaining, isKitchenPickup, labelText, localPhone, mealsOfOneDelivery, mealsPerBox,
} from '../../apps/api/src/modules/m25-label/partner-label-profile';

// TS-U (WP-OPS-A78) — the customer part of the legacy label, read from Partner at print time.

const DATE = '2026-10-07';
const page = (data: unknown[], next: string | null = null) =>
  new Response(JSON.stringify({ data, count: data.length, next_cursor: next, mode: 'live', server_time: 'x' }));

const daily = {
  order_id: 28251, order_number: '29203', delivery_date: DATE, updated_at: '2026-09-30T12:53:57+03:00',
  customer: { code: '1119', name: 'jasem', phone: '98992558' },
  driver_instructions: 'Thursday Double Box\nif no answer call 97504160',
  time_slot: { id: 26, title: 'Before 1 day' }, delivery_method: 'Leave the box',
  address: { text: '2, 314, 13, home', area_en: 'Abdullah Al Mubarak ', area_ar: 'عبد الله المبارك' },
};
const subscription = {
  subscription_id: 28251, order_number: '29203', deleted: false,
  package: { name_en: '720- 1920  calories (almost)', name_ar: '(تقريبا) 720- 1920 سعرة حرارية', meals_per_day: 3, snacks_per_day: 2 },
  delivery: { delivery_address_id: 7913, off_weekdays: [5] },
  start_date: '2026-09-12', end_date: '2026-10-11', frozen_days: 0,
};
const freeze = (id: number, date: string, extra: Record<string, unknown> = {}) => ({
  change_id: id, subscription_id: 28251, change_type: 'freeze', effective_from: date, effective_to: date,
  is_reverted: false, deleted: false, ...extra,
});
const address = {
  address_id: 7913, name: '3', street: '314', building: '2', house_no: '13', flat_no: null, landmark: null,
  extra_directions: 'home', area_en: 'Old Area', deleted: false,
};

function source(handlers: Record<string, () => Response | Promise<Response>>, extra: Record<string, unknown> = {}) {
  const fetchImpl = vi.fn(async (input: string | URL) => {
    const endpoint = new URL(String(input)).pathname.split('/').pop()!;
    const handler = handlers[endpoint];
    if (!handler) return new Response('{}', { status: 404 });
    return handler();
  });
  const instance = new PartnerLabelProfileSource({
    // The labels are for DATE: a fixed clock keeps freezes of that week from ageing out of the test.
    baseUrl: 'https://nutreeze.com/integration', apiKey: 'test-key', fetchImpl, now: () => Date.parse(`${DATE}T09:00:00Z`), ...extra,
  });
  return { instance, fetchImpl };
}

describe('TS-U partner label profile (A78)', () => {
  it('prints the local number, never a country prefix on a Kuwait number', () => {
    expect(localPhone('+96698992558')).toBe('98992558');
    expect(localPhone('+96598992558')).toBe('98992558');
    expect(localPhone('0096598992558')).toBe('98992558');
    expect(localPhone('98992558')).toBe('98992558');
    expect(localPhone('+447911123456')).toBe('+447911123456');
    expect(localPhone('-')).toBeNull();
    expect(localPhone(null)).toBeNull();
  });

  it('A90: days remaining is the delivery days still ahead, past freezes not taken off again', () => {
    const fri = [5];
    // order 29203 on its label for the 7th: ends on the 11th, Friday off -> 7, 8, 10, 11
    expect(daysRemaining('2026-10-07', { endDate: '2026-10-11', offWeekdays: fri })).toBe(4);
    // order 27902 on 2026-10-11: 55 bought, 34 delivered; 12 frozen days of which one is ahead
    expect(daysRemaining('2026-10-11', { endDate: '2026-11-04', offWeekdays: fri }, new Set(['2026-10-03', '2026-10-17']))).toBe(21);
    // a freeze on an off day or after the end date takes nothing off
    expect(daysRemaining('2026-10-11', { endDate: '2026-11-04', offWeekdays: fri }, new Set(['2026-10-16', '2026-11-05']))).toBe(22);
    expect(daysRemaining('2026-10-10', { endDate: '2026-10-09', offWeekdays: fri })).toBe(0);
    expect(daysRemaining('2026-10-10', { endDate: null, offWeekdays: fri })).toBeNull();
    expect(daysRemaining('2026-10-10', { endDate: '2099-01-01', offWeekdays: fri })).toBeNull();
  });

  it('A91: a Qurain pickup note means the customer collects from the central kitchen', () => {
    expect(isKitchenPickup('Pickup Qurain/100c/180p')).toBe(true);
    expect(isKitchenPickup('Pickup Qurain branch')).toBe(true);
    expect(isKitchenPickup('day before / pick up from Al Qurain')).toBe(true);
    expect(isKitchenPickup('استلام من القرين')).toBe(true);
    // another branch is still carried by a driver; a bare branch name is not a pickup
    expect(isKitchenPickup('day before/ pick up from jahra branch ,')).toBe(false);
    expect(isKitchenPickup('day before - qurain branch - 160 c')).toBe(false);
    expect(isKitchenPickup(null)).toBe(false);
  });

  it('maps a Partner address the way the legacy label prints it', () => {
    expect(addressFromPartner({ ...address, landmark: 'Main street', flat_no: '4' })).toEqual({
      area: 'Old Area', block: '3', street: '314', building: '13', floor: null, flat: '4', direction: 'Main street',
    });
    expect(addressFromPartner({ name: '-', street: ' 5\n', house_no: 12 })).toMatchObject({ block: null, street: '5', building: '12' });
    expect(labelText('  a\u0000b  ')).toBe('a b');
  });

  it('joins the day, the subscription and its delivery address by exact ids', async () => {
    const { instance, fetchImpl } = source({
      'daily-deliveries': () => page([daily]),
      subscriptions: () => page([subscription, { ...subscription, subscription_id: 1, deleted: true }]),
      'customer-addresses': () => page([address]),
      'subscription-changes': () => page([freeze(1, '2026-10-10')]),
    });
    await expect(instance.profileForOrder('29203', DATE)).resolves.toEqual({
      userId: '1119', phone: '98992558',
      packageName: '(تقريبا) 720- 1920 سعرة حرارية', mealsPerDay: 3, snacksPerDay: 2,
      address: { area: 'Abdullah Al Mubarak', block: '3', street: '314', building: '13', floor: null, flat: null, direction: null },
      notes: 'Thursday Double Box if no answer call 97504160',
      deliveryTime: 'Before 1 day', deliveryMethod: 'Leave the box', daysRemaining: 3, deliveryRows: 1, doubleBox: false, boxItemCounts: [],
    });
    await expect(instance.profileForOrder('WA-98992558', DATE)).resolves.toBeNull();
    await instance.profileForOrder('29203', DATE);
    // one day page + one page of each list, shared by every label
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    for (const call of fetchImpl.mock.calls) {
      expect((call[1] as RequestInit).headers).toMatchObject({ 'X-Api-Key': 'test-key' });
      expect(String(call[0])).not.toContain('test-key');
    }
  });

  it('keeps the code and phone when the lists are unavailable, and never throws', async () => {
    const lists = source({
      'daily-deliveries': () => page([daily]),
      subscriptions: () => new Response('{}', { status: 500 }),
      'customer-addresses': () => page([address]),
    });
    await expect(lists.instance.profileForOrder('29203', DATE)).resolves.toEqual({
      userId: '1119', phone: '98992558', packageName: null, mealsPerDay: null, snacksPerDay: null, address: null,
      notes: 'Thursday Double Box if no answer call 97504160',
      deliveryTime: 'Before 1 day', deliveryMethod: 'Leave the box', daysRemaining: null, deliveryRows: 1, doubleBox: false, boxItemCounts: [],
    });
    const down = source({});
    await expect(down.instance.profileForOrder('29203', DATE)).resolves.toBeNull();
    await expect(down.instance.profileForOrder('', DATE)).resolves.toBeNull();
    await expect(down.instance.profileForOrder('29203', 'tomorrow')).resolves.toBeNull();
  });

  it('keeps the last good lists when a later refresh comes back empty', async () => {
    let now = 0;
    let empty = false;
    const { instance } = source({
      'daily-deliveries': () => page([daily]),
      subscriptions: () => page(empty ? [] : [subscription]),
      'customer-addresses': () => page(empty ? [] : [address]),
    }, { now: () => now, referenceTtlMs: 1000, dayTtlMs: 1000 });
    expect((await instance.profileForOrder('29203', DATE))?.address?.block).toBe('3');
    empty = true;
    now = 5000;
    expect((await instance.profileForOrder('29203', DATE))?.address?.block).toBe('3');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect((await instance.profileForOrder('29203', DATE))?.address?.block).toBe('3');
  });

  it('uses the newest row when Partner repeats an order in the day', async () => {
    const { instance } = source({
      'daily-deliveries': () => page([
        { ...daily, customer: { code: '2000', phone: '50000000' }, updated_at: '2026-10-01T00:00:00+03:00' },
        daily,
      ]),
      subscriptions: () => page([subscription]),
      'customer-addresses': () => page([address]),
    });
    expect((await instance.profileForOrder('29203', DATE))?.userId).toBe('2000');
  });

  it('A90: reads every freeze once, then only the changed ones; a reverted freeze counts again', async () => {
    let now = Date.parse('2026-10-07T09:00:00Z');
    const asked: string[] = [];
    let changed: unknown[] = [];
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      const endpoint = url.pathname.split('/').pop()!;
      if (endpoint === 'daily-deliveries') return page([daily]);
      if (endpoint === 'subscriptions') return page([subscription]);
      if (endpoint === 'customer-addresses') return page([address]);
      asked.push(url.search);
      return page(url.searchParams.has('since') ? changed : [
        freeze(1, '2026-10-08'), freeze(2, '2026-10-10'), freeze(3, '2026-09-20'),
        freeze(4, '2026-10-11', { is_reverted: true }), freeze(5, '2026-10-11', { subscription_id: 99 }),
      ]);
    });
    const instance = new PartnerLabelProfileSource({
      baseUrl: 'https://nutreeze.com/integration', apiKey: 'test-key', fetchImpl, now: () => now, referenceTtlMs: 1000,
    });
    expect((await instance.profileForOrder('29203', DATE))?.daysRemaining).toBe(2);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain('change_type=freeze');
    expect(asked[0]).not.toContain('since');

    changed = [freeze(2, '2026-10-10', { is_reverted: true })];
    now += 5000;
    await instance.profileForOrder('29203', DATE); // serves the older copy, refreshes behind it
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(asked[1]).toContain('since=');
    expect((await instance.profileForOrder('29203', DATE))?.daysRemaining).toBe(3);
  });

  it('A90: without the freeze list the label still prints a count, and a failed read is not repeated per label', async () => {
    const { instance, fetchImpl } = source({
      'daily-deliveries': () => page([daily]),
      subscriptions: () => page([subscription]),
      'customer-addresses': () => page([address]),
    });
    expect((await instance.profileForOrder('29203', DATE))?.daysRemaining).toBe(4);
    expect((await instance.profileForOrder('29203', DATE))?.daysRemaining).toBe(4);
    expect(fetchImpl.mock.calls.filter((call) => String(call[0]).includes('subscription-changes'))).toHaveLength(1);
  });

  it('A92: a delivery legacy holds twice prints its meals once (order 30781, 2026-10-12)', async () => {
    const meal = (dish_name: string, qty = 1) => ({ dish_name, qty });
    const six = ['tuna bagel', 'orzo pasta', 'white fish', 'salad', 'kunafa', 'pomegranate'].map((name) => meal(name));
    expect(mealsOfOneDelivery([...six, ...six], 2)).toEqual(six);
    // one delivery row: the customer really has the dish twice
    expect(mealsOfOneDelivery([...six, ...six], 1)).toHaveLength(12);
    // two rows but not exact copies: nothing is dropped
    expect(mealsOfOneDelivery([...six, ...six.slice(0, 5), meal('pomegranate', 2)], 2)).toHaveLength(12);
    expect(mealsOfOneDelivery([...six, meal('extra')], 2)).toHaveLength(7);
    expect(mealsOfOneDelivery([], 2)).toEqual([]);

    const { instance } = source({
      'daily-deliveries': () => page([{ ...daily, delivery_id: 411359 }, { ...daily, delivery_id: 411360 }]),
      subscriptions: () => page([subscription]),
      'customer-addresses': () => page([address]),
    });
    expect((await instance.profileForOrder('29203', DATE))?.deliveryRows).toBe(2);
  });

  it('A98: a Thursday double box is two boxes with their own meals, and Friday still counts as a day', async () => {
    const meal = (dish_name: string) => ({ dish_name, qty: 1 });
    const thursday = ['cheddar toast', 'chomein', 'pasta', 'dry fruits', 'crudites'].map(meal);
    const friday = ['cheddar toast', 'pasta', 'chomein', 'tabbouleh'].map(meal);
    expect(mealsPerBox([...thursday, ...friday], [5, 4])).toEqual([thursday, friday]);
    expect(mealsPerBox([...thursday, ...friday], [5, 5])).toBeNull();
    expect(mealsPerBox(thursday, [5])).toBeNull();
    // Thu 22 Oct to Tue 27 Oct: 6 with Friday's box (legacy "Days Remaining 6"), 5 without
    expect(daysRemaining('2026-10-22', { endDate: '2026-10-27', offWeekdays: [5], doubleBox: true })).toBe(6);
    expect(daysRemaining('2026-10-22', { endDate: '2026-10-27', offWeekdays: [5] })).toBe(5);

    const { instance } = source({
      'daily-deliveries': () => page([
        { ...daily, delivery_id: 411360, meal_item_count: 4 }, { ...daily, delivery_id: 411359, meal_item_count: 5 },
      ]),
      subscriptions: () => page([{ ...subscription, delivery: { ...subscription.delivery, thursday_double_box: true } }]),
      'customer-addresses': () => page([address]),
    });
    expect(await instance.profileForOrder('29203', DATE)).toMatchObject({ deliveryRows: 2, doubleBox: true, boxItemCounts: [5, 4] });
  });
});
