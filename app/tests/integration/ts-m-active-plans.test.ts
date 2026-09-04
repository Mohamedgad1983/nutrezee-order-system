import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { AuditReadQueue, AuditService } from '../../apps/api/src/platform/audit/audit.service';
import { OutboxService } from '../../apps/api/src/platform/outbox/outbox.service';
import { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import { TransitionEngine } from '../../apps/api/src/platform/transition/transition-engine';
import type { StaffContext } from '../../apps/api/src/platform/auth/session.service';
import type { DraftService } from '../../apps/api/src/modules/m01-intake/draft.service';
import type { ReviewService } from '../../apps/api/src/modules/m02-review/review.service';
import { CustomerService } from '../../apps/api/src/modules/m04-customers/customer.service';
import { CatalogService } from '../../apps/api/src/modules/m05-catalog/catalog.service';
import { OrderService } from '../../apps/api/src/modules/m03-orders/order.service';
import { PaymentService } from '../../apps/api/src/modules/m07-payments/payment.service';
import { SyncRecordService } from '../../apps/api/src/modules/m18-bridge/sync-record.service';
import { BatchRunner, ImportGateError } from '../../apps/api/src/modules/m19-migration/batch-runner';
import { activePlanImporter, catalogImporter, customerImporter } from '../../apps/api/src/modules/m19-migration/importers';

let pool: Pool;
let runner: BatchRunner;
let importCustomers: ReturnType<typeof customerImporter>;
let importCatalog: ReturnType<typeof catalogImporter>;
let importActivePlans: ReturnType<typeof activePlanImporter>;

const sa: StaffContext = {
  staffId: 'sa-wp13', name: 'SA WP13', email: 'sa-wp13@t', locale: 'en', roles: ['super_admin'], sessionId: 's-wp13',
};

const CUSTOMER_FIXTURE = [
  { legacy_id: 'cust-ap-1', name: 'Active Plan Customer', phone: '0502220001' },
];
const CATALOG_FIXTURE = [
  { kind: 'package', legacy_id: 'pkg-ap-1', name: 'Legacy Active Plan', name_ar: 'Legacy Active Plan', price: 90000 },
];
const ACTIVE_PLAN_FIXTURE = [
  {
    legacy_id: 'plan-ap-1',
    order_number: 'LEG-AP-1001',
    customer_legacy_id: 'cust-ap-1',
    package_legacy_id: 'pkg-ap-1',
    package_name: 'Legacy Active Plan',
    start_date: '2099-07-01',
    end_date: '2099-07-03',
    off_days: 'legacy-friday-calendar',
    payment_status: 'gateway_pending',
    payment_method: 'legacy_gateway',
    total: 90000,
    address: 'Legacy address text',
  },
];

beforeAll(async () => {
  pool = await freshDb();
  const audit = new AuditService();
  const outbox = new OutboxService();
  const settings = new SettingsReader(pool, 0);
  const sync = new SyncRecordService();
  const customers = new CustomerService(pool, audit, new AuditReadQueue(pool, audit), outbox, settings);
  const catalog = new CatalogService(pool, audit, settings);
  const engine = new TransitionEngine(pool, audit, outbox, 0);
  const orders = new OrderService(
    pool, audit, outbox, settings, engine,
    {} as DraftService, {} as ReviewService, customers, catalog,
  );
  const payments = new PaymentService(pool, audit, outbox, engine, orders);
  runner = new BatchRunner(pool, audit, outbox, sync, { orders, payments, customers, catalog });
  importCustomers = customerImporter(customers, sync, '+966');
  importCatalog = catalogImporter(catalog, sync);
  importActivePlans = activePlanImporter(customers, catalog, orders, payments, sync, '+966');

  await runner.run(sa, 'customer', CUSTOMER_FIXTURE, importCustomers);
  await runner.run(sa, 'customer', CUSTOMER_FIXTURE, importCustomers, { apply: true });
  await runner.run(sa, 'catalog', CATALOG_FIXTURE, importCatalog);
  await runner.run(sa, 'catalog', CATALOG_FIXTURE, importCatalog, { apply: true });
}, 60_000);

afterAll(async () => {
  await pool.end();
});

describe('TS-M migration — active-plan batch 3 (WP-13)', () => {
  it('dry-runs active plans without writing business rows', async () => {
    const dry = await runner.run(sa, 'active_plans', ACTIVE_PLAN_FIXTURE, importActivePlans);
    expect(dry.dryRun).toBe(true);
    expect(dry.counts).toMatchObject({ created: 1, error: 0 });
    expect(dry.rows[0].messages).toContain('off_days_unverified=true; sponsor review required');

    const orders = await pool.query(`SELECT count(*)::int AS n FROM customer_order WHERE order_number = 'LEG-AP-1001'`);
    expect(orders.rows[0].n).toBe(0);
    const persisted = await runner.report(dry.batchId);
    expect(persisted.rows).toHaveLength(1);
  });

  it('applies active plans through M03/M07 owner APIs and queues unmapped payment statuses for finance review', async () => {
    const applied = await runner.run(sa, 'active_plans', ACTIVE_PLAN_FIXTURE, importActivePlans, { apply: true });
    expect(applied.counts).toMatchObject({ created: 1, error: 0 });

    const order = await pool.query(
      `SELECT id, origin, off_days_unverified, total FROM customer_order WHERE order_number = 'LEG-AP-1001'`,
    );
    expect(order.rows[0]).toMatchObject({ origin: 'legacy', off_days_unverified: true, total: '90000' });
    const days = await pool.query(`SELECT count(*)::int AS n FROM fulfillment_day WHERE order_id = $1`, [order.rows[0].id]);
    expect(days.rows[0].n).toBe(3);

    const payment = await pool.query(`SELECT id, status, origin FROM payment_record WHERE order_id = $1`, [order.rows[0].id]);
    expect(payment.rows[0]).toMatchObject({ status: 'unpaid', origin: 'legacy' });
    const review = await pool.query(`SELECT requested_status, state FROM payment_review_item WHERE payment_id = $1`, [payment.rows[0].id]);
    expect(review.rows[0]).toMatchObject({ requested_status: 'legacy_unmapped:gateway_pending', state: 'waiting' });

    const sync = await pool.query(
      `SELECT object_type, legacy_key FROM sync_record
       WHERE legacy_key = 'plan-ap-1' ORDER BY object_type`,
    );
    expect(sync.rows.map((r) => r.object_type)).toEqual(['order', 'payment']);

    const rerun = await runner.run(sa, 'active_plans', ACTIVE_PLAN_FIXTURE, importActivePlans, { apply: true });
    expect(rerun.counts).toMatchObject({ created: 0, matched: 1 });

    await runner.rollback(sa, applied.batchId);
    expect((await pool.query(`SELECT count(*)::int AS n FROM customer_order WHERE order_number = 'LEG-AP-1001'`)).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT count(*)::int AS n FROM payment_record WHERE id = $1`, [payment.rows[0].id])).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT count(*)::int AS n FROM sync_record WHERE legacy_key = 'plan-ap-1'`)).rows[0].n).toBe(0);
    expect((await pool.query(`SELECT state FROM import_batch WHERE id = $1`, [applied.batchId])).rows[0].state).toBe('rolled_back');
  });

  it('keeps active-plan apply blocked when synthetic dry-run has any error rows', async () => {
    const broken = [{ legacy_id: 'plan-broken', order_number: 'BROKEN-1', start_date: '2099-07-01', end_date: '2099-07-02' }];
    const dry = await runner.run(sa, 'active_plans', broken, importActivePlans);
    expect(dry.counts.error).toBe(1);
    await expect(runner.run(sa, 'active_plans', broken, importActivePlans, { apply: true }))
      .rejects.toBeInstanceOf(ImportGateError);
  });

  // review: the phone-fallback resolution path had no coverage (fixtures always
  // supplied customer_legacy_id) — cover both hit and miss explicitly
  it('resolves the plan customer by normalized phone when no legacy customer id maps', async () => {
    const byPhone = [{
      legacy_id: 'plan-ap-2',
      order_number: 'LEG-AP-1002',
      customer_phone: '050 222 0001', // raw legacy formatting of cust-ap-1's phone
      package_name: 'Legacy Active Plan',
      start_date: '2099-08-01',
      end_date: '2099-08-02',
    }];
    const dry = await runner.run(sa, 'active_plans', byPhone, importActivePlans);
    expect(dry.counts).toMatchObject({ created: 1, error: 0 });

    const unknownPhone = [{
      legacy_id: 'plan-ap-3',
      order_number: 'LEG-AP-1003',
      customer_phone: '0509998887', // no such customer -> error row, not a false match
      package_name: 'Legacy Active Plan',
      start_date: '2099-08-01',
      end_date: '2099-08-02',
    }];
    const miss = await runner.run(sa, 'active_plans', unknownPhone, importActivePlans);
    expect(miss.counts).toMatchObject({ error: 1 });
  });

  // Option B: frozen legacy delivery (method/time/area) stored on create + backfilled
  // idempotently onto already-imported orders.
  it('stores frozen legacy delivery on create and backfills it idempotently on re-import', async () => {
    // the runner enforces dry-run-before-apply (same source hash)
    const applyRows = async (rows: Array<Record<string, unknown>>) => {
      await runner.run(sa, 'active_plans', rows, importActivePlans);
      return runner.run(sa, 'active_plans', rows, importActivePlans, { apply: true });
    };
    const base = {
      legacy_id: 'plan-deliv-1', order_number: 'LEG-DELIV-1',
      customer_legacy_id: 'cust-ap-1', package_name: 'Legacy Active Plan',
      start_date: '2099-09-01', end_date: '2099-09-02',
    };
    // 1) create WITHOUT delivery -> all three frozen columns null
    await applyRows([base]);
    let o = await pool.query(
      `SELECT delivery_method_frozen, delivery_time_frozen, delivery_area_frozen FROM customer_order WHERE order_number='LEG-DELIV-1'`,
    );
    expect(o.rows[0]).toMatchObject({ delivery_method_frozen: null, delivery_time_frozen: null, delivery_area_frozen: null });

    // 2) re-import (matched) WITH delivery -> backfilled, message present
    const withDelivery = [{ ...base, delivery_method: 'اترك الصندوق عند الباب', delivery_time: '5am-4pm', area: 'Jabriya' }];
    const back = await applyRows(withDelivery);
    expect(back.counts).toMatchObject({ created: 0, matched: 1 });
    expect(back.rows[0].messages).toContain('delivery_backfilled');
    o = await pool.query(
      `SELECT delivery_method_frozen, delivery_time_frozen, delivery_area_frozen FROM customer_order WHERE order_number='LEG-DELIV-1'`,
    );
    expect(o.rows[0]).toMatchObject({ delivery_method_frozen: 'اترك الصندوق عند الباب', delivery_time_frozen: '5am-4pm', delivery_area_frozen: 'Jabriya' });

    // 3) idempotent: a later re-import with a DIFFERENT method does NOT overwrite the stored snapshot
    const changed = [{ ...base, delivery_method: 'OTHER', delivery_time: 'OTHER', area: 'OTHER' }];
    const again = await applyRows(changed);
    expect(again.rows[0].messages ?? []).not.toContain('delivery_backfilled');
    o = await pool.query(`SELECT delivery_method_frozen FROM customer_order WHERE order_number='LEG-DELIV-1'`);
    expect(o.rows[0].delivery_method_frozen).toBe('اترك الصندوق عند الباب');

    // 4) create path: a NEW order carrying delivery stores it directly
    const newWithDelivery = [{
      legacy_id: 'plan-deliv-2', order_number: 'LEG-DELIV-2', customer_legacy_id: 'cust-ap-1',
      package_name: 'Legacy Active Plan', start_date: '2099-09-03', end_date: '2099-09-04',
      delivery_method: 'رن الجرس عند الوصول', delivery_time: 'morning', area: 'Salwa',
    }];
    await applyRows(newWithDelivery);
    const o2 = await pool.query(
      `SELECT delivery_method_frozen, delivery_area_frozen FROM customer_order WHERE order_number='LEG-DELIV-2'`,
    );
    expect(o2.rows[0]).toMatchObject({ delivery_method_frozen: 'رن الجرس عند الوصول', delivery_area_frozen: 'Salwa' });
  });
});
