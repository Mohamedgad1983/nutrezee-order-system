import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { AuditReadQueue, AuditService } from '../../apps/api/src/platform/audit/audit.service';
import { OutboxService } from '../../apps/api/src/platform/outbox/outbox.service';
import { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import { TransitionEngine } from '../../apps/api/src/platform/transition/transition-engine';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service';
import type { StaffContext } from '../../apps/api/src/platform/auth/session.service';
import type { DraftService } from '../../apps/api/src/modules/m01-intake/draft.service';
import type { ReviewService } from '../../apps/api/src/modules/m02-review/review.service';
import { CustomerService } from '../../apps/api/src/modules/m04-customers/customer.service';
import { CatalogService } from '../../apps/api/src/modules/m05-catalog/catalog.service';
import { OrderService } from '../../apps/api/src/modules/m03-orders/order.service';
import { PaymentService } from '../../apps/api/src/modules/m07-payments/payment.service';
import { SyncRecordService } from '../../apps/api/src/modules/m18-bridge/sync-record.service';
import { BatchRunner } from '../../apps/api/src/modules/m19-migration/batch-runner';
import { MigrationService } from '../../apps/api/src/modules/m19-migration/migration.service';
import {
  PartnerDailyFeedClient, type PartnerDailyFeedGateway,
} from '../../apps/api/src/modules/m19-migration/partner-daily-feed';
import { BarcodeService } from '../../apps/api/src/modules/m25-label/barcode.service';
import { CollectionService } from '../../apps/api/src/modules/m25-label/collection.service';
import type { FleetbaseDriverContext } from '../../apps/api/src/modules/m25-label/fleetbase-identity.service';

// TS-I — WP-OPS-06 (A47): Partner daily-deliveries → customer_order / fulfillment_day mirror
// through the governed M19 batch runner, then proven end-to-end by the Fleetbase collection scan.

let pool: Pool;
let migrations: MigrationService;
let collection: CollectionService;
let barcodes: BarcodeService;
let feedRows: Record<string, unknown[]> = {};

const DATE = '2099-09-05';
const NEXT = '2099-09-06';
const sa: StaffContext = {
  staffId: 'sa-ops06', name: 'SA OPS06', email: 'sa-ops06@t', locale: 'en', roles: ['super_admin'], sessionId: 's-ops06',
};
const opsActor: StaffContext = {
  staffId: 'fleetbase:ops-1', name: 'Fleet-Ops user', email: '', locale: 'en', roles: ['ops_manager'], sessionId: 'fleetbase',
};

function delivery(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    delivery_id: 501, order_id: 31, order_number: '28669', delivery_date: DATE, customer_ref: '11365',
    customer: { name: 'Daily Customer', phone: '97497260' },
    address: { text: 'Rawda B:4 S:424 H:30', area_en: 'Rawda', area_ar: 'الروضة' },
    location_pin: '29.3000,48.0000', is_cancelled: false, is_on_hold: false,
    order_status: 'success', delivery_status: 'driver_assigned', hold_state: 'scheduled', meal_item_count: 3,
    driver: { id: 19033, name: 'RAVI RAVI' }, delivery_method: 'Leave the box', driver_instructions: null,
    time_slot: { id: 1, title: 'From 5 AM to 4 PM', start: '05:00', end: '16:00' },
    updated_at: '2099-09-04T10:00:00+03:00',
    ...overrides,
  };
}

function feed(): PartnerDailyFeedGateway {
  return new PartnerDailyFeedClient({
    baseUrl: 'https://nutreeze.com/integration',
    apiKey: 'test-key',
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      const date = url.searchParams.get('delivery_date')!;
      const data = feedRows[date] ?? [];
      return new Response(JSON.stringify({
        data, count: data.length, mode: 'live', server_time: '2099-09-04T10:00:00+03:00', next_cursor: null,
        completeness: {
          snapshot_built_at: 'x', snapshot_age_seconds: 1, refresh_interval_minutes: 5, rows_in_window: data.length,
          window_from: '2099-09-01', window_to: '2099-09-30',
          per_date: data.length === 0 ? [] : [{
            delivery_date: date, deliveries: data.length,
            distinct_orders: new Set(data.map((d) => (d as Record<string, unknown>)['order_number'])).size,
            scheduled: data.filter((d) => !(d as Record<string, unknown>)['is_cancelled'] && !(d as Record<string, unknown>)['is_on_hold']).length,
            on_hold: data.filter((d) => (d as Record<string, unknown>)['is_on_hold'] === true).length,
            cancelled: data.filter((d) => (d as Record<string, unknown>)['is_cancelled'] === true).length,
          }],
        },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    },
  });
}

beforeAll(async () => {
  pool = await freshDb();
  await pool.query(`INSERT INTO setting (id, key, value, value_type, created_by)
                    VALUES ('setting-test-phone-cc', 'default_phone_country_code', '"+965"', 'text', 'test')
                    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`);
  const audit = new AuditService();
  const outbox = new OutboxService();
  const settings = new SettingsReader(pool, 0);
  const sync = new SyncRecordService();
  const customers = new CustomerService(pool, audit, new AuditReadQueue(pool, audit), outbox, settings);
  const catalog = new CatalogService(pool, audit, settings);
  const engine = new TransitionEngine(pool, audit, outbox, 0);
  const orders = new OrderService(pool, audit, outbox, settings, engine, {} as DraftService, {} as ReviewService, customers, catalog);
  const payments = new PaymentService(pool, audit, outbox, engine, orders);
  const runner = new BatchRunner(pool, audit, outbox, sync, { orders, payments, customers, catalog });
  migrations = new MigrationService(runner, customers, catalog, sync, orders, payments, settings, feed());
  barcodes = new BarcodeService(pool, audit);
  collection = new CollectionService(pool, audit, barcodes, new IdempotencyService(), async () => DATE);
}, 60_000);

afterAll(async () => {
  await pool.end();
});

describe('TS-I Partner daily feed → Nutrezee orders (WP-OPS-06)', () => {
  it('dry-run reports without business writes; apply creates customer, order and day keyed by phone/order_number', async () => {
    feedRows = { [DATE]: [
      delivery(),
      delivery({ delivery_id: 502, meal_item_count: 4, updated_at: '2099-09-04T11:00:00+03:00' }), // repeat row
      delivery({ delivery_id: 503, order_id: 32, order_number: '27788', customer_ref: '5908', customer: { name: 'Second', phone: '50266999' }, is_on_hold: true, driver: { id: null, name: null } }),
      delivery({ delivery_id: 504, order_id: 33, order_number: '27500', customer_ref: '664', customer: { name: 'Third', phone: '9749 7260' } }), // same phone as first
    ] };
    const dry = await migrations.runPartnerDaily(sa, DATE, false);
    expect(dry.dryRun).toBe(true);
    expect(dry.source).toMatchObject({ delivery_rows: 4, distinct_orders: 3, orders_without_partner_driver: 1, on_hold: 1 });
    expect(dry.counts).toMatchObject({ created: 3, error: 0 });
    expect((await pool.query('SELECT count(*)::int AS n FROM customer_order')).rows[0].n).toBe(0);

    const applied = await migrations.runPartnerDaily(sa, DATE, true);
    expect(applied.dryRun).toBe(false);
    expect(applied.counts).toMatchObject({ created: 3, error: 0 });

    const orders = await pool.query(
      `SELECT co.order_number, co.status, co.start_date::text AS s, co.end_date::text AS e, co.channel, co.currency,
              co.delivery_area_frozen, co.delivery_time_frozen, fd.status AS day_status, fd.address_frozen, p.phone_normalized
         FROM customer_order co JOIN fulfillment_day fd ON fd.order_id = co.id
         JOIN customer_phone p ON p.customer_id = co.customer_id AND p.is_primary
        ORDER BY co.order_number`,
    );
    expect(orders.rows.map((r) => r.order_number)).toEqual(['27500', '27788', '28669']);
    expect(orders.rows[2]).toMatchObject({
      status: 'active', s: DATE, e: DATE, channel: 'partner', currency: 'KWD', delivery_area_frozen: 'Rawda',
      delivery_time_frozen: 'From 5 AM to 4 PM', day_status: 'scheduled', phone_normalized: '+96597497260',
    });
    expect(orders.rows[2].address_frozen).toMatchObject({ partner_import: true, partner_customer_ref: '11365', location_pin: '29.3000,48.0000' });
    expect(orders.rows[1].day_status).toBe('skipped'); // on hold
    // one customer for the shared phone, two customers total
    expect((await pool.query('SELECT count(*)::int AS n FROM customer')).rows[0].n).toBe(2);
    expect(orders.rows[0].phone_normalized).toBe('+96597497260');
    const sync = await pool.query(`SELECT object_type, legacy_key FROM sync_record ORDER BY object_type, legacy_key`);
    expect(sync.rows).toEqual(expect.arrayContaining([
      { object_type: 'order', legacy_key: '28669' }, { object_type: 'customer', legacy_key: '+96597497260' },
    ]));
    const audit = await pool.query(`SELECT count(*)::int AS n FROM audit_event WHERE event_type = 'bridge.import_run'`);
    expect(audit.rows[0].n).toBe(2);
  });

  it('re-run is idempotent; a new date adds a day and widens the order range; cancellation mirrors to cancelled_day', async () => {
    const again = await migrations.runPartnerDaily(sa, DATE, false);
    expect(again.counts).toMatchObject({ created: 0, matched: 3, error: 0 });
    expect(again.rows.every((r) => r.messages.includes('day_unchanged'))).toBe(true);

    feedRows[NEXT] = [
      delivery({ delivery_id: 601, delivery_date: NEXT, updated_at: '2099-09-05T10:00:00+03:00' }),
      delivery({ delivery_id: 602, delivery_date: NEXT, order_id: 32, order_number: '27788', customer_ref: '5908', customer: { name: 'Second', phone: '50266999' }, is_cancelled: true, updated_at: '2099-09-05T10:00:00+03:00' }),
    ];
    await migrations.runPartnerDaily(sa, NEXT, false);
    const next = await migrations.runPartnerDaily(sa, NEXT, true);
    expect(next.counts).toMatchObject({ created: 0, matched: 2, error: 0 });
    const days = await pool.query(
      `SELECT co.order_number, fd.date::text AS d, fd.status, co.start_date::text AS s, co.end_date::text AS e
         FROM fulfillment_day fd JOIN customer_order co ON co.id = fd.order_id ORDER BY co.order_number, fd.date`,
    );
    expect(days.rows).toEqual([
      { order_number: '27500', d: DATE, status: 'scheduled', s: DATE, e: DATE },
      { order_number: '27788', d: DATE, status: 'skipped', s: DATE, e: NEXT },
      { order_number: '27788', d: NEXT, status: 'cancelled_day', s: DATE, e: NEXT },
      { order_number: '28669', d: DATE, status: 'scheduled', s: DATE, e: NEXT },
      { order_number: '28669', d: NEXT, status: 'scheduled', s: DATE, e: NEXT },
    ]);
    const history = await pool.query(`SELECT to_status FROM order_status_history WHERE subject = 'fulfillment_day' ORDER BY at`);
    expect(history.rows.map((r) => r.to_status)).toEqual(expect.arrayContaining(['skipped', 'cancelled_day']));

    // Partner un-holds the second order for DATE -> back to scheduled; a delivered day is never touched.
    await pool.query(`UPDATE fulfillment_day SET status = 'delivered' WHERE date = $1 AND order_id = (SELECT id FROM customer_order WHERE order_number = '27500')`, [DATE]);
    feedRows[DATE] = feedRows[DATE]!.map((d) => (d as Record<string, unknown>)['order_number'] === '27788'
      ? { ...(d as Record<string, unknown>), is_on_hold: false, updated_at: '2099-09-05T12:00:00+03:00' } : d);
    await migrations.runPartnerDaily(sa, DATE, false);
    const rerun = await migrations.runPartnerDaily(sa, DATE, true);
    const byOrder = new Map(rerun.rows.map((r) => [feedOrder(r.rowNo), r.messages]));
    expect(byOrder.get('27788')).toContain('day_updated');
    expect(byOrder.get('27500')).toContain('day_locked');
    const statuses = await pool.query(`SELECT co.order_number, fd.status FROM fulfillment_day fd JOIN customer_order co ON co.id = fd.order_id WHERE fd.date = $1 ORDER BY 1`, [DATE]);
    expect(statuses.rows).toEqual([
      { order_number: '27500', status: 'delivered' }, { order_number: '27788', status: 'scheduled' }, { order_number: '28669', status: 'scheduled' },
    ]);
  });

  it('proves the chain: an imported customer barcode scans as accepted for the Fleetbase-assigned order', async () => {
    // Customer "Second" (order 27788) has exactly one live delivery on DATE after Partner un-held it.
    const order = (await pool.query(`SELECT id, customer_id FROM customer_order WHERE order_number = '27788'`)).rows[0];
    const barcode = await barcodes.issueFor(opsActor, order.customer_id as string);
    const driver: FleetbaseDriverContext = {
      actorId: 'fleetbase:user-9', actorRole: 'fleetbase_driver', userUuid: 'user-9', driverId: 'driver_ioPJGOyvvu',
      driverRef: 'NU472415',
      assignedOrders: [{ fleetbaseOrderId: 'order_x', localOrderId: order.id as string, orderNumber: '27788' }],
    };
    const wrong: FleetbaseDriverContext = { ...driver, driverId: 'driver_other', assignedOrders: [] };
    expect((await collection.scan(wrong, { barcode: barcode.barcode_value })).outcome).toBe('wrong_driver');
    const result = await collection.scan(driver, { barcode: barcode.barcode_value });
    expect(result.outcome).toBe('accepted');
    expect(result.order_number).toBe('27788');
    expect(result.area).toBe('Rawda');
    // A family sharing one phone (orders 28669 + 27500 on the same day) is deliberately ambiguous.
    const shared = (await pool.query(`SELECT customer_id FROM customer_order WHERE order_number = '28669'`)).rows[0];
    const sharedBarcode = await barcodes.issueFor(opsActor, shared.customer_id as string);
    expect((await collection.scan(driver, { barcode: sharedBarcode.barcode_value })).outcome).toBe('ambiguous_delivery');
  });

  it('rejects a feed that contradicts itself and refuses apply without a same-snapshot dry-run', async () => {
    feedRows['2099-09-07'] = [delivery({ delivery_id: 701, delivery_date: '2099-09-07' }), delivery({ delivery_id: 702, delivery_date: '2099-09-07', customer: { name: 'X', phone: '11111111' } })];
    await expect(migrations.runPartnerDaily(sa, '2099-09-07', false)).rejects.toMatchObject({ code: 'contract_violation' });
    feedRows['2099-09-08'] = [delivery({ delivery_id: 801, delivery_date: '2099-09-08' })];
    await expect(migrations.runPartnerDaily(sa, '2099-09-08', true)).rejects.toMatchObject({ code: 'dry_run_required' });
  });
});

function feedOrder(rowNo: number): string {
  // canonical rows are sorted by order_number: 27500, 27788, 28669
  return ['27500', '27788', '28669'][rowNo - 1]!;
}
