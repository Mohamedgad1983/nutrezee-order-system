import { expect, test } from '@playwright/test';

test('Arabic and English totals-only kitchen display', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  await expect(page.getByRole('heading', { name: 'تسجيل دخول المطبخ' })).toBeVisible();

  await page.getByLabel('اسم المستخدم').fill('kitchen-display');
  await page.getByLabel('كلمة المرور').fill('e2e-only-password');
  await page.getByRole('button', { name: 'تسجيل دخول المطبخ' }).click();

  await expect(page.getByRole('heading', { name: 'شاشة إنتاج المطبخ' })).toBeVisible();
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
