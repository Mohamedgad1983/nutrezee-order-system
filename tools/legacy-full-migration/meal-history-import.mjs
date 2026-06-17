#!/usr/bin/env node
// m22 customer meal-history import — DRY-RUN + GATED last-30-days APPLY (Phase 2/3).
// Reads captured legacy meal grids (meals_<internalId>.html.gz), archives the raw payload (hash
// dedup), maps each order to the new customer_order/customer, window-filters meal-days, and either
// REPORTS what an import would do (dry-run) or WRITES it (apply). NO bridge. Writes ONLY m22 tables
// (raw/history/items/exceptions/import_runs); reads order/customer for lookup only. NEVER touches
// production. Meal history has its OWN run/exception trail — never mixed into the order sync.
//
// Guards (defense in depth, before any DB/driver load):
//   - scope=full refused unless ALLOW_FULL_HISTORY=1 (no whole-history import)
//   - apply refused unless SYNC_TARGET=staging          (no production apply)
//   - apply refused unless scope=last_30_days           (Phase 2/3 is last-30 only)
//   - apply refused unless MEAL_IMPORT_APPLY_CONFIRM=APPLY_LAST_30_STAGING (explicit confirmation)
//   - apply refused unless the m22 destination tables are deployed on the target
// env: RAW_DIR, ORDERS_INDEX (jsonl), DATABASE_URL, MEAL_IMPORT_SCOPE, MEAL_IMPORT_MODE (dry-run|
//   apply), MEAL_IMPORT_APPLY_CONFIRM, TODAY (test override), SYNC_TARGET, RUN_HISTORY.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {
  mealSha, parseMealGrid, scopeToWindow, withinWindow, classifyItem, emptyCounts,
} from './meal-history-lib.mjs';

const MODE = (process.env.MEAL_IMPORT_MODE || 'dry-run').toLowerCase();
const SCOPE = (process.env.MEAL_IMPORT_SCOPE || 'last_30_days').toLowerCase();
const TARGET = (process.env.SYNC_TARGET || 'staging').toLowerCase();
const APPLY = MODE === 'apply';
const RAW_DIR = process.env.RAW_DIR || '/srv/meal_raw';
const ORDERS_INDEX = process.env.ORDERS_INDEX || '/srv/orders_index.jsonl';
const TODAY = process.env.TODAY || new Date().toISOString().slice(0, 10);
const RUN_HISTORY = process.env.RUN_HISTORY || '';
const SOURCE_SYSTEM = process.env.SOURCE_SYSTEM || 'nutreeze.com';
const log = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));

// ---- hard guards (before deps) ----
if (SCOPE === 'full' && process.env.ALLOW_FULL_HISTORY !== '1') {
  log({ fatal: 'refused: scope=full requires ALLOW_FULL_HISTORY=1 (no whole-history import)' });
  process.exit(2);
}
if (APPLY && TARGET !== 'staging') {
  log({ fatal: `refused: apply mode requires SYNC_TARGET=staging (got '${TARGET}')` });
  process.exit(2);
}
if (APPLY && SCOPE !== 'last_30_days') {
  log({ fatal: `refused: apply scope must be last_30_days in Phase 2/3 (got '${SCOPE}')` });
  process.exit(2);
}
if (APPLY && process.env.MEAL_IMPORT_APPLY_CONFIRM !== 'APPLY_LAST_30_STAGING') {
  log({ fatal: 'refused: apply requires MEAL_IMPORT_APPLY_CONFIRM=APPLY_LAST_30_STAGING (explicit confirmation)' });
  process.exit(2);
}

const { default: pg } = await import('pg');
const { ulid } = await import('ulid');

const startedAt = new Date().toISOString();
const t0 = Date.now();
const window = scopeToWindow(SCOPE, TODAY);
const counts = emptyCounts();
// apply-only actual-insert tallies + exception breakdown
const inserts = { raw_inserted: 0, parent_inserted: 0, item_inserted: 0, exception_inserted: 0 };
const exceptionsByReason = {};
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
function bumpException(reason) {
  counts.would_exception += 1;
  if (reason === 'invalid_date') counts.invalid_date += 1;
  else if (reason === 'missing_order_link') counts.missing_order_link += 1;
  else if (reason === 'missing_customer_link') counts.missing_customer_link += 1;
  exceptionsByReason[reason] = (exceptionsByReason[reason] || 0) + 1;
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
const orderLinks = new Map();   // order_number -> { order_id, customer_id }
const existingRawSha = new Set();
let runId = null;

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
  // Dedup against already-archived raw (only if the m22 destination table is deployed).
  let dedupChecked = false;
  try {
    const seen = await client.query('SELECT raw_sha FROM legacy_meal_history_raw');
    for (const r of seen.rows) existingRawSha.add(r.raw_sha);
    dedupChecked = true;
  } catch { /* destination not migrated yet — dedup skipped */ }

  // Apply requires the destination tables to exist on the target.
  if (APPLY && !dedupChecked) {
    log({ fatal: 'refused: apply requires the m22 tables deployed on the target (dedup_checked=false)' });
    await client.end().catch(() => {});
    process.exit(2);
  }

  // Apply opens its own import-run record (counts finalized at the end).
  if (APPLY) {
    runId = ulid();
    await client.query(
      `INSERT INTO customer_meal_history_import_runs
         (id, mode, scope, window_from, window_to, source_system, status, created_by)
       VALUES ($1,'apply',$2,$3,$4,$5,'running','meal-import')`,
      [runId, SCOPE, window.from, window.to, SOURCE_SYSTEM],
    );
  }

  const files = fs.existsSync(RAW_DIR)
    ? fs.readdirSync(RAW_DIR).filter((f) => /^meals_\d+\.html\.gz$/.test(f)).sort()
    : (errors.push(`raw_dir_missing:${RAW_DIR}`), []);

  for (const file of files) {
    counts.records_seen += 1;
    const internalId = (file.match(/^meals_(\d+)\.html\.gz$/) || [])[1];
    let html;
    try { html = zlib.gunzipSync(fs.readFileSync(path.join(RAW_DIR, file))).toString('utf8'); }
    catch { bumpException('parse_error'); errors.push(`gunzip_fail:${file}`); continue; }

    const sha = mealSha(html);
    const parsed = parseMealGrid(html);
    const orderNumber = internalToOrderNo.get(String(internalId)) || null;
    const links = (orderNumber && orderLinks.get(orderNumber)) || {};
    const inWindow = parsed.dates.filter((d) => withinWindow(d, window));

    // ---- duplicate raw => idempotent skip (whole order) ----
    if (existingRawSha.has(sha)) { counts.duplicate_hash += 1; counts.would_skip_duplicate += 1; continue; }
    existingRawSha.add(sha);          // also dedup within this run
    counts.would_archive += 1;
    if (inWindow.length > 0) counts.records_candidate += 1;

    if (!APPLY) {
      // DRY-RUN: classify only.
      for (const meal_date of inWindow) {
        const cls = classifyItem({ meal_date, order_id: links.order_id, customer_id: links.customer_id });
        if (cls === 'clean') counts.would_import_clean += 1; else bumpException(cls);
      }
      continue;
    }

    // ---- APPLY: write this order in its own transaction (m22 tables only) ----
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO legacy_meal_history_raw
           (id, source_system, source_name, source_record_id, legacy_order_number, payload, raw_sha, extracted_at, import_run_id)
         VALUES ($1,$2,'getMealsDateWiseFilter',$3,$4,$5,$6, now(), $7)
         ON CONFLICT (raw_sha) DO NOTHING`,
        [ulid(), SOURCE_SYSTEM, internalId, orderNumber,
          JSON.stringify({ internal_id: internalId, dates: parsed.dates, meal_types: parsed.meal_types, meal_ids: parsed.meal_ids }),
          sha, runId],
      );
      inserts.raw_inserted += 1;

      const linked = !!links.order_id && !!links.customer_id;
      const importStatus = linked ? 'imported' : 'exception';
      const parentId = ulid();
      const ins = await client.query(
        `INSERT INTO customer_meal_history
           (id, import_run_id, legacy_order_id, legacy_order_number, order_id, customer_id,
            meal_date_from, meal_date_to, meal_day_count, meal_types, status, source_sha, import_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULL,$11,$12)
         ON CONFLICT (legacy_order_id) DO NOTHING RETURNING id`,
        [parentId, runId, internalId, orderNumber, links.order_id ?? null, links.customer_id ?? null,
          inWindow[0] ?? null, inWindow[inWindow.length - 1] ?? null, inWindow.length,
          JSON.stringify(parsed.meal_types), sha, importStatus],
      );
      const historyId = ins.rows[0]?.id
        ?? (await client.query('SELECT id FROM customer_meal_history WHERE legacy_order_id=$1', [internalId])).rows[0].id;
      if (ins.rows.length) inserts.parent_inserted += 1;

      for (const meal_date of inWindow) {
        const cls = classifyItem({ meal_date, order_id: links.order_id, customer_id: links.customer_id });
        if (cls === 'clean') {
          const it = await client.query(
            `INSERT INTO customer_meal_history_items
               (id, meal_history_id, legacy_order_id, order_id, meal_date, source_sha, import_run_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,
            [ulid(), historyId, internalId, links.order_id, meal_date, sha, runId],
          );
          if (it.rows.length) { counts.would_import_clean += 1; inserts.item_inserted += 1; }
          else counts.would_skip_duplicate += 1;   // dup meal-day already present
        } else {
          await client.query(
            `INSERT INTO customer_meal_history_exceptions (id, import_run_id, legacy_order_id, meal_date, reason, detail)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [ulid(), runId, internalId, meal_date, cls, JSON.stringify({ order_number: orderNumber })],
          );
          inserts.exception_inserted += 1;
          bumpException(cls);
        }
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      errors.push(`apply_fail:${internalId}:${String(e.message || e).slice(0, 50)}`);
    }
  }

  const summary = {
    job: 'meal-history-import', mode: APPLY ? 'apply' : 'dry-run', scope: SCOPE, target: TARGET,
    run_id: runId, window_from: window.from, window_to: window.to,
    started_at: startedAt, finished_at: new Date().toISOString(), duration_ms: Date.now() - t0,
    ...counts, ...(APPLY ? inserts : {}), exceptions_by_reason: exceptionsByReason,
    dedup_checked: dedupChecked, errors, applied: APPLY, whatsapp_sent: false, ok: errors.length === 0,
  };

  if (APPLY && runId) {
    await client.query(
      `UPDATE customer_meal_history_import_runs SET finished_at=now(), duration_ms=$2, counts=$3, status=$4 WHERE id=$1`,
      [runId, summary.duration_ms, JSON.stringify(summary), summary.ok ? 'ok' : 'failed'],
    );
  }

  log({ [APPLY ? 'MEAL_APPLY_SUMMARY' : 'MEAL_DRY_RUN_SUMMARY']: summary });
  console.log('SUMMARY ' + JSON.stringify(summary));
  if (RUN_HISTORY) { try { fs.appendFileSync(RUN_HISTORY, JSON.stringify(summary) + '\n'); } catch { /* best effort */ } }
  await client.end().catch(() => {});
  process.exit(summary.ok ? 0 : 1);
} catch (e) {
  log({ fatal: String(e.message || e) });
  await client.end().catch(() => {});
  process.exit(1);
}
