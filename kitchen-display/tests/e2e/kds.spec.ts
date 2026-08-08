import { expect, test } from '@playwright/test';

const live = process.env.KDS_E2E_LIVE === '1';
const username = process.env.KDS_E2E_USERNAME ?? 'kitchen-display';
const password = process.env.KDS_E2E_PASSWORD ?? 'e2e-only-password';

test('Arabic and English totals-only kitchen display', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'تسجيل دخول المطبخ' })).toBeVisible();

  await page.getByLabel('اسم المستخدم').fill(username);
  await page.getByLabel('كلمة المرور').fill(password);
  await page.getByRole('button', { name: 'تسجيل دخول المطبخ' }).click();

  await expect(page.getByRole('heading', { name: 'شاشة إنتاج المطبخ' })).toBeVisible();
  if (live) {
    await assertLiveTotals(page);
    return;
  }

  await expect(page.getByRole('heading', { name: 'المطبخ الساخن' })).toBeVisible();
  await expect(page.getByText('دجاج مشوي')).toHaveCount(2);
  await expect(page.getByRole('alert').filter({ hasText: 'يوجد عناصر غير موجّهة لقسم' })).toBeVisible();
  await expect(page.locator('.sectionCard').filter({ hasText: 'hot' }).locator('.sectionTotal')).toHaveText('٥');
  await expect(page.locator('.sectionCard.unrouted').locator('.sectionTotal')).toHaveText('٤');
  await expect(page.locator('body')).not.toContainText('PRIVATE-ROW');
  await expect(page.locator('body')).not.toContainText('Customer');

  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { name: 'Kitchen Production Display' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hot Kitchen' })).toBeVisible();
  await expect(page.getByText('Grilled Chicken')).toHaveCount(2);
  await expect(page.getByRole('alert').filter({ hasText: 'Some items have no section route' })).toBeVisible();
});

async function assertLiveTotals(page: import('@playwright/test').Page): Promise<void> {
  const requestedDate = process.env.KDS_E2E_DELIVERY_DATE;
  if (requestedDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
    throw new Error('KDS_E2E_DELIVERY_DATE must use YYYY-MM-DD');
  }

  const responsePromise = page.waitForResponse((response) => (
    response.request().method() === 'GET'
      && new URL(response.url()).pathname === '/api/section-totals'
  ));
  if (requestedDate) {
    await page.getByLabel('تاريخ التسليم').fill(requestedDate);
  }
  await page.getByRole('button', { name: 'تحديث الآن' }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);

  const payload = await response.json() as {
    summary: {
      source_quantity_total: number;
      section_assignment_quantity_total: number;
    };
    sections: Array<{ total_qty: number; meals: Array<{ total_qty: number }> }>;
  };
  const serialized = JSON.stringify(payload).toLowerCase();
  for (const forbidden of [
    'customer', 'phone', 'address', 'order_number', 'order_no', 'item_ref',
    'api_key', 'driver', 'vehicle', 'barcode', 'label',
  ]) {
    expect(serialized).not.toContain(forbidden);
  }
  expect(payload.summary.source_quantity_total).toBeGreaterThanOrEqual(0);
  expect(payload.summary.section_assignment_quantity_total).toBeGreaterThanOrEqual(0);
  expect(payload.sections.reduce((sum, section) => sum + section.total_qty, 0))
    .toBe(payload.summary.section_assignment_quantity_total);
  for (const section of payload.sections) {
    expect(section.meals.reduce((sum, meal) => sum + meal.total_qty, 0)).toBe(section.total_qty);
  }

  await expect(page.getByText('إجمالي الوجبات')).toBeVisible();
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.getByRole('heading', { name: 'Kitchen Production Display' })).toBeVisible();
  await expect(page.getByText('Meal quantity')).toBeVisible();
}
