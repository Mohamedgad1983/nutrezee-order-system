import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const SHOTS = 'shots-audit';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page): Promise<void> {
  await page.goto('/app/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Kitchen board' })).toBeVisible();
}

// WP-UI-03c — audit log. Read-only over the new GET /audit. The audit table already
// has lots of real rows (every state change is audited), so this is fully demonstrable.
test('audit log — list, filter, expand detail', async ({ page }) => {
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(e.message));

  await signIn(page);
  await page.getByRole('link', { name: 'Audit log' }).click();
  await expect(page).toHaveURL(/\/app\/audit$/);

  // The log renders real events
  await expect(page.locator('table.table tbody tr').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-audit.png`, fullPage: true });

  // Filter to a stable event type (the super-admin bootstrap)
  await page.getByLabel('Event type').fill('staff.created');
  const filtered = page.waitForResponse((r) => r.url().includes('/audit?') && r.url().includes('event_type=staff.created') && r.status() === 200);
  await page.getByRole('button', { name: 'Search' }).click();
  await filtered;
  await expect(page.getByRole('cell', { name: 'staff.created' }).first()).toBeVisible();

  // Expand the change detail (super admin has full visibility → before/after shown)
  await page.getByRole('button', { name: 'Detail' }).first().click();
  await expect(page.getByText('After', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/02-detail.png`, fullPage: true });

  expect(crashes, `client crashes: ${crashes.join(' | ')}`).toHaveLength(0);
});
