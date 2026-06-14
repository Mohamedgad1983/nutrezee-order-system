import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const SHOTS = 'shots-reports';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page): Promise<void> {
  await page.goto('/app/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Kitchen board' })).toBeVisible();
}

// WP-UI-03b — reports browse. Read-only over GET /reports/* + POST /exports.
// Demonstrable because the UAT seed produced real outbox events (drafts, an order,
// a payment) → intake-funnel / daily-ops show live numbers.
test('reports — intake funnel, daily ops, kitchen day-list + export', async ({ page }) => {
  // Fail loudly on any uncaught client error — a report tab switch used to white-screen.
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(e.message));
  await signIn(page);
  await page.getByRole('link', { name: 'Reports' }).click();
  await expect(page).toHaveURL(/\/app\/reports$/);

  // Intake funnel (default) — metric labels render
  await expect(page.getByText('Drafts created', { exact: true })).toBeVisible();
  await expect(page.getByText('Approved', { exact: true })).toBeVisible();
  await expect(page.getByText('By channel', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-intake-funnel.png`, fullPage: true });

  // Export JSON triggers a client-side download
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain('intake-funnel');

  // Daily ops
  await page.getByRole('button', { name: 'Daily ops' }).click();
  await expect(page.getByText('Orders approved', { exact: true })).toBeVisible();
  await expect(page.getByText('Fulfillment by status', { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/02-daily-ops.png`, fullPage: true });

  // Kitchen day-list (likely empty — demo-data gap renders cleanly, not a failure)
  await page.getByRole('button', { name: 'Kitchen day-list' }).click();
  await expect(page.getByRole('button', { name: 'Export JSON' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/03-kitchen-day-list.png`, fullPage: true });

  expect(crashes, `client crashes: ${crashes.join(' | ')}`).toHaveLength(0);
});
