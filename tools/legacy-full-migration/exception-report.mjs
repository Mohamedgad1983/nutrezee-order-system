#!/usr/bin/env node
// Exception Recovery diagnostic (read-only): classify every legacy customer/order that is
// NOT stored in staging, by exact reason + repairability + recommended action.
// Replicates the orchestrator's keying/exclusion logic. Runs inside nutrezee-api (DB access).
// Usage: node exception-report.mjs <customers_v2.json> <orders_history.json> <outJsonPath>
import pg from 'pg';
import fs from 'node:fs';

const DB = process.env.DATABASE_URL;
const CUST = process.argv[2];
const ORD = process.argv[3];
const OUT = process.argv[4] || '/tmp/exception-report.json';

const validPhone = (p) => !!p && /^\+\d{8,15}$/.test(p);
const validDate = (s) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + 'T00:00:00Z').getTime());

const custs = JSON.parse(fs.readFileSync(CUST, 'utf8'));
const orders = JSON.parse(fs.readFileSync(ORD, 'utf8'));

// placeholder-phone blacklist: phones shared by >= 10 legacy customers (orchestrator rule)
const pc = {};
for (const c of custs) if (c.phone) pc[c.phone] = (pc[c.phone] || 0) + 1;
const BLACKLIST = new Set(Object.entries(pc).filter(([, n]) => n >= 10).map(([p]) => p));

const cl = new pg.Client({ connectionString: DB });
await cl.connect();
const storedCustKeys = new Set((await cl.query("SELECT legacy_key FROM sync_record WHERE object_type='customer'")).rows.map((r) => r.legacy_key));
const storedOrderKeys = new Set((await cl.query("SELECT legacy_key FROM sync_record WHERE object_type='order'")).rows.map((r) => r.legacy_key));
await cl.end();

// ---- customers ----
const custReport = []; const custReasons = {};
const phoneFirstSeen = new Set();
for (const cu of custs) {
  const name = (cu.name || '').trim();
  const phone = cu.phone || '';
  let reason = null, repairable = null, action = null;
  if (!name) { reason = 'no_name'; repairable = 'NO'; action = 'no name in source — cannot import'; }
  else if (validPhone(phone) && BLACKLIST.has(phone)) { reason = 'placeholder_phone_blacklisted'; repairable = 'REVIEW'; action = 'shared/junk phone (>=10 customers); import with synthetic key only after manual verification'; }
  else if (!validPhone(phone)) { reason = 'invalid_or_missing_phone'; repairable = 'PARTIAL'; action = 'import with synthetic np: key + unverified flag; no reliable dedup key'; }
  else if (storedCustKeys.has(phone)) {
    if (!phoneFirstSeen.has(phone)) { phoneFirstSeen.add(phone); continue; } // STORED (representative)
    reason = 'duplicate_phone_deduped'; repairable = 'REVIEW'; action = 'folded into the customer with the same phone; import as distinct only if a different person (family-shared phone)';
  } else { reason = 'not_imported'; repairable = 'YES'; action = 're-import (unique valid phone, not yet stored)'; }
  custReasons[reason] = (custReasons[reason] || 0) + 1;
  custReport.push({ legacy_id: String(cu.id), phone_masked: (phone || '').slice(0, 5) + '***', reason, repairable, action });
}

// ---- orders ----
const orderReport = []; const orderReasons = {};
for (const o of orders) {
  const id = String(o.id);
  if (storedOrderKeys.has(id) || storedOrderKeys.has(String(o.order_number))) continue; // STORED
  const start = o.start_date, end = o.end_date, phone = o.phone || '', pkg = o.package;
  let reason, repairable, action;
  if (!validDate(start) || !validDate(end)) { reason = 'invalid_date'; repairable = 'REVIEW'; action = 'parse/repair legacy date then re-import'; }
  else if (!phone) { reason = 'no_phone'; repairable = 'NO'; action = 'no phone — cannot resolve customer'; }
  else if (BLACKLIST.has(phone)) { reason = 'placeholder_phone'; repairable = 'REVIEW'; action = 'shared/junk phone; resolve customer manually'; }
  else if (!storedCustKeys.has(phone)) { reason = 'customer_not_found'; repairable = 'DEPENDS'; action = 'import the customer first (see customer exceptions), then re-import order'; }
  else if (!pkg) { reason = 'no_package'; repairable = 'PARTIAL'; action = 'import with frozen package name only'; }
  else { reason = 'unprocessed_recoverable'; repairable = 'YES'; action = 're-import (customer exists, dates+package valid)'; }
  orderReasons[reason] = (orderReasons[reason] || 0) + 1;
  orderReport.push({ legacy_id: id, order_number: String(o.order_number ?? ''), reason, repairable, action });
}

const summary = {
  customers: { source: custs.length, distinct_stored: storedCustKeys.size, missing: custReport.length, by_reason: custReasons },
  orders: { source: orders.length, stored: storedOrderKeys.size, missing: orderReport.length, by_reason: orderReasons },
};
console.log(JSON.stringify(summary, null, 2));
fs.writeFileSync(OUT, JSON.stringify({ summary, customer_exceptions: custReport, order_exceptions: orderReport }));
console.log(JSON.stringify({ wrote: OUT }));
