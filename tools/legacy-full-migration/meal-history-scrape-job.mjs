#!/usr/bin/env node
// m22 meal-history SCRAPE JOB — VPS-ONLY (Phase 4). Reads candidate orders (window-filtered),
// fetches the legacy date-wise meal grid GET /orders/getMealsDateWiseFilter/all/<internal_id>, and
// stores raw compressed artifacts + a counts-only manifest on a VPS-approved path. It NEVER scrapes
// the secondary per-dish getMeals endpoint, NEVER writes the legacy system, NEVER runs locally,
// NEVER logs credentials/cookies/PII. Raw artifacts (which DO contain PII) live on the VPS and are
// NOT committed; the manifest + run-history carry ids/counts only.
//
// GET-only allowlist + login + throttle + resume mirror legacy-detail-extract.mjs (the proven, safe
// extractor). Archiving raw into the m22 DB tables is a SEPARATE step (meal-history-import.mjs).
//
// Usage (VPS):
//   SCRAPE_ON_VPS=1 LEGACY_BASE_URL=… LEGACY_ADMIN_EMAIL=… LEGACY_ADMIN_PASSWORD=… \
//   node meal-history-scrape-job.mjs --mode dry-run|scrape|archive-only --target staging \
//     --window last-90 --limit 10 --concurrency 1 --rate-limit-ms 1200 --resume --no-local \
//     --orders-source extract --output-dir /opt/nutrezee/legacy-meal-history/raw --summary-json
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseMealGrid, mealSha, normalizeDate } from './meal-history-lib.mjs';

// ---------- arg parsing ----------
function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t.startsWith('--')) {
      const key = t.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) a[key] = true;        // boolean flag
      else { a[key] = next; i++; }
    } else a._.push(t);
  }
  return a;
}
const args = parseArgs(process.argv.slice(2));
const MODE = String(args.mode || 'dry-run').toLowerCase();
const TARGET = String(args.target || process.env.SYNC_TARGET || '').toLowerCase();
const WINDOW = String(args.window || 'last-90').toLowerCase();
const LIMIT = args.limit !== undefined ? Number(args.limit) : Infinity;
const CONCURRENCY = Math.max(1, Number(args.concurrency || 1));
const RATE_MS = Math.max(0, Number(args['rate-limit-ms'] || 1200));
const RESUME = !!args.resume;
const NO_LOCAL = !!args['no-local'];
const ORDERS_SOURCE = String(args['orders-source'] || 'extract').toLowerCase();
const OUTPUT_DIR = String(args['output-dir'] || '/opt/nutrezee/legacy-meal-history/raw');
const SUMMARY_JSON = !!args['summary-json'];
const ORDERS_INDEX = process.env.ORDERS_INDEX || '/opt/nutrezee/legacy-detail-2026/out/orders_index.jsonl';
const RUN_HISTORY = process.env.RUN_HISTORY || '/opt/nutrezee/legacy-meal-history/run-history.jsonl';
const APPROVED_PREFIX = '/opt/nutrezee/legacy-meal-history';
const VPS_MARKER = '/opt/nutrezee';
const CONCURRENCY_CAP = 4;

const BASE = (process.env.LEGACY_BASE_URL || process.env.LEGACY_BASE || '').replace(/\/$/, '');
const EMAIL = process.env.LEGACY_ADMIN_EMAIL || process.env.LEGACY_EMAIL || '';
const PASS = process.env.LEGACY_ADMIN_PASSWORD || process.env.LEGACY_PASS || '';

const log = (o) => console.log(JSON.stringify({ t: new Date().toISOString(), ...o }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const refuse = (msg) => { log({ fatal: `refused: ${msg}` }); process.exit(2); };

// safe-path check: resolved path must equal an approved prefix or sit strictly under it (defeats
// `..` traversal and sibling-prefix tricks like `<prefix>-EXFIL`).
const underApproved = (p, prefix) => {
  const r = path.resolve(p);
  return r === prefix || r.startsWith(prefix + path.sep);
};

// ---------- guards (no network, no secrets printed) ----------
// Always-on guards (apply to every mode):
if (!['dry-run', 'scrape', 'archive-only'].includes(MODE)) refuse(`unknown --mode '${MODE}'`);
if (!TARGET) refuse('missing --target (must be staging)');
if (TARGET !== 'staging') refuse(`--target must be staging (got '${TARGET}') — no production`);
if (!['last-30', 'last-90', 'custom', 'last-year', 'full', 'all'].includes(WINDOW)) refuse(`unknown --window '${WINDOW}'`);
if (!Number.isInteger(CONCURRENCY) || CONCURRENCY < 1) refuse(`--concurrency must be a positive integer (got '${args.concurrency}')`);
if (CONCURRENCY > CONCURRENCY_CAP) refuse(`--concurrency ${CONCURRENCY} exceeds safe cap ${CONCURRENCY_CAP}`);
// Effective-window bound: ANY effectively-unbounded or wide window (including via --since / unknown
// span) needs ALLOW_FULL_HISTORY_SCRAPE — the gate is on the COMPUTED span, not the window label.
const WIN = windowDates();
const SPAN_CAP_DAYS = 100;
const spanDays = (WIN.from && WIN.to) ? Math.round((Date.parse(WIN.to) - Date.parse(WIN.from)) / 86_400_000) : null;
if ((WIN.from === null || spanDays === null || spanDays > SPAN_CAP_DAYS) && process.env.ALLOW_FULL_HISTORY_SCRAPE !== '1') {
  refuse(`effective window too wide (span=${spanDays ?? 'unbounded'}d > ${SPAN_CAP_DAYS}d) — requires ALLOW_FULL_HISTORY_SCRAPE=1 (no full-history scrape)`);
}
// RUN_HISTORY is written in every mode (incl. dry-run) — it must be under the approved VPS tree, else
// it is a counts-only file in CWD only when off-VPS (see finish(): off-VPS writes are skipped).
if (RUN_HISTORY && fs.existsSync(VPS_MARKER) && !underApproved(RUN_HISTORY, VPS_MARKER)) {
  refuse(`RUN_HISTORY must be under ${VPS_MARKER} on the VPS (got '${RUN_HISTORY}')`);
}
// FS/network-touching modes (scrape, archive-only) must prove VPS context + approved output path.
// dry-run only selects + counts candidates (no fetch) so it runs anywhere.
const TOUCHES_FS = MODE === 'scrape' || MODE === 'archive-only';
if (TOUCHES_FS) {
  if (!underApproved(OUTPUT_DIR, APPROVED_PREFIX)) refuse(`--output-dir must be under ${APPROVED_PREFIX} (got '${OUTPUT_DIR}')`);
  if (!NO_LOCAL) refuse('scrape/archive requires --no-local (no local scraping)');
  if (!fs.existsSync(VPS_MARKER) || process.env.SCRAPE_ON_VPS !== '1') {
    refuse(`cannot prove VPS context (need ${VPS_MARKER} present AND SCRAPE_ON_VPS=1) — no local scraping`);
  }
}
if (MODE === 'scrape') {
  if (!BASE) refuse('missing legacy base URL (LEGACY_BASE_URL)');
  if (!EMAIL || !PASS) refuse('missing legacy credentials (LEGACY_ADMIN_EMAIL / LEGACY_ADMIN_PASSWORD)');
  // pin the legacy host — the --target label alone must not be trusted to keep us off an arbitrary host
  const allow = (process.env.LEGACY_HOST_ALLOWLIST || 'nutreeze.com').split(',').map((h) => h.trim()).filter(Boolean);
  let host = '';
  try { host = new URL(BASE).host.replace(/:\d+$/, ''); } catch { refuse(`invalid LEGACY_BASE_URL`); }
  if (!allow.some((a) => host === a || host.endsWith('.' + a))) refuse(`legacy host '${host}' not in LEGACY_HOST_ALLOWLIST`);
}

// ---------- GET-only allowlist ----------
const GET_ALLOW = [/^\/orders\/getMealsDateWiseFilter\/all\/\d+(\?.*)?$/];
let cookie = '';
async function login() {
  // matches the proven legacy-detail-extract.mjs: POST /logincheck with email_address + password
  const r = await fetch(`${BASE}/logincheck`, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': 'nutrezee-migration-readonly' },
    body: new URLSearchParams({ email_address: EMAIL, password: PASS }).toString(),
  });
  const sc = r.headers.getSetCookie ? r.headers.getSetCookie() : [r.headers.get('set-cookie') || ''];
  cookie = sc.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
  if (!cookie) throw new Error('login failed: no session cookie');   // never logs the cookie value
}
async function getMealGrid(internalId, { tries = 3 } = {}) {
  const p = `/orders/getMealsDateWiseFilter/all/${internalId}`;
  if (!GET_ALLOW.some((re) => re.test(p))) throw new Error('BLOCKED non-allowlisted GET');
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      const r = await fetch(`${BASE}${p}`, { headers: { cookie } });
      const body = await r.text();
      return { status: r.status, body };
    } catch (e) { lastErr = e; await sleep(RATE_MS * 2 * i); }
  }
  throw lastErr || new Error('fetch failed');
}

// ---------- candidate selection (window-filtered; preserves internal_id + order_number) ----------
function ddmmyyyyToIso(s) {
  if (typeof s !== 'string' || !/^\d{2}-\d{2}-\d{4}$/.test(s)) return null;
  const [d, m, y] = s.split('-');
  return normalizeDate(`${y}-${m}-${d}`);
}
function windowDates() {
  const to = normalizeDate(String(args.until || new Date().toISOString().slice(0, 10)));
  let days = WINDOW === 'last-30' ? 30 : WINDOW === 'last-90' ? 90 : WINDOW === 'last-year' ? 365 : null;
  if (args.since) return { from: normalizeDate(String(args.since)), to };
  if (days === null) return { from: null, to };
  const dt = new Date(to + 'T00:00:00Z'); dt.setUTCDate(dt.getUTCDate() - days);
  return { from: dt.toISOString().slice(0, 10), to };
}
function selectCandidatesFromExtract(win) {
  if (!fs.existsSync(ORDERS_INDEX)) { errors.push(`orders_index_missing:${ORDERS_INDEX}`); return []; }
  const out = [];
  const seen = new Set();
  for (const line of fs.readFileSync(ORDERS_INDEX, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let r; try { r = JSON.parse(line); } catch { continue; }
    if (!r.internal_id || !r.order_number) continue;
    if (seen.has(String(r.internal_id))) continue;
    const start = ddmmyyyyToIso(r.start), end = ddmmyyyyToIso(r.end);
    // overlap test: plan [start,end] intersects [win.from, win.to]
    if (win.from && end && end < win.from) continue;
    if (win.to && start && start > win.to) continue;
    if (!start && !end) continue;                 // need at least one date to window-filter
    seen.add(String(r.internal_id));
    out.push({ internal_id: String(r.internal_id), order_number: String(r.order_number) });
  }
  return out;
}

// ---------- main ----------
const errors = [];
const summary = {
  job: 'meal-history-scrape', mode: MODE, target: TARGET, window: WINDOW,
  window_from: null, window_to: null, output_dir: OUTPUT_DIR,
  records_candidate: 0, requests_attempted: 0, requests_success: 0, requests_failed: 0,
  raw_files_written: 0, parse_success: 0, parse_failed: 0, meal_days_found: 0,
  duplicate_skipped: 0, resume_supported: true, concurrency: CONCURRENCY, rate_limit_ms: RATE_MS,
  duration_ms: 0, errors, ok: false,
};
const t0 = Date.now();

function existingFor(internalId) {
  try { return fs.readdirSync(OUTPUT_DIR).some((f) => f.startsWith(`meals_${internalId}_`) && f.endsWith('.html.gz')); }
  catch { return false; }
}
function writeManifest(row) {
  try { fs.appendFileSync(path.join(OUTPUT_DIR, 'manifest.jsonl'), JSON.stringify(row) + '\n'); } catch { /* best effort */ }
}

try {
  const win = WIN;   // computed + span-gated in the guard section
  summary.window_from = win.from; summary.window_to = win.to;

  let candidates = selectCandidatesFromExtract(win);   // ORDERS_SOURCE=db is a future option (doc 16)
  summary.records_candidate = candidates.length;
  if (Number.isFinite(LIMIT)) candidates = candidates.slice(0, LIMIT);

  if (MODE === 'dry-run') {
    summary.ok = errors.length === 0;
    finish();
  } else {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    if (MODE === 'scrape') await login();

    // bounded-concurrency worker pool
    let idx = 0;
    async function worker() {
      while (idx < candidates.length) {
        const c = candidates[idx++];
        if (RESUME && existingFor(c.internal_id)) { summary.duplicate_skipped += 1; continue; }

        if (MODE === 'archive-only') {
          // re-parse an already-scraped artifact (no fetch); report parse stats
          const file = (fs.readdirSync(OUTPUT_DIR).find((f) => f.startsWith(`meals_${c.internal_id}_`)) || '');
          if (!file) continue;
          try {
            const html = zlib.gunzipSync(fs.readFileSync(path.join(OUTPUT_DIR, file))).toString('utf8');
            const parsed = parseMealGrid(html);
            summary.parse_success += 1; summary.meal_days_found += parsed.dates.length;
          } catch { summary.parse_failed += 1; }
          continue;
        }

        // MODE === 'scrape'
        const ts = Date.now();
        summary.requests_attempted += 1;
        try {
          const res = await getMealGrid(c.internal_id);
          if (res.status !== 200) { summary.requests_failed += 1; writeManifest({ internal_id: c.internal_id, order_number: c.order_number, http_status: res.status, error_code: 'http_' + res.status, fetched_at: new Date().toISOString() }); continue; }
          summary.requests_success += 1;
          const sha = mealSha(res.body);
          const parsed = (() => { try { const p = parseMealGrid(res.body); summary.parse_success += 1; return p; } catch { summary.parse_failed += 1; return { dates: [], meal_types: [], meal_ids: [] }; } })();
          summary.meal_days_found += parsed.dates.length;
          const fname = `meals_${c.internal_id}_${c.order_number}_${sha.slice(0, 8)}.html.gz`;
          fs.writeFileSync(path.join(OUTPUT_DIR, fname), zlib.gzipSync(Buffer.from(res.body, 'utf8')));
          summary.raw_files_written += 1;
          writeManifest({
            internal_id: c.internal_id, order_number: c.order_number, http_status: res.status,
            bytes: Buffer.byteLength(res.body), raw_sha: sha, fetched_at: new Date().toISOString(),
            duration_ms: Date.now() - ts, parse_status: parsed.dates.length ? 'ok' : 'empty',
            meal_day_count: parsed.dates.length, error_code: null,
          });
        } catch (e) {
          summary.requests_failed += 1;
          writeManifest({ internal_id: c.internal_id, order_number: c.order_number, http_status: 0, error_code: String(e.message || e).slice(0, 40), fetched_at: new Date().toISOString() });
        }
        if (RATE_MS) await sleep(RATE_MS);
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, candidates.length) || 1 }, worker));
    summary.ok = summary.requests_failed === 0 && errors.length === 0;
    finish();
  }
} catch (e) {
  errors.push(String(e.message || e));
  finish();
}

function finish() {
  summary.duration_ms = Date.now() - t0;
  if (summary.errors.length) summary.ok = false;
  log({ SCRAPE_SUMMARY: summary });
  console.log('SUMMARY ' + JSON.stringify(summary));
  // Persist counts-only run-history ONLY on the VPS (under the approved tree, already guard-validated);
  // off-VPS the summary is available on stdout only — no arbitrary off-VPS file write.
  if (RUN_HISTORY && fs.existsSync(VPS_MARKER)) {
    try { fs.mkdirSync(path.dirname(RUN_HISTORY), { recursive: true }); fs.appendFileSync(RUN_HISTORY, JSON.stringify(summary) + '\n'); } catch { /* best effort */ }
  }
  if (SUMMARY_JSON) console.log(JSON.stringify(summary));
  process.exit(summary.ok ? 0 : 1);
}
