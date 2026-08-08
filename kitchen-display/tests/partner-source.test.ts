import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PartnerSource, PartnerSourceError, validCalendarDate } from '../src/api/partner-source.js';

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

function section(id = 'hot-id', code = 'hot', stepNo = 1) {
  return {
    section_id: id,
    code,
    name_en: 'Hot',
    name_ar: 'ساخن',
    step_no: stepNo,
    is_packing: false,
  };
}

function item(ref: string, overrides: Record<string, unknown> = {}) {
  return {
    item_ref: ref,
    order_number: `PRIVATE-${ref}`,
    customer_name: 'Private Customer',
    phone: '55555555',
    delivery_date: DATE,
    meal_id: 'meal-1',
    meal_name_en: 'Chicken',
    meal_name_ar: 'دجاج',
    portion_size: 'regular',
    qty: 2,
    sections: [section()],
    ...overrides,
  };
}

describe('PartnerSource read-only boundary', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('uses paginated GET requests with exact filters and a header-only key', async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      return url.searchParams.has('cursor')
        ? envelope([item('two')])
        : envelope([item('one')], 'page-2');
    });
    const source = new PartnerSource({
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
      expect(String(input)).not.toContain('server-secret');
      expect(init?.method).toBe('GET');
      expect(init?.headers).toMatchObject({ 'X-Api-Key': 'server-secret' });
      expect(init?.body).toBeUndefined();
    }
  });

  it('rejects non-live, count-mismatched, wrong-date and malformed rows', async () => {
    const cases: unknown[] = [
      { data: [], count: 0, mode: 'sandbox', server_time: new Date().toISOString(), next_cursor: null },
      { data: [], count: 1, mode: 'live', server_time: new Date().toISOString(), next_cursor: null },
      { data: [item('one', { delivery_date: '2026-08-07' })], count: 1, mode: 'live', server_time: new Date().toISOString(), next_cursor: null },
      { data: [item('one', { sections: 'hot' })], count: 1, mode: 'live', server_time: new Date().toISOString(), next_cursor: null },
    ];
    for (const payload of cases) {
      const source = new PartnerSource({
        baseUrl: 'https://partner.example/integration',
        apiKey: 'key',
        fetchImpl: vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })),
      });
      await expect(source.itemsForDay(DATE, 'main')).rejects.toMatchObject({ code: 'response_invalid' });
    }
  });

  it('rejects duplicate physical rows, duplicate routes and cursor loops', async () => {
    const duplicates = new PartnerSource({
      baseUrl: 'https://partner.example/integration',
      apiKey: 'key',
      fetchImpl: vi.fn(async () => envelope([item('same'), item('same')])),
    });
    await expect(duplicates.itemsForDay(DATE, 'main')).rejects.toMatchObject({ code: 'response_invalid' });

    const duplicateRoutes = new PartnerSource({
      baseUrl: 'https://partner.example/integration',
      apiKey: 'key',
      fetchImpl: vi.fn(async () => envelope([item('one', { sections: [section(), section()] })])),
    });
    await expect(duplicateRoutes.itemsForDay(DATE, 'main')).rejects.toMatchObject({ code: 'response_invalid' });

    let counter = 0;
    const loop = new PartnerSource({
      baseUrl: 'https://partner.example/integration',
      apiKey: 'key',
      fetchImpl: vi.fn(async () => envelope([item(`loop-${counter += 1}`)], 'same')),
    });
    await expect(loop.itemsForDay(DATE, 'main')).rejects.toMatchObject({ code: 'pagination_invalid' });
  });

  it('maps upstream auth, HTTP and network failures without leaking detail', async () => {
    for (const [result, code] of [
      [new Response('', { status: 401 }), 'auth_failed'],
      [new Response('', { status: 500 }), 'upstream_http'],
    ] as const) {
      const source = new PartnerSource({
        baseUrl: 'https://partner.example/integration',
        apiKey: 'key',
        fetchImpl: vi.fn(async () => result),
      });
      await expect(source.itemsForDay(DATE, 'main')).rejects.toMatchObject({ code });
    }
    const unavailable = new PartnerSource({
      baseUrl: 'https://partner.example/integration',
      apiKey: 'key',
      fetchImpl: vi.fn(async () => { throw new Error('network detail'); }),
    });
    await expect(unavailable.itemsForDay(DATE, 'main')).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('requires the dedicated key and pins the production host/path', () => {
    expect(() => PartnerSource.fromEnv({ NODE_ENV: 'production' })).toThrowError(
      expect.objectContaining({ code: 'not_configured' }),
    );
    expect(() => PartnerSource.fromEnv({
      NODE_ENV: 'production',
      KDS_PARTNER_API_KEY: 'key',
      KDS_PARTNER_API_BASE: 'https://attacker.example/integration',
    })).toThrowError(expect.objectContaining({ code: 'response_invalid' }));
    expect(PartnerSource.fromEnv({
      NODE_ENV: 'production',
      KDS_PARTNER_API_KEY: 'dedicated',
      KDS_PARTNER_API_BASE: 'https://nutreeze.com/integration',
    })).toBeInstanceOf(PartnerSource);
  });

  it('loads the dedicated key from a protected file and rejects ambiguous secret sources', () => {
    const directory = mkdtempSync(join(tmpdir(), 'kds-key-test-'));
    const keyFile = join(directory, 'partner-key');
    writeFileSync(keyFile, 'file-held-key\n', { mode: 0o600 });
    try {
      expect(PartnerSource.fromEnv({
        NODE_ENV: 'production',
        KDS_PARTNER_API_KEY_FILE: keyFile,
      })).toBeInstanceOf(PartnerSource);
      expect(() => PartnerSource.fromEnv({
        NODE_ENV: 'production',
        KDS_PARTNER_API_KEY: 'direct',
        KDS_PARTNER_API_KEY_FILE: keyFile,
      })).toThrowError(expect.objectContaining({ code: 'not_configured' }));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('validates real calendar dates and bounded kitchen codes', async () => {
    expect(validCalendarDate('2024-02-29')).toBe(true);
    expect(validCalendarDate('2026-02-29')).toBe(false);
    const source = new PartnerSource({
      baseUrl: 'https://partner.example/integration', apiKey: 'key', fetchImpl: vi.fn(),
    });
    await expect(source.itemsForDay('2026-02-29', 'main')).rejects.toBeInstanceOf(PartnerSourceError);
    await expect(source.itemsForDay(DATE, '../labels')).rejects.toMatchObject({ code: 'response_invalid' });
  });

  it('rejects quantities that could overflow an exact totals projection', async () => {
    const source = new PartnerSource({
      baseUrl: 'https://partner.example/integration',
      apiKey: 'key',
      fetchImpl: vi.fn(async () => envelope([item('one', { qty: Number.MAX_VALUE })])),
    });
    await expect(source.itemsForDay(DATE, 'main')).rejects.toMatchObject({ code: 'response_invalid' });
  });

  it('accepts at most six quantity decimals and rejects finer precision', async () => {
    const accepted = new PartnerSource({
      baseUrl: 'https://partner.example/integration',
      apiKey: 'key',
      fetchImpl: vi.fn(async () => envelope([item('one', { qty: '0.000001' })])),
    });
    await expect(accepted.itemsForDay(DATE, 'main')).resolves.toMatchObject({
      items: [{ quantity: 0.000001 }],
    });

    const rejected = new PartnerSource({
      baseUrl: 'https://partner.example/integration',
      apiKey: 'key',
      fetchImpl: vi.fn(async () => envelope([item('one', { qty: '0.0000004' })])),
    });
    await expect(rejected.itemsForDay(DATE, 'main')).rejects.toMatchObject({ code: 'response_invalid' });
  });

  it('rejects a paginated response whose cumulative decoded size exceeds the bound', async () => {
    const firstBody = JSON.stringify({
      data: [item('one')],
      count: 1,
      mode: 'live',
      server_time: '2026-08-08T10:00:00+03:00',
      next_cursor: 'next',
    });
    const secondBody = JSON.stringify({
      data: [item('two')],
      count: 1,
      mode: 'live',
      server_time: '2026-08-08T10:00:00+03:00',
      next_cursor: null,
    });
    const responses = [firstBody, secondBody];
    const fetchMock = vi.fn(async () => new Response(responses.shift(), { status: 200 }));
    const source = new PartnerSource({
      baseUrl: 'https://partner.example/integration',
      apiKey: 'key',
      fetchImpl: fetchMock,
      maxTotalResponseBytes: Buffer.byteLength(firstBody) + 1,
    });
    await expect(source.itemsForDay(DATE, 'main')).rejects.toMatchObject({ code: 'pagination_invalid' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects an oversized upstream page before parsing it', async () => {
    const source = new PartnerSource({
      baseUrl: 'https://partner.example/integration',
      apiKey: 'key',
      fetchImpl: vi.fn(async () => new Response('{}', {
        status: 200,
        headers: { 'Content-Length': String(5 * 1024 * 1024 + 1) },
      })),
    });
    await expect(source.itemsForDay(DATE, 'main')).rejects.toMatchObject({ code: 'response_invalid' });
  });
});
