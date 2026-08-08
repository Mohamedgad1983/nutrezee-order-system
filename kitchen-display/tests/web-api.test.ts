import { afterEach, describe, expect, it, vi } from 'vitest';
import { request } from '../src/web/api';

describe('browser API timeout boundary', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('adds a timeout signal and preserves a caller-supplied signal', async () => {
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(request<{ ok: boolean }>('/health')).resolves.toEqual({ ok: true });

    const controller = new AbortController();
    await request('/health', { signal: controller.signal });
    expect(fetchMock.mock.calls[1]?.[1]?.signal).toBe(controller.signal);
  });
});
