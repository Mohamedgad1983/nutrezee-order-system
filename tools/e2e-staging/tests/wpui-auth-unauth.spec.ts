import { test, expect } from '@playwright/test';

const SHOTS = '../../docs/evidence/admin_gap_rebuild/screenshots';

test('protected admin routes redirect to login without a session', async ({ page }) => {
  await page.goto('/app/orders');
  await expect(page).toHaveURL(/\/app\/login$/);
  await expect(page.getByRole('heading', { name: 'Nutrezee' })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-login-redirect.png`, fullPage: true });
});

test('invalid admin login shows an error and stays on login', async ({ page }) => {
  await page.goto('/app/login');
  await page.getByLabel('Email').fill('invalid-admin@example.test');
  await page.getByLabel('Password').fill('definitely-wrong');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app\/login$/);
  await expect(page.getByText(/Invalid email or password|Login failed/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/02-invalid-login.png`, fullPage: true });
});
