#!/usr/bin/env node
// m22 meal-history INCREMENTAL SYNC — DRY-RUN PLANNER (Stage 11 foundation, DISABLED by default).
// After the historical meal-history transfer, this detects orders whose meal-history is NOT yet
// archived in PostgreSQL (vs the legacy_meal_history_raw watermark) and reports what an incremental
// sync WOULD do. It is SEPARATE from the order incremental-sync, has its OWN run-history, NEVER
// applies from this scheduled entrypoint, NEVER scrapes the secondary per-dish getMeals ajax, NEVER
// sends WhatsApp, NEVER touches production. Counts only — no PII, no secrets.
//
// Application is performed by the already-gated tools, each with its own explicit token:
//   1) meal-history-scrape-job.mjs  (VPS-only GET scrape of the new orders' meal grids)
//   2) meal-history-import.mjs      (gated apply: archive raw + clean items / exceptions)
// This planner only DIFFS and REPORTS; it deliberately holds no scrape/import side effects, so it is
// safe to schedule read-only. Apply is refused here (defense in depth) and named for clarity.
//
// env:
//   DATABASE_URL / PG*    staging Postgres (required)
//   ORDERS_INDEX          orders index jsonl (internal_id, order_number, start, end)
//   SYNC_MODE             must be 'dry-run' (default). 'apply' is REFUSED from this entrypoint.
//   SYNC_TARGET           must be 'staging' (default). Any other value aborts (no production).
//   SYNC_WINDOW_DAYS      lookback window for candidate detection (default 30; <=0 => unbounded NOT allowed)
//   TODAY                 YYYY-MM-DD override (tests)
//   RUN_HISTORY           JSONL run-history file (its OWN, not the order-sync history) (optional)
//   LOCK                  PID lockfile (default /tmp/nutrezee-meal-history-sync.lock)
// Only Node builtins are imported statically so the guards run BEFORE any driver loads.
import fs from 'node:fs';
import { normalizeDate } from './meal-history-lib.mjs';

const LOCK = process.env.LOCK || '/tmp/nutrezee-meal-history-sync.lock';
const SYNC_MODE = (process.env.SYNC_MODE || 'dry-run').toLowerCase();
const SYNC_TARGET = (process.env.SYNC_TARGET || 'staging').toLowerCase();
const ORDERS_INDEX = process.env.ORDERS_INDEX || '/opt/nutrezee/legacy-detail-2026/out/orders_index.jsonl';
const WINDOW_DAYS = Number(process.env.SYNC_WINDOW_DAYS || 30);
const TODAY = process.env.TODAY || new Date().toISOString().slice(0, 10);
const RUN_HISTORY = process.env.RUN_HISTORY || '';
const log = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));

// ---- defense in depth: scheduled entrypoint is dry-run + staging ONLY (before any dep loads) ----
if (SYNC_MODE === 'apply' || process.argv.includes('--apply')) {
  log({ fatal: 'refused: apply is not permitted from the meal-history incremental-sync entrypoint — '
    + 'run the gated meal-history-scrape-job.mjs then meal-history-import.mjs (each requires its own '
    + 'explicit token: APPLY_LAST_*_STAGING + MEAL_IMPORT_SOURCE_VPS=1)' });
  process.exit(2);
}
if (SYNC_TARGET !== 'staging') {
  log({ fatal: `refused: SYNC_TARGET must be 'staging' (got '${SYNC_TARGET}') — no production` });
  process.exit(2);
}
if (!Number.isFinite(WINDOW_DAYS) || WINDOW_DAYS <= 0 || WINDOW_DAYS > 366) {
  log({ fatal: `refused: SYNC_WINDOW_DAYS must be 1..366 (got '${process.env.SYNC_WINDOW_DAYS}') — `
    + 'no unbounded incremental window (historical backfill is the gated import path, not this job)' });
  process.exit(2);
}

// ---- overlap guard: atomic O_EXCL lockfile; stale (>25min) locks reclaimed ----
function acquireLock() {
  try { fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' }); return true; }
  catch {
    try {
      const age = Date.now() - fs.statSync(LOCK).mtimeMs;
      if (age > 25 * 60 * 1000) { fs.unlinkSync(LOCK); fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' }); return true; }
    } catch { /* race */ }
    return false;
  }
}
if (!acquireLock()) { log({ skipped: 'another meal-history sync is running (lock held)' }); process.exit(0); }

const { default: pg } = await import('pg');

function ddmmyyyyToIso(s) {
  if (typeof s !== 'string' || !/^\d{2}-\d{2}-\d{4}$/.test(s)) return null;
  const [d, m, y] = s.split('-');
  return normalizeDate(`${y}-${m}-${d}`);
}
function windowFromTo() {
  const to = normalizeDate(TODAY);
  const dt = new Date(to + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() - WINDOW_DAYS);
  return { from: dt.toISOString().slice(0, 10), to };
}

const startedAt = new Date().toISOString();
const t0 = Date.now();
const summary = {
  job: 'meal-history-incremental-sync', mode: 'dry-run', target: SYNC_TARGET,
  started_at: startedAt, finished_at: null, duration_ms: 0,
  window_from: null, window_to: null, window_days: WINDOW_DAYS,
  records_seen: 0, already_archived: 0, would_scrape: 0, would_import: 0,
  watermark_internal_id: 0, next_cursor_internal_id: 0,
  applied: false, whatsapp_sent: false, ok: false, errors: [],
};
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  // watermark = highest legacy internal_id already archived in the m22 raw table
  const wm = await client.query(
    "SELECT max((source_record_id)::bigint) AS m FROM legacy_meal_history_raw WHERE source_record_id ~ '^[0-9]+$'");
  summary.watermark_internal_id = Number(wm.rows[0].m || 0);
  const archived = new Set(
    (await client.query("SELECT source_record_id FROM legacy_meal_history_raw")).rows.map((r) => String(r.source_record_id)));

  const win = windowFromTo();
  summary.window_from = win.from; summary.window_to = win.to;

  // candidate orders whose plan overlaps the recent window and are NOT yet archived
  let orders = [];
  try { orders = fs.readFileSync(ORDERS_INDEX, 'utf8').split('\n'); }
  catch (e) { summary.errors.push(`orders_index_unreadable:${ORDERS_INDEX}`); }
  const seen = new Set();
  let maxId = summary.watermark_internal_id;
  for (const line of orders) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (!r.internal_id || !r.order_number) continue;
    const id = String(r.internal_id);
    if (seen.has(id)) continue; seen.add(id);
    const idNum = Number(id); if (Number.isFinite(idNum)) maxId = Math.max(maxId, idNum);
    const start = ddmmyyyyToIso(r.start), end = ddmmyyyyToIso(r.end);
    if (win.from && end && end < win.from) continue;     // plan ends before window
    if (win.to && start && start > win.to) continue;      // plan starts after window
    if (!start && !end) continue;                         // need a date to window-filter
    summary.records_seen += 1;
    if (archived.has(id)) { summary.already_archived += 1; continue; }
    summary.would_scrape += 1;                            // new order -> would scrape its meal grid
  }
  summary.would_import = summary.would_scrape;            // each newly scraped order would be imported
  summary.next_cursor_internal_id = maxId;
  summary.ok = summary.errors.length === 0;
} catch (e) {
  summary.errors.push(String(e.message || e));
} finally {
  await client.end().catch(() => {});
  summary.finished_at = new Date().toISOString();
  summary.duration_ms = Date.now() - t0;
  if (summary.errors.length) summary.ok = false;
  log({ MEAL_SYNC_DRY_RUN_SUMMARY: summary });
  console.log('SUMMARY ' + JSON.stringify(summary));
  if (RUN_HISTORY) { try { fs.appendFileSync(RUN_HISTORY, JSON.stringify(summary) + '\n'); } catch { /* best effort */ } }
  try { fs.unlinkSync(LOCK); } catch { /* ignore */ }
  process.exit(summary.ok ? 0 : 1);
}
