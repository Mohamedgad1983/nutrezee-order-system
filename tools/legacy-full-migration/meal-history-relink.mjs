#!/usr/bin/env node
// m22 meal-history RELINK — deterministic promotion of missing_order_link exceptions (Phase 4).
// When an order that was a missing_order_link exception later appears in sync_record, this pass
// promotes its archived meal-days into clean items and marks the exceptions resolved — WITHOUT
// re-scraping, WITHOUT deleting exceptions, WITHOUT name/phone/guess linking. It reads only m22 rows
// + reads sync_record/customer_order for the deterministic chain; writes ONLY m22 tables.
//
// Deterministic chain ONLY: legacy_order_number -> sync_record.legacy_key(order) -> customer_order.id,
// customer_id. A link promotes only when BOTH order_id and customer_id resolve. No legacy scrape here.
//
// Guards (before any DB load): apply refused unless SYNC_TARGET=staging + RELINK_APPLY_CONFIRM=
// APPLY_RELINK_STAGING; reason fixed to missing_order_link; apply also requires migration >= 0019
// (resolution columns) and the m22 tables. Dry-run by default.
// env: DATABASE_URL, RELINK_MODE (dry-run|apply), SYNC_TARGET, RELINK_APPLY_CONFIRM, RUN_HISTORY.
import fs from 'node:fs';
import { planRelink } from './meal-history-lib.mjs';

const MODE = (process.env.RELINK_MODE || 'dry-run').toLowerCase();
const TARGET = (process.env.SYNC_TARGET || 'staging').toLowerCase();
const APPLY = MODE === 'apply';
const REASON = 'missing_order_link';
const RUN_HISTORY = process.env.RUN_HISTORY || '';
const log = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));

if (APPLY && TARGET !== 'staging') {
  log({ fatal: `refused: relink apply requires SYNC_TARGET=staging (got '${TARGET}')` });
  process.exit(2);
}
if (APPLY && process.env.RELINK_APPLY_CONFIRM !== 'APPLY_RELINK_STAGING') {
  log({ fatal: 'refused: relink apply requires RELINK_APPLY_CONFIRM=APPLY_RELINK_STAGING (explicit confirmation)' });
  process.exit(2);
}

const { default: pg } = await import('pg');
const { ulid } = await import('ulid');

const startedAt = new Date().toISOString();
const t0 = Date.now();
const summary = {
  job: 'meal-history-relink', mode: APPLY ? 'apply' : 'dry-run', target: TARGET, reason: REASON,
  run_id: null, started_at: startedAt, finished_at: null, duration_ms: 0,
  exceptions_seen: 0, resolvable: 0, unresolved: 0,
  would_promote_items: 0, promoted_items: 0, would_mark_resolved: 0, marked_resolved: 0,
  still_missing_order_link: 0, duplicate_clean_items: 0, invalid_raw_payload: 0,
  applied: APPLY, ok: false, errors: [],
};
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();

  // resolution columns (0019) present?
  const res = await client.query(
    `SELECT count(*)::int AS n FROM information_schema.columns
     WHERE table_name='customer_meal_history_exceptions' AND column_name='resolution_status'`,
  );
  const resolutionSupported = res.rows[0].n > 0;
  if (APPLY && !resolutionSupported) {
    log({ fatal: 'refused: relink apply requires migration 0019 (resolution columns) on the target' });
    await client.end().catch(() => {});
    process.exit(2);
  }

  // open missing_order_link exceptions (+ raw_sha for provenance)
  const whereOpen = resolutionSupported ? "AND e.resolution_status='open'" : '';
  const exRows = (await client.query(
    `SELECT e.id, e.legacy_order_id, e.detail->>'order_number' AS order_number, e.meal_date,
            r.raw_sha
     FROM customer_meal_history_exceptions e
     LEFT JOIN legacy_meal_history_raw r ON r.source_record_id = e.legacy_order_id
     WHERE e.reason=$1 ${whereOpen}`,
    [REASON],
  )).rows;
  summary.exceptions_seen = exRows.length;

  // deterministic sync map
  const syncMap = new Map();
  for (const r of (await client.query(
    `SELECT sr.legacy_key AS order_number, co.id AS order_id, co.customer_id
     FROM sync_record sr JOIN customer_order co ON co.id = sr.new_ref WHERE sr.object_type='order'`,
  )).rows) syncMap.set(String(r.order_number), { order_id: r.order_id, customer_id: r.customer_id });

  // raw_sha per order (provenance)
  const rawSha = new Map();
  for (const e of exRows) if (e.raw_sha) rawSha.set(String(e.legacy_order_id), e.raw_sha);

  const exForPlan = exRows.map((e) => ({ legacy_order_id: e.legacy_order_id, order_number: e.order_number, meal_date: this_dateStr(e.meal_date) }));
  const plan = planRelink(exForPlan, syncMap);
  summary.resolvable = plan.resolvable.length;
  summary.unresolved = plan.unresolved.length;
  summary.would_promote_items = plan.would_promote_items;
  summary.would_mark_resolved = plan.would_mark_resolved;
  summary.still_missing_order_link = plan.still_missing_order_link;

  if (APPLY && plan.resolvable.length > 0) {
    summary.run_id = ulid();
    await client.query(
      `INSERT INTO customer_meal_history_import_runs (id, mode, scope, source_system, status, created_by)
       VALUES ($1,'apply','relink','m22-relink','running','meal-relink')`,
      [summary.run_id],
    );
    for (const o of plan.resolvable) {
      const sha = rawSha.get(String(o.legacy_order_id)) || null;
      if (!sha) { summary.invalid_raw_payload += 1; continue; }  // no raw provenance -> don't promote
      try {
        await client.query('BEGIN');
        const parent = await client.query('SELECT id FROM customer_meal_history WHERE legacy_order_id=$1', [o.legacy_order_id]);
        const parentId = parent.rows[0]?.id;
        if (!parentId) { await client.query('ROLLBACK'); summary.invalid_raw_payload += 1; continue; }
        for (const meal_date of o.dates) {
          const ins = await client.query(
            `INSERT INTO customer_meal_history_items
               (id, meal_history_id, legacy_order_id, order_id, meal_date, source_sha, import_run_id)
             VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,
            [ulid(), parentId, o.legacy_order_id, o.order_id, meal_date, sha, summary.run_id],
          );
          if (ins.rows.length) summary.promoted_items += 1; else summary.duplicate_clean_items += 1;
        }
        await client.query(
          `UPDATE customer_meal_history SET order_id=$2, customer_id=$3, import_status='imported', updated_at=now()
           WHERE legacy_order_id=$1 AND order_id IS NULL`,
          [o.legacy_order_id, o.order_id, o.customer_id],
        );
        const marked = await client.query(
          `UPDATE customer_meal_history_exceptions
             SET resolution_status='resolved', resolved_at=now(), resolved_by_run_id=$2,
                 resolution_note='relinked: order now resolvable via sync_record'
           WHERE legacy_order_id=$1 AND reason=$3 AND resolution_status='open' RETURNING id`,
          [o.legacy_order_id, summary.run_id, REASON],
        );
        summary.marked_resolved += marked.rows.length;
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        summary.errors.push(`relink_fail:${o.legacy_order_id}:${String(e.message || e).slice(0, 50)}`);
      }
    }
    await client.query(
      `UPDATE customer_meal_history_import_runs SET finished_at=now(), duration_ms=$2, counts=$3, status=$4 WHERE id=$1`,
      [summary.run_id, Date.now() - t0, JSON.stringify(summary), summary.errors.length ? 'failed' : 'ok'],
    );
  }

  summary.finished_at = new Date().toISOString();
  summary.duration_ms = Date.now() - t0;
  summary.ok = summary.errors.length === 0;
  log({ [APPLY ? 'RELINK_APPLY_SUMMARY' : 'RELINK_DRY_RUN_SUMMARY']: summary });
  console.log('SUMMARY ' + JSON.stringify(summary));
  if (RUN_HISTORY) { try { fs.appendFileSync(RUN_HISTORY, JSON.stringify(summary) + '\n'); } catch { /* best effort */ } }
  await client.end().catch(() => {});
  process.exit(summary.ok ? 0 : 1);
} catch (e) {
  log({ fatal: String(e.message || e) });
  await client.end().catch(() => {});
  process.exit(1);
}

// date -> YYYY-MM-DD (pg date may come back as Date or string)
function this_dateStr(v) {
  if (v instanceof Date) {
    const y = v.getUTCFullYear(); const m = String(v.getUTCMonth() + 1).padStart(2, '0'); const d = String(v.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return v == null ? null : String(v).slice(0, 10);
}
