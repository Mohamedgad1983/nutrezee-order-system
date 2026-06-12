import { test, expect, request as pwRequest } from '@playwright/test';

const BASE = 'https://13-140-159-201.sslip.io';
const EMAIL = 'mohamedgad8092@gmail.com';
const PASSWORD = '07sYXr0UDIWuyuOfjeXY';
const SHOTS = 'shots';

let sessionId: string;

test.beforeAll(async () => {
  // The SPA has no login form (known gap) — mint the session via the API,
  // exactly as the deployment smoke test did, then hand the cookie to the browser.
  const api = await pwRequest.newContext({ baseURL: BASE });
  const res = await api.post('/auth/login', { data: { email: EMAIL, password: PASSWORD } });
  expect(res.status(), 'API login must succeed').toBe(200);
  const setCookie = res.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie')?.value ?? '';
  const m = /nz_session=([^;]+)/.exec(setCookie);
  expect(m, 'nz_session cookie present').toBeTruthy();
  sessionId = m![1];
  await api.dispose();
});

test('1 — landing page renders the admin shell', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Nutrezee Admin' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Kitchen Board' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-landing-page.png`, fullPage: true });
});

test('2 — /kitchen deep link loads the SPA (D7 fix proof)', async ({ page }) => {
  // Before the D7 nginx fix this URL 301-redirected into an API 404.
  const response = await page.goto('/kitchen');
  expect(response!.status()).toBe(200);
  await expect(page.getByText('Kitchen Board')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/02-kitchen-deeplink-loads.png`, fullPage: true });
});

test('3 — kitchen board WITHOUT login shows the auth error (no login UI exists yet)', async ({ page }) => {
  await page.goto('/kitchen');
  // The board fetches /kitchen/board unauthenticated -> 401 no_session surfaces as the error line.
  await expect(page.locator('.error')).toContainText('no_session');
  await page.screenshot({ path: `${SHOTS}/03-kitchen-unauthenticated-error.png`, fullPage: true });
});

test('4 — kitchen board WITH session: loads, Refresh and Generate work', async ({ browser }) => {
  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: 1280, height: 800 },
  });
  await context.addCookies([
    {
      name: 'nz_session',
      value: sessionId,
      domain: '13-140-159-201.sslip.io',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const page = await context.newPage();

  await page.goto('/kitchen');
  await expect(page.getByText('Kitchen Board')).toBeVisible();
  // Fresh DB: board loads successfully and shows the empty state, no error line.
  await expect(page.getByText('No tickets')).toBeVisible();
  await expect(page.locator('.error')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/04-kitchen-authed-empty-board.png`, fullPage: true });

  // Exercise the toolbar buttons against the live API.
  const boardReload = page.waitForResponse((r) => r.url().includes('/kitchen/board') && r.status() === 200);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await boardReload;
  await expect(page.locator('.error')).toHaveCount(0);

  const generateCall = page.waitForResponse((r) => r.url().includes('/kitchen/generate-tickets') && r.status() < 300);
  await page.getByRole('button', { name: 'Generate' }).click();
  await generateCall;
  await expect(page.locator('.error')).toHaveCount(0);
  // No orders exist yet, so generation legitimately yields zero tickets.
  await expect(page.getByText('No tickets')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/05-kitchen-generate-refresh-work.png`, fullPage: true });

  await context.close();
});

test('5 — API surface sanity from the browser session: whoami + drafts respond', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: BASE });
  await context.addCookies([
    {
      name: 'nz_session',
      value: sessionId,
      domain: '13-140-159-201.sslip.io',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const page = await context.newPage();

  // These are API endpoints (no UI screens exist for them yet) — render the JSON
  // in the browser to prove the backend behind the missing screens is live.
  await page.goto('/auth/me');
  await expect(page.locator('body')).toContainText('"roles":["super_admin"]');
  await page.screenshot({ path: `${SHOTS}/06-api-whoami.png` });

  await page.goto('/drafts');
  await expect(page.locator('body')).toContainText('"items":[]');
  await page.screenshot({ path: `${SHOTS}/07-api-drafts-empty.png` });

  await context.close();
});
