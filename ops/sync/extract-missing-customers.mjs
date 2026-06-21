#!/usr/bin/env node
// extract-missing-customers.mjs — build governed-importer rows for the legacy customers that were
// never migrated, so their orphan orders can resolve. READ-ONLY (DB read + local archive); writes
// only the rows file. Counts + masked output only (no raw PII).
//
// A "missing customer" = a phone that (a) is the Contact-no on an unsynced order, (b) is a valid
// Kuwait mobile, (c) is NOT already a customer in sync_record, and (d) maps to a SINGLE customer
// name across all its order pages. Phones shared by many names (e.g. test/placeholder numbers like
// the 364-order "Test" number) are QUARANTINED, never imported (the wrong-customer trap).
//
// Output row shape (the m19 customer importer schema): { legacy_id:'+965XXXXXXXX', name, name_ar?, phone:'+965XXXXXXXX' }
//   legacy_id == normalized phone (the keyspace the whole system uses for customers).
//
// Inputs (dump via psql, no DB driver needed — keeps this tool dependency-free):
//   SRO_FILE = file of sync_record order legacy_keys (one per line)
//   SRC_FILE = file of sync_record customer legacy_keys (one per line)
// env: SRO_FILE, SRC_FILE (required), DIR(/opt/nutrezee/legacy-detail-2026),
//      OUT($DIR/customers_missing.json), MAX_NAMES_PER_PHONE(default 2 — >= this many distinct
//      names => quarantine as shared/junk)
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

const DIR = process.env.DIR || '/opt/nutrezee/legacy-detail-2026';
const RAW = path.join(DIR, 'out', 'raw');
const OUT = process.env.OUT || path.join(DIR, 'customers_missing.json');
const MAX_NAMES = Number(process.env.MAX_NAMES_PER_PHONE || 2); // >= this distinct names -> quarantine
const readSet = (f) => new Set(fs.readFileSync(f, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean));
const srO = readSet(process.env.SRO_FILE);
const srC = readSet(process.env.SRC_FILE);

const idx = fs.readFileSync(path.join(DIR, 'out', 'orders_index.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const on2in = new Map(); const conflict = new Set();
{ const m = new Map(); for (const d of idx) { const on = String(d.order_number), inn = String(d.internal_id); if (!m.has(on)) m.set(on, new Set()); m.get(on).add(inn); }
  for (const [on, s] of m) { if (s.size === 1) on2in.set(on, [...s][0]); else conflict.add(on); } }

const orders = JSON.parse(fs.readFileSync(path.join(DIR, 'orders_history_enriched.json'), 'utf8'));
const validKwMobile = (p) => /^\+965[569]\d{7}$/.test(p); // Kuwait mobiles start 5/6/9
const nameRe = /<b>Name<\/b>\s*:\s*([\s\S]*?)\s*<\/br>/i;
const isArabic = (s) => /[؀-ۿ]/.test(s);
const pageName = (inn) => {
  const f = path.join(RAW, `view_${inn}.html.gz`);
  if (!inn || !fs.existsSync(f)) return null;
  let html; try { html = zlib.gunzipSync(fs.readFileSync(f)).toString('utf8'); } catch { return null; }
  const m = nameRe.exec(html); return m ? m[1].replace(/\s+/g, ' ').trim() : null;
};

// blocked orders grouped by phone
const byPhone = new Map(); // phone -> { orders:[order_number], names:Map<name,count> }
for (const o of orders) {
  const on = String(o.id), ph = o.phone;
  if (srO.has(on) || !ph || !/^\+965\d{8}$/.test(ph) || srC.has(ph)) continue;
  if (!byPhone.has(ph)) byPhone.set(ph, { orders: [], names: new Map() });
  const e = byPhone.get(ph); e.orders.push(on);
  const nm = pageName(on2in.get(on));
  if (nm) e.names.set(nm, (e.names.get(nm) || 0) + 1);
}

const rows = []; const quarantine = [];
for (const [ph, e] of byPhone) {
  const distinctNames = e.names.size;
  const reasons = [];
  if (!validKwMobile(ph)) reasons.push('invalid_kw_mobile');
  if (distinctNames >= MAX_NAMES) reasons.push(`shared_phone_${distinctNames}_names`);
  if (distinctNames === 0) reasons.push('no_name_on_page');
  if (reasons.length) { quarantine.push({ phone_masked: ph.slice(0, 7) + 'xxxx', orders: e.orders.length, distinct_names: distinctNames, reasons }); continue; }
  // clean: single real customer
  const name = [...e.names.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const row = { legacy_id: ph, name, phone: ph };
  if (isArabic(name)) row.name_ar = name;
  rows.push(row);
}

fs.writeFileSync(OUT, JSON.stringify(rows, null, 2));
console.log(JSON.stringify({
  blocked_phones: byPhone.size,
  clean_customers_to_import: rows.length,
  unblocks_orders: [...byPhone].filter(([ph, e]) => rows.some((r) => r.legacy_id === ph)).reduce((n, [, e]) => n + e.orders.length, 0),
  quarantined: quarantine,
  out: OUT,
}, null, 2));
