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

// Dashboard is read-only and runs against mutable staging data, so assertions check
// live analytics structure rather than fixed seed counts.
test('dashboard — stat cards from live projections + queue counts', async ({ page }) => {
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(e.message));

  await signIn(page);
  await page.getByRole('link', { name: 'Dashboard' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);

  // Group headers + key cards render.
  await expect(page.getByText('Executive snapshot', { exact: true })).toBeVisible();
  await expect(page.getByText('Live operations analytics', { exact: true })).toBeVisible();
  await expect(page.getByTestId('metric-attention')).toBeVisible();
  await expect(page.getByText('Intake funnel', { exact: true })).toBeVisible();
  await expect(page.getByText('Orders & payments', { exact: true })).toBeVisible();
  await expect(page.getByText('Payment status mix', { exact: true })).toBeVisible();
  await expect(page.getByText('Kitchen readiness', { exact: true })).toBeVisible();
  await expect(page.getByText('14-day order trend', { exact: true })).toBeVisible();
  await expect(page.locator('.metricCard').filter({ hasText: 'Reviews waiting' })).toBeVisible();
  await expect(page.locator('.metricCard').filter({ hasText: 'Drafts created' })).toBeVisible();

  await expect(page.locator('.analyticsPanel')).toHaveCount(8);
  await expect(page.locator('.metricCard')).toHaveCount(11);

  await expect(page.getByTestId('metric-page-body')).toHaveCount(0);

  await page.getByTestId('metric-attention').click();
  await expect(page).toHaveURL(/\/app\/dashboard\/attention$/);
  const attentionPage = page.getByTestId('metric-page-body');
  await expect(page.getByRole('heading', { name: 'Needs attention' })).toBeVisible();
  await expect(attentionPage.getByRole('heading', { name: 'Reviews waiting' })).toBeVisible();
  await expect(attentionPage.getByRole('heading', { name: 'Payments to confirm' })).toBeVisible();

  await page.getByRole('link', { name: 'Back to dashboard' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);

  await page.getByTestId('metric-orders').click();
  await expect(page).toHaveURL(/\/app\/dashboard\/orders$/);
  await expect(page.getByRole('heading', { name: 'Total orders' })).toBeVisible();
  await expect(page.getByTestId('metric-page-body').getByRole('columnheader', { name: 'Metric' })).toHaveCount(2);
  await page.getByRole('link', { name: 'Back to dashboard' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);

  for (const title of [
    'Orders & payments',
    'Payment status mix',
    'Intake funnel',
    '14-day order trend',
    'Fulfillment pipeline',
    'Kitchen readiness',
    'Top delivery areas',
    'Top packages',
  ]) {
    const panel = page.locator('.analyticsPanel').filter({ hasText: title });
    await panel.getByRole('button').click();
    await expect(panel.locator('.detailDrop')).toBeVisible();
    await expect(panel.getByRole('columnheader', { name: 'Metric' })).toBeVisible();
  }
  await expect(page.locator('.detailDrop')).toHaveCount(8);

  await page.screenshot({ path: `${SHOTS}/01-dashboard.png`, fullPage: true });

  expect(crashes, `client crashes: ${crashes.join(' | ')}`).toHaveLength(0);
});
