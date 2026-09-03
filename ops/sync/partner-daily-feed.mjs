#!/usr/bin/env node
// WP-OPS-06 (A47) — Partner daily-deliveries → Nutrezee order feed runner.
//
// Drives the governed M19 endpoints `POST /imports/partner-daily/fetch/dry-run` then
// `.../apply` for each target date. The API fetches Partner itself with its server-held key;
// this runner never sees Partner data, only the batch report (counts + error messages).
// Guards: SYNC_TARGET=staging, ALLOW_APPLY=yes for apply, exactly like ops/sync/apply-order-sync.mjs.
// A temporary super-admin (`sync-temp@nutrezee.local`) is created for the session and deleted
// afterwards, matching the established ops pattern.
import crypto from 'node:crypto';

const API = process.env.API || 'http://127.0.0.1:3000';
const DB = process.env.DATABASE_URL;
const TEMP_EMAIL = 'sync-temp@nutrezee.local';
const MODE = (process.env.FEED_MODE || 'dry-run').toLowerCase();
const log = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));

if ((process.env.SYNC_TARGET || 'staging').toLowerCase() !== 'staging') { log({ fatal: 'refused: SYNC_TARGET must be staging' }); process.exit(2); }
if (!['dry-run', 'apply'].includes(MODE)) { log({ fatal: 'refused: FEED_MODE must be dry-run or apply' }); process.exit(2); }
if (MODE === 'apply' && (process.env.ALLOW_APPLY || '').toLowerCase() !== 'yes') { log({ fatal: 'refused: set ALLOW_APPLY=yes to apply' }); process.exit(2); }
if (!DB) { log({ fatal: 'DATABASE_URL required' }); process.exit(2); }

const kuwaitDate = (offsetDays) => {
  const now = new Date(Date.now() + 3 * 3600 * 1000 + offsetDays * 86400 * 1000);
  return now.toISOString().slice(0, 10);
};
const DATES = (process.env.FEED_DATES || `${kuwaitDate(0)} ${kuwaitDate(1)}`).split(/\s+/).filter(Boolean);
for (const d of DATES) if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { log({ fatal: `invalid date ${d}` }); process.exit(2); }

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
  if (!r.ok) throw new Error(`login failed ${r.status}`);
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
async function call(step, date) {
  const r = await fetch(`${API}/imports/partner-daily/fetch/${step}`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ delivery_date: date }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) return { ok: false, status: r.status, error: body };
  return { ok: true, report: body };
}
const summarize = (report) => ({
  batch_id: report.batchId, dry_run: report.dryRun, counts: report.counts, source: report.source,
  errors: report.rows.filter((x) => x.action === 'error').map((x) => ({ row: x.rowNo, messages: x.messages })).slice(0, 20),
  locked_days: report.rows.filter((x) => x.messages.includes('day_locked')).length,
});

await client.connect();
let failures = 0;
try {
  await bootstrapTemp();
  for (const date of DATES) {
    const dry = await call('dry-run', date);
    if (!dry.ok) { failures += 1; log({ event: 'partner_daily_failed', date, stage: 'dry_run', status: dry.status, error: dry.error }); continue; }
    log({ event: 'partner_daily_dry_run', date, ...summarize(dry.report) });
    if (MODE !== 'apply') continue;
    const applied = await call('apply', date);
    if (!applied.ok) { failures += 1; log({ event: 'partner_daily_failed', date, stage: 'apply', status: applied.status, error: applied.error }); continue; }
    log({ event: 'partner_daily_applied', date, ...summarize(applied.report) });
  }
} finally {
  await deleteTemp().catch((e) => log({ warn: 'temp admin cleanup failed', message: String(e) }));
  await client.end();
}
log({ event: 'partner_daily_complete', mode: MODE, dates: DATES, failures });
process.exit(failures === 0 ? 0 : 1);
