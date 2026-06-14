// Orchestrator. DEFAULT MODE = dry-run (read-only): extract → normalize → compare →
// report. NEVER imports or mutates anything. Resilient to missing legacy access (the
// current S1 blocker) — then it produces scaffold reports and tells you what to provide.
//
//   npm run legacy:migration:dry-run     full read-only pipeline (default)
//   npm run legacy:migration:extract     extraction only
//   npm run legacy:migration:compare     comparison only (needs a prior extraction in-process)

import { join } from 'node:path';
import { loadConfig, resolveSecrets, haveLegacyAccess, haveNewAccess } from './lib/config.ts';
import { launchContexts } from './lib/browser.ts';
import { loginLegacy } from './legacy-login.ts';
import { NewApiClient } from './lib/new-api.ts';
import { runDir, writeExtraction, writeReport, writeJson } from './lib/io.ts';
import { installLegacySafety, throttle } from './lib/safety.ts';
import { log } from './lib/logger.ts';
import { extractionSummary, coverageReport, readinessReport } from './lib/reports.ts';
import type { EntityKey, ExtractionResult, ComparisonResult, ExtractionStatus } from './lib/types.ts';

import { extractCustomers } from './extractors/customers.extractor.ts';
import { extractOrders } from './extractors/orders.extractor.ts';
import { extractSubscriptions } from './extractors/subscriptions.extractor.ts';
import { extractProducts } from './extractors/products.extractor.ts';
import { extractPackages } from './extractors/packages.extractor.ts';
import {
  extractAreas, extractDeliverySlots, extractDeliveryMethods,
  extractPaymentMethods, extractCoupons, extractSettings,
} from './extractors/settings.extractor.ts';
import { extractReports } from './extractors/reports.extractor.ts';
import { compareCustomers } from './comparators/compare-customers.ts';
import { compareOrders } from './comparators/compare-orders.ts';
import { compareCatalog } from './comparators/compare-catalog.ts';

const REGISTRY: Array<{ entity: EntityKey; run: typeof extractCustomers }> = [
  { entity: 'customers', run: extractCustomers },
  { entity: 'orders', run: extractOrders },
  { entity: 'subscriptions', run: extractSubscriptions },
  { entity: 'products', run: extractProducts },
  { entity: 'packages', run: extractPackages },
  { entity: 'areas', run: extractAreas },
  { entity: 'delivery_slots', run: extractDeliverySlots },
  { entity: 'delivery_methods', run: extractDeliveryMethods },
  { entity: 'payment_methods', run: extractPaymentMethods },
  { entity: 'coupons', run: extractCoupons },
  { entity: 'settings', run: extractSettings },
  { entity: 'reports', run: extractReports },
];

function emptyResult(
  entity: EntityKey,
  source: string,
  reason: string,
  status: ExtractionStatus = 'SKIPPED',
): ExtractionResult {
  return {
    entity, status, source, extracted_at: new Date().toISOString(), row_count: 0, raw: [], normalized: [],
    confidence_breakdown: { VERIFIED: 0, INFERRED: 0, NEEDS_MANUAL_REVIEW: 0 },
    pages: 0, screenshots: [], dry_run: true, skipped_reason: reason,
  };
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const subset = args.has('--extract') || args.has('--compare') || args.has('--report-only');
  const dryRun = args.has('--dry-run') || !subset;
  const doExtract = dryRun || args.has('--extract');
  const doCompare = dryRun || args.has('--compare');

  const cfg = loadConfig();
  const secrets = resolveSecrets(cfg);
  const legacyAvailable = haveLegacyAccess(secrets);
  const newAvailable = haveNewAccess(secrets);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = runDir(stamp);
  log.info(`migration ${dryRun ? 'DRY-RUN (read-only)' : 'run'} → ${dir}`);
  log.info(`legacy access: ${legacyAvailable ? 'yes (read-only)' : 'NO'} · new-system access: ${newAvailable ? 'yes' : 'NO'}`);

  const extractions: ExtractionResult[] = [];
  let contexts: Awaited<ReturnType<typeof launchContexts>> | undefined;
  let legacyPage;
  const calibratedEntities = REGISTRY.filter(({ entity }) => cfg.entities[entity]?.calibrated);

  if (doExtract && legacyAvailable && calibratedEntities.length > 0) {
    contexts = await launchContexts({ headed: !!process.env.MIGRATION_HEADED, navTimeoutMs: cfg.navTimeoutMs });
    const legacySafety = await installLegacySafety(contexts.legacy, {
      baseUrl: secrets.legacyBaseUrl!,
      authPostAllowlist: cfg.legacy.authPostAllowlist,
      readOnlyGetAllowlist: cfg.legacy.readOnlyGetAllowlist,
    });
    log.info('legacy context launched with AUTH-ONLY safety guard');
    legacyPage = await loginLegacy(contexts.legacy, cfg, secrets);
    legacySafety.enableStrictReadOnly();
    log.info('legacy context switched to STRICT READ-ONLY mode');
  } else if (doExtract) {
    log.warn(
      legacyAvailable
        ? 'extraction skipped — no entity is calibrated. Producing NEEDS_CALIBRATION reports only.'
        : 'extraction skipped — legacy access not provided. Producing scaffold reports only.',
    );
  }

  if (doExtract) {
    for (const { entity, run } of REGISTRY) {
      const ecfg = cfg.entities[entity];
      if (!legacyAvailable || !ecfg) {
        extractions.push(emptyResult(entity, ecfg?.path ?? '(no config)', !legacyAvailable ? 'legacy access not provided' : 'no entity config'));
        continue;
      }
      if (!ecfg.calibrated) {
        extractions.push(emptyResult(entity, ecfg.path, 'selector config not calibrated; no legacy route visited', 'NEEDS_CALIBRATION'));
        continue;
      }
      if (!legacyPage) {
        extractions.push(emptyResult(entity, ecfg.path, 'legacy browser not started', 'SKIPPED'));
        continue;
      }
      const ctx = {
        dryRun, throttleMs: cfg.throttleMs, retries: cfg.retries, retryBackoffMs: cfg.retryBackoffMs,
        navTimeoutMs: cfg.navTimeoutMs, screenshotDir: join(dir, 'screenshots'), baseUrl: secrets.legacyBaseUrl!,
        readOnlyGetAllowlist: cfg.legacy.readOnlyGetAllowlist,
      };
      try {
        const result = await run(legacyPage, ecfg, ctx);
        extractions.push(result);
        writeExtraction(dir, result);
      } catch (e) {
        log.error(`[${entity}] extraction error: ${String(e)}`);
        extractions.push(emptyResult(entity, ecfg.path, `error: ${String(e)}`, 'ERROR'));
      }
      await throttle(cfg.throttleMs);
    }
  }

  const comparisons: ComparisonResult[] = [];
  if (doCompare && newAvailable) {
    const api = new NewApiClient(secrets.newBaseUrl!);
    try {
      await api.login(secrets.newEmail!, secrets.newPassword!);
      const norm = (k: EntityKey) => extractions.find((e) => e.entity === k)?.normalized ?? [];
      comparisons.push(await compareCustomers(norm('customers'), api));
      comparisons.push(await compareOrders(norm('orders'), api));
      const cat = await compareCatalog(norm('products'), norm('packages'), api);
      comparisons.push(cat.products, cat.packages);
    } catch (e) {
      log.error(`comparison error: ${String(e)}`);
    }
  } else if (doCompare) {
    log.warn('comparison skipped — new-system access not provided.');
  }

  const exForReport = extractions.length ? extractions : REGISTRY.map((r) => emptyResult(r.entity, '(not run)', 'not run'));
  writeReport(dir, 'extraction-summary.md', extractionSummary(exForReport));
  writeReport(dir, 'legacy-vs-new-coverage.md', coverageReport(comparisons));
  writeReport(dir, 'migration-readiness-report.md', readinessReport(exForReport, comparisons, { legacyAvailable, newAvailable }));
  writeJson(dir, 'run-manifest.json', {
    stamp, dry_run: dryRun, legacy_available: legacyAvailable, new_available: newAvailable,
    extracted: extractions.map((e) => ({ entity: e.entity, status: e.status, rows: e.row_count, skipped: e.skipped_reason })),
    comparisons: comparisons.map((c) => ({ entity: c.entity, legacy: c.legacy_count, new: c.new_count, matched: c.matched })),
  });

  if (contexts) await contexts.close();

  log.info('─'.repeat(48));
  log.info(`DONE → ${dir}`);
  if (!legacyAvailable) {
    log.warn('NEXT: provide LEGACY_BASE_URL / LEGACY_ADMIN_EMAIL / LEGACY_ADMIN_PASSWORD, calibrate config.json selectors, then re-run:');
    log.warn('  npm run legacy:migration:dry-run');
  }
}

main().catch((e) => { log.error(String(e)); process.exit(1); });
