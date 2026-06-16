#!/usr/bin/env node
// 30-minute incremental legacy->staging sync — DRY-RUN FOUNDATION.
// Detects legacy records not yet in staging (vs sync_record watermark) and DRY-RUNS importing
// them through the governed M19 endpoints. NEVER applies, NEVER sends WhatsApp, NEVER touches
// production. Overlap-safe (O_EXCL lockfile + intended `flock` cron wrapper). No PII committed.
//
// env: DATABASE_URL, API (default 127.0.0.1:3000). MIGRATION_APPLY is IGNORED here (always dry).
// Source of "new records": the on-disk extract (orders_history.json) for this foundation; a
// production cron re-pulls fresh from the legacy admin (read-only) — see the runbook.
import pg from 'pg';
import { hash } from '@node-rs/argon2';
import { ulid } from 'ulid';
import crypto from 'node:crypto';
import fs from 'node:fs';

const LOCK = process.env.LOCK || '/tmp/nutrezee-incremental-sync.lock';
const API = process.env.API || 'http://127.0.0.1:3000';
const DB = process.env.DATABASE_URL;
const ORD = process.argv[2] || '/srv/orders_history.json';
const TEMP_EMAIL = 'sync-temp@nutrezee.local';
const log = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));
const validPhone = (p) => !!p && /^\+\d{8,15}$/.test(p);
const validDate = (s) => { if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined; const d = new Date(s + 'T00:00:00Z'); return (!Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s) ? s : undefined; };

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

try {
  await client.connect();
  // watermark: highest numeric legacy order key already synced + counts
  const wm = await client.query("SELECT max((legacy_key)::bigint) AS max_order, count(*) AS n FROM sync_record WHERE object_type='order' AND legacy_key ~ '^[0-9]+$'");
  const watermark = Number(wm.rows[0].max_order || 0);
  const storedOrders = new Set((await client.query("SELECT legacy_key FROM sync_record WHERE object_type='order'")).rows.map((r) => r.legacy_key));
  const storedCust = new Set((await client.query("SELECT legacy_key FROM sync_record WHERE object_type='customer'")).rows.map((r) => r.legacy_key));
  log({ watermark_max_order_id: watermark, synced_orders: Number(wm.rows[0].n) });

  // candidate new/changed legacy orders (not yet stored). A production cron re-pulls these
  // from the legacy admin; here we read the on-disk extract to demonstrate the diff + dry-run.
  const orders = JSON.parse(fs.readFileSync(ORD, 'utf8'));
  const newRows = [];
  for (const o of orders) {
    const id = String(o.id);
    if (storedOrders.has(id)) continue; // already synced
    const start = validDate(o.start_date), end = validDate(o.end_date);
    if (!start || !end || !o.package || end < start) continue;
    if (!validPhone(o.phone) || !storedCust.has(o.phone)) continue;
    const paid = Number(o.paid_amount), amt = Number(o.package_amount);
    const total = Number.isFinite(paid) ? Math.round(paid * 1000) : (Number.isFinite(amt) ? Math.round(amt * 1000) : 0);
    if (total < 0) continue;
    newRows.push({ legacy_id: id, order_number: id, customer_phone: o.phone, package_name: o.package, start_date: start, end_date: end, status: o.status, currency: 'KWD', total, payment_amount: total, ...(o.payment_status ? { payment_status: String(o.payment_status) } : {}) });
  }
  log({ candidate_new_orders: newRows.length });

  let agg = { created: 0, matched: 0, error: 0, skipped: 0, merge_review: 0 };
  if (newRows.length) {
    await bootstrapTemp();
    for (const ch of chunk(newRows, 100)) {
      const r = await fetch(`${API}/imports/active_plans/dry-run`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ rows: ch }) });
      const b = await r.json();
      for (const k in agg) agg[k] += b.counts?.[k] || 0;
    }
    await deleteTemp();
  }
  log({ DRY_RUN_RESULT: true, would_create: agg.created, would_match: agg.matched, would_fail: agg.error, applied: false, whatsapp_sent: false });
} catch (e) {
  await deleteTemp().catch(() => {});
  log({ fatal: String(e.message || e) });
} finally {
  await client.end().catch(() => {});
  releaseLock();
}
