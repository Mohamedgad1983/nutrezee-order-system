import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const SHOTS = 'shots-review';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page): Promise<void> {
  await page.goto('/app/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Kitchen board' })).toBeVisible();
}

test('1 — review screen loads the queue from the live API', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Review queue' }).click();
  await expect(page).toHaveURL(/\/app\/review-queue$/);
  const load = page.waitForResponse((r) => r.url().includes('/review-queue') && r.status() === 200);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await load;
  await expect(page.locator('.content .error')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/01-review-queue.png`, fullPage: true });
});

test('2 — state filter re-queries without error', async ({ page }) => {
  await signIn(page);
  await page.goto('/app/review-queue');
  const load = page.waitForResponse((r) => r.url().includes('/review-queue?state=waiting') && r.status() === 200);
  await page.locator('select').first().selectOption('waiting');
  await load;
  await expect(page.locator('.content .error')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/02-review-filtered.png`, fullPage: true });
});

test('3 — reason-code endpoint is wired (drives reject/return pickers)', async ({ page }) => {
  // The decision pickers fetch /settings/reason-codes?domain=...; assert the endpoint
  // responds 200 (empty until the workshop seeds codes) so the wiring is proven even
  // with an empty review queue on the seedless staging DB.
  await signIn(page);
  const res = await page.request.get('https://13-140-159-201.sslip.io/settings/reason-codes?domain=rejection');
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(Array.isArray(body.items)).toBe(true);
});
