import { test, expect } from '@playwright/test';

// Use an operator's protected, uncommitted Fleetbase storage state. No print is submitted.
// Run explicitly: npx playwright test --config fleetops.config.ts
// FLEETOPS_E2E_DATE must name a dispatched day containing at least one complete meal label.
test.use({ storageState: process.env.FLEETOPS_E2E_STORAGE_STATE });

test('A55 — searchable driver, area and exact-order label previews', async ({ page }) => {
  await page.setViewportSize({ width: 1728, height: 1100 });
  const day = process.env.FLEETOPS_E2E_DATE;
  expect(day, 'Set FLEETOPS_E2E_DATE to the delivery day under test').toMatch(/^\d{4}-\d{2}-\d{2}$/);
  await page.goto(`${process.env.FLEETOPS_BASE_URL ?? 'https://ops.nutreeze.com'}/fleet-ops/management/nutrezee-batch-labels`);
  const date = page.getByLabel('Delivery day / يوم التوصيل', { exact: true });
  await expect(date).toBeEnabled({ timeout: 60000 });
  await date.fill(day!);
  await date.press('Tab');
  const group = page.locator('[data-test-batch-filter="group"]');
  const scope = page.locator('[data-test-batch-filter="scope"]');
  const order = page.locator('[data-test-batch-filter="order"]');
  const labels = page.locator('.nz-batch-labels article');
  await expect(group.locator('summary')).toHaveAttribute('aria-disabled', 'false', { timeout: 60000 });

  await scope.locator('summary').click();
  const driver = scope.locator('.nz-filter__option').first();
  const driverLabel = await driver.locator('span').first().innerText();
  await scope.getByRole('searchbox').fill(driverLabel);
  await expect(scope.locator('.nz-filter__option')).toHaveCount(1);
  await driver.click();
  await expect(page.getByRole('heading', { name: /labels ready/ })).toBeVisible({ timeout: 60000 });
  expect(await labels.count()).toBeGreaterThan(1);
  const panel = await page.locator('.nz-batch-panel').boundingBox();
  expect(panel!.width).toBeGreaterThan(1300);
  const firstBox = await labels.nth(0).boundingBox();
  const secondBox = await labels.nth(1).boundingBox();
  expect(Math.abs(firstBox!.y - secondBox!.y)).toBeLessThan(2);
  expect(secondBox!.x).toBeGreaterThan(firstBox!.x + firstBox!.width);
  const contact = labels.first().locator('.nz-driver-band__contact');
  const name = await contact.locator('bdi').innerText();
  const phone = await contact.locator('strong').innerText();
  expect(driverLabel).toContain(`${name} · ${phone}`);
  const header = await labels.first().locator('header').boundingBox();
  const band = await labels.first().locator('.nz-driver-band').boundingBox();
  expect(band!.y + band!.height).toBeLessThanOrEqual(header!.y + header!.height);
  // Screen grid must not turn printed pages into multiple-label sheets.
  await page.emulateMedia({ media: 'print' });
  expect(await page.locator('.nz-batch-labels').evaluate((el) => getComputedStyle(el).gridTemplateColumns)).toBe('none');
  await page.emulateMedia({ media: 'screen' });

  await group.locator('summary').click();
  await group.getByRole('button', { name: 'Area / المنطقة', exact: true }).click();
  await scope.locator('summary').click();
  await scope.locator('.nz-filter__option').first().click();
  await expect(page.getByRole('heading', { name: /labels ready/ })).toBeVisible({ timeout: 60000 });

  await group.locator('summary').click();
  await group.getByRole('button', { name: 'Orders / الطلبات', exact: true }).click();
  await order.locator('summary').click();
  const first = order.locator('.nz-filter__option').first();
  const text = await first.locator('span').first().innerText();
  const number = text.match(/^#([^ ]+)/)![1];
  await order.getByRole('searchbox').fill(number);
  await first.click();
  await expect(labels).toHaveCount(1, { timeout: 60000 });
  await expect(labels.first()).toHaveAttribute('aria-label', `Nutrezee label for order ${number}`);
  await expect(page.locator('.nz-batch-confirm')).toHaveCount(0);
  await page.locator('.nz-batch-filter-card').screenshot({ path: 'test-results/a55-dropdown-filters.png' });
});
