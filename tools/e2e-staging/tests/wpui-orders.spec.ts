import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const SHOTS = 'shots-orders';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page): Promise<void> {
  await page.goto('/app/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Kitchen board' })).toBeVisible();
}

test('1 — Orders screen loads from the live API', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Orders' }).click();
  await expect(page).toHaveURL(/\/app\/orders$/);
  const load = page.waitForResponse((r) => r.url().includes('/orders') && r.status() === 200);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await load;
  await expect(page.locator('.content .error')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/01-orders.png`, fullPage: true });
});

test('2 — status filter re-queries without error', async ({ page }) => {
  await signIn(page);
  await page.goto('/app/orders');
  const load = page.waitForResponse((r) => r.url().includes('/orders?status=active') && r.status() === 200);
  await page.getByRole('button', { name: 'Active' }).click();
  await load;
  await expect(page.locator('.content .error')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/02-orders-filtered.png`, fullPage: true });
});

test('3 — cancellation reason-code endpoint is wired (drives the cancel picker)', async ({ page }) => {
  await signIn(page);
  const res = await page.request.get('https://13-140-159-201.sslip.io/settings/reason-codes?domain=cancellation');
  expect(res.status()).toBe(200);
  expect(Array.isArray((await res.json()).items)).toBe(true);
});
