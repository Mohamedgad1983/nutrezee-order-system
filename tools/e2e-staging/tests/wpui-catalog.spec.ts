import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const SHOTS = 'shots-catalog';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page): Promise<void> {
  await page.goto('/app/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Kitchen board' })).toBeVisible();
}

// WP-UI-03b — catalog browse. Read-only over GET /catalog/*; demonstrable on staging
// because the catalog was seeded via the M19 import (2 products, 2 packages, 2 meal types).
test('catalog browse — products, packages, masters tabs (read-only)', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Catalog' }).click();
  await expect(page).toHaveURL(/\/app\/catalog$/);

  // Products tab (default) — seeded products visible
  await expect(page.getByText('Grilled Chicken Kabsa')).toBeVisible();
  await expect(page.getByText('Quinoa Power Salad')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-products.png`, fullPage: true });

  // Open a product → detail panel with nutrition + allergens sections
  await page.getByRole('row', { name: /Grilled Chicken Kabsa/ }).getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { name: 'Grilled Chicken Kabsa' })).toBeVisible();
  await expect(page.getByText('Nutrition', { exact: true })).toBeVisible();
  await expect(page.getByText('Allergens', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/02-product-detail.png`, fullPage: true });
  await page.getByRole('button', { name: 'Close' }).click();

  // Packages tab — seeded packages visible
  await page.getByRole('button', { name: 'Packages' }).click();
  await expect(page.getByText('Weekly Lite Plan')).toBeVisible();
  await expect(page.getByText('Monthly Balanced Plan')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/03-packages.png`, fullPage: true });

  // Open a package → detail
  await page.getByRole('row', { name: /Weekly Lite Plan/ }).getByRole('button', { name: 'Open' }).click();
  await expect(page.getByRole('heading', { name: 'Weekly Lite Plan' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/04-package-detail.png`, fullPage: true });
  await page.getByRole('button', { name: 'Close' }).click();

  // Masters tab — meal_type kind shows the seeded masters
  await page.getByRole('button', { name: 'Masters' }).click();
  await expect(page.getByText('Lunch')).toBeVisible();
  await expect(page.getByText('Dinner')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/05-masters.png`, fullPage: true });
});

// WP-UI-04 — catalog enrichment: edit a product's nutrition (POST /catalog/products/:id/nutrition,
// catalog.enrich; bypasses mirror mode). Demonstrable live on a seeded product.
test('catalog — edit product nutrition (enrichment)', async ({ page }) => {
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(e.message));

  await signIn(page);
  await page.getByRole('link', { name: 'Catalog' }).click();
  await page.getByRole('row', { name: /Grilled Chicken Kabsa/ }).getByRole('button', { name: 'Open' }).click();
  const panel = page.locator('.reviewPanel');
  await expect(panel.getByRole('heading', { name: 'Grilled Chicken Kabsa' })).toBeVisible();

  await panel.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Calories').fill('537');
  await page.getByLabel('Protein (g)').fill('41');
  await page.getByLabel('Carbs (g)').fill('29');
  await page.getByLabel('Fat (g)').fill('11');
  const saved = page.waitForResponse((r) => /\/catalog\/products\/.+\/nutrition$/.test(r.url()) && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Save nutrition' }).click();
  expect((await saved).status()).toBe(200);

  // detail re-rendered with the saved values
  await expect(panel).toContainText('537');
  await expect(panel).toContainText('41');
  await page.screenshot({ path: `${SHOTS}/06-nutrition-edited.png`, fullPage: true });

  expect(crashes, `client crashes: ${crashes.join(' | ')}`).toHaveLength(0);
});
