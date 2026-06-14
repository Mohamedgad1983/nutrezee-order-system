import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const SHOTS = 'shots-payments';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page): Promise<void> {
  await page.goto('/app/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Kitchen board' })).toBeVisible();
}

test('1 — Payments queue is live in the sidebar (no longer "soon")', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Payments' }).click();
  await expect(page).toHaveURL(/\/app\/payments$/);
  const load = page.waitForResponse((r) => r.url().includes('/payment-reviews') && r.status() === 200);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await load;
  await expect(page.locator('.content .error')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/01-payments-queue.png`, fullPage: true });
});

test('2 — state filter re-queries without error', async ({ page }) => {
  await signIn(page);
  await page.goto('/app/payments');
  const load = page.waitForResponse((r) => r.url().includes('/payment-reviews?state=waiting') && r.status() === 200);
  await page.locator('select').first().selectOption('waiting');
  await load;
  await expect(page.locator('.content .error')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/02-payments-filtered.png`, fullPage: true });
});

test('3 — payment_fail reason-code endpoint is wired (drives the reject picker)', async ({ page }) => {
  await signIn(page);
  const res = await page.request.get('https://13-140-159-201.sslip.io/settings/reason-codes?domain=payment_fail');
  expect(res.status()).toBe(200);
  expect(Array.isArray((await res.json()).items)).toBe(true);
});
