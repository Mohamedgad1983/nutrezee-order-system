#!/usr/bin/env node
// Runs INSIDE the nutrezee-api container (has pg, @node-rs/argon2, ulid, DATABASE_URL).
// Bootstraps a TEMPORARY dedicated import super-admin with an in-process-generated password
// (never printed, never written to disk), logs in, and runs the governed M19 catalog import.
// `cleanup` deletes the temp admin. Staging only. No secrets in output.
//
// Usage: node import-runner.mjs <dry-run|apply|cleanup> [productsJsonlPath]
import pg from 'pg';
import { hash } from '@node-rs/argon2';
import { ulid } from 'ulid';
import crypto from 'node:crypto';
import fs from 'node:fs';

const API = process.env.API || 'http://127.0.0.1:3000';
const DB = process.env.DATABASE_URL;
const MODE = process.argv[2] || 'dry-run';
const SRC = process.argv[3] || '/srv/products.jsonl';
const TEMP_EMAIL = 'import-temp@nutrezee.local';
const TEMP_NAME = 'TEMP Import Admin (delete after migration)';
const CHUNK = 250;

const client = new pg.Client({ connectionString: DB });
await client.connect();
const log = (o) => console.log(JSON.stringify(o));

async function upsertTempAdmin(password) {
  const pwd = await hash(password);
  const ex = await client.query('SELECT id FROM staff_user WHERE email=$1', [TEMP_EMAIL]);
  await client.query('BEGIN');
  try {
    let id;
    if (ex.rowCount > 0) {
      id = ex.rows[0].id;
      await client.query('UPDATE staff_user SET password_hash=$1, active=true, failed_logins=0, updated_by=$2, updated_at=now() WHERE id=$3', [pwd, 'import-bootstrap', id]);
    } else {
      id = ulid();
      await client.query(`INSERT INTO staff_user (id, name_en, email, password_hash, created_by) VALUES ($1,$2,$3,$4,'import-bootstrap')`, [id, TEMP_NAME, TEMP_EMAIL, pwd]);
      await client.query(`INSERT INTO role_assignment (id, staff_id, role_id, assigned_by) SELECT $1,$2,id,'import-bootstrap' FROM role WHERE code='super_admin'`, [ulid(), id]);
      await client.query(`INSERT INTO audit_event (id, event_type, actor_role, entity_type, entity_id, severity, after) VALUES ($1,'staff.created','system','staff_user',$2,'high',$3)`, [ulid(), id, JSON.stringify({ temp_import_admin: true, role: 'super_admin' })]);
    }
    await client.query('COMMIT');
    return id;
  } catch (e) { await client.query('ROLLBACK'); throw e; }
}

async function cleanup() {
  const ex = await client.query('SELECT id FROM staff_user WHERE email=$1', [TEMP_EMAIL]);
  if (ex.rowCount === 0) { log({ cleanup: 'no temp admin found' }); return; }
  const id = ex.rows[0].id;
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM role_assignment WHERE staff_id=$1', [id]);
    await client.query('DELETE FROM session WHERE staff_id=$1', [id]);
    await client.query(`INSERT INTO audit_event (id, event_type, actor_role, entity_type, entity_id, severity, after) VALUES ($1,'staff.deleted','system','staff_user',$2,'high',$3)`, [ulid(), id, JSON.stringify({ temp_import_admin_removed: true })]);
    await client.query('DELETE FROM staff_user WHERE id=$1', [id]);
    await client.query('COMMIT');
    log({ cleanup: 'temp admin DELETED', id });
  } catch (e) {
    await client.query('ROLLBACK');
    await client.query('UPDATE staff_user SET active=false WHERE id=$1', [id]);
    log({ cleanup: 'temp admin DEACTIVATED (delete blocked by FK)', id, note: e.message });
  }
}

let cookie = '';
async function login(password) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: TEMP_EMAIL, password }) });
  if (!r.ok) throw new Error(`login ${r.status} ${(await r.text()).slice(0, 100)}`);
  const scs = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || ''];
  cookie = (scs.find((c) => c.includes('nz_session')) || '').split(';')[0];
  if (!cookie) throw new Error('no nz_session cookie');
}

function buildProductRows(src) {
  const out = []; let skip = 0; const seen = new Set();
  for (const line of fs.readFileSync(src, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const p = JSON.parse(line);
    if (p.legacy_id == null || p.legacy_id === '') { skip++; continue; }
    const name = String(p.name_en ?? '').trim();
    if (!name) { skip++; continue; }
    const key = String(p.legacy_id);
    if (seen.has(key)) { skip++; continue; }
    seen.add(key);
    // createProduct requires both names non-empty; fall back to EN when AR is blank ("" or null)
    const nameAr = String(p.name_ar ?? '').trim() || name;
    out.push({ kind: 'product', legacy_id: key, name, name_ar: nameAr });
  }
  return { rows: out, skip };
}

async function callImport(type, mode, rows) {
  const r = await fetch(`${API}/imports/${type}/${mode}`, { method: 'POST', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ rows }) });
  const t = await r.text();
  let b; try { b = JSON.parse(t); } catch { b = { raw: t.slice(0, 300) }; }
  if (!r.ok) throw new Error(`import ${r.status}: ${JSON.stringify(b).slice(0, 300)}`);
  return b;
}

try {
  if (MODE === 'cleanup') { await cleanup(); await client.end(); process.exit(0); }
  const password = crypto.randomBytes(24).toString('base64url'); // in-process only
  const adminId = await upsertTempAdmin(password);
  await login(password);
  log({ step: 'auth', temp_admin_id: adminId, logged_in: true });

  const { rows, skip } = buildProductRows(SRC);
  log({ step: 'normalize', product_rows: rows.length, skipped: skip });

  const agg = { created: 0, matched: 0, error: 0, skipped: 0, merge_review: 0 };
  const batches = []; const errs = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const b = await callImport('catalog', MODE === 'apply' ? 'apply' : 'dry-run', rows.slice(i, i + CHUNK));
    if (i === 0) log({ first_response_shape: Object.keys(b), first_counts: b.counts ?? null });
    const c = b.counts || b;
    for (const k of Object.keys(agg)) if (typeof c[k] === 'number') agg[k] += c[k];
    if (b.id) batches.push(b.id);
    for (const rr of (b.rows || [])) if (rr.action === 'error') errs.push({ rowNo: i + (rr.rowNo ?? 0), messages: rr.messages });
  }
  log({ FINAL: true, mode: MODE, agg, batch_count: batches.length, error_sample: errs.slice(0, 10) });
} catch (e) {
  console.error('FATAL ' + e.message);
  await client.end();
  process.exit(1);
}
await client.end();
