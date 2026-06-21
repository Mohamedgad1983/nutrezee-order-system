#!/usr/bin/env node
// enrich-orders.mjs — build the phone-enriched order extract from the legacy archive
// using the CORRECT identifier chain. OFFLINE, read-only, no DB, no legacy network.
//
//   order_number (=id)  --orders_index.jsonl-->  internal_id  -->  out/raw/view_<internal_id>.html.gz
//   --"Contact no : <8-digit>"-->  +965XXXXXXXX  (the order's own customer phone)
//
// The two legacy id spaces (order_number, internal_id) are DISJOINT — joining order_number
// straight to view_<order_number> attaches a different customer's phone (the 2026-06-21 bug).
// Ambiguous order_numbers (>1 internal_id) are excluded, not guessed. Writes the same shape the
// governed apply (apply-order-sync.mjs) + dry-run planner (incremental-sync.mjs) consume:
//   { id, start_date(YYYY-MM-DD), end_date(YYYY-MM-DD), package, status, phone? }
// Counts-only stdout; never prints phones.
//
// env: DIR (default /opt/nutrezee/legacy-detail-2026), OUT (default $DIR/orders_history_enriched.json)
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

const DIR = process.env.DIR || '/opt/nutrezee/legacy-detail-2026';
const RAW = path.join(DIR, 'out', 'raw');
const OUT = process.env.OUT || path.join(DIR, 'orders_history_enriched.json');

// DD-MM-YYYY -> YYYY-MM-DD (legacy index format); returns undefined if not parseable
const toIso = (s) => {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(s || '').trim());
  if (!m) return undefined;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  const d = new Date(iso + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : undefined;
};
const phoneRe = /Contact\s*no\s*:?\s*([+0-9][0-9 \-]{6,})/i;
const normPhone = (raw) => { const d = String(raw).replace(/\D/g, ''); return d.length === 8 ? '+965' + d : (d.length >= 8 ? '+' + d : null); };
const parsePhone = (internalId) => {
  const f = path.join(RAW, `view_${internalId}.html.gz`);
  if (!internalId || !fs.existsSync(f)) return null;
  let html; try { html = zlib.gunzipSync(fs.readFileSync(f)).toString('utf8'); } catch { return null; }
  const m = phoneRe.exec(html); return m ? normPhone(m[1]) : null;
};

const idx = fs.readFileSync(path.join(DIR, 'out', 'orders_index.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

// order_number -> internal_id, excluding ambiguous (>1 distinct internal_id)
const m = new Map();
for (const d of idx) { const on = String(d.order_number), inn = String(d.internal_id); if (!m.has(on)) m.set(on, new Set()); m.get(on).add(inn); }
const on2in = new Map(); let ambiguous = 0;
for (const [on, s] of m) { if (s.size === 1) on2in.set(on, [...s][0]); else ambiguous += 1; }

// one record per order_number (last-wins across status lists), shaped like orders_history.json
const byOrder = new Map();
for (const d of idx) byOrder.set(String(d.order_number), { id: String(d.order_number), start_date: toIso(d.start), end_date: toIso(d.end), package: d.package, status: d.status });

let enriched = 0, withPhoneAndDates = 0;
const out = [];
for (const o of byOrder.values()) {
  const p = parsePhone(on2in.get(o.id));
  if (p) { o.phone = p; enriched += 1; if (o.start_date && o.end_date) withPhoneAndDates += 1; }
  out.push(o);
}
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(JSON.stringify({ index_rows: idx.length, distinct_orders: out.length, ambiguous_excluded: ambiguous, enriched_with_phone: enriched, enriched_with_phone_and_dates: withPhoneAndDates, out: OUT }));
