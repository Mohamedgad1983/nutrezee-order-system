#!/usr/bin/env node
// Populate migration_exception_review (staging) from the legacy source, classifying every
// record NOT safely imported. Idempotent (clears + re-inserts). Runs inside nutrezee-api.
// PII (phone/name) lands in staging only. Usage: node populate-exceptions.mjs <cust> <orders>
import pg from 'pg';
import fs from 'node:fs';
import { ulid } from 'ulid';

const DB = process.env.DATABASE_URL;
const custs = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const orders = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'));
const validPhone = (p) => !!p && /^\+\d{8,15}$/.test(p);
const validDate = (s) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s + 'T00:00:00Z').getTime());
const norm = (p) => (p || '').replace(/[^\d+]/g, '') || null;

// risk + repairability + action per reason
const META = {
  duplicate_phone_deduped:      { risk: 'medium', repair: 'review',  action: 'verify distinct person before splitting (family/shared phone)' },
  placeholder_phone_blacklisted:{ risk: 'high',   repair: 'review',  action: 'phone shared by >=10 customers (call-centre/default); manual identity verification' },
  placeholder_phone:            { risk: 'high',   repair: 'review',  action: 'order on a shared/junk phone; resolve customer manually' },
  invalid_or_missing_phone:     { risk: 'high',   repair: 'partial', action: 'no reliable contact/dedup key; import only with synthetic key + unverified flag' },
  customer_not_found:           { risk: 'medium', repair: 'depends', action: 'garbage/unknown phone (e.g. name[phone]); resolve customer manually' },
  negative_amount:              { risk: 'high',   repair: 'review',  action: 'negative legacy amount; finance review before any correction' },
  reversed_dates:               { risk: 'medium', repair: 'review',  action: 'end_date < start_date; confirm correct dates' },
  no_name:                      { risk: 'low',    repair: 'no',      action: 'no customer name in source; cannot import' },
};

const c = new pg.Client({ connectionString: DB });
await c.connect();
const storedCustKeys = new Set((await c.query("SELECT legacy_key FROM sync_record WHERE object_type='customer'")).rows.map((r) => r.legacy_key));
const storedOrderKeys = new Set((await c.query("SELECT legacy_key FROM sync_record WHERE object_type='order'")).rows.map((r) => r.legacy_key));
const pc = {}; for (const cu of custs) if (cu.phone) pc[cu.phone] = (pc[cu.phone] || 0) + 1;
const BLACK = new Set(Object.entries(pc).filter(([, n]) => n >= 10).map(([p]) => p));

const rows = [];
const seenPhone = new Set();
for (const cu of custs) {
  const name = (cu.name || '').trim(); const phone = cu.phone || '';
  let reason = null;
  if (!name) reason = 'no_name';
  else if (validPhone(phone) && BLACK.has(phone)) reason = 'placeholder_phone_blacklisted';
  else if (!validPhone(phone)) reason = 'invalid_or_missing_phone';
  else if (storedCustKeys.has(phone)) { if (!seenPhone.has(phone)) { seenPhone.add(phone); continue; } reason = 'duplicate_phone_deduped'; }
  else continue; // unique valid phone not stored = recovered (or storable)
  rows.push({ lc: String(cu.id), lo: null, phone, name, reason });
}
for (const o of orders) {
  const id = String(o.id);
  if (storedOrderKeys.has(id)) continue;
  const phone = o.phone || '';
  const start = o.start_date, end = o.end_date;
  const paid = Number(o.paid_amount), amt = Number(o.package_amount);
  const total = Number.isFinite(paid) ? paid : (Number.isFinite(amt) ? amt : 0);
  let reason;
  if (!validDate(start) || !validDate(end)) reason = 'reversed_dates'; // invalid/odd dates bucket
  else if (validDate(start) && validDate(end) && end < start) reason = 'reversed_dates';
  else if (total < 0) reason = 'negative_amount';
  else if (!validPhone(phone)) reason = 'customer_not_found';
  else if (BLACK.has(phone)) reason = 'placeholder_phone';
  else if (!storedCustKeys.has(phone)) reason = 'customer_not_found';
  else continue; // resolvable & clean = should be stored
  rows.push({ lc: null, lo: id, phone, name: o.customer_name || null, reason });
}

await c.query('DELETE FROM migration_exception_review');
const CH = 500;
for (let i = 0; i < rows.length; i += CH) {
  const chunk = rows.slice(i, i + CH);
  const vals = []; const params = [];
  chunk.forEach((r, j) => {
    const m = META[r.reason] || { risk: 'medium', repair: 'review', action: 'review' };
    const b = j * 10;
    vals.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8},$${b + 9},$${b + 10})`);
    params.push(ulid(), r.lc, r.lo, r.phone || null, norm(r.phone), r.name, r.reason, m.repair, m.action, m.risk);
  });
  await c.query(
    `INSERT INTO migration_exception_review
       (id, legacy_customer_id, legacy_order_id, phone_original, normalized_phone, customer_name, reason, repairability, recommended_action, risk_level)
     VALUES ${vals.join(',')}`,
    params,
  );
}
const summary = await c.query("SELECT reason, risk_level, count(*)::int n FROM migration_exception_review GROUP BY reason, risk_level ORDER BY n DESC");
console.log(JSON.stringify({ inserted: rows.length, by_reason: summary.rows }, null, 1));
await c.end();
