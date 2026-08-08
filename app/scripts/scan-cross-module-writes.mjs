// CI guard (backend_foundation §1, ADR-010): single write path — no module writes
// another module's tables. Ownership map mirrors physical_schema_design.md; module
// source roots map to backend_module_specs.md. The platform layer owns wave-1 tables;
// business modules (src/modules/mXX-*) own their wave's tables and may READ others
// only via the owning module's service API (not enforced here — reviewed) but
// WRITES (INSERT/UPDATE/DELETE in SQL strings) to foreign tables fail this scan.
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const API_SRC = new URL('../apps/api/src/', import.meta.url).pathname;

// table -> owning source root (first path segment under src/)
const OWNERSHIP = {
  // platform (wave 1)
  staff_user: 'platform', role: 'platform', permission: 'platform',
  role_permission: 'platform', role_assignment: 'platform', session: 'platform',
  audit_event: 'platform', setting: 'platform', feature_flag: 'platform',
  reason_code: 'platform', section_master: 'platform', area: 'platform',
  delivery_slot: 'platform', delivery_method: 'platform', transition_config: 'platform',
  outbox_event: 'platform', idempotency_key: 'platform', audit_read_queue: 'platform',
  // wave 2 (WP-04/05/06)
  customer: 'm04-customers', customer_phone: 'm04-customers', address: 'm04-customers',
  customer_allergy: 'm04-customers', preference: 'm04-customers', merge_record: 'm04-customers',
  meal_type: 'm05-catalog', diet_status: 'm05-catalog', tag: 'm05-catalog',
  package_for_type: 'm05-catalog', ingredient: 'm05-catalog', allergen: 'm05-catalog',
  product: 'm05-catalog', product_component: 'm05-catalog', product_ingredient: 'm05-catalog',
  product_allergen: 'm05-catalog', nutrition_facts: 'm05-catalog', package: 'm05-catalog',
  routing_rule: 'm05-catalog', ingredient_allergen: 'm05-catalog', // A6

  import_batch: 'm19-migration', import_row_result: 'm19-migration', sync_record: 'm18-bridge',

  // wave 3 (WP-07)
  draft_order: 'm01-intake', draft_item: 'm01-intake',
  whatsapp_message_ref: 'm17-whatsapp',
  // wave 3 (WP-08)
  review_queue_item: 'm02-review', review_decision: 'm02-review',
  // wave 4 (WP-09)
  customer_order: 'm03-orders', order_item: 'm03-orders', fulfillment_day: 'm03-orders',
  order_status_history: 'm03-orders', change_request: 'm03-orders', exception_case: 'm03-orders',
  // wave 4 (WP-11)
  payment_record: 'm07-payments', payment_review_item: 'm07-payments',
  // wave 5 (WP-10)
  kitchen_ticket: 'm08-kitchen', ticket_status_event: 'm08-kitchen', escalation: 'm08-kitchen',
  // wave 5 (WP-12)
  notification_template: 'm11-notifications', notification_log: 'm11-notifications',
  // wave 5 (WP-13)
  reconciliation_run: 'm18-bridge',

  // wave 6 — operational foundation (packing + driver/area), migration track
  packing_batch: 'm20-packing', packing_batch_order: 'm20-packing', packing_item: 'm20-packing',
  packing_label: 'm20-packing', packing_status_history: 'm20-packing',
  driver: 'm21-delivery', driver_area: 'm21-delivery', driver_shift: 'm21-delivery',
  delivery_route: 'm21-delivery', delivery_route_order: 'm21-delivery',
  driver_assignment_history: 'm21-delivery',

  // wave 6 — m22 customer meal-history controlled transfer (no bridge)
  legacy_meal_history_raw: 'm22-meal-history', customer_meal_history: 'm22-meal-history',
  customer_meal_history_items: 'm22-meal-history', customer_meal_history_import_runs: 'm22-meal-history',
  customer_meal_history_exceptions: 'm22-meal-history',
};

const WRITE_SQL = /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+("?)([a-z_]+)\2/gi;

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(p);
    else if (entry.name.endsWith('.ts')) yield p;
  }
}

let violations = 0;
for await (const file of walk(API_SRC)) {
  const rel = relative(API_SRC, file);
  const sourceRoot = rel.split(sep)[0]; // 'platform' | 'modules' | ...
  const moduleRoot = sourceRoot === 'modules' ? rel.split(sep)[1] : sourceRoot;
  const src = await readFile(file, 'utf8');
  for (const m of src.matchAll(WRITE_SQL)) {
    const table = m[3].toLowerCase();
    const owner = OWNERSHIP[table];
    if (!owner) continue; // unknown table => not yet registered (registered per WP)
    const ownerMatches =
      owner === moduleRoot || (owner === 'platform' && sourceRoot === 'platform');
    if (!ownerMatches) {
      violations += 1;
      console.error(`cross-module write violation: ${rel} writes ${table} (owner: ${owner})`);
    }
  }
}

if (violations > 0) {
  console.error(`scan-cross-module-writes FAILED: ${violations} violation(s)`);
  process.exit(1);
}
console.log('scan-cross-module-writes OK');
