// New-system login — env-var creds only. Used when comparison drives the SPA via the
// browser; comparators that only hit the API use lib/new-api.ts instead.

import type { BrowserContext, Page } from 'playwright';
import type { MigrationConfig, ResolvedSecrets } from './lib/config.ts';
import { withRetry } from './lib/safety.ts';
import { log } from './lib/logger.ts';

export async function loginNew(
  ctx: BrowserContext,
  cfg: MigrationConfig,
  secrets: ResolvedSecrets,
): Promise<Page> {
  if (!secrets.newBaseUrl || !secrets.newEmail || !secrets.newPassword) {
    throw new Error('new-system credentials missing — set NEW_STAGING_URL / NEW_ADMIN_EMAIL / NEW_ADMIN_PASSWORD');
  }
  const page = await ctx.newPage();
  await withRetry(async () => {
    await page.goto(`${secrets.newBaseUrl}/app/login`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('Email').fill(secrets.newEmail!);
    await page.getByLabel('Password').fill(secrets.newPassword!);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await page.getByRole('heading', { name: 'Kitchen board' }).waitFor({ timeout: cfg.navTimeoutMs });
  }, { retries: 1, backoffMs: 2000, label: 'new-system login' });
  log.info('new-system: login OK');
  return page;
}
