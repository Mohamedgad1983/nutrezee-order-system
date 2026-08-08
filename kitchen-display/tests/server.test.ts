import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthManager, createPasswordHash } from '../src/api/auth.js';
import { PartnerSourceError, type PartnerSourceGateway } from '../src/api/partner-source.js';
import { createKdsServer, type KdsServerOptions } from '../src/api/server.js';

const USERNAME = 'kitchen-display';
const PASSWORD = 'test-only-secure-password';
const TOKEN = 't'.repeat(43);

describe('standalone KDS HTTP boundary', () => {
  let server: Server;
  let origin: string;
  let options: KdsServerOptions;
  let webRoot: string;

  beforeEach(async () => {
    webRoot = await mkdtemp(join(tmpdir(), 'nutrezee-kds-test-'));
    await writeFile(join(webRoot, 'index.html'), '<!doctype html><title>KDS</title>');
    const source: PartnerSourceGateway = {
      itemsForDay: async () => ({
        serverTime: '2026-08-08T10:00:00+03:00',
        items: [{
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
        }],
      }),
    };
    options = {
      auth: new AuthManager({
        username: USERNAME,
        passwordHash: await createPasswordHash(PASSWORD, Buffer.alloc(16, 3)),
        randomToken: () => TOKEN,
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
    expect((await fetch(`${origin}/api/auth/me`, { headers: { Cookie: cookieFrom(login) } })).status).toBe(200);
  });

  it('returns only section/meal/portion totals and never exposes physical identifiers', async () => {
    const login = await signIn();
    const cookie = cookieFrom(login);
    const config = await fetch(`${origin}/api/display-config`, { headers: { Cookie: cookie } });
    expect(await config.json()).toEqual({ kitchens: ['main'], refresh_seconds: 60 });

    const response = await fetch(`${origin}/api/section-totals?date=2026-08-08&kitchen=main`, {
      headers: { Cookie: cookie },
    });
    expect(response.status).toBe(200);
    const bodyText = await response.text();
    expect(JSON.parse(bodyText)).toMatchObject({
      delivery_date: '2026-08-08',
      kitchen: 'main',
      sections: [{ code: 'hot', total_qty: 3, meals: [{ meal_id: 'meal-1', portion_size: 'large', total_qty: 3 }] }],
    });
    expect(bodyText).not.toContain('PRIVATE-PHYSICAL-ROW');
    expect(bodyText).not.toContain('itemRef');
    expect(bodyText).not.toContain('item_ref');
    expect(response.headers.get('cache-control')).toBe('no-store');
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

  async function signIn(): Promise<Response> {
    return fetch(`${origin}/api/auth/login`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USERNAME, password: PASSWORD }),
    });
  }
});

function cookieFrom(response: Response): string {
  return (response.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
}
