#!/usr/bin/env node
// SUPERVISED order-sync APPLY (manual, staging only) — Phase 3 of the order-sync
// full-detail re-pull (docs/evidence/legacy_full_migration/32_...). Builds the SAME
// candidate rows as the scheduled dry-run (incremental-sync.mjs) from the ENRICHED
// extract (orders with phone), then per 100-row chunk runs the governed M19
// /imports/active_plans dry-run (to satisfy the apply gate's same-sourceHash check)
// then /apply. Idempotent via sync_record (re-run creates 0). Never WhatsApp, never
// production. Requires explicit ALLOW_APPLY=yes + SYNC_TARGET=staging.
import crypto from 'node:crypto';
import fs from 'node:fs';

const API = process.env.API || 'http://127.0.0.1:3000';
const DB = process.env.DATABASE_URL;
const ORD = process.argv[2] || '/srv/orders_history_enriched.json';
const TEMP_EMAIL = 'sync-temp@nutrezee.local';
const log = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));
const validPhone = (p) => !!p && /^\+\d{8,15}$/.test(p);
const validDate = (s) => { if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined; const d = new Date(s + 'T00:00:00Z'); return (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s) ? s : undefined; };

if ((process.env.ALLOW_APPLY || '').toLowerCase() !== 'yes') { log({ fatal: 'refused: set ALLOW_APPLY=yes to apply' }); process.exit(2); }
if ((process.env.SYNC_TARGET || 'staging').toLowerCase() !== 'staging') { log({ fatal: 'refused: SYNC_TARGET must be staging' }); process.exit(2); }

const { default: pg } = await import('pg');
const { hash } = await import('@node-rs/argon2');
const { ulid } = await import('ulid');

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

await client.connect();
const storedOrders = new Set((await client.query("SELECT legacy_key FROM sync_record WHERE object_type='order'")).rows.map((r) => r.legacy_key));
const storedCust = new Set((await client.query("SELECT legacy_key FROM sync_record WHERE object_type='customer'")).rows.map((r) => r.legacy_key));
const orders = JSON.parse(fs.readFileSync(ORD, 'utf8'));
const newRows = [];
for (const o of orders) {
  const id = String(o.id);
  if (storedOrders.has(id)) continue;
  const start = validDate(o.start_date), end = validDate(o.end_date);
  if (!start || !end || !o.package || end < start) continue;
  if (!validPhone(o.phone) || !storedCust.has(o.phone)) continue;
  const paid = Number(o.paid_amount), amt = Number(o.package_amount);
  const total = Number.isFinite(paid) ? Math.round(paid * 1000) : (Number.isFinite(amt) ? Math.round(amt * 1000) : 0);
  if (total < 0) continue;
  newRows.push({ legacy_id: id, order_number: id, customer_phone: o.phone, package_name: o.package, start_date: start, end_date: end, status: o.status, currency: 'KWD', total, payment_amount: total, ...(o.payment_status ? { payment_status: String(o.payment_status) } : {}) });
}
log({ candidate_new_orders: newRows.length });

const applyAgg = { created: 0, matched: 0, error: 0, skipped: 0, merge_review: 0 };
let chunkNo = 0;
let hadError = false; // any chunk HTTP failure OR row-level error => non-zero exit (no silent partials)
try {
  await bootstrapTemp();
  const MAX_CHUNKS = Number(process.env.MAX_CHUNKS || 0); // 0 = all
  for (const ch of chunk(newRows, 100)) {
    chunkNo += 1;
    if (MAX_CHUNKS && chunkNo > MAX_CHUNKS) break;
    // 1) dry-run THIS exact chunk → registers reviewed dry_run for its sourceHash
    await fetch(`${API}/imports/active_plans/dry-run`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ rows: ch }) });
    // 2) apply THIS exact chunk → gate finds the matching dry_run, creates rows
    const a = await fetch(`${API}/imports/active_plans/apply`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ rows: ch }) });
    const ab = await a.json().catch(() => ({}));
    if (!a.ok) { hadError = true; log({ chunk: chunkNo, apply_http: a.status, body: JSON.stringify(ab).slice(0, 300) }); }
    else {
      for (const k in applyAgg) applyAgg[k] += ab.counts?.[k] || 0;
      if ((ab.counts?.error || 0) > 0) hadError = true;
      log({ chunk: chunkNo, counts: ab.counts });
    }
  }
} catch (e) {
  hadError = true; log({ fatal: String(e.message || e) });
} finally {
  await deleteTemp().catch(() => {});
  await client.end().catch(() => {});
}
log({ APPLY_RESULT: applyAgg, applied: true, hadError });
console.log('APPLY_SUMMARY ' + JSON.stringify({ ...applyAgg, chunks: chunkNo, hadError }));
if (hadError) process.exit(1); // fail-fast: never report success on a partial/errored apply
