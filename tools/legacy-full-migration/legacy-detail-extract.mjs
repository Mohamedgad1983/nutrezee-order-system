#!/usr/bin/env node
// Read-only legacy detail extractor for the missing P0 data (order line items,
// delivery, product catalog). GET-ONLY against the live nutreeze.com admin, throttled,
// resumable. Captures raw HTML (for lossless re-parse) + a best-effort structured parse.
//
// SAFETY (hard rules, enforced below):
//  - Only GETs an allowlisted set of read paths + the single login POST. Any other URL throws.
//  - Never calls mutation endpoints (addMealByAdmin/deletemeal/editMeal/assignDriver/...).
//  - Credentials come from env only (LEGACY_BASE, LEGACY_EMAIL, LEGACY_PASS). Never logged.
//  - Raw payloads (PII) are written locally gzipped; never commit them.
//
// Usage:
//   LEGACY_BASE=https://nutreeze.com LEGACY_EMAIL=... LEGACY_PASS=... \
//   OUT=/path/out node legacy-detail-extract.mjs <mode>
//   mode = products | orders-index | orders-detail | all
//   env: THROTTLE_MS (default 1200), STATUSES (csv, default Active,Expire,Pause,cancel,pending),
//        LIMIT (cap orders-detail count, for smoke tests), PAGE_LEN (ajax page size, default 500)

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const BASE = (process.env.LEGACY_BASE || 'https://nutreeze.com').replace(/\/$/, '');
const EMAIL = process.env.LEGACY_EMAIL || '';
const PASS = process.env.LEGACY_PASS || '';
const OUT = process.env.OUT || './legacy-detail-out';
const THROTTLE_MS = Number(process.env.THROTTLE_MS || 1200);
const PAGE_LEN = Number(process.env.PAGE_LEN || 500);
const LIMIT = process.env.LIMIT ? Number(process.env.LIMIT) : Infinity;
const STATUSES = (process.env.STATUSES || 'Active,Expire,Pause,cancel,pending').split(',').map((s) => s.trim()).filter(Boolean);
const FETCH_MEALS = process.env.FETCH_MEALS === '1';
const MEALS_SAMPLE = Number(process.env.MEALS_SAMPLE || 25);
const MODE = process.argv[2] || 'all';

// GET allowlist — only these read paths may be fetched (plus the login POST).
const GET_ALLOW = [
  /^\/products(\?.*)?$/,
  /^\/orders\/ajaxlist\/[A-Za-z]+(\?.*)?$/,
  /^\/orders\/view\/\d+(\?.*)?$/,
  /^\/orders\/getMealsDateWiseFilter\/all\/\d+(\?.*)?$/,
];

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(path.join(OUT, 'raw'), { recursive: true });
const LOG = path.join(OUT, 'extract.log');
const log = (o) => { const line = JSON.stringify({ t: new Date().toISOString(), ...o }); fs.appendFileSync(LOG, line + '\n'); console.log(line); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 16);
const gzWrite = (p, s) => fs.writeFileSync(p, zlib.gzipSync(Buffer.from(s, 'utf8')));
const appendJsonl = (f, obj) => fs.appendFileSync(path.join(OUT, f), JSON.stringify(obj) + '\n');

let COOKIE = '';
function assertAllowed(p) {
  if (!GET_ALLOW.some((re) => re.test(p))) throw new Error(`BLOCKED non-allowlisted GET: ${p}`);
}
async function get(p, { tries = 3 } = {}) {
  assertAllowed(p);
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(BASE + p, { headers: { cookie: COOKIE, 'user-agent': 'nutrezee-migration-readonly' }, redirect: 'follow' });
      const body = await r.text();
      if (r.status === 200) return body;
      if (r.status === 401 || r.status === 403 || /logincheck|email_address/i.test(body)) { await login(); continue; }
      throw new Error(`http ${r.status}`);
    } catch (e) {
      if (i === tries) throw e;
      await sleep(THROTTLE_MS * 2 * i);
    }
  }
}
async function login() {
  if (!EMAIL || !PASS) throw new Error('LEGACY_EMAIL / LEGACY_PASS not set');
  const body = new URLSearchParams({ email_address: EMAIL, password: PASS }).toString();
  const r = await fetch(BASE + '/logincheck', {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: COOKIE, 'user-agent': 'nutrezee-migration-readonly' },
    body,
  });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || ''];
  const jar = sc.map((c) => c.split(';')[0]).filter(Boolean);
  if (jar.length) COOKIE = jar.join('; ');
  log({ login: true, ok: !!COOKIE }); // never logs creds
}

// ---- parsers (best-effort; raw HTML is the lossless source of truth) ----
const stripTags = (s) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
function parseProductsRows(html) {
  // inline tbody rows: No | Name EN | Name AR | Category | Associate Packages | Status | Operation(action w/ id)
  const out = [];
  const tbody = (html.match(/<tbody[\s\S]*?<\/tbody>/i) || [html])[0];
  const rows = tbody.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  for (const row of rows) {
    const cells = (row.match(/<td[\s\S]*?<\/td>/gi) || []).map((c) => stripTags(c));
    const idm = row.match(/\/product\/[a-zA-Z]+\/(\d+)/);
    if (cells.length >= 5) out.push({ legacy_id: idm ? idm[1] : null, no: cells[0], name_en: cells[1], name_ar: cells[2], category: cells[3], packages: cells[4], status: cells[5] || null });
  }
  return out;
}
function parseAjaxOrderRows(json) {
  const data = JSON.parse(json);
  const rows = data.data || [];
  return rows.map((r) => {
    const action = String(r[15] || r[r.length - 1] || '');
    const idm = action.match(/\/orders\/view\/(\d+)/);
    // r[2] = "Name[ phone ]" — needed for WhatsApp renewal segmentation (phone is the
    // operational key, name personalizes the message). PII -> output stays outside the repo.
    const cust = stripTags(String(r[2] ?? ''));
    const cm = cust.match(/^(.*?)\s*\[\s*(\+?[\d][\d\s]*)\s*\]\s*$/);
    return {
      order_number: String(r[1] ?? ''),
      internal_id: idm ? idm[1] : null,
      customer_name: cm ? cm[1].trim() : (cust || null),
      customer_phone: cm ? cm[2].replace(/\s+/g, '') : null,
      package: String(r[3] ?? ''), subpackage: String(r[4] ?? ''),
      start: String(r[5] ?? ''), end: String(r[6] ?? ''), order_date: String(r[7] ?? ''),
      txn: String(r[8] ?? ''), order_type: String(r[9] ?? ''),
      payment_status: stripTags(String(r[10] ?? '')), order_status: stripTags(String(r[11] ?? '')),
      amt_a: String(r[13] ?? ''), amt_b: String(r[14] ?? ''),
    };
  });
}
function parseOrderView(html) {
  const txt = html.replace(/\r/g, '');
  const esc = (l) => l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // delivery block is rendered inline as "Label : value" (value runs until next tag)
  const inline = (label) => {
    const m = txt.match(new RegExp(esc(label) + '\\s*:\\s*([^<\\n]{0,80})', 'i'));
    return m ? m[1].replace(/&nbsp;/g, ' ').trim() || null : null;
  };
  // payment block is a header/value table: <th>Label</th><td>value</td>
  const cell = (label) => {
    const m = txt.match(new RegExp('>\\s*' + esc(label) + '\\s*:?\\s*<\\/t[hd]>\\s*<td[^>]*>([^<]{0,80})', 'i'));
    return m ? stripTags(m[1]) || null : null;
  };
  return {
    delivery_method: inline('Delivery Method'),
    delivery_time: inline('Delivery Time'),
    area: inline('Area'),
    driver: inline('Driver'),
    payment_method: cell('Payment method') || inline('Payment method'),
    amount_charged: cell('Amount charged') || inline('Amount charged'),
    payment_date: cell('Payment date') || inline('Payment date'),
    transaction_id: cell('Transaction Id') || cell('Transaction ID'),
    has_allergy_block: /allerg/i.test(txt),
  };
}
function parseMeals(html) {
  // server-rendered meals grid; capture coverage signals (raw is lossless)
  const dates = [...new Set((html.match(/\b\d{4}-\d{2}-\d{2}\b/g) || []))];
  const mealTypes = [...new Set((html.match(/\b(breakfast|lunch|dinner|snack|Snack|Breakfast|Lunch|Dinner)\b/g) || []).map((s) => s.toLowerCase()))];
  return { distinct_dates: dates.length, meal_types: mealTypes };
}

// ---- modes ----
async function doProducts() {
  const html = await get('/products');
  gzWrite(path.join(OUT, 'raw', 'products.html.gz'), html);
  const rows = parseProductsRows(html);
  fs.writeFileSync(path.join(OUT, 'products.jsonl'), '');
  for (const p of rows) appendJsonl('products.jsonl', { legacy_source: BASE, legacy_entity: 'product', legacy_id: p.legacy_id, extracted_at: new Date().toISOString(), source_checksum: sha(JSON.stringify(p)), ...p });
  log({ products_extracted: rows.length });
  return rows.length;
}
async function doOrdersIndex() {
  fs.writeFileSync(path.join(OUT, 'orders_index.jsonl'), '');
  let total = 0;
  for (const status of STATUSES) {
    let start = 0, statusTotal = null;
    for (;;) {
      const qs = `?draw=1&start=${start}&length=${PAGE_LEN}`;
      const json = await get(`/orders/ajaxlist/${status}${qs}`);
      let parsed; try { parsed = JSON.parse(json); } catch { log({ status, start, parse_error: true }); break; }
      if (statusTotal == null) statusTotal = parsed.recordsTotal ?? 0;
      const rows = parseAjaxOrderRows(json);
      for (const r of rows) appendJsonl('orders_index.jsonl', { legacy_source: BASE, legacy_entity: 'order_index', status, extracted_at: new Date().toISOString(), source_checksum: sha(r.order_number + '|' + r.internal_id), ...r });
      total += rows.length; start += rows.length;
      log({ status, fetched: start, of: statusTotal });
      if (!rows.length || start >= statusTotal) break;
      await sleep(THROTTLE_MS);
    }
  }
  log({ orders_index_total: total });
  return total;
}
function loadDoneSet() {
  const f = path.join(OUT, 'order_detail.jsonl');
  const done = new Set();
  if (fs.existsSync(f)) for (const line of fs.readFileSync(f, 'utf8').split('\n')) { if (!line) continue; try { const o = JSON.parse(line); if (o.internal_id) done.add(o.internal_id); } catch { /* skip */ } }
  return done;
}
async function doOrdersDetail() {
  const idxFile = path.join(OUT, 'orders_index.jsonl');
  if (!fs.existsSync(idxFile)) throw new Error('run orders-index first');
  const ids = [];
  for (const line of fs.readFileSync(idxFile, 'utf8').split('\n')) { if (!line) continue; try { const o = JSON.parse(line); if (o.internal_id) ids.push(o.internal_id); } catch { /* skip */ } }
  const uniq = [...new Set(ids)];
  const done = loadDoneSet();
  let n = 0, processed = 0;
  for (const id of uniq) {
    if (done.has(id)) continue;
    if (processed >= LIMIT) break;
    processed++;
    try {
      const view = await get(`/orders/view/${id}`);
      gzWrite(path.join(OUT, 'raw', `view_${id}.html.gz`), view);
      // Per-day meals are ajax-gated (no clean line items in static HTML) — capturing
      // the raw meals page only for a sample documents that; FETCH_MEALS=1 forces all.
      let meals = null;
      if (FETCH_MEALS || n < MEALS_SAMPLE) {
        await sleep(THROTTLE_MS);
        const mhtml = await get(`/orders/getMealsDateWiseFilter/all/${id}`);
        gzWrite(path.join(OUT, 'raw', `meals_${id}.html.gz`), mhtml);
        meals = parseMeals(mhtml);
      }
      const rec = { legacy_source: BASE, legacy_entity: 'order_detail', internal_id: id, extracted_at: new Date().toISOString(),
        view: parseOrderView(view), meals, source_checksum: sha(view) };
      appendJsonl('order_detail.jsonl', rec);
      n++;
      if (n % 50 === 0) log({ order_detail_done: n, current: id });
    } catch (e) {
      appendJsonl('order_detail_errors.jsonl', { internal_id: id, error: String(e.message || e), at: new Date().toISOString() });
      log({ id, error: String(e.message || e) });
    }
    await sleep(THROTTLE_MS);
  }
  log({ order_detail_extracted: n });
  return n;
}

(async () => {
  await login();
  if (MODE === 'products' || MODE === 'all') await doProducts();
  if (MODE === 'orders-index' || MODE === 'all') await doOrdersIndex();
  if (MODE === 'orders-detail' || MODE === 'all') await doOrdersDetail();
  log({ done: true, mode: MODE });
})().catch((e) => { log({ fatal: String(e.message || e) }); process.exit(1); });
