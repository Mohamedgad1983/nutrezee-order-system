import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PartnerLabelSource, PartnerLabelSourceError,
} from '../../apps/api/src/modules/m25-label/partner-label-source';

const DATE = '2026-08-08';

function envelope(
  data: unknown[],
  nextCursor: string | number | null = null,
  mode = 'live',
): Response {
  return new Response(JSON.stringify({
    data,
    count: data.length,
    mode,
    server_time: '2026-08-08T10:00:00+03:00',
    next_cursor: nextCursor,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function catalog(
  mealId: string,
  nutrition: Record<string, unknown> = { protein_g: 10, carbs_g: 20, fat_g: 5, calories: 165 },
) {
  return { meal_id: mealId, name_en: `Catalog ${mealId}`, nutrition };
}

function item(orderNumber: string, mealId: string, itemRef: string, qty = 1) {
  return {
    item_ref: itemRef,
    order_number: orderNumber,
    delivery_date: DATE,
    meal_id: mealId,
    meal_name_en: `Item ${mealId}`,
    qty,
  };
}

describe('TS-U Partner Kitchen & Labels v2 source (A29)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('fails production startup when the protected key is absent', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('NUTREEZE_PARTNER_LABEL_API_KEY', '');
    expect(() => PartnerLabelSource.fromEnv()).toThrowError(expect.objectContaining({
      code: 'not_configured',
    }));
  });

  it('uses GET + server-only key, paginates both endpoints, joins exact ids and caches the date', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      const cursor = url.searchParams.get('cursor');
      if (url.pathname.endsWith('/meal-catalog-v2')) {
        return cursor === null
          ? envelope([catalog('meal-1')], 'catalog-page-2')
          : envelope([catalog('meal-2', {
            protein_g: '8.5', carbs_g: '11', fat_g: '0', calories: '78',
          })]);
      }
      if (url.pathname.endsWith('/order-items')) {
        return cursor === null
          ? envelope([item('ORDER-1', 'meal-1', 'item-1')], 200)
          : envelope([item('ORDER-2', 'meal-2', 'item-2', 2)]);
      }
      return new Response(null, { status: 404 });
    });
    const source = new PartnerLabelSource({
      baseUrl: 'https://partner.example/integration',
      apiKey: 'server-secret',
      fetchImpl: fetchMock,
    });

    const [first, second] = await Promise.all([
      source.mealsForOrder('ORDER-1', DATE),
      source.mealsForOrder('ORDER-2', DATE),
    ]);
    expect(first).toEqual([{
      dish_name: 'Item meal-1', qty: 1, protein: 10, carbs: 20, fat: 5, calories: 165,
    }]);
    expect(second).toEqual([{
      dish_name: 'Item meal-2', qty: 2, protein: 17, carbs: 22, fat: 0, calories: 156,
    }]);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    for (const [input, init] of fetchMock.mock.calls) {
      const url = new URL(String(input));
      expect(url.searchParams.get('limit')).toBe('1000');
      expect(url.searchParams.has('api_key')).toBe(false);
      expect(String(input)).not.toContain('server-secret');
      expect(init?.method).toBe('GET');
      expect(init?.headers).toMatchObject({ 'X-Api-Key': 'server-secret', Accept: 'application/json' });
      expect(init?.body).toBeUndefined();
      if (url.pathname.endsWith('/order-items')) {
        expect(url.searchParams.get('delivery_date')).toBe(DATE);
      }
    }

    await source.mealsForOrder('ORDER-1', DATE);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('reads an absent Partner value as zero (A51) and still blocks meals with no nutrition at all or garbage', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/meal-catalog-v2')) {
        return envelope([
          catalog('complete'),
          // Partner stores a typed 0 as empty and emits null: pineapple has fat 0 / protein 0.
          catalog('pineapple', { protein_g: null, carbs_g: 11, fat_g: null, calories: 44 }),
          catalog('blank-string', { protein_g: '', carbs_g: 11, fat_g: undefined, calories: 44 }),
          catalog('unknown', { protein_g: null, carbs_g: null, fat_g: null, calories: null }),
          catalog('garbage', { protein_g: 'n/a', carbs_g: 20, fat_g: 5, calories: 200 }),
        ]);
      }
      return envelope([
        item('COMPLETE-ORDER', 'complete', 'complete-item'),
        item('ZERO-ORDER', 'pineapple', 'pineapple-item'),
        item('BLANK-ORDER', 'blank-string', 'blank-item'),
        item('UNKNOWN-ORDER', 'unknown', 'unknown-item'),
        item('GARBAGE-ORDER', 'garbage', 'garbage-item'),
      ]);
    });
    const source = new PartnerLabelSource({
      baseUrl: 'https://partner.example/integration', apiKey: 'key', fetchImpl: fetchMock,
    });

    await expect(source.mealsForOrder('COMPLETE-ORDER', DATE)).resolves.toHaveLength(1);
    await expect(source.mealsForOrder('ZERO-ORDER', DATE)).resolves.toEqual([
      expect.objectContaining({ protein: 0, carbs: 11, fat: 0, calories: 44 }),
    ]);
    await expect(source.mealsForOrder('BLANK-ORDER', DATE)).resolves.toEqual([
      expect.objectContaining({ protein: 0, fat: 0, carbs: 11, calories: 44 }),
    ]);
    await expect(source.mealsForOrder('UNKNOWN-ORDER', DATE)).rejects.toMatchObject({ code: 'nutrition_incomplete' });
    await expect(source.mealsForOrder('GARBAGE-ORDER', DATE)).rejects.toMatchObject({ code: 'nutrition_incomplete' });
  });

  it('fails closed on missing order items, missing catalog ids and malformed envelopes', async () => {
    const missingCatalogFetch = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      return url.pathname.endsWith('/meal-catalog-v2')
        ? envelope([])
        : envelope([item('ORDER-X', 'unknown-meal', 'item-x')]);
    });
    const missingCatalog = new PartnerLabelSource({
      baseUrl: 'https://partner.example/integration', apiKey: 'key', fetchImpl: missingCatalogFetch,
    });
    await expect(missingCatalog.mealsForOrder('ORDER-X', DATE)).rejects.toMatchObject({
      code: 'catalog_item_missing',
    });
    await expect(missingCatalog.mealsForOrder('ABSENT', DATE)).rejects.toMatchObject({
      code: 'order_items_missing',
    });

    const malformed = new PartnerLabelSource({
      baseUrl: 'https://partner.example/integration',
      apiKey: 'key',
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ data: [], count: 1 }), { status: 200 })),
    });
    await expect(malformed.mealsForOrder('ORDER-X', DATE)).rejects.toBeInstanceOf(PartnerLabelSourceError);
    await expect(malformed.mealsForOrder('ORDER-X', DATE)).rejects.toMatchObject({
      code: 'response_invalid',
    });

    const sandbox = new PartnerLabelSource({
      baseUrl: 'https://partner.example/integration',
      apiKey: 'key',
      fetchImpl: vi.fn(async () => envelope([], null, 'sandbox')),
    });
    await expect(sandbox.mealsForOrder('ORDER-X', DATE)).rejects.toMatchObject({
      code: 'response_invalid',
    });
  });

  it('does not cache failed reads and rejects cursor loops', async () => {
    let failing = true;
    const retryFetch = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (failing && url.pathname.endsWith('/meal-catalog-v2')) {
        return new Response(null, { status: 503 });
      }
      return url.pathname.endsWith('/meal-catalog-v2')
        ? envelope([catalog('meal-1')])
        : envelope([item('ORDER-1', 'meal-1', 'item-1')]);
    });
    const retrying = new PartnerLabelSource({
      baseUrl: 'https://partner.example/integration', apiKey: 'key', fetchImpl: retryFetch,
    });
    await expect(retrying.mealsForOrder('ORDER-1', DATE)).rejects.toMatchObject({ code: 'upstream_http' });
    failing = false;
    await expect(retrying.mealsForOrder('ORDER-1', DATE)).resolves.toHaveLength(1);

    const loop = new PartnerLabelSource({
      baseUrl: 'https://partner.example/integration',
      apiKey: 'key',
      fetchImpl: vi.fn(async () => envelope([catalog('meal-loop')], 'same-cursor')),
    });
    await expect(loop.mealsForOrder('ORDER-1', DATE)).rejects.toMatchObject({
      code: 'pagination_invalid',
    });
  });
});
