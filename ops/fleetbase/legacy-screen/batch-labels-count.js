// A70.6 — what the Fleet-Ops "Batch Labels" page will offer for one delivery day, computed inside the
// running nutrezee-api container with the page's own compiled code (LabelService.batchCandidates).
// Input (stdin): the day's Fleetbase order projections read from the Fleetbase database by the host
// runner (the page reads the same rows through the Fleetbase API with the operator's token).
// Output (stdout): order numbers only — { day, fleetbase_active, labels, label_numbers, unmapped }.
'use strict';
const { Pool } = require('/srv/node_modules/pg');
const { LabelService } = require('/srv/dist/modules/m25-label/label.service.js');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// Same rules as fleetbase-identity.service.ts (fleetbaseOrderDate / isHeldOrCancelled).
function fleetbaseOrderDate(order) {
  const metaDate = order.meta && order.meta.delivery_date;
  if (typeof metaDate === 'string' && DATE_RE.test(metaDate)) return metaDate;
  if (!order.scheduled_at) return null;
  const date = new Date(order.scheduled_at);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function isHeldOrCancelled(order) {
  const status = String(order.status || '').toLowerCase();
  if (status.includes('cancel')) return true;
  const hold = order.meta && order.meta.hold_reason;
  return typeof hold === 'string' && hold.trim().length > 0;
}

async function main() {
  const day = process.argv[2];
  const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));
  const orders = input.filter((o) => o.id && fleetbaseOrderDate(o) === day).filter((o) => !isHeldOrCancelled(o));
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  try {
    const labels = new LabelService(pool, null, null, null);
    const candidates = await labels.batchCandidates(day, orders);
    const labelNumbers = candidates.map((c) => String(c.orderNumber));
    const mapped = new Set(labelNumbers);
    const unmapped = orders
      .map((o) => String((o.meta && (o.meta.source_order_number || o.meta.external_ref)) || o.internal_id || o.id))
      .filter((n) => !mapped.has(n));
    process.stdout.write(JSON.stringify({
      day, fleetbase_active: orders.length, labels: candidates.length, label_numbers: labelNumbers, unmapped,
    }));
  } finally {
    await pool.end();
  }
}
main().catch((e) => { process.stdout.write(JSON.stringify({ error: String(e && e.message || e).slice(0, 300) })); process.exit(1); });
