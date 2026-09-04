#!/usr/bin/env node
// SUPERVISED customer backfill via the governed M19 'customer' importer (STAGING only).
// Imports genuinely-missing legacy customers so their orphan orders can resolve (order-sync
// resolveCustomer hits findActiveByPhone). Reads a rows file [{legacy_id, name, name_ar?, phone}]
// where legacy_id == the normalized +965 phone (the keyspace the whole system uses).
// Per chunk: POST /imports/customer/dry-run (satisfies the apply same-sourceHash gate) then,
// only if ALLOW_APPLY=yes, /imports/customer/apply. Idempotent (sync_record legacy_key) +
// importer dedups by exact phone. Never legacy, never production, never WhatsApp.
//
// env: DATABASE_URL, API(127.0.0.1:3000), ALLOW_APPLY(yes->apply; else dry-run only),
//      SYNC_TARGET(must be staging). argv[2] = rows JSON (default /srv/customers_missing.json)
import crypto from 'node:crypto';
import fs from 'node:fs';

const API = process.env.API || 'http://127.0.0.1:3000';
const DB = process.env.DATABASE_URL;
const ROWS_FILE = process.argv[2] || '/srv/customers_missing.json';
const APPLY = (process.env.ALLOW_APPLY || '').toLowerCase() === 'yes';
const TEMP_EMAIL = 'sync-temp@nutrezee.local';
const log = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));

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
const rows = JSON.parse(fs.readFileSync(ROWS_FILE, 'utf8'));
log({ rows_to_import: rows.length, mode: APPLY ? 'apply' : 'dry-run' });

const dry = { created: 0, matched: 0, merge_review: 0, error: 0, skipped: 0 };
const app = { created: 0, matched: 0, merge_review: 0, error: 0, skipped: 0 };
let hadError = false; // any chunk HTTP failure OR row-level error => non-zero exit (no silent partials)
try {
  await bootstrapTemp();
  let ci = 0;
  for (const ch of chunk(rows, 200)) {
    ci += 1;
    const d = await fetch(`${API}/imports/customer/dry-run`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ rows: ch }) });
    const db = await d.json().catch(() => ({}));
    for (const k in dry) dry[k] += db.counts?.[k] || 0;
    log({ chunk: ci, dry_run_counts: db.counts });
    if (APPLY) {
      const a = await fetch(`${API}/imports/customer/apply`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ rows: ch }) });
      const ab = await a.json().catch(() => ({}));
      if (!a.ok) { hadError = true; log({ chunk: ci, apply_http: a.status, body: JSON.stringify(ab).slice(0, 300) }); }
      else {
        for (const k in app) app[k] += ab.counts?.[k] || 0;
        if ((ab.counts?.error || 0) > 0) hadError = true;
        log({ chunk: ci, apply_counts: ab.counts });
      }
    }
  }
} catch (e) {
  hadError = true; log({ fatal: String(e.message || e) });
} finally {
  await deleteTemp().catch(() => {});
  await client.end().catch(() => {});
}
log({ DRY_RUN_TOTAL: dry, APPLY_TOTAL: APPLY ? app : null, applied: APPLY, hadError });
console.log('CUSTOMER_IMPORT_SUMMARY ' + JSON.stringify({ dry, apply: APPLY ? app : null, applied: APPLY, hadError }));
if (hadError) process.exit(1); // fail-fast: never report success on a partial/errored apply
