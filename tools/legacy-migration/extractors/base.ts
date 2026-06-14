// Generic, config-driven legacy table extractor. Each entity extractor is a thin wrapper
// over this. It navigates, walks pagination (capped), reads rows by the configured column
// selectors, screenshots each page for evidence, and never clicks a mutating control.

import { join } from 'node:path';
import type { Page } from 'playwright';
import type { EntityConfig } from '../lib/config.ts';
import type { Confidence, EntityKey, ExtractionResult, NormalizedRecord, RawRow } from '../lib/types.ts';
import { safeClick, throttle, withRetry } from '../lib/safety.ts';
import { log } from '../lib/logger.ts';

export interface ExtractCtx {
  dryRun: boolean;
  throttleMs: number;
  retries: number;
  retryBackoffMs: number;
  navTimeoutMs: number;
  screenshotDir: string;
  baseUrl: string;
  readOnlyGetAllowlist: string[];
}

export type NormalizeFn = (raw: RawRow[]) => NormalizedRecord[];

async function scrape(page: Page, entity: EntityKey, cfg: EntityConfig, ctx: ExtractCtx) {
  const raw: RawRow[] = [];
  const screenshots: string[] = [];
  if (!cfg.rowSelector || !cfg.columns) {
    log.warn(`[${entity}] config has no rowSelector/columns — calibrate after legacy access; skipping scrape.`);
    return { raw, pages: 0, screenshots };
  }
  const maxPages = cfg.maxPages ?? 20;
  await withRetry(
    () => page.goto(`${ctx.baseUrl}${cfg.path}`, { waitUntil: 'domcontentloaded' }),
    { retries: ctx.retries, backoffMs: ctx.retryBackoffMs, label: `[${entity}] goto ${cfg.path}` },
  );

  let pageNo = 0;
  for (; pageNo < maxPages; pageNo++) {
    await page.waitForSelector(cfg.rowSelector, { timeout: ctx.navTimeoutMs }).catch(() => undefined);
    for (const row of await page.locator(cfg.rowSelector).all()) {
      const rec: RawRow = {};
      for (const [field, sel] of Object.entries(cfg.columns)) {
        const txt = (await row.locator(sel).first().textContent().catch(() => null)) ?? '';
        rec[field] = txt.trim() || null;
      }
      raw.push(rec);
    }
    const shot = join(ctx.screenshotDir, `${entity}-p${pageNo + 1}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => undefined);
    screenshots.push(shot);

    if (!cfg.nextPageSelector) break;
    const next = page.locator(cfg.nextPageSelector).first();
    const more = (await next.isVisible().catch(() => false)) && (await next.isEnabled().catch(() => false));
    if (!more) break;
    await throttle(ctx.throttleMs);                 // never scrape aggressively
    await safeClick(page, cfg.nextPageSelector, {
      baseUrl: ctx.baseUrl,
      readOnlyGetAllowlist: ctx.readOnlyGetAllowlist,
    });                                             // pagination is non-mutating; guard re-checks
    await page.waitForLoadState('domcontentloaded').catch(() => undefined);
  }
  log.info(`[${entity}] ${raw.length} rows across ${pageNo + 1} page(s)`);
  return { raw, pages: pageNo + 1, screenshots };
}

function rollup(normalized: NormalizedRecord[]): Record<Confidence, number> {
  const b: Record<Confidence, number> = { VERIFIED: 0, INFERRED: 0, NEEDS_MANUAL_REVIEW: 0 };
  for (const n of normalized) b[n.confidence]++;
  return b;
}

/** Build a thin extractor for `entity` that scrapes then runs `normalize`. */
export function defineExtractor(entity: EntityKey, normalize: NormalizeFn) {
  return async (page: Page, cfg: EntityConfig, ctx: ExtractCtx): Promise<ExtractionResult> => {
    if (!cfg.calibrated) {
      return {
        entity, status: 'NEEDS_CALIBRATION', source: cfg.path, extracted_at: new Date().toISOString(),
        row_count: 0, raw: [], normalized: [],
        confidence_breakdown: { VERIFIED: 0, INFERRED: 0, NEEDS_MANUAL_REVIEW: 0 },
        pages: 0, screenshots: [], dry_run: ctx.dryRun,
        skipped_reason: 'selector config not calibrated; no legacy route visited',
      };
    }
    const { raw, pages, screenshots } = await scrape(page, entity, cfg, ctx);
    const normalized = normalize(raw);
    return {
      entity, status: 'OK', source: cfg.path, extracted_at: new Date().toISOString(),
      row_count: raw.length, raw, normalized,
      confidence_breakdown: rollup(normalized), pages, screenshots, dry_run: ctx.dryRun,
    };
  };
}
