// Legacy login — credentials from env vars ONLY (never hardcoded, never from config).
// Does NOT bypass auth. Supports a manual pause for 2FA / captcha (MIGRATION_MANUAL_LOGIN=1).

import type { BrowserContext, Page } from 'playwright';
import type { MigrationConfig, ResolvedSecrets } from './lib/config.ts';
import { withRetry } from './lib/safety.ts';
import { log } from './lib/logger.ts';

export async function loginLegacy(
  ctx: BrowserContext,
  cfg: MigrationConfig,
  secrets: ResolvedSecrets,
): Promise<Page> {
  if (!secrets.legacyBaseUrl || !secrets.legacyEmail || !secrets.legacyPassword) {
    throw new Error('legacy credentials missing — set LEGACY_BASE_URL / LEGACY_ADMIN_EMAIL / LEGACY_ADMIN_PASSWORD');
  }
  const page = await ctx.newPage();
  const { legacy } = cfg;

  await withRetry(async () => {
    await page.goto(`${secrets.legacyBaseUrl}${legacy.loginPath}`, { waitUntil: 'domcontentloaded' });
    await page.fill(legacy.emailSelector, secrets.legacyEmail!);
    await page.fill(legacy.passwordSelector, secrets.legacyPassword!);
    log.info('legacy: submitting login (read-only session)');
    await page.click(legacy.submitSelector);

    if (process.env.MIGRATION_MANUAL_LOGIN) {
      log.warn('MIGRATION_MANUAL_LOGIN set — pausing up to 120s for 2FA/captcha. Complete it in the browser…');
      await page.waitForSelector(legacy.loggedInSelector, { timeout: 120_000 });
    } else {
      await page.waitForSelector(legacy.loggedInSelector, { timeout: cfg.navTimeoutMs });
    }
  }, { retries: 1, backoffMs: 2000, label: 'legacy login' });

  log.info('legacy: login OK');
  return page;
}
