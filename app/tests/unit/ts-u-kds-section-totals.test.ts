import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  aggregateKitchenDay, KitchenTotalsError, KitchenTotalsService,
} from '../../apps/api/src/modules/m08-kitchen/kitchen-totals.service';
import {
  PartnerKdsSource, PartnerKdsSourceError, type PartnerKdsDay,
} from '../../apps/api/src/modules/m08-kitchen/partner-kds-source';
import { formatQuantity, kuwaitToday } from '../../apps/kds/src/model';

const DATE = '2026-08-08';

function envelope(data: unknown[], nextCursor: string | number | null = null): Response {
  return new Response(JSON.stringify({
    data,
    count: data.length,
    mode: 'live',
    server_time: '2026-08-08T10:00:00+03:00',
    next_cursor: nextCursor,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function section(id: string, code: string, stepNo: number, isPacking = false) {
  return {
    section_id: id,
    code,
    name_en: `${code} EN`,
    name_ar: `${code} AR`,
    step_no: stepNo,
    is_packing: isPacking,
  };
}

function item(
  ref: string,
  mealId: string,
  qty: number,
  sections: unknown[],
  portionSize: string | null = 'regular',
) {
  return {
    item_ref: ref,
    order_number: `PRIVATE-${ref}`,
    customer_name: 'Private Customer',
    phone: '55555555',
    delivery_date: DATE,
    meal_id: mealId,
    meal_name_en: `${mealId} EN`,
    meal_name_ar: `${mealId} AR`,
    portion_size: portionSize,
    qty,
    sections,
  };
}

describe('TS-U KDS read-only Partner source and section totals (A30)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('uses paginated GET requests with the server-only key and exact filters', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      return url.searchParams.has('cursor')
        ? envelope([item('item-2', 'meal-2', 2, [section('cold-id', 'cold', 2)])])
        : envelope([item('item-1', 'meal-1', 1, [section('hot-id', 'hot', 1)])], 'page-2');
    });
    const source = new PartnerKdsSource({
      baseUrl: 'https://partner.example/integration',
      apiKey: 'server-secret',
      fetchImpl: fetchMock,
    });

    const first = await source.itemsForDay(DATE, 'main');
    const second = await source.itemsForDay(DATE, 'main');
    expect(first.items).toHaveLength(2);
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [input, init] of fetchMock.mock.calls) {
      const url = new URL(String(input));
      expect(url.pathname).toBe('/integration/order-items');
      expect(url.searchParams.get('delivery_date')).toBe(DATE);
      expect(url.searchParams.get('kitchen')).toBe('main');
      expect(url.searchParams.get('limit')).toBe('1000');
      expect(url.searchParams.has('api_key')).toBe(false);
      expect(String(input)).not.toContain('server-secret');
      expect(init?.method).toBe('GET');
      expect(init?.headers).toMatchObject({ 'X-Api-Key': 'server-secret' });
      expect(init?.body).toBeUndefined();
    }
  });

  it('sums meal quantities per upstream section and portion, including multi-section work', () => {
    const hot = section('hot-id', 'hot', 1);
    const packing = section('packing-id', 'packing', 9, true);
    const source = new PartnerKdsSource({
      baseUrl: 'https://partner.example/integration', apiKey: 'key', fetchImpl: vi.fn(),
    });
    void source; // construction also verifies the same strict URL/key path used in production.
    const day: PartnerKdsDay = {
      serverTime: '2026-08-08T10:00:00+03:00',
      items: [
        normalized(item('one', 'meal-1', 2, [hot, packing], 'large')),
        normalized(item('two', 'meal-1', 3, [hot], 'large')),
        normalized(item('three', 'meal-1', 4, [hot], 'small')),
      ],
    };
    const totals = aggregateKitchenDay(day, DATE, 'main', '2026-08-08T07:01:00.000Z');

    expect(totals.summary).toEqual({
      source_item_rows: 3,
      source_quantity_total: 9,
      section_assignment_quantity_total: 11,
      unrouted_quantity_total: 0,
    });
    expect(totals.sections.map((entry) => [entry.code, entry.total_qty])).toEqual([
      ['hot', 9], ['packing', 2],
    ]);
    expect(totals.sections[0]?.meals.map((meal) => [meal.portion_size, meal.total_qty])).toEqual([
      ['large', 5], ['small', 4],
    ]);
  });

  it('keeps missing routes visible and strips all order/customer/item identifiers', async () => {
    const fetchMock = vi.fn(async () => envelope([
      item('sensitive-ref', 'meal-1', 3, []),
    ]));
    const source = new PartnerKdsSource({
      baseUrl: 'https://partner.example/integration', apiKey: 'key', fetchImpl: fetchMock,
    });
    const service = new KitchenTotalsService(source, () => new Date('2026-08-08T07:01:00.000Z'));
    const totals = await service.totals(DATE, 'main');

    expect(totals.summary.unrouted_quantity_total).toBe(3);
    expect(totals.sections).toMatchObject([{ code: 'unrouted', unrouted: true, total_qty: 3 }]);
    const serialized = JSON.stringify(totals);
    expect(serialized).not.toContain('sensitive-ref');
    expect(serialized).not.toContain('PRIVATE-');
    expect(serialized).not.toContain('Private Customer');
    expect(serialized).not.toContain('55555555');
    expect(serialized).not.toContain('item_ref');
    expect(serialized).not.toContain('order_number');
  });

  it('fails closed when the same section or meal id carries contradictory display metadata', () => {
    const contradictory: PartnerKdsDay = {
      serverTime: '2026-08-08T10:00:00+03:00',
      items: [
        normalized(item('one', 'meal-1', 1, [section('hot-id', 'hot', 1)])),
        {
          ...normalized(item('two', 'meal-1', 1, [section('hot-id', 'hot', 2)])),
          nameEn: 'Conflicting meal name',
        },
      ],
    };
    expect(() => aggregateKitchenDay(contradictory, DATE, 'main', DATE))
      .toThrowError(expect.objectContaining({ code: 'response_invalid' }));
  });

  it('fails closed on duplicate physical items, malformed routing and cursor loops', async () => {
    const duplicates = new PartnerKdsSource({
      baseUrl: 'https://partner.example/integration',
      apiKey: 'key',
      fetchImpl: vi.fn(async () => envelope([
        item('same', 'meal-1', 1, [section('hot-id', 'hot', 1)]),
        item('same', 'meal-1', 1, [section('hot-id', 'hot', 1)]),
      ])),
    });
    await expect(duplicates.itemsForDay(DATE, 'main')).rejects.toMatchObject({ code: 'response_invalid' });

    const malformed = new PartnerKdsSource({
      baseUrl: 'https://partner.example/integration',
      apiKey: 'key',
      fetchImpl: vi.fn(async () => envelope([
        { ...item('one', 'meal-1', 1, []), sections: 'hot' },
      ])),
    });
    await expect(malformed.itemsForDay(DATE, 'main')).rejects.toBeInstanceOf(PartnerKdsSourceError);

    const loop = new PartnerKdsSource({
      baseUrl: 'https://partner.example/integration',
      apiKey: 'key',
      fetchImpl: vi.fn(async () => envelope([
        item(`loop-${Math.random()}`, 'meal-1', 1, [section('hot-id', 'hot', 1)]),
      ], 'same')),
    });
    await expect(loop.itemsForDay(DATE, 'main')).rejects.toMatchObject({ code: 'pagination_invalid' });
  });

  it('fails production startup without the protected credential and maps availability safely', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NUTREEZE_PARTNER_LABEL_API_KEY', '');
    expect(() => PartnerKdsSource.fromEnv()).toThrowError(expect.objectContaining({ code: 'not_configured' }));

    const service = new KitchenTotalsService(null);
    await expect(service.totals(DATE, 'main')).rejects.toBeInstanceOf(KitchenTotalsError);
    await expect(service.totals(DATE, 'main')).rejects.toMatchObject({ code: 'not_configured' });
  });

  it('uses the Kuwait business date and preserves fractional totals in display formatting', () => {
    expect(kuwaitToday(new Date('2026-08-07T21:30:00.000Z'))).toBe('2026-08-08');
    expect(formatQuantity(12.5, 'en')).toBe('12.5');
  });
});

function normalized(raw: ReturnType<typeof item>): PartnerKdsDay['items'][number] {
  return {
    itemRef: raw.item_ref,
    mealId: raw.meal_id,
    nameEn: raw.meal_name_en,
    nameAr: raw.meal_name_ar,
    portionSize: raw.portion_size,
    quantity: raw.qty,
    sections: raw.sections.map((route) => {
      const value = route as ReturnType<typeof section>;
      return {
        sectionId: value.section_id,
        code: value.code,
        nameEn: value.name_en,
        nameAr: value.name_ar,
        stepNo: value.step_no,
        isPacking: value.is_packing,
      };
    }),
  };
}
