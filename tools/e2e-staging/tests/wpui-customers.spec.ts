import { test, expect, type Page } from '@playwright/test';

const EMAIL = 'mohamedgad8092@gmail.com';
const PASSWORD = '07sYXr0UDIWuyuOfjeXY';
const SHOTS = 'shots-customers';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page): Promise<void> {
  await page.goto('/app/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Kitchen board' })).toBeVisible();
}

// Full end-to-end: this screen works on staging with no seed data, so we drive the
// whole create → search → open profile → edit chain for real.
test('customers admin — create, search, open profile, edit (end-to-end)', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Customers' }).click();
  await expect(page).toHaveURL(/\/app\/customers$/);
  await page.screenshot({ path: `${SHOTS}/01-customers.png`, fullPage: true });

  const suffix = String(Date.now()).slice(-7);
  const phone = `+96656${suffix}`;
  const name = `E2E Customer ${suffix}`;

  // Create
  await page.getByRole('button', { name: 'New customer' }).click();
  await page.getByLabel('Full name (EN)').fill(name);
  await page.getByLabel('Phone').fill(phone);
  await page.getByLabel('Email (optional)').fill(`e2e${suffix}@example.com`);
  const created = page.waitForResponse((r) => r.url().endsWith('/customers') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  expect((await created).status()).toBe(201);
  // Lands on the new profile
  await expect(page.getByText('Name (EN)')).toBeVisible();
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/02-profile.png`, fullPage: true });

  // Edit notes, save
  await page.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Notes').fill('VIP — e2e edit');
  const patched = page.waitForResponse((r) => r.url().includes('/customers/') && r.request().method() === 'PATCH');
  await page.getByRole('button', { name: 'Save' }).click();
  expect((await patched).status()).toBeLessThan(300);
  await expect(page.getByText('VIP — e2e edit')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/03-edited.png`, fullPage: true });

  // Search finds the created customer by phone
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByPlaceholder('Search by phone').fill(phone);
  const found = page.waitForResponse((r) => r.url().includes('/customers?phone=') && r.status() === 200);
  await page.getByRole('button', { name: 'Search' }).click();
  await found;
  await expect(page.getByRole('cell', { name }).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/04-search-found.png`, fullPage: true });
});
