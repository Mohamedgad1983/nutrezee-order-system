import { test, expect, type Page } from '@playwright/test';

const EMAIL = process.env.E2E_EMAIL ?? '';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const SHOTS = 'shots-merge';

test.describe.configure({ mode: 'serial' });

async function signIn(page: Page): Promise<void> {
  await page.goto('/app/login');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Kitchen board' })).toBeVisible();
}

// WP-UI-05 — customer merge UI over the WP-API-02 merge/undo API. Self-seeds a winner
// and a duplicate, merges via the UI, then undoes (self-cleaning).
test('customers — merge a duplicate and undo (UI over WP-API-02)', async ({ page }) => {
  const crashes: string[] = [];
  page.on('pageerror', (e) => crashes.push(e.message));

  await signIn(page);

  const sfx = String(Date.now()).slice(-6);
  const phoneA = `+96651${sfx}`;
  const phoneB = `+96652${sfx}`;
  const nameA = `Merge Keep ${sfx}`;
  const nameB = `Merge Dupe ${sfx}`;
  for (const [name, phone] of [[nameA, phoneA], [nameB, phoneB]]) {
    const r = await page.request.post('/customers', { data: { full_name_en: name, phone, force: true } });
    expect(r.status()).toBe(201);
  }

  await page.getByRole('link', { name: 'Customers' }).click();
  await page.getByRole('button', { name: 'Merge duplicates' }).click();

  const winner = page.locator('label.field').filter({ hasText: 'Keep (winner)' });
  const loser = page.locator('label.field').filter({ hasText: 'Remove (duplicate)' });

  await winner.getByPlaceholder('phone').fill(phoneA);
  await winner.getByRole('button', { name: 'Find' }).click();
  await winner.locator('ul.hits button').first().click();
  await expect(winner.getByText(nameA)).toBeVisible();

  await loser.getByPlaceholder('phone').fill(phoneB);
  await loser.getByRole('button', { name: 'Find' }).click();
  await loser.locator('ul.hits button').first().click();
  await expect(loser.getByText(nameB)).toBeVisible();

  const merged = page.waitForResponse((r) => r.url().endsWith('/customers/merge') && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Merge', exact: true }).click();
  expect((await merged).status()).toBe(201);
  await expect(page.getByText('merged', { exact: true })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/01-merged.png`, fullPage: true });

  // undo (cleans up — the duplicate goes back to active)
  const undone = page.waitForResponse((r) => /\/customers\/merge\/.+\/undo$/.test(r.url()) && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Undo merge' }).click();
  expect((await undone).status()).toBe(200);
  await expect(page.getByText('merge undone')).toBeVisible();

  expect(crashes, `client crashes: ${crashes.join(' | ')}`).toHaveLength(0);
});
