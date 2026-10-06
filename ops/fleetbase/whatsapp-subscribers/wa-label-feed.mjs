#!/usr/bin/env node
// WP-OPS-A71 — WhatsApp-system subscribers → label database, through the governed M19 import
// (`POST /imports/partner_daily/dry-run` then `/apply` with the rows of one delivery day).
// Runs inside the nutrezee-api container like partner-daily-feed.mjs, with its own temporary
// super-admin so it never collides with the Partner feed that runs every 30 minutes.
// The importer only adds or updates the rows it is given; it never removes another source's days.
import crypto from 'node:crypto';
import fs from 'node:fs';

const API = process.env.API || 'http://127.0.0.1:3000';
const DB = process.env.DATABASE_URL;
const TEMP_EMAIL = 'wa-sync-temp@nutrezee.local';
const MODE = (process.env.FEED_MODE || 'dry-run').toLowerCase();
const INPUT = process.env.WA_INPUT;
const log = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));

if (!['dry-run', 'apply'].includes(MODE)) { log({ fatal: 'FEED_MODE must be dry-run or apply' }); process.exit(2); }
if (MODE === 'apply' && (process.env.ALLOW_APPLY || '').toLowerCase() !== 'yes') { log({ fatal: 'set ALLOW_APPLY=yes to apply' }); process.exit(2); }
if (!DB || !INPUT) { log({ fatal: 'DATABASE_URL and WA_INPUT required' }); process.exit(2); }

const source = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
const date = source.delivery_date;
if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Array.isArray(source.rows)) { log({ fatal: 'invalid input' }); process.exit(2); }
const rows = source.rows.map((r) => ({
  legacy_id: `${r.order_number}:${date}`,
  order_number: r.order_number,
  delivery_date: date,
  customer_ref: `WA-${r.ref}`,
  customer_name: r.customer_name,
  customer_phone: r.customer_phone,
  address_text: r.address_text || r.area || 'Unknown area',
  area_en: r.area || null,
  area_ar: null,
  location_pin: null,
  order_status: 'success',
  delivery_status: 'scheduled',
  is_cancelled: false,
  is_on_hold: false,
  meal_item_count: 0,
  delivery_method: null,
  delivery_time: null,
  partner_driver_id: null,
  partner_driver_name: null,
  source_delivery_ids: [],
  updated_at: date,
}));
if (rows.length === 0) { log({ event: 'wa_label_feed_complete', date, rows: 0, failures: 0 }); process.exit(0); }

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
    await client.query(`INSERT INTO staff_user (id,name_en,email,password_hash,created_by) VALUES ($1,'TEMP WhatsApp Label Sync',$2,$3,'sync')`, [tempId, TEMP_EMAIL, h]);
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
async function call(step) {
  const r = await fetch(`${API}/imports/partner_daily/${step}`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ rows }),
  });
  const body = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, report: body } : { ok: false, status: r.status, error: body };
}
const summarize = (report) => ({
  batch_id: report.batchId, dry_run: report.dryRun, counts: report.counts,
  errors: report.rows.filter((x) => x.action === 'error').map((x) => ({ row: x.rowNo, messages: x.messages })).slice(0, 20),
  locked_days: report.rows.filter((x) => x.messages.includes('day_locked')).length,
  days_created: report.rows.filter((x) => x.messages.includes('day_created')).length,
  days_updated: report.rows.filter((x) => x.messages.includes('day_updated')).length,
});

await client.connect();
let failures = 0;
try {
  await bootstrapTemp();
  const dry = await call('dry-run');
  if (!dry.ok) { failures += 1; log({ event: 'wa_label_feed_failed', date, stage: 'dry_run', status: dry.status, error: dry.error }); }
  else {
    const s = summarize(dry.report);
    log({ event: 'wa_label_feed_dry_run', date, ...s });
    const changed = (s.counts?.created ?? 0) > 0 || s.days_created > 0 || s.days_updated > 0;
    if (MODE === 'apply' && changed) {
      const applied = await call('apply');
      if (!applied.ok) { failures += 1; log({ event: 'wa_label_feed_failed', date, stage: 'apply', status: applied.status, error: applied.error }); }
      else log({ event: 'wa_label_feed_applied', date, ...summarize(applied.report) });
    } else if (MODE === 'apply') log({ event: 'wa_label_feed_unchanged', date });
  }
} finally {
  await deleteTemp().catch((e) => log({ warn: 'temp admin cleanup failed', message: String(e) }));
  await client.end();
}
log({ event: 'wa_label_feed_complete', date, mode: MODE, rows: rows.length, failures });
process.exit(failures === 0 ? 0 : 1);
