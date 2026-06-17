#!/usr/bin/env node
// m22 customer meal-history import — DRY-RUN FOUNDATION (Phase 1).
// Reads captured legacy meal grids (meals_<internalId>.html.gz), archives the raw payload (hash
// dedup), maps each order to the new customer_order/customer, window-filters meal-days, and reports
// what an import WOULD do. NO bridge. NO writes in Phase 1. NEVER touches production. Meal history
// has its OWN run/exception trail — it is never mixed into the order sync.
//
// Guards (defense in depth, evaluated before any DB/driver loads):
//   - apply mode is refused unless SYNC_TARGET=staging (no production apply)
//   - apply mode is refused entirely in Phase 1 (dry-run + validation must pass first)
//   - scope=full is refused unless ALLOW_FULL_HISTORY=1 (no accidental whole-history import)
// env: RAW_DIR, ORDERS_INDEX (jsonl), DATABASE_URL, MEAL_IMPORT_SCOPE (last_30_days|last_90_days|
//   last_year|full), MEAL_IMPORT_MODE (dry-run|apply), TODAY (YYYY-MM-DD, test override),
//   SYNC_TARGET (staging), RUN_HISTORY (jsonl sink).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  mealSha, parseMealGrid, scopeToWindow, withinWindow, classifyItem, emptyCounts,
} from './meal-history-lib.mjs';

const MODE = (process.env.MEAL_IMPORT_MODE || 'dry-run').toLowerCase();
const SCOPE = (process.env.MEAL_IMPORT_SCOPE || 'last_30_days').toLowerCase();
const TARGET = (process.env.SYNC_TARGET || 'staging').toLowerCase();
const RAW_DIR = process.env.RAW_DIR || '/srv/meal_raw';
const ORDERS_INDEX = process.env.ORDERS_INDEX || '/srv/orders_index.jsonl';
const TODAY = process.env.TODAY || new Date().toISOString().slice(0, 10);
const RUN_HISTORY = process.env.RUN_HISTORY || '';
const log = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));

// ---- hard guards (before deps) ----
if (SCOPE === 'full' && process.env.ALLOW_FULL_HISTORY !== '1') {
  log({ fatal: 'refused: scope=full requires ALLOW_FULL_HISTORY=1 (no whole-history import)' });
  process.exit(2);
}
if (MODE === 'apply' && TARGET !== 'staging') {
  log({ fatal: `refused: apply mode requires SYNC_TARGET=staging (got '${TARGET}')` });
  process.exit(2);
}
if (MODE === 'apply') {
  log({ fatal: 'refused: apply path is not enabled in Phase 1 — dry-run + last-30-days validation must pass first' });
  process.exit(2);
}

const { default: pg } = await import('pg');

const startedAt = new Date().toISOString();
const t0 = Date.now();
const window = scopeToWindow(SCOPE, TODAY);
const counts = emptyCounts();
const errors = [];

function loadInternalToOrderNumber(file) {
  const map = new Map();
  if (!fs.existsSync(file)) { errors.push(`orders_index_missing:${file}`); return map; }
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r.internal_id && r.order_number) map.set(String(r.internal_id), String(r.order_number));
    } catch { /* skip malformed line */ }
  }
  return map;
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const orderLinks = new Map();   // order_number -> { order_id, customer_id }
const existingRawSha = new Set();

try {
  const internalToOrderNo = loadInternalToOrderNumber(ORDERS_INDEX);

  // Essential read: resolve order/customer links (internal_id -> order_number -> customer_order).
  try {
    await client.connect();
    const links = await client.query(
      `SELECT sr.legacy_key AS order_number, co.id AS order_id, co.customer_id
       FROM sync_record sr JOIN customer_order co ON co.id = sr.new_ref
       WHERE sr.object_type='order'`,
    );
    for (const r of links.rows) orderLinks.set(String(r.order_number), { order_id: r.order_id, customer_id: r.customer_id });
  } catch (e) {
    errors.push(`db_links_unavailable:${String(e.message || e).slice(0, 60)}`);
  }
  // Optional dedup: only if the m22 destination table is deployed on this target. Its absence in a
  // dry-run is NOT an error (Phase 1 may run before the migration is applied to the target).
  let dedupChecked = false;
  try {
    const seen = await client.query('SELECT raw_sha FROM legacy_meal_history_raw');
    for (const r of seen.rows) existingRawSha.add(r.raw_sha);
    dedupChecked = true;
  } catch { /* destination not migrated yet — dedup skipped */ }

  const files = fs.existsSync(RAW_DIR)
    ? fs.readdirSync(RAW_DIR).filter((f) => /^meals_\d+\.html\.gz$/.test(f))
    : (errors.push(`raw_dir_missing:${RAW_DIR}`), []);

  for (const file of files) {
    counts.records_seen += 1;
    const internalId = (file.match(/^meals_(\d+)\.html\.gz$/) || [])[1];
    let html;
    try { html = zlib.gunzipSync(fs.readFileSync(path.join(RAW_DIR, file))).toString('utf8'); }
    catch { counts.would_exception += 1; errors.push(`gunzip_fail:${file}`); continue; }

    const sha = mealSha(html);
    if (existingRawSha.has(sha)) { counts.duplicate_hash += 1; counts.would_skip_duplicate += 1; continue; }
    existingRawSha.add(sha);          // also dedup within this run
    counts.would_archive += 1;        // raw payload would be archived (lossless, whole order)

    const parsed = parseMealGrid(html);
    const orderNumber = internalToOrderNo.get(String(internalId));
    const links = (orderNumber && orderLinks.get(orderNumber)) || {};

    const inWindow = parsed.dates.filter((d) => withinWindow(d, window));
    if (inWindow.length > 0) counts.records_candidate += 1;

    for (const meal_date of inWindow) {
      const cls = classifyItem({ meal_date, order_id: links.order_id, customer_id: links.customer_id });
      if (cls === 'clean') { counts.would_import_clean += 1; continue; }
      counts.would_exception += 1;
      if (cls === 'invalid_date') counts.invalid_date += 1;
      else if (cls === 'missing_order_link') counts.missing_order_link += 1;
      else if (cls === 'missing_customer_link') counts.missing_customer_link += 1;
    }
  }

  const summary = {
    job: 'meal-history-import', mode: 'dry-run', scope: SCOPE, target: TARGET,
    window_from: window.from, window_to: window.to,
    started_at: startedAt, finished_at: new Date().toISOString(), duration_ms: Date.now() - t0,
    ...counts, dedup_checked: dedupChecked, errors, applied: false, whatsapp_sent: false, ok: errors.length === 0,
  };
  log({ MEAL_DRY_RUN_SUMMARY: summary });
  console.log('SUMMARY ' + JSON.stringify(summary));
  if (RUN_HISTORY) { try { fs.appendFileSync(RUN_HISTORY, JSON.stringify(summary) + '\n'); } catch { /* best effort */ } }
  await client.end().catch(() => {});
  process.exit(summary.ok ? 0 : 1);
} catch (e) {
  log({ fatal: String(e.message || e) });
  await client.end().catch(() => {});
  process.exit(1);
}
