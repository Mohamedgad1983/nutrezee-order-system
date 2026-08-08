import { expect, test } from '@playwright/test';

const live = process.env.KDS_E2E_LIVE === '1';
const username = process.env.KDS_E2E_USERNAME ?? 'kitchen-display';
const password = process.env.KDS_E2E_PASSWORD ?? 'e2e-only-password';

test('English-default and Arabic totals-only kitchen display', async ({ page }) => {
  let totalsRequests = 0;
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/section-totals') totalsRequests += 1;
  });
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Kitchen sign in' })).toBeVisible();

  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Kitchen sign in' }).click();

  await expect(page.getByRole('heading', { name: 'Kitchen Production Display' })).toBeVisible();
  if (live) {
    await assertLiveTotals(page);
    return;
  }

  await expect(page.getByRole('heading', { name: 'Hot Kitchen' })).toBeVisible();
  await expect(page.getByText('Grilled Chicken')).toHaveCount(2);
  await expect(page.getByRole('alert').filter({ hasText: 'Some items have no section route' })).toBeVisible();
  await expect(page.locator('.sectionCard').filter({ hasText: 'hot' }).locator('.sectionTotal')).toHaveText('5');
  await expect(page.locator('.sectionCard.unrouted').locator('.sectionTotal')).toHaveText('4');
  await expect(page.locator('body')).not.toContainText('PRIVATE-ROW');

  const requestsBeforeLanguageToggle = totalsRequests;
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
  await expect(page.getByRole('heading', { name: 'شاشة إنتاج المطبخ' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'المطبخ الساخن' })).toBeVisible();
  await expect(page.getByText('دجاج مشوي')).toHaveCount(2);
  await expect(page.getByRole('alert').filter({ hasText: 'يوجد عناصر غير موجّهة لقسم' })).toBeVisible();
  await page.waitForTimeout(200);
  expect(totalsRequests).toBe(requestsBeforeLanguageToggle);
  await page.setViewportSize({ width: 390, height: 800 });
  await expect(page.getByRole('button', { name: 'تسجيل الخروج' })).toBeVisible();
});

test('a slower previous date cannot overwrite the current selection', async ({ page }) => {
  test.skip(live, 'fixture-only concurrency regression');
  let releaseInitial: (() => void) | undefined;
  const initialStarted = new Promise<void>((resolve) => { releaseInitial = resolve; });
  let firstTotalsRequest = true;
  await page.route('**/api/section-totals?**', async (route) => {
    const date = new URL(route.request().url()).searchParams.get('date') ?? '';
    if (firstTotalsRequest) {
      firstTotalsRequest = false;
      releaseInitial?.();
      await new Promise((resolve) => setTimeout(resolve, 600));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(totalsPayload(date, 'وجبة قديمة', 9)) });
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(totalsPayload(date, 'وجبة حالية', 2)) });
  });

  await page.goto('/');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Kitchen sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Kitchen Production Display' })).toBeVisible();
  await initialStarted;
  await page.getByLabel('Delivery date').fill('2026-08-09');
  await expect(page.getByText('وجبة حالية')).toBeVisible();
  await page.waitForTimeout(700);
  await expect(page.getByText('وجبة حالية')).toBeVisible();
  await expect(page.getByText('وجبة قديمة')).toHaveCount(0);
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
    await page.getByLabel('Delivery date').fill(requestedDate);
  }
  await page.getByRole('button', { name: 'Refresh now' }).click();
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

  await expect(page.getByText('Meal quantity')).toBeVisible();
  await page.getByRole('button', { name: 'العربية' }).click();
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'شاشة إنتاج المطبخ' })).toBeVisible();
  await expect(page.getByText('إجمالي الوجبات')).toBeVisible();
}

function totalsPayload(deliveryDate: string, mealName: string, quantity: number) {
  const timestamp = '2026-08-08T10:00:00.000Z';
  return {
    delivery_date: deliveryDate,
    kitchen: 'main',
    generated_at: timestamp,
    source_server_time: timestamp,
    summary: {
      source_item_rows: 1,
      source_quantity_total: quantity,
      section_assignment_quantity_total: quantity,
      unrouted_quantity_total: 0,
    },
    sections: [{
      section_id: 'hot-id',
      code: 'hot',
      name_en: 'Hot Kitchen',
      name_ar: 'المطبخ الساخن',
      step_no: 1,
      is_packing: false,
      unrouted: false,
      total_qty: quantity,
      meals: [{
        meal_id: `meal-${quantity}`,
        name_en: mealName,
        name_ar: mealName,
        portion_size: 'regular',
        total_qty: quantity,
      }],
    }],
  };
}
