import { describe, expect, it, vi } from 'vitest';
import type { BrowserContext, Page } from 'playwright';
import {
  evaluateLegacyRequest,
  installLegacySafety,
  isDangerousLegacyGetUrl,
  safeClick,
  type LegacySafetyOptions,
} from '../lib/safety.ts';

const opts: LegacySafetyOptions = {
  baseUrl: 'https://legacy.test',
  authPostAllowlist: ['/login'],
  readOnlyGetAllowlist: ['/masters/payment-methods'],
};

describe('legacy safety guard', () => {
  it('allows the configured login POST only during auth mode', () => {
    expect(evaluateLegacyRequest('POST', 'https://legacy.test/login', opts, 'auth')).toEqual({ allow: true });
    expect(evaluateLegacyRequest('POST', 'https://legacy.test/login', opts, 'strict')).toMatchObject({
      allow: false,
      reason: 'strict read-only mode',
    });
    expect(evaluateLegacyRequest('POST', 'https://legacy.test/users', opts, 'auth')).toMatchObject({
      allow: false,
      reason: 'mutating request outside auth allowlist',
    });
  });

  it('blocks all non-auth POST/PUT/PATCH/DELETE requests', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(evaluateLegacyRequest(method, 'https://legacy.test/orders/1', opts, 'strict')).toMatchObject({
        allow: false,
      });
    }
  });

  it('switches the installed route guard from auth-only to strict read-only', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    type Handler = Parameters<BrowserContext['route']>[1];
    let handler: Handler | undefined;
    const context = {
      route: vi.fn(async (_glob: string, h: Handler) => { handler = h; }),
    } as unknown as BrowserContext;
    const controller = await installLegacySafety(context, opts);

    const runRequest = async (method: string, url: string) => {
      const abort = vi.fn(async () => undefined);
      const proceed = vi.fn(async () => undefined);
      await handler!({
        request: () => ({ method: () => method, url: () => url }),
        abort,
        continue: proceed,
      } as never, {} as never);
      return { abort, proceed };
    };

    expect(controller.mode()).toBe('auth');
    expect((await runRequest('POST', 'https://legacy.test/login')).proceed).toHaveBeenCalledOnce();

    controller.enableStrictReadOnly();
    expect(controller.mode()).toBe('strict');
    expect((await runRequest('POST', 'https://legacy.test/login')).abort).toHaveBeenCalledOnce();
    consoleSpy.mockRestore();
  });

  it('blocks dangerous same-origin GET URLs unless explicitly allowlisted as read-only', () => {
    expect(isDangerousLegacyGetUrl('https://legacy.test/orders/delete/123', opts)).toBe(true);
    expect(evaluateLegacyRequest('GET', 'https://legacy.test/orders?action=cancel&id=1', opts, 'strict')).toMatchObject({
      allow: false,
      reason: 'dangerous GET URL',
    });
    expect(evaluateLegacyRequest('GET', 'https://legacy.test/masters/payment-methods', opts, 'strict')).toEqual({
      allow: true,
    });
    expect(evaluateLegacyRequest('GET', 'https://cdn.test/status.js', opts, 'strict')).toEqual({ allow: true });
  });
});

describe('safeClick', () => {
  function fakePage(attrs: { text?: string; value?: string; href?: string | null }) {
    const click = vi.fn(async () => undefined);
    const getAttribute = vi.fn(async (name: string) => {
      if (name === 'value') return attrs.value ?? '';
      if (name === 'href') return attrs.href ?? null;
      return null;
    });
    const page = {
      locator: () => ({
        first: () => ({
          textContent: vi.fn(async () => attrs.text ?? ''),
          getAttribute,
          click,
        }),
      }),
    } as unknown as Page;
    return { page, click };
  }

  it('refuses mutating controls before clicking', async () => {
    const { page, click } = fakePage({ text: 'Save changes' });
    await expect(safeClick(page, 'button')).rejects.toThrow(/mutating control/);
    expect(click).not.toHaveBeenCalled();
  });

  it('refuses dangerous legacy GET hrefs before clicking', async () => {
    const { page, click } = fakePage({ text: 'Next', href: '/orders/delete/123' });
    await expect(safeClick(page, 'a.next', opts)).rejects.toThrow(/dangerous legacy GET URL/);
    expect(click).not.toHaveBeenCalled();
  });
});
