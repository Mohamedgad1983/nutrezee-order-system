import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthManager, createPasswordHash } from '../src/api/auth.js';
import { PartnerSourceError, type PartnerSourceGateway } from '../src/api/partner-source.js';
import { createKdsServer, LoginLimiter, type KdsServerOptions } from '../src/api/server.js';

const USERNAME = 'hot-display';
const PACKING_USERNAME = 'packing-display';
const PASSWORD = 'test-only-secure-password';
const TOKEN = 't'.repeat(43);
const SECOND_TOKEN = 'p'.repeat(43);

describe('standalone KDS HTTP boundary', () => {
  let server: Server;
  let origin: string;
  let options: KdsServerOptions;
  let webRoot: string;

  beforeEach(async () => {
    webRoot = await mkdtemp(join(tmpdir(), 'nutrezee-kds-test-'));
    await writeFile(join(webRoot, 'index.html'), '<!doctype html><title>KDS</title>');
    await writeFile(join(webRoot, 'manifest.webmanifest'), '{}');
    await mkdir(join(webRoot, 'assets'));
    await writeFile(join(webRoot, 'assets', 'app-hash.js'), 'export {};');
    const source: PartnerSourceGateway = {
      itemsForDay: async () => ({
        serverTime: '2026-08-08T10:00:00+03:00',
        items: [
          {
            itemRef: 'PRIVATE-PHYSICAL-ROW',
            mealId: 'meal-1',
            nameEn: 'Chicken',
            nameAr: 'دجاج',
            portionSize: 'large',
            quantity: 3,
            sections: [{
              sectionId: 'hot-id',
              code: 'hot',
              nameEn: 'Hot',
              nameAr: 'ساخن',
              stepNo: 1,
              isPacking: false,
            }],
          },
          {
            itemRef: 'PRIVATE-PACKING-ROW',
            mealId: 'meal-2',
            nameEn: 'Packing meal',
            nameAr: 'وجبة تجهيز',
            portionSize: 'regular',
            quantity: 7,
            sections: [{
              sectionId: 'packing-id',
              code: 'packing',
              nameEn: 'Packing',
              nameAr: 'التجهيز',
              stepNo: 9,
              isPacking: true,
            }],
          },
        ],
      }),
    };
    const passwordHash = await createPasswordHash(PASSWORD, Buffer.alloc(16, 3));
    let tokenIndex = 0;
    options = {
      auth: new AuthManager({
        users: [
          { username: USERNAME, passwordHash, sectionCodes: ['hot'] },
          { username: PACKING_USERNAME, passwordHash, sectionCodes: ['packing'] },
        ],
        randomToken: () => tokenIndex++ === 0 ? TOKEN : SECOND_TOKEN,
      }),
      source,
      kitchens: ['main'],
      publicOrigin: 'http://127.0.0.1',
      secureCookies: true,
      sessionMaxAgeSeconds: 300,
      webRoot,
      logger: () => undefined,
    };
    server = createKdsServer(options);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    options.publicOrigin = origin;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(webRoot, { recursive: true, force: true });
  });

  it('serves health/static content with restrictive browser headers', async () => {
    const health = await fetch(`${origin}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: 'ok', service: 'nutrezee-kds' });
    expect(health.headers.get('x-frame-options')).toBe('DENY');
    expect(health.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(health.headers.get('strict-transport-security')).toContain('max-age=31536000');

    const page = await fetch(`${origin}/some/client/route`);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<title>KDS</title>');
    expect(page.headers.get('cache-control')).toBe('no-cache');
    expect((await fetch(`${origin}/manifest.webmanifest`)).headers.get('cache-control')).toBe('no-cache');
    expect((await fetch(`${origin}/assets/app-hash.js`)).headers.get('cache-control'))
      .toBe('public, max-age=31536000, immutable');
  });

  it('requires its own session, origin-checks login, and sets an opaque strict cookie', async () => {
    expect((await fetch(`${origin}/api/auth/me`)).status).toBe(401);
    const missingOrigin = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    });
    expect(missingOrigin.status).toBe(403);

    const login = await signIn();
    expect(login.status).toBe(200);
    const setCookie = login.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain(`kds_session=${TOKEN}`);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Strict');
    expect(setCookie).toContain('Max-Age=300');
    expect(setCookie).toContain('Secure');
    expect(setCookie).not.toContain('test-only-secure-password');
    const me = await fetch(`${origin}/api/auth/me`, { headers: { Cookie: cookieFrom(login) } });
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({
      authenticated: true,
      username: USERNAME,
      assigned_sections: ['hot'],
    });
  });

  it('returns only section/meal/portion totals and never exposes physical identifiers', async () => {
    const login = await signIn();
    const cookie = cookieFrom(login);
    const config = await fetch(`${origin}/api/display-config`, { headers: { Cookie: cookie } });
    expect(await config.json()).toEqual({
      username: USERNAME,
      assigned_sections: ['hot'],
      kitchens: ['main'],
      refresh_seconds: 60,
    });

    const response = await fetch(`${origin}/api/section-totals?date=2026-08-08&kitchen=main`, {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);
    const bodyText = await response.text();
    expect(JSON.parse(bodyText)).toMatchObject({
      delivery_date: '2026-08-08',
      kitchen: 'main',
      sections: [{ code: 'hot', total_qty: 3, meals: [{ meal_id: 'meal-1', portion_size: 'large', total_qty: 3 }] }],
      summary: { assigned_section_count: 1, assigned_quantity_total: 3 },
    });
    expect(bodyText).not.toContain('"code":"packing"');
    expect(bodyText).not.toContain('Packing meal');
    expect(bodyText).not.toContain('PRIVATE-PHYSICAL-ROW');
    expect(bodyText).not.toContain('itemRef');
    expect(bodyText).not.toContain('item_ref');
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('enforces different user-to-section assignments at the API boundary', async () => {
    const hotCookie = cookieFrom(await signIn());
    const packingCookie = cookieFrom(await signIn(PACKING_USERNAME));

    const hotText = await (await fetch(
      `${origin}/api/section-totals?date=2026-08-08&kitchen=main`,
      { headers: { Cookie: hotCookie } },
    )).text();
    const packingText = await (await fetch(
      `${origin}/api/section-totals?date=2026-08-08&kitchen=main`,
      { headers: { Cookie: packingCookie } },
    )).text();

    expect(JSON.parse(hotText)).toMatchObject({ sections: [{ code: 'hot', total_qty: 3 }] });
    expect(hotText).not.toContain('"code":"packing"');
    expect(JSON.parse(packingText)).toMatchObject({ sections: [{ code: 'packing', total_qty: 7 }] });
    expect(packingText).not.toContain('"code":"hot"');
    expect(packingText).not.toContain('Chicken');
  });

  it('rejects unconfigured kitchens, extra query fields and unsafe methods', async () => {
    const cookie = cookieFrom(await signIn());
    const headers = { Cookie: cookie };
    expect((await fetch(`${origin}/api/section-totals?date=2026-08-08&kitchen=other`, { headers })).status).toBe(400);
    expect((await fetch(`${origin}/api/section-totals?date=2026-08-08&kitchen=main&customer=1`, { headers })).status).toBe(400);
    expect((await fetch(`${origin}/api/section-totals`, { method: 'POST', headers })).status).toBe(405);
  });

  it('fails closed with safe source errors and invalid login responses', async () => {
    const wrong = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, password: 'wrong' }),
    });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error_code: 'invalid_credentials' });

    const cookie = cookieFrom(await signIn());
    options.source.itemsForDay = async () => { throw new PartnerSourceError('response_invalid'); };
    const invalidSource = await fetch(`${origin}/api/section-totals?date=2026-08-08&kitchen=main`, {
      headers: { Cookie: cookie },
    });
    expect(invalidSource.status).toBe(502);
    expect(await invalidSource.json()).toEqual({ error_code: 'kds_source_response_invalid' });
  });

  it('uses the rightmost valid proxy address for account throttling', async () => {
    options.trustProxy = true;
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const response = await fetch(`${origin}/api/auth/login`, {
        method: 'POST',
        headers: {
          Origin: origin,
          'Content-Type': 'application/json',
          'X-Forwarded-For': `198.51.100.${attempt}, 203.0.113.7`,
        },
        body: JSON.stringify({ username: USERNAME, password: 'wrong' }),
      });
      expect(response.status).toBe(401);
    }
    const limited = await fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        'X-Forwarded-For': '198.51.100.99, 203.0.113.7',
      },
      body: JSON.stringify({ username: USERNAME, password: 'wrong' }),
    });
    expect(limited.status).toBe(429);
  });

  async function signIn(username = USERNAME, password = PASSWORD): Promise<Response> {
    return fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
  }
});

describe('login limiter capacity', () => {
  it('evicts only the least-recently-used counter and preserves a live limit', () => {
    const limiter = new LoginLimiter(3);
    expect(limiter.allowed('protected', 2, 0)).toBe(true);
    expect(limiter.allowed('old', 10, 1)).toBe(true);
    expect(limiter.allowed('protected', 2, 2)).toBe(true);
    expect(limiter.allowed('new', 10, 3)).toBe(true);
    expect(limiter.allowed('newer', 10, 4)).toBe(true);
    expect(limiter.allowed('protected', 2, 5)).toBe(false);
  });
});

function cookieFrom(response: Response): string {
  return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}
