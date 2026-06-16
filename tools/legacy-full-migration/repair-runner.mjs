#!/usr/bin/env node
// Exception Recovery repair runner. Re-imports ONLY the safe-to-repair subset:
//   customers: reason 'not_imported' (unique valid phone, not yet stored)
//   orders:    reason 'unprocessed_recoverable' (customer exists, valid dates+package)
// Bootstraps a TEMPORARY super-admin (in-process password, deleted after), then dry-run
// (and apply if mode=apply) through the governed M19 endpoints. Staging only.
// Usage: node repair-runner.mjs <dry-run|apply> <customers_v2.json> <orders_history.json>
import pg from 'pg';
import { hash } from '@node-rs/argon2';
import { ulid } from 'ulid';
import crypto from 'node:crypto';
import fs from 'node:fs';

const API = process.env.API || 'http://127.0.0.1:3000';
const DB = process.env.DATABASE_URL;
const MODE = process.argv[2] === 'apply' ? 'apply' : 'dry-run';
const CUST = process.argv[3]; const ORD = process.argv[4];
const TEMP_EMAIL = 'import-temp@nutrezee.local';
const log = (o) => console.log(JSON.stringify(o));
const validPhone = (p) => !!p && /^\+\d{8,15}$/.test(p);
const validDate = (s) => { if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined; const d = new Date(s + 'T00:00:00Z'); if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return undefined; const y = +s.slice(0, 4); return (y >= 1990 && y <= 2030) ? s : undefined; };
const fin = (v) => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };

const client = new pg.Client({ connectionString: DB });
await client.connect();

async function upsertTempAdmin(pw) {
  const h = await hash(pw);
  const ex = await client.query('SELECT id FROM staff_user WHERE email=$1', [TEMP_EMAIL]);
  await client.query('BEGIN');
  let id;
  if (ex.rowCount > 0) { id = ex.rows[0].id; await client.query('UPDATE staff_user SET password_hash=$1,active=true,failed_logins=0,updated_at=now() WHERE id=$2', [h, id]); }
  else {
    id = ulid();
    await client.query(`INSERT INTO staff_user (id,name_en,email,password_hash,created_by) VALUES ($1,'TEMP Repair Admin',$2,$3,'repair-bootstrap')`, [id, TEMP_EMAIL, h]);
    await client.query(`INSERT INTO role_assignment (id,staff_id,role_id,assigned_by) SELECT $1,$2,id,'repair-bootstrap' FROM role WHERE code='super_admin'`, [ulid(), id]);
    await client.query(`INSERT INTO audit_event (id,event_type,actor_role,entity_type,entity_id,severity,after) VALUES ($1,'staff.created','system','staff_user',$2,'high',$3)`, [ulid(), id, JSON.stringify({ temp_repair_admin: true })]);
  }
  await client.query('COMMIT');
  return id;
}
async function deleteTempAdmin() {
  const ex = await client.query('SELECT id FROM staff_user WHERE email=$1', [TEMP_EMAIL]);
  if (ex.rowCount === 0) return;
  const id = ex.rows[0].id;
  await client.query('BEGIN');
  await client.query('DELETE FROM role_assignment WHERE staff_id=$1', [id]);
  await client.query('DELETE FROM session WHERE staff_id=$1', [id]);
  await client.query(`INSERT INTO audit_event (id,event_type,actor_role,entity_type,entity_id,severity,after) VALUES ($1,'staff.deleted','system','staff_user',$2,'high',$3)`, [ulid(), id, JSON.stringify({ temp_repair_admin_removed: true })]);
  await client.query('DELETE FROM staff_user WHERE id=$1', [id]);
  await client.query('COMMIT');
}

let cookie = '';
async function login(pw) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: TEMP_EMAIL, password: pw }) });
  if (!r.ok) throw new Error('login ' + r.status);
  const scs = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || ''];
  cookie = (scs.find((c) => c.includes('nz_session')) || '').split(';')[0];
  if (!cookie) throw new Error('no cookie');
}
async function imp(type, mode, rows) {
  const r = await fetch(`${API}/imports/${type}/${mode}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ rows }) });
  const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = { raw: t.slice(0, 300) }; }
  if (!r.ok) throw new Error(`${type}/${mode} ${r.status}: ${JSON.stringify(b).slice(0, 200)}`);
  return b;
}
const chunk = (a, n) => { const o = []; for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n)); return o; };
async function runImport(type, rows, doApply) {
  const agg = { created: 0, matched: 0, error: 0, skipped: 0, merge_review: 0 }; const errs = [];
  for (const ch of chunk(rows, 50)) {
    const dr = await imp(type, 'dry-run', ch);
    for (const row of (dr.rows || [])) if (row.action === 'error') errs.push({ ...ch[(row.rowNo ?? 1) - 1], messages: row.messages });
    if (doApply && (dr.counts.error ?? 0) === 0) {
      const ap = await imp(type, 'apply', ch);
      for (const k in agg) agg[k] += ap.counts[k] || 0;
    } else if (!doApply) {
      for (const k in agg) agg[k] += dr.counts[k] || 0;
    }
  }
  return { agg, errorSample: errs.slice(0, 8), errorCount: errs.length };
}

try {
  const custs = JSON.parse(fs.readFileSync(CUST, 'utf8'));
  const orders = JSON.parse(fs.readFileSync(ORD, 'utf8'));
  const pc = {}; for (const c of custs) if (c.phone) pc[c.phone] = (pc[c.phone] || 0) + 1;
  const BLACK = new Set(Object.entries(pc).filter(([, n]) => n >= 10).map(([p]) => p));
  const storedCustKeys = new Set((await client.query("SELECT legacy_key FROM sync_record WHERE object_type='customer'")).rows.map((r) => r.legacy_key));
  const storedOrderKeys = new Set((await client.query("SELECT legacy_key FROM sync_record WHERE object_type='order'")).rows.map((r) => r.legacy_key));

  // safe customers: unique valid phone, not blacklisted, has name, phone NOT stored
  const custRows = []; const seen = new Set();
  for (const cu of custs) {
    const name = (cu.name || '').trim(); const phone = cu.phone || '';
    if (!name || !validPhone(phone) || BLACK.has(phone) || storedCustKeys.has(phone) || seen.has(phone)) continue;
    seen.add(phone);
    const r = { legacy_id: phone, name, phone };
    if (cu.email && /@/.test(cu.email)) r.email = String(cu.email).slice(0, 200);
    const dob = validDate(cu.dob); if (dob) r.dob = dob;
    custRows.push(r);
  }
  // safe orders: built AGAINST stored customers so they resolve cleanly. Requires a valid
  // phone that maps to a stored customer (no garbage "name[phone]" rows), non-negative amount
  // (customer_order CHECK total/package_amount >= 0), valid dates+package, non-blacklist.
  const buildOrderRows = (custKeys) => {
    const out = [];
    for (const o of orders) {
      const id = String(o.id);
      if (storedOrderKeys.has(id)) continue;
      const start = validDate(o.start_date), end = validDate(o.end_date);
      if (!start || !end || !o.package) continue;
      if (end < start) continue; // CHECK (start_date <= end_date)
      if (!validPhone(o.phone) || BLACK.has(o.phone) || !custKeys.has(o.phone)) continue;
      const paid = fin(o.paid_amount), amt = fin(o.package_amount);
      const total = paid !== undefined ? Math.round(paid * 1000) : (amt !== undefined ? Math.round(amt * 1000) : 0);
      if (total < 0) continue; // negative legacy amount (refund/data error) — not a safe auto-repair
      const r = { legacy_id: id, order_number: id, customer_phone: o.phone, package_name: o.package, start_date: start, end_date: end, status: o.status, currency: 'KWD', total, payment_amount: total };
      if (o.payment_status) r.payment_status = String(o.payment_status);
      if (o.transaction_id) r.transaction_ref = String(o.transaction_id);
      out.push(r);
    }
    return out;
  };
  log({ step: 'safe_subset', customers: custRows.length, orders_pre_customer_apply: buildOrderRows(storedCustKeys).length });

  const pw = crypto.randomBytes(24).toString('base64url');
  await upsertTempAdmin(pw); await login(pw);

  const doApply = MODE === 'apply';
  const cust = await runImport('customer', custRows, doApply);
  log({ phase: 'customers', mode: MODE, ...cust });

  // re-fetch stored customers so orders for the just-applied customers also resolve
  const custKeys2 = doApply
    ? new Set((await client.query("SELECT legacy_key FROM sync_record WHERE object_type='customer'")).rows.map((r) => r.legacy_key))
    : storedCustKeys;
  const orderRows = buildOrderRows(custKeys2);
  log({ step: 'safe_orders', count: orderRows.length });
  const ord = await runImport('active_plans', orderRows, doApply);
  log({ phase: 'orders', mode: MODE, ...ord });

  await deleteTempAdmin();
  log({ FINAL: true, mode: MODE, customers: cust.agg, orders: ord.agg, cust_errors: cust.errorCount, order_errors: ord.errorCount, order_error_sample: ord.errorSample.map((e) => ({ id: e.legacy_id, m: e.messages })) });
} catch (e) {
  await deleteTempAdmin().catch(() => {});
  console.error('FATAL ' + e.message); await client.end(); process.exit(1);
}
await client.end();
