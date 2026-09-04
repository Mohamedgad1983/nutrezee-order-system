#!/usr/bin/env node
// m23 dish-detail SCRAPE JOB — VPS-ONLY, READ-ONLY, DISABLED by default (built, not run).
// Captures the legacy dish CATALOG from the confirmed read-only endpoint `/orders/getMealsByType`
// (POST {meal_type_id, main_sub_package_id, req_date} -> selectable dishes HTML) into the m23 raw path.
// It NEVER calls mutation endpoints (addMealByAdmin/editMeal/deletemeal*/assignDriver), NEVER scrapes
// locally, NEVER touches production, NEVER prints credentials/cookies/PII. Output + manifest live on the
// VPS only and are NOT committed. Archiving raw into the m23 DB tables is a SEPARATE step
// (dish-detail-import.mjs). This is the catalog/menu layer — the per-customer assignment is NOT
// available from the captured grid (see docs/evidence/dish_per_day/01) and remains a discovery gap.
//
// Usage (VPS): SCRAPE_ON_VPS=1 LEGACY_BASE_URL=… LEGACY_ADMIN_EMAIL=… LEGACY_ADMIN_PASSWORD=… \
//   node dish-detail-scrape-job.mjs --mode dry-run|scrape --target staging --window sample \
//     --limit 5 --concurrency 1 --rate-limit-ms 1500 --resume --no-local \
//     --output-dir /opt/nutrezee/dish-per-day/raw --summary-json
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { dishSha } from './dish-detail-lib.mjs';

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) { const k = t.slice(2); const n = argv[i + 1];
      if (n === undefined || n.startsWith('--')) a[k] = true; else { a[k] = n; i++; } }
    else a._.push(t);
  }
  return a;
}
const args = parseArgs(process.argv.slice(2));
const MODE = String(args.mode || 'dry-run').toLowerCase();
const TARGET = String(args.target || process.env.SYNC_TARGET || '').toLowerCase();
const WINDOW = String(args.window || 'sample').toLowerCase();
const LIMIT = args.limit !== undefined ? Number(args.limit) : 5;
const CONCURRENCY = Math.max(1, Number(args.concurrency || 1));
const RATE_MS = Math.max(0, Number(args['rate-limit-ms'] || 1500));
const RESUME = !!args.resume;
const NO_LOCAL = !!args['no-local'];
const OUTPUT_DIR = String(args['output-dir'] || '/opt/nutrezee/dish-per-day/raw');
const SUMMARY_JSON = !!args['summary-json'];
const APPROVED_PREFIX = '/opt/nutrezee/dish-per-day';
const VPS_MARKER = '/opt/nutrezee';
const CONCURRENCY_CAP = 4;
const RUN_HISTORY = process.env.RUN_HISTORY || '/opt/nutrezee/dish-per-day/run-history.jsonl';
// params source: a JSONL of {meal_type_id, main_sub_package_id, req_date, order_id?, order_meal_id?}
const PARAMS_FILE = process.env.DISH_PARAMS_FILE || '/opt/nutrezee/dish-per-day/catalog-params.jsonl';

const BASE = (process.env.LEGACY_BASE_URL || '').replace(/\/$/, '');
const EMAIL = process.env.LEGACY_ADMIN_EMAIL || '';
const PASS = process.env.LEGACY_ADMIN_PASSWORD || '';
const log = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const refuse = (m) => { log({ fatal: `refused: ${m}` }); process.exit(2); };
const underApproved = (p, pre) => { const r = path.resolve(p); return r === pre || r.startsWith(pre + path.sep); };

// ---------- guards (no network, no secrets printed) ----------
if (!['dry-run', 'scrape'].includes(MODE)) refuse(`unknown --mode '${MODE}'`);
if (TARGET !== 'staging') refuse(`--target must be staging (got '${TARGET}') — no production`);
if (!['sample', 'last-7', 'last-30', 'last-90', 'last-year', 'custom'].includes(WINDOW)) refuse(`unknown --window '${WINDOW}'`);
if (!Number.isInteger(CONCURRENCY) || CONCURRENCY > CONCURRENCY_CAP) refuse(`--concurrency must be 1..${CONCURRENCY_CAP}`);
if (MODE === 'scrape') {
  if (!underApproved(OUTPUT_DIR, APPROVED_PREFIX)) refuse(`--output-dir must be under ${APPROVED_PREFIX}`);
  if (!NO_LOCAL) refuse('scrape requires --no-local (no local scraping)');
  if (!fs.existsSync(VPS_MARKER) || process.env.SCRAPE_ON_VPS !== '1') refuse(`cannot prove VPS context (need ${VPS_MARKER} + SCRAPE_ON_VPS=1)`);
  if (!BASE) refuse('missing LEGACY_BASE_URL');
  if (!EMAIL || !PASS) refuse('missing legacy credentials');
  const allow = (process.env.LEGACY_HOST_ALLOWLIST || 'nutreeze.com').split(',').map((h) => h.trim()).filter(Boolean);
  let host = ''; try { host = new URL(BASE).host.replace(/:\d+$/, ''); } catch { refuse('invalid LEGACY_BASE_URL'); }
  if (!allow.some((a) => host === a || host.endsWith('.' + a))) refuse(`legacy host '${host}' not in allowlist`);
}

// ---------- READ-ONLY allowlist (mutation endpoints are HARD-blocked) ----------
const READ_ALLOW = [/^\/orders\/getMealsByType$/, /^\/orders\/getMealsDateWiseFilter\/all\/\d+$/];
const MUTATION_DENY = /addMealByAdmin|editMeal|deletemeal|deletemealproduct|deletewholedaymeal|assignDriver|saveMeal|updateMeal/i;
let cookie = '';
async function login() {
  const r = await fetch(`${BASE}/logincheck`, { method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'nutrezee-migration-readonly' },
    body: new URLSearchParams({ email_address: EMAIL, password: PASS }).toString() });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || ''];
  cookie = sc.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
  if (!cookie) throw new Error('login failed: no session cookie');  // never logs the cookie
}
async function getCatalog(p) {
  if (MUTATION_DENY.test(p.endpoint)) throw new Error('BLOCKED mutation endpoint');
  if (!READ_ALLOW.some((re) => re.test(p.endpoint))) throw new Error('BLOCKED non-allowlisted endpoint');
  const r = await fetch(`${BASE}${p.endpoint}`, { method: 'POST',
    headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ meal_type_id: String(p.meal_type_id ?? ''),
      main_sub_package_id: String(p.main_sub_package_id ?? ''), req_date: String(p.req_date ?? '') }).toString() });
  return { status: r.status, body: await r.text() };
}

function loadParams() {
  if (!fs.existsSync(PARAMS_FILE)) return [];
  const out = [];
  for (const line of fs.readFileSync(PARAMS_FILE, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try { const r = JSON.parse(line); r.endpoint = '/orders/getMealsByType'; out.push(r); } catch { /* skip */ }
  }
  return out;
}

const summary = { job: 'dish-detail-scrape', mode: MODE, target: TARGET, window: WINDOW, output_dir: OUTPUT_DIR,
  records_candidate: 0, requests_attempted: 0, requests_success: 0, requests_failed: 0, raw_files_written: 0,
  duplicate_skipped: 0, concurrency: CONCURRENCY, rate_limit_ms: RATE_MS, duration_ms: 0, errors: [], ok: false };
const t0 = Date.now();

function finish() {
  summary.duration_ms = Date.now() - t0;
  summary.ok = summary.requests_failed === 0 && summary.errors.length === 0;
  console.log('SUMMARY ' + JSON.stringify(summary));
  if (RUN_HISTORY && fs.existsSync(VPS_MARKER)) {
    try { fs.mkdirSync(path.dirname(RUN_HISTORY), { recursive: true }); fs.appendFileSync(RUN_HISTORY, JSON.stringify(summary) + '\n'); } catch { /* best effort */ }
  }
  if (SUMMARY_JSON) console.log(JSON.stringify(summary));
  process.exit(summary.ok ? 0 : 1);
}

try {
  let params = loadParams();
  if (Number.isFinite(LIMIT)) params = params.slice(0, LIMIT);
  summary.records_candidate = params.length;
  if (MODE === 'dry-run') { summary.ok = summary.errors.length === 0; finish(); }
  else {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    await login();
    let idx = 0;
    async function worker() {
      while (idx < params.length) {
        const p = params[idx++];
        const key = `${p.meal_type_id}_${p.main_sub_package_id}_${p.req_date}`;
        const fnameGlob = `catalog_${key}_`;
        if (RESUME && fs.readdirSync(OUTPUT_DIR).some((f) => f.startsWith(fnameGlob))) { summary.duplicate_skipped += 1; continue; }
        summary.requests_attempted += 1;
        try {
          const res = await getCatalog(p);
          if (res.status !== 200) { summary.requests_failed += 1; }
          else {
            summary.requests_success += 1;
            const sha = dishSha(res.body);
            fs.writeFileSync(path.join(OUTPUT_DIR, `${fnameGlob}${sha.slice(0, 8)}.html.gz`), zlib.gzipSync(Buffer.from(res.body, 'utf8')));
            summary.raw_files_written += 1;
          }
        } catch (e) { summary.requests_failed += 1; summary.errors.push(String(e.message || e).slice(0, 40)); }
        if (RATE_MS) await sleep(RATE_MS);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, params.length) || 1 }, worker));
    finish();
  }
} catch (e) { summary.errors.push(String(e.message || e)); finish(); }
