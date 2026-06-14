import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const SHOTS = 'shots-intake';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page): Promise<void> {
  await page.goto('/app/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Kitchen board' })).toBeVisible();
}

test('1 — New intake screen renders all sections from the sidebar', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'New intake' }).click();
  await expect(page).toHaveURL(/\/app\/intake$/);
  await expect(page.getByRole('heading', { name: 'Channel & customer' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Selection' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Schedule & delivery' })).toBeVisible();
  // Create is disabled until a customer is chosen.
  await expect(page.getByRole('button', { name: 'Create draft' })).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/01-intake-form.png`, fullPage: true });
});

test('2 — customer phone search calls the live API', async ({ page }) => {
  await signIn(page);
  await page.goto('/app/intake');
  await page.getByPlaceholder('Search by phone').fill('500000000');
  const search = page.waitForResponse((r) => r.url().includes('/customers?phone=') && r.status() === 200);
  await page.getByRole('button', { name: 'Search' }).click();
  await search;
  await expect(page.getByText('No match — try New customer.')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/02-customer-search.png`, fullPage: true });
});

test('3 — guided-create a customer, then create a draft and see the completeness verdict', async ({ page }) => {
  await signIn(page);
  await page.goto('/app/intake');

  // Guided create with a unique phone so reruns do not collide on duplicate_phone.
  const suffix = String(Date.now()).slice(-7);
  await page.getByRole('button', { name: 'New customer' }).click();
  await page.getByPlaceholder('Full name (EN)').fill(`E2E Intake ${suffix}`);
  await page.getByPlaceholder('Phone').fill(`+96655${suffix}`);
  const create = page.waitForResponse((r) => r.url().endsWith('/customers') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  const createRes = await create;
  expect(createRes.status()).toBe(201);
  await expect(page.getByText(/^Customer:/)).toBeVisible();

  // Pick a payment method + dates (dropdowns for area/slot/method are empty on the
  // seedless staging DB — the draft is created incomplete, which is what we prove).
  await page.locator('select').filter({ hasText: 'cash' }).first().selectOption('cash').catch(() => {});

  await expect(page.getByRole('button', { name: 'Create draft' })).toBeEnabled();
  const draftPost = page.waitForResponse((r) => r.url().endsWith('/drafts') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create draft' }).click();
  const draftRes = await draftPost;
  expect(draftRes.status()).toBe(201);

  // Server completeness verdict renders; with no catalog/masters data the draft is
  // incomplete and Submit stays disabled — the create+completeness wiring is proven.
  await expect(page.getByText(/Draft .* saved/)).toBeVisible();
  await expect(page.getByText('Incomplete — fill these to submit:')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Submit for review' })).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/03-draft-created-completeness.png`, fullPage: true });
});

test('4 — the created draft appears in the read-only Intake drafts list', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Intake drafts' }).click();
  await expect(page.getByRole('heading', { name: 'Intake drafts' })).toBeVisible();
  const reload = page.waitForResponse((r) => r.url().includes('/drafts') && r.status() === 200);
  await page.getByRole('button', { name: 'Refresh' }).click();
  await reload;
  // At least one draft row exists now (created by test 3).
  await expect(page.locator('table.table tbody tr').first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/04-draft-in-list.png`, fullPage: true });
});
