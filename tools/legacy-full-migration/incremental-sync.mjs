#!/usr/bin/env node
// 30-minute incremental legacy->staging sync — DRY-RUN FOUNDATION (scheduled).
// Detects legacy records not yet in staging (vs sync_record watermark) and DRY-RUNS importing
// them through the governed M19 endpoints. NEVER applies, NEVER sends WhatsApp, NEVER touches
// production. Overlap-safe (O_EXCL lockfile + intended `flock` cron/systemd wrapper). No PII committed.
//
// env:
//   DATABASE_URL   staging Postgres (required)
//   API            default http://127.0.0.1:3000
//   SYNC_MODE      must be 'dry-run' (default). 'apply' is REFUSED here (defense in depth).
//   SYNC_TARGET    must be 'staging' (default). Any other value aborts.
//   RUN_HISTORY    JSONL run-history file to append a counts-only summary to (optional)
//   ALERT_FILE     file written with the failure summary when a run errors (optional)
//   LOCK           PID lockfile path (default /tmp/nutrezee-incremental-sync.lock)
// MIGRATION_APPLY is IGNORED — this entrypoint is always dry. The summary line carries the exact
// schema the runbook (doc 25) consumes: started_at, finished_at, records_seen, would_create,
// would_update, would_skip, would_fail, errors, duration_ms, watermark, next_cursor.
// Only Node builtins are imported statically, so the safety guards below run BEFORE any
// driver/dependency is loaded — an accidental apply/non-staging invocation fails fast even
// in an environment without pg installed. The heavy deps load via dynamic import after the guard.
import crypto from 'node:crypto';
import fs from 'node:fs';

const LOCK = process.env.LOCK || '/tmp/nutrezee-incremental-sync.lock';
const API = process.env.API || 'http://127.0.0.1:3000';
const DB = process.env.DATABASE_URL;
const ORD = process.argv[2] || '/srv/orders_history.json';
const SYNC_MODE = (process.env.SYNC_MODE || 'dry-run').toLowerCase();
const SYNC_TARGET = (process.env.SYNC_TARGET || 'staging').toLowerCase();
const RUN_HISTORY = process.env.RUN_HISTORY || '';
const ALERT_FILE = process.env.ALERT_FILE || '';
const TEMP_EMAIL = 'sync-temp@nutrezee.local';
const log = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));
const validPhone = (p) => !!p && /^\+\d{8,15}$/.test(p);
const validDate = (s) => { if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined; const d = new Date(s + 'T00:00:00Z'); return (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s) ? s : undefined; };

// ---- defense in depth: this scheduled entrypoint is dry-run + staging ONLY ----
if (SYNC_MODE === 'apply' || process.argv.includes('--apply')) {
  log({ fatal: 'refused: SYNC_MODE=apply is not permitted from the scheduled dry-run entrypoint' });
  process.exit(2);
}
if (SYNC_TARGET !== 'staging') {
  log({ fatal: `refused: SYNC_TARGET must be 'staging' (got '${SYNC_TARGET}')` });
  process.exit(2);
}

// ---- overlap guard: atomic lockfile (O_EXCL). Stale (>25min) locks are reclaimed. ----
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
function releaseLock() { try { fs.unlinkSync(LOCK); } catch { /* ignore */ } }

if (!acquireLock()) { log({ skipped: 'another sync is running (lock held)' }); process.exit(0); }

// Heavy deps load only after the guards + lock pass (resolved inside the API container).
const { default: pg } = await import('pg');
const { hash } = await import('@node-rs/argon2');
const { ulid } = await import('ulid');

// ---- run-history + alert sinks (counts only; never PII / secrets) ----
function appendHistory(summary) {
  if (!RUN_HISTORY) return;
  try { fs.appendFileSync(RUN_HISTORY, JSON.stringify(summary) + '\n'); } catch { /* best effort */ }
}
function writeAlert(summary) {
  if (!ALERT_FILE) return;
  try { fs.writeFileSync(ALERT_FILE, JSON.stringify(summary, null, 2) + '\n'); } catch { /* best effort */ }
}

const startedAt = new Date().toISOString();
const t0 = Date.now();
const client = new pg.Client({ connectionString: DB });
let tempId = null; let cookie = '';
async function bootstrapTemp() {
  const pw = crypto.randomBytes(24).toString('base64url');
  const h = await hash(pw);
  const ex = await client.query('SELECT id FROM staff_user WHERE email=$1', [TEMP_EMAIL]);
  await client.query('BEGIN');
  if (ex.rowCount > 0) { tempId = ex.rows[0].id; await client.query('UPDATE staff_user SET password_hash=$1,active=true,failed_logins=0 WHERE id=$2', [h, tempId]); }
  else {
    tempId = ulid();
    await client.query(`INSERT INTO staff_user (id,name_en,email,password_hash,created_by) VALUES ($1,'TEMP Sync Admin',$2,$3,'sync')`, [tempId, TEMP_EMAIL, h]);
    await client.query(`INSERT INTO role_assignment (id,staff_id,role_id,assigned_by) SELECT $1,$2,id,'sync' FROM role WHERE code='super_admin'`, [ulid(), tempId]);
  }
  await client.query('COMMIT');
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: TEMP_EMAIL, password: pw }) });
  const scs = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || ''];
  cookie = (scs.find((c) => c.includes('nz_session')) || '').split(';')[0];
}
async function deleteTemp() {
  if (!tempId) return;
  await client.query('BEGIN');
  await client.query('DELETE FROM role_assignment WHERE staff_id=$1', [tempId]);
  await client.query('DELETE FROM session WHERE staff_id=$1', [tempId]);
  await client.query('DELETE FROM staff_user WHERE id=$1', [tempId]);
  await client.query('COMMIT');
}
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };

// summary defaults (the exact schema doc 25 / the runbook consume)
const summary = {
  job: 'incremental-sync', mode: 'dry-run', target: SYNC_TARGET,
  started_at: startedAt, finished_at: null, duration_ms: 0,
  records_seen: 0, would_create: 0, would_update: 0, would_skip: 0, would_fail: 0,
  errors: [], watermark: 0, next_cursor: 0, applied: false, whatsapp_sent: false, ok: false,
};

try {
  await client.connect();
  // watermark: highest numeric legacy order key already synced + counts
  const wm = await client.query("SELECT max((legacy_key)::bigint) AS max_order, count(*) AS n FROM sync_record WHERE object_type='order' AND legacy_key ~ '^[0-9]+$'");
  const watermark = Number(wm.rows[0].max_order || 0);
  summary.watermark = watermark;
  summary.next_cursor = watermark;
  const storedOrders = new Set((await client.query("SELECT legacy_key FROM sync_record WHERE object_type='order'")).rows.map((r) => r.legacy_key));
  const storedCust = new Set((await client.query("SELECT legacy_key FROM sync_record WHERE object_type='customer'")).rows.map((r) => r.legacy_key));
  log({ watermark_max_order_id: watermark, synced_orders: Number(wm.rows[0].n) });

  // candidate new/changed legacy orders (not yet stored). A production cron re-pulls these
  // from the legacy admin (read-only); here we read the on-disk extract to demonstrate the diff.
  let orders = [];
  try { orders = JSON.parse(fs.readFileSync(ORD, 'utf8')); }
  catch (e) { summary.errors.push(`extract_unreadable:${ORD}`); }
  summary.records_seen = orders.length;
  const newRows = [];
  let maxSeen = watermark;
  for (const o of orders) {
    const id = String(o.id);
    const idNum = Number(id);
    if (Number.isFinite(idNum)) maxSeen = Math.max(maxSeen, idNum);
    if (storedOrders.has(id)) continue; // already synced
    const start = validDate(o.start_date), end = validDate(o.end_date);
    if (!start || !end || !o.package || end < start) { summary.would_skip += 1; continue; }
    if (!validPhone(o.phone) || !storedCust.has(o.phone)) { summary.would_skip += 1; continue; }
    const paid = Number(o.paid_amount), amt = Number(o.package_amount);
    const total = Number.isFinite(paid) ? Math.round(paid * 1000) : (Number.isFinite(amt) ? Math.round(amt * 1000) : 0);
    if (total < 0) { summary.would_skip += 1; continue; }
    newRows.push({ legacy_id: id, order_number: id, customer_phone: o.phone, package_name: o.package, start_date: start, end_date: end, status: o.status, currency: 'KWD', total, payment_amount: total, ...(o.payment_status ? { payment_status: String(o.payment_status) } : {}) });
  }
  summary.next_cursor = maxSeen;
  log({ candidate_new_orders: newRows.length });

  const agg = { created: 0, matched: 0, error: 0, skipped: 0, merge_review: 0 };
  if (newRows.length) {
    await bootstrapTemp();
    for (const ch of chunk(newRows, 100)) {
      const r = await fetch(`${API}/imports/active_plans/dry-run`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ rows: ch }) });
      const b = await r.json();
      for (const k in agg) agg[k] += b.counts?.[k] || 0;
    }
    await deleteTemp();
  }
  // M19 dry-run counts -> required schema
  summary.would_create += agg.created;
  summary.would_update += agg.matched;
  summary.would_skip += agg.skipped + agg.merge_review;
  summary.would_fail += agg.error;
  summary.ok = true;
} catch (e) {
  summary.errors.push(String(e.message || e));
  await deleteTemp().catch(() => {});
} finally {
  await client.end().catch(() => {});
  summary.finished_at = new Date().toISOString();
  summary.duration_ms = Date.now() - t0;
  if (summary.errors.length > 0) summary.ok = false;
  log({ DRY_RUN_SUMMARY: summary });
  // Bare, grep-able one-liner so a wrapper running this via `docker exec` can persist host-side
  // run-history without needing jq or a shared mount (the RUN_HISTORY/ALERT_FILE paths below are
  // container-internal and only used when the script runs directly on the host).
  console.log('SUMMARY ' + JSON.stringify(summary));
  appendHistory(summary);
  if (!summary.ok) writeAlert(summary);
  releaseLock();
  process.exit(summary.ok ? 0 : 1);
}
