import { describe, expect, it, vi } from 'vitest';
import {
  PartnerLabelProfileSource, addressFromPartner, labelText, legacyDaysRemaining, localPhone,
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
    baseUrl: 'https://nutreeze.com/integration', apiKey: 'test-key', fetchImpl, ...extra,
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

  it('A80: days remaining follows the legacy rule (values read off the legacy screen on 2026-10-08)', () => {
    const fri = [5];
    // order 29203 on its label for the 7th: ends on the 11th, Friday off -> 7, 8, 10, 11
    expect(legacyDaysRemaining('2026-10-07', { endDate: '2026-10-11', offWeekdays: fri, frozenDays: 0 })).toBe(4);
    expect(legacyDaysRemaining('2026-10-08', { endDate: '2026-11-08', offWeekdays: fri, frozenDays: 0 })).toBe(27); // 30545
    expect(legacyDaysRemaining('2026-10-08', { endDate: '2026-10-20', offWeekdays: fri, frozenDays: 2 })).toBe(9); // 29432
    expect(legacyDaysRemaining('2026-10-08', { endDate: '2026-11-02', offWeekdays: fri, frozenDays: 1 })).toBe(21); // 27097
    expect(legacyDaysRemaining('2026-10-08', { endDate: '2026-10-19', offWeekdays: fri, frozenDays: 29 })).toBe(-19); // 27067
    expect(legacyDaysRemaining('2026-10-10', { endDate: '2026-10-09', offWeekdays: fri, frozenDays: 0 })).toBe(0);
    expect(legacyDaysRemaining('2026-10-10', { endDate: null, offWeekdays: fri, frozenDays: 0 })).toBeNull();
    expect(legacyDaysRemaining('2026-10-10', { endDate: '2099-01-01', offWeekdays: fri, frozenDays: 0 })).toBeNull();
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
    });
    await expect(instance.profileForOrder('29203', DATE)).resolves.toEqual({
      userId: '1119', phone: '98992558',
      packageName: '(تقريبا) 720- 1920 سعرة حرارية', mealsPerDay: 3, snacksPerDay: 2,
      address: { area: 'Abdullah Al Mubarak', block: '3', street: '314', building: '13', floor: null, flat: null, direction: null },
      notes: 'Thursday Double Box if no answer call 97504160',
      deliveryTime: 'Before 1 day', deliveryMethod: 'Leave the box', daysRemaining: 4,
    });
    await expect(instance.profileForOrder('WA-98992558', DATE)).resolves.toBeNull();
    await instance.profileForOrder('29203', DATE);
    // one day page + one page of each list, shared by every label
    expect(fetchImpl).toHaveBeenCalledTimes(3);
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
      deliveryTime: 'Before 1 day', deliveryMethod: 'Leave the box', daysRemaining: null,
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
});
