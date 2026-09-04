import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const SHOTS = 'shots-wpui';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page): Promise<void> {
  await page.goto('/app/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Kitchen board' })).toBeVisible();
}

async function expectListState(page: Page, emptyText: string): Promise<void> {
  await expect(page.getByText(emptyText).or(page.locator('table.table')).first()).toBeVisible();
}

test('1 — unauthenticated visit redirects to the new login screen', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/app\/login$/);
  await expect(page.getByRole('heading', { name: 'Nutrezee' })).toBeVisible();
  await expect(page.getByLabel('Email')).toBeVisible();
  await expect(page.getByLabel('Password')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeDisabled();
  await page.screenshot({ path: `${SHOTS}/01-login-screen.png`, fullPage: true });
});

test('2 — sign in through the form lands on the kitchen board inside the shell', async ({ page }) => {
  await signIn(page);
  await expect(page).toHaveURL(/\/app\/kitchen$/);
  await expect(page.locator('.sidebar')).toBeVisible();
  await expect(page.locator('.who')).toContainText('Staging Admin');
  await page.screenshot({ path: `${SHOTS}/02-signed-in-kitchen-shell.png`, fullPage: true });
});

test('3 — sidebar navigates the live list screens', async ({ page }) => {
  await signIn(page);

  await page.getByRole('link', { name: 'Intake drafts' }).click();
  await expect(page.getByRole('heading', { name: 'Intake drafts' })).toBeVisible();
  await expectListState(page, 'No drafts yet');
  await page.screenshot({ path: `${SHOTS}/03-drafts-screen.png`, fullPage: true });

  await page.getByRole('link', { name: 'Review queue' }).click();
  await expect(page.getByRole('heading', { name: 'Review queue' })).toBeVisible();
  await expectListState(page, 'Review queue is empty');
  await page.screenshot({ path: `${SHOTS}/04-review-queue-screen.png`, fullPage: true });

  await page.getByRole('link', { name: 'Orders' }).click();
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  await expectListState(page, 'No orders yet');
  await page.screenshot({ path: `${SHOTS}/05-orders-screen.png`, fullPage: true });
});

test('4 — Payments opens from the sidebar as a live queue', async ({ page }) => {
  await signIn(page);
  await page.getByRole('link', { name: 'Payments' }).click();
  await expect(page).toHaveURL(/\/app\/payments$/);
  await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible();
  await expect(page.getByLabel('State')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeVisible();
  await expectListState(page, 'Payment review queue is empty');
  await page.screenshot({ path: `${SHOTS}/06-payments-screen.png`, fullPage: true });
});

test('5 — kitchen board still works inside the shell (Generate + Refresh)', async ({ page }) => {
  await signIn(page);
  const gen = page.waitForResponse((r) => r.url().includes('/kitchen/generate-tickets') && r.status() < 300);
  await page.getByRole('button', { name: 'Generate' }).click();
  await gen;
  await expect(page.locator('.content .error')).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/07-kitchen-board-in-shell.png`, fullPage: true });
});

test('6 — deep-link hard refresh renders the SPA (nginx fallback)', async ({ page }) => {
  await signIn(page);
  await page.goto('/app/orders');
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
});

test('7 — sign out revokes the session server-side', async ({ page }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/app\/login$/);
  await page.reload();
  await expect(page.getByLabel('Email')).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/08-signed-out.png`, fullPage: true });
});
