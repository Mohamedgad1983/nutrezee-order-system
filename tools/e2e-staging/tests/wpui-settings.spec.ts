import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const SHOTS = 'shots-settings';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page): Promise<void> {
  await page.goto('/app/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Kitchen board' })).toBeVisible();
}

// WP-UI-03c — settings/masters admin. View + live add over /settings/masters/:kind
// and /settings/reason-codes. Demonstrable: lists show the seeded rows, and add works
// for real (no seed-data dependency).
test('settings — view + add masters and reason codes', async ({ page }) => {
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(e.message));

  await signIn(page);
  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/\/app\/settings$/);

  // Masters tab (default), kind=area → seeded area visible
  await expect(page.getByRole('cell', { name: 'Riyadh Central' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-masters-area.png`, fullPage: true });

  // Add an area for real
  const suffix = String(Date.now()).slice(-6);
  const areaName = `E2E Area ${suffix}`;
  await page.getByRole('button', { name: 'Add area' }).click();
  await page.getByLabel('Code').fill(`e2e-${suffix}`);
  await page.getByLabel('Name (EN)').fill(areaName);
  await page.getByLabel('Name (AR)').fill(`منطقة ${suffix}`);
  const created = page.waitForResponse((r) => r.url().endsWith('/settings/masters/area') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  expect((await created).status()).toBe(201);
  await expect(page.getByRole('cell', { name: areaName })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/02-area-added.png`, fullPage: true });

  // Switch kind to delivery slots → seeded slot visible (no crash on the kind switch)
  await page.getByLabel('Kind').selectOption('delivery_slot');
  await expect(page.getByRole('cell', { name: 'Morning 8:00–10:00' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/03-slots.png`, fullPage: true });

  // Reason codes tab → rejection domain → seeded 'other' code visible
  await page.getByRole('button', { name: 'Reason codes' }).click();
  await expect(page.getByRole('cell', { name: 'other', exact: true })).toBeVisible();

  // Add a reason code for real
  const rcCode = `e2e_${suffix}`;
  await page.getByRole('button', { name: 'Add reason code' }).click();
  await page.getByLabel('Code').fill(rcCode);
  await page.getByLabel('Label (EN)').fill(`E2E reason ${suffix}`);
  const rcCreated = page.waitForResponse((r) => r.url().includes('/settings/reason-codes') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  expect((await rcCreated).status()).toBe(201);
  await expect(page.getByRole('cell', { name: rcCode })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/04-reason-added.png`, fullPage: true });

  expect(crashes, `client crashes: ${crashes.join(' | ')}`).toHaveLength(0);
});
