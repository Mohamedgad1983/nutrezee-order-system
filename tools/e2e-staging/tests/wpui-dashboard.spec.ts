import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const SHOTS = 'shots-dashboard';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page): Promise<void> {
  await page.goto('/app/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Kitchen board' })).toBeVisible();
}

// WP-UI-03c — dashboard. Read-only overview aggregating the M15 report projections +
// live queue counts. Demonstrable against the seed (1 review waiting, 1 payment to
// confirm, 1 order, 4 drafts created, 1 approved).
test('dashboard — stat cards from live projections + queue counts', async ({ page }) => {
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(e.message));

  await signIn(page);
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);

  // Group headers + key cards render
  await expect(page.getByText('Needs attention', { exact: true })).toBeVisible();
  await expect(page.getByText('Intake funnel', { exact: true })).toBeVisible();
  await expect(page.getByText('Orders & payments', { exact: true })).toBeVisible();
  await expect(page.getByText('Reviews waiting', { exact: true })).toBeVisible();
  await expect(page.getByText('Drafts created', { exact: true })).toBeVisible();

  // Real data flows from the live API: the seeded queues/order each have one item.
  await expect(page.locator('.card').filter({ hasText: 'Reviews waiting' })).toContainText('1');
  await expect(page.locator('.card').filter({ hasText: 'Payments to confirm' })).toContainText('1');

  await page.screenshot({ path: `${SHOTS}/01-dashboard.png`, fullPage: true });

  expect(crashes, `client crashes: ${crashes.join(' | ')}`).toHaveLength(0);
});
