#!/usr/bin/env node
// Backfill frozen legacy delivery (method/time/area) onto already-imported staging orders.
// Joins order_detail.jsonl (internal_id -> delivery) with orders_index.jsonl (internal_id ->
// order_number), then bulk UPDATE ... FROM with COALESCE (never overwrites; idempotent).
// customer_order is M03's own table (not cross-module). Staging only. dry-run | apply.
// Runs inside nutrezee-api (DATABASE_URL + pg in env).
import pg from 'pg';
import fs from 'node:fs';
import { ulid } from 'ulid';

const MODE = process.argv[2] === 'apply' ? 'apply' : 'dry-run';
const INDEX = process.argv[3] || '/srv/orders_index.jsonl';
const DETAIL = process.argv[4] || '/srv/order_detail.jsonl';
const DB = process.env.DATABASE_URL;

const log = (o) => console.log(JSON.stringify(o));

// internal_id -> order_number
const idToOrder = new Map();
for (const line of fs.readFileSync(INDEX, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  if (r.internal_id && r.order_number) idToOrder.set(String(r.internal_id), String(r.order_number));
}

// order_number -> {method,time,area}
const rows = [];
const seen = new Set();
for (const line of fs.readFileSync(DETAIL, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const r = JSON.parse(line);
  const orderNumber = idToOrder.get(String(r.internal_id));
  if (!orderNumber || seen.has(orderNumber)) continue;
  const v = r.view || {};
  const method = (v.delivery_method ?? '').toString().trim() || null;
  const time = (v.delivery_time ?? '').toString().trim() || null;
  const area = (v.area ?? '').toString().trim() || null;
  if (!method && !time && !area) continue;
  seen.add(orderNumber);
  rows.push({ orderNumber, method, time, area });
}
log({ step: 'normalize', detail_rows: rows.length, index_size: idToOrder.size });

const c = new pg.Client({ connectionString: DB });
await c.connect();
try {
  await c.query('BEGIN');
  await c.query('CREATE TEMP TABLE _delivery_bf (order_number text PRIMARY KEY, method text, time_ text, area text) ON COMMIT DROP');
  // bulk insert in chunks
  const CH = 1000;
  for (let i = 0; i < rows.length; i += CH) {
    const chunk = rows.slice(i, i + CH);
    const vals = [];
    const params = [];
    chunk.forEach((r, j) => {
      const b = j * 4;
      vals.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4})`);
      params.push(r.orderNumber, r.method, r.time, r.area);
    });
    await c.query(`INSERT INTO _delivery_bf (order_number, method, time_, area) VALUES ${vals.join(',')} ON CONFLICT DO NOTHING`, params);
  }
  // how many legacy orders would change (a currently-null column gets a non-null value)
  const wouldUpdate = await c.query(
    `SELECT count(*)::int n FROM customer_order o JOIN _delivery_bf d ON o.order_number = d.order_number
     WHERE o.origin='legacy'
       AND ((o.delivery_method_frozen IS NULL AND d.method IS NOT NULL)
         OR (o.delivery_time_frozen   IS NULL AND d.time_  IS NOT NULL)
         OR (o.delivery_area_frozen   IS NULL AND d.area   IS NOT NULL))`,
  );
  const matched = await c.query(
    `SELECT count(*)::int n FROM customer_order o JOIN _delivery_bf d ON o.order_number = d.order_number WHERE o.origin='legacy'`,
  );
  log({ would_update: wouldUpdate.rows[0].n, matched_orders: matched.rows[0].n, no_match_in_staging: rows.length - matched.rows[0].n });

  if (MODE === 'apply') {
    const upd = await c.query(
      `UPDATE customer_order o
          SET delivery_method_frozen = COALESCE(o.delivery_method_frozen, d.method),
              delivery_time_frozen   = COALESCE(o.delivery_time_frozen,   d.time_),
              delivery_area_frozen   = COALESCE(o.delivery_area_frozen,   d.area),
              updated_at = now(), updated_by = 'delivery-backfill'
         FROM _delivery_bf d
        WHERE o.order_number = d.order_number AND o.origin='legacy'
          AND ((o.delivery_method_frozen IS NULL AND d.method IS NOT NULL)
            OR (o.delivery_time_frozen   IS NULL AND d.time_  IS NOT NULL)
            OR (o.delivery_area_frozen   IS NULL AND d.area   IS NOT NULL))`,
    );
    await c.query(
      `INSERT INTO audit_event (id,event_type,actor_role,entity_type,entity_id,severity,after)
       VALUES ($1,'settings.changed','system','customer_order',$2,'high',$3)`,
      [ulid(), 'bulk-delivery-backfill', JSON.stringify({ delivery_backfill: upd.rowCount, source: 'order_detail.jsonl' })],
    );
    await c.query('COMMIT');
    log({ FINAL: true, mode: 'apply', updated: upd.rowCount });
  } else {
    await c.query('ROLLBACK');
    log({ FINAL: true, mode: 'dry-run', note: 'no writes' });
  }
} catch (e) {
  await c.query('ROLLBACK').catch(() => {});
  console.error('FATAL ' + e.message);
  process.exit(1);
} finally {
  await c.end();
}
