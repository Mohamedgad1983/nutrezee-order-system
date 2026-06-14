import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const SHOTS = 'shots-staff';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page): Promise<void> {
  await page.goto('/app/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Kitchen board' })).toBeVisible();
}

// WP-UI-03c — staff & roles admin. List staff, grant/revoke roles live (self-cleaning
// round-trip), and view the RBAC matrix. Over existing endpoints; the 2 seeded staff
// make it demonstrable.
test('staff & roles — list, grant/revoke role, RBAC matrix', async ({ page }) => {
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(e.message));

  await signIn(page);
  await page.getByRole('link', { name: 'Staff & roles' }).click();
  await expect(page).toHaveURL(/\/app\/staff$/);

  // Staff list — both seeded members
  await expect(page.getByRole('cell', { name: 'Staging Admin' })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'UAT Seed Admin' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-staff.png`, fullPage: true });

  // Manage the UAT seed admin → grant report_viewer (live), verify, then revoke (clean up)
  await page.getByRole('row', { name: /UAT Seed Admin/ }).getByRole('button', { name: 'Manage' }).click();
  const panel = page.locator('.reviewPanel');
  await expect(panel.getByRole('heading', { name: 'UAT Seed Admin' })).toBeVisible();

  await page.getByLabel('Grant role').selectOption('report_viewer');
  const granted = page.waitForResponse((r) => r.url().endsWith('/rbac/grants') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Grant', exact: true }).click();
  expect((await granted).status()).toBe(200);
  // Scope to the roles list (.hits) — after a revoke the role returns to the grant
  // dropdown as an <option>, which a panel-wide getByText would also match.
  await expect(panel.locator('.hits').getByText('report_viewer', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/02-role-granted.png`, fullPage: true });

  const revoked = page.waitForResponse((r) => r.url().endsWith('/rbac/revoke') && r.request().method() === 'POST');
  await panel.locator('.hits li', { hasText: 'report_viewer' }).getByRole('button', { name: 'revoke' }).click();
  expect((await revoked).status()).toBe(200);
  await expect(panel.locator('.hits').getByText('report_viewer', { exact: true })).toHaveCount(0);

  // RBAC matrix tab
  await page.getByRole('button', { name: 'Roles (RBAC matrix)' }).click();
  await expect(page.getByRole('cell', { name: 'super_admin', exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: 'ops_manager', exact: true })).toBeVisible();
  await page.getByRole('row', { name: /super_admin/ }).getByRole('button', { name: 'View' }).click();
  await expect(page.getByText('staff.read', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/03-rbac-matrix.png`, fullPage: true });

  expect(crashes, `client crashes: ${crashes.join(' | ')}`).toHaveLength(0);
});
