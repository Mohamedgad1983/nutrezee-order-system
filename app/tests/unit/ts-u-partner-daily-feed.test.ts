import { describe, expect, it } from 'vitest';
import {
  PartnerDailyFeedClient, PartnerDailyFeedError, canonicalizeDailyDeliveries,
  normalizeDailyDelivery, normalizePartnerDriverId,
} from '../../apps/api/src/modules/m19-migration/partner-daily-feed';

// TS-U — WP-OPS-06 (A47): Partner daily-deliveries contract + canonicalization + paginated client.

const DATE = '2026-09-05';

export function rawDelivery(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    delivery_id: 501,
    order_id: 31,
    order_number: '28669',
    delivery_date: DATE,
    customer_ref: '11365',
    customer: { name: 'Daily Customer', phone: '97497260' },
    address: { text: 'Rawda B:4 S:424 H:30', area_en: 'Rawda', area_ar: 'الروضة' },
    location_pin: '29.3000,48.0000',
    is_cancelled: false,
    is_on_hold: false,
    order_status: 'success',
    delivery_status: 'driver_assigned',
    hold_state: 'scheduled',
    meal_item_count: 3,
    driver: { id: 19033, name: 'RAVI RAVI' },
    delivery_method: 'Leave the box',
    driver_instructions: null,
    time_slot: { id: 1, title: 'From 5 AM to 4 PM', start: '05:00', end: '16:00' },
    updated_at: '2026-09-04T10:00:00+03:00',
    ...overrides,
  };
}

function envelope(data: unknown[], nextCursor: string | number | null = null, completeness?: unknown): Response {
  return new Response(JSON.stringify({
    data,
    count: data.length,
    mode: 'live',
    server_time: '2026-09-04T10:00:00+03:00',
    next_cursor: nextCursor,
    completeness: completeness ?? {
      snapshot_built_at: '2026-09-04T09:59:00+03:00',
      snapshot_age_seconds: 60,
      refresh_interval_minutes: 5,
      rows_in_window: 1400,
      window_from: '2026-09-03',
      window_to: '2026-09-07',
      per_date: [
        { delivery_date: DATE, deliveries: 2, distinct_orders: 2, scheduled: 2, on_hold: 0, cancelled: 0 },
      ],
    },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('TS-U Partner daily-deliveries contract (WP-OPS-06)', () => {
  it('normalizes a valid row and keeps the Partner driver id as a string', () => {
    const row = normalizeDailyDelivery(rawDelivery(), DATE);
    expect(row).toMatchObject({
      orderNumber: '28669', customerRef: '11365', customerPhone: '97497260', areaEn: 'Rawda',
      partnerDriverId: '19033', partnerDriverName: 'RAVI RAVI', mealItemCount: 3,
      timeSlotTitle: 'From 5 AM to 4 PM', orderStatus: 'success',
    });
    expect(normalizeDailyDelivery(rawDelivery({ driver: { id: null, name: null } }), DATE).partnerDriverId).toBeNull();
    expect(normalizePartnerDriverId(' A9 ')).toBe('A9');
  });

  it('rejects contract violations: wrong date, missing driver key, bad phone, bad ids', () => {
    for (const bad of [
      rawDelivery({ delivery_date: '2026-09-06' }),
      rawDelivery({ driver: { name: 'x' } }),
      rawDelivery({ customer: { name: 'x', phone: '' } }),
      rawDelivery({ order_id: 0 }),
      rawDelivery({ meal_item_count: -1 }),
      rawDelivery({ is_cancelled: 'no' }),
      rawDelivery({ driver: { id: 'bad id', name: null } }),
    ]) {
      expect(() => normalizeDailyDelivery(bad, DATE)).toThrowError(expect.objectContaining({ code: 'contract_violation' }));
    }
  });

  it('collapses repeated rows per order to the latest update and unions delivery ids', () => {
    const rows = [
      normalizeDailyDelivery(rawDelivery(), DATE),
      normalizeDailyDelivery(rawDelivery({ delivery_id: 502, meal_item_count: 4, updated_at: '2026-09-04T11:00:00+03:00' }), DATE),
      normalizeDailyDelivery(rawDelivery({ delivery_id: 503, order_id: 32, order_number: '27788', customer_ref: '5908', customer: { name: 'B', phone: '50266999' }, is_on_hold: true }), DATE),
    ];
    const canonical = canonicalizeDailyDeliveries(rows);
    expect(canonical.map((r) => r.order_number)).toEqual(['27788', '28669']);
    expect(canonical[1]).toMatchObject({ meal_item_count: 4, source_delivery_ids: [501, 502], is_cancelled: false, partner_driver_id: '19033' });
    expect(canonical[0]).toMatchObject({ is_on_hold: true, customer_phone: '50266999' });
  });

  it('flags cancellation from either is_cancelled or order_status=cancel and rejects conflicting identities', () => {
    const cancelled = canonicalizeDailyDeliveries([normalizeDailyDelivery(rawDelivery({ order_status: 'cancel' }), DATE)]);
    expect(cancelled[0]).toMatchObject({ is_cancelled: true, order_status: 'cancel' });
    expect(() => canonicalizeDailyDeliveries([
      normalizeDailyDelivery(rawDelivery(), DATE),
      normalizeDailyDelivery(rawDelivery({ delivery_id: 502, customer: { name: 'Other', phone: '99999999' } }), DATE),
    ])).toThrowError(expect.objectContaining({ code: 'contract_violation' }));
  });

  it('walks cursor pages, sends the key only as X-Api-Key, and verifies completeness', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      calls.push({ url, headers: Object.fromEntries(Object.entries(init?.headers as Record<string, string>)) });
      if (!url.includes('cursor=')) return envelope([rawDelivery()], 'c1');
      return envelope([rawDelivery({ delivery_id: 502, order_id: 32, order_number: '27788', customer_ref: '5908' })], null);
    };
    const client = new PartnerDailyFeedClient({ baseUrl: 'https://nutreeze.com/integration', apiKey: 'k-1', fetchImpl });
    const result = await client.fetchDate(DATE);
    expect(result.rows).toHaveLength(2);
    expect(result.pages).toBe(2);
    expect(result.completeness).toMatchObject({ deliveries: 2, distinctOrders: 2 });
    expect(calls[0]!.url).toBe('https://nutreeze.com/integration/daily-deliveries?delivery_date=2026-09-05&limit=1000');
    expect(calls[0]!.headers['X-Api-Key']).toBe('k-1');
    expect(calls[1]!.url).toContain('cursor=c1');
  });

  it('treats an empty in-window date as a zero day and fails on completeness mismatch or auth errors', async () => {
    const empty = new PartnerDailyFeedClient({
      baseUrl: 'https://nutreeze.com/integration', apiKey: 'k',
      fetchImpl: async () => envelope([], null, {
        snapshot_built_at: 'x', snapshot_age_seconds: 1, refresh_interval_minutes: 5, rows_in_window: 0,
        window_from: '2026-09-03', window_to: '2026-09-07', per_date: [],
      }),
    });
    await expect(empty.fetchDate('2026-09-04')).resolves.toMatchObject({ rows: [], completeness: { deliveries: 0 } });

    const mismatch = new PartnerDailyFeedClient({
      baseUrl: 'https://nutreeze.com/integration', apiKey: 'k',
      fetchImpl: async () => envelope([rawDelivery()], null),
    });
    await expect(mismatch.fetchDate(DATE)).rejects.toMatchObject({ code: 'response_invalid', detail: 'completeness_mismatch' });

    const denied = new PartnerDailyFeedClient({
      baseUrl: 'https://nutreeze.com/integration', apiKey: 'k',
      fetchImpl: async () => new Response('{}', { status: 401 }),
    });
    await expect(denied.fetchDate(DATE)).rejects.toMatchObject({ code: 'upstream_http', detail: 'auth' });
  });

  it('refuses a non-Partner base URL and an empty key', () => {
    expect(() => new PartnerDailyFeedClient({ baseUrl: 'https://evil.example/integration', apiKey: 'k' }))
      .toThrowError(PartnerDailyFeedError);
    expect(() => new PartnerDailyFeedClient({ baseUrl: 'https://nutreeze.com/integration', apiKey: ' ' }))
      .toThrowError(expect.objectContaining({ code: 'not_configured' }));
  });
});
