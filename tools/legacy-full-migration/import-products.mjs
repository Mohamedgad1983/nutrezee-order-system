#!/usr/bin/env node
// Import the legacy product catalog into STAGING via the governed M19 catalog importer
// (POST /imports/catalog/{dry-run|apply}). Idempotent (sync_record('product', 'product:<id>')).
// Staging only. Credentials from env only (NEW_ADMIN_EMAIL/PASSWORD, API). Never logs secrets.
//
// Usage: node import-products.mjs <peek|dry-run|apply> <products.jsonl>
//   peek    = POST one 3-row chunk to dry-run and print the raw response (contract check)
//   dry-run = full dry-run, aggregate counts, no writes
//   apply   = full apply (only run after a clean dry-run)
import fs from 'node:fs';

const API = process.env.API || 'http://127.0.0.1:3000';
const EMAIL = process.env.NEW_ADMIN_EMAIL, PASS = process.env.NEW_ADMIN_PASSWORD;
const MODE = process.argv[2] || 'dry-run';
const SRC = process.argv[3] || '/work/legacy-detail-2026/out/products.jsonl';
const CHUNK = 250;

let cookie = '';
async function login() {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`login ${r.status}`);
  const scs = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || ''];
  cookie = (scs.find((c) => c.includes('nz_session')) || '').split(';')[0];
  if (!cookie) throw new Error('no nz_session cookie');
  console.log(JSON.stringify({ step: 'login', ok: true, roles: JSON.parse(txt).roles }));
}

function buildRows() {
  const out = [];
  let skippedNoId = 0, skippedNoName = 0;
  for (const line of fs.readFileSync(SRC, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const p = JSON.parse(line);
    if (p.legacy_id == null || p.legacy_id === '') { skippedNoId++; continue; }
    const name = String(p.name_en ?? '').trim();
    if (!name) { skippedNoName++; continue; }
    out.push({ kind: 'product', legacy_id: String(p.legacy_id), name, name_ar: String(p.name_ar ?? name).trim() });
  }
  console.log(JSON.stringify({ step: 'normalize', rows: out.length, skipped_no_id: skippedNoId, skipped_no_name: skippedNoName }));
  return out;
}

async function call(mode, rows) {
  const r = await fetch(`${API}/imports/catalog/${mode}`, {
    method: 'POST', headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ rows }),
  });
  const t = await r.text();
  let body; try { body = JSON.parse(t); } catch { body = { raw: t.slice(0, 400) }; }
  if (!r.ok) throw new Error(`import ${r.status}: ${JSON.stringify(body).slice(0, 400)}`);
  return body;
}

function mergeCounts(agg, body) {
  const c = body.counts || body.summary || body;
  for (const k of ['created', 'matched', 'error', 'skipped', 'merge_review']) {
    if (typeof c[k] === 'number') agg[k] = (agg[k] || 0) + c[k];
  }
  return body.id || body.batchId || null;
}

(async () => {
  await login();
  const rows = buildRows();

  if (MODE === 'peek') {
    const res = await call('dry-run', rows.slice(0, 3));
    console.log(JSON.stringify({ PEEK_RESPONSE: res }, null, 2));
    return;
  }

  const mode = MODE === 'apply' ? 'apply' : 'dry-run';
  const agg = { created: 0, matched: 0, error: 0, skipped: 0, merge_review: 0 };
  const batches = []; const errorSamples = [];
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const body = call ? await call(mode, chunk) : null;
    const id = mergeCounts(agg, body);
    if (id) batches.push(id);
    const rr = body.rows || body.results || [];
    for (const row of rr) if (row.action === 'error') errorSamples.push({ rowNo: i + (row.rowNo ?? 0), messages: row.messages });
    console.log(JSON.stringify({ mode, done: Math.min(i + CHUNK, rows.length), agg }));
  }
  console.log(JSON.stringify({ FINAL: true, mode, agg, batch_count: batches.length, batches: batches.slice(0, 3), error_sample: errorSamples.slice(0, 10) }));
})().catch((e) => { console.error('FATAL ' + e.message); process.exit(1); });
