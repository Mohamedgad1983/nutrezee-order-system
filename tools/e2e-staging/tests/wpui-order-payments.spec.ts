import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const SHOTS = 'shots-order-payments';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page): Promise<void> {
  await page.goto('/app/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Kitchen board' })).toBeVisible();
}

// WP-UI-06 — per-order payment actions on the order detail. Requesting a status change
// creates a payment_review_item (→ Finance queue) and is repeatable, so that's the
// asserted path; record-link-sent is also in the UI (state-dependent, smoke-checked).
test('orders — request a payment status change from the order panel', async ({ page }) => {
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(e.message));

  await signIn(page);
  await page.getByRole('link', { name: 'Orders' }).click();
  await page.getByRole('button', { name: 'Open' }).first().click();

  const panel = page.locator('.reviewPanel');
  await expect(panel.getByRole('heading', { name: /Order/ })).toBeVisible();
  await panel.getByRole('button', { name: 'Payment' }).click();

  // payment status loaded + shown
  await expect(panel.getByText('Payment status')).toBeVisible();

  // request a status change → Finance review
  await page.getByLabel('Requested status').selectOption('paid');
  await page.getByLabel('Evidence note (optional)').fill(`e2e ${Date.now()}`);
  const requested = page.waitForResponse((r) => r.url().endsWith('/payments/status-requests') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Request status change' }).click();
  expect((await requested).status()).toBe(201);
  await expect(panel.getByText('Requested — sent to Finance review.')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-status-requested.png`, fullPage: true });

  expect(crashes, `client crashes: ${crashes.join(' | ')}`).toHaveLength(0);
});
