import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const SHOTS = 'shots-exceptions';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page): Promise<void> {
  await page.goto('/app/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Kitchen board' })).toBeVisible();
}

// WP-UI-03c — exceptions view. Read over the new GET /orders/exceptions + resolve.
// The screen doesn't raise exceptions (that's the order screen), so the test self-seeds
// one via the API (sharing the signed-in cookie), then lists and resolves it.
test('exceptions — list a seeded exception and resolve it', async ({ page }) => {
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(e.message));

  await signIn(page);

  // Self-seed: raise an exception on the seeded order via the API
  const suffix = String(Date.now()).slice(-6);
  const note = `E2E exception ${suffix}`;
  const orders = await (await page.request.get('/orders')).json();
  const orderId = orders.items[0].id as string;
  const created = await page.request.post(`/orders/${orderId}/exceptions`, {
    data: { type_code: 'other', severity: 'high', notes: note },
  });
  expect(created.status()).toBe(201);

  await page.getByRole('link', { name: 'Exceptions' }).click();
  await expect(page).toHaveURL(/\/app\/exceptions$/);

  // The seeded exception is listed
  await expect(page.getByRole('cell', { name: note })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-exceptions.png`, fullPage: true });

  // Resolve it
  await page.getByRole('row', { name: new RegExp(suffix) }).getByRole('button', { name: 'Resolve' }).click();
  await expect(page.getByRole('heading', { name: /Resolve exception/ })).toBeVisible();
  await page.getByLabel('Resolution reason').selectOption('other');
  const resolved = page.waitForResponse((r) => r.url().includes('/orders/exceptions/') && r.url().endsWith('/resolve') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Mark resolved' }).click();
  expect((await resolved).status()).toBeLessThan(300);

  // It's now resolved — switch the filter and confirm
  await page.getByLabel('State').selectOption('resolved');
  await expect(page.getByRole('row', { name: new RegExp(suffix) })).toContainText('resolved');
  await page.screenshot({ path: `${SHOTS}/02-resolved.png`, fullPage: true });

  expect(crashes, `client crashes: ${crashes.join(' | ')}`).toHaveLength(0);
});
