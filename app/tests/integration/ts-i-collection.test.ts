import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { newId } from '../../apps/api/src/platform/ids';
import { AuditService } from '../../apps/api/src/platform/audit/audit.service';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service';
import { BarcodeService } from '../../apps/api/src/modules/m25-label/barcode.service';
import { CollectionService } from '../../apps/api/src/modules/m25-label/collection.service';
import type {
  FleetbaseDriverContext,
} from '../../apps/api/src/modules/m25-label/fleetbase-identity.service';
import type { StaffContext } from '../../apps/api/src/platform/auth/session.service';

// TS-I — Fleetbase-authorized daily box collection (WP-LBL-A28).
// Fleetbase identity and exact Fleetbase order assignments are the only collection authority.
// Every outcome is audited, assignment failures disclose no customer PII, and accepted rows retain
// the Fleetbase user/driver/order proof while the retired synthetic driver/route columns stay null.

let pool: Pool;
let barcodes: BarcodeService;
let collection: CollectionService;

const DATE = '2099-05-12';
const OTHER_DATE = '2099-05-13';

const driverOne: FleetbaseDriverContext = {
  actorId: 'fleetbase:user-1',
  actorRole: 'fleetbase_driver',
  userUuid: 'user-1',
  driverId: 'driver_1',
  driverRef: 'A1',
  assignedOrders: [],
};
const driverTwo: FleetbaseDriverContext = {
  actorId: 'fleetbase:user-2',
  actorRole: 'fleetbase_driver',
  userUuid: 'user-2',
  driverId: 'driver_2',
  driverRef: 'A2',
  assignedOrders: [],
};
const opsActor: StaffContext = {
  staffId: 'fleetbase:ops-1',
  name: 'Fleet-Ops user',
  email: '',
  locale: 'en',
  roles: ['ops_manager'],
  sessionId: 'fleetbase',
};

beforeAll(async () => {
  pool = await freshDb();
  const audit = new AuditService();
  barcodes = new BarcodeService(pool, audit);
  collection = new CollectionService(pool, audit, barcodes, new IdempotencyService());
}, 60_000);

afterAll(async () => { await pool.end(); });

interface Seeded {
  customerId: string;
  orderId: string;
  orderNumber: string;
  fleetbaseOrderId: string;
  barcode: string;
}

async function seedCustomer(opts: {
  name: string;
  orderNo: string;
  days?: Array<{ date: string; status?: string }>;
  assignTo?: FleetbaseDriverContext | null;
  phone?: string;
}): Promise<Seeded> {
  const customerId = newId();
  const orderId = newId();
  const fleetbaseOrderId = `order_${orderId}`;
  await pool.query(
    `INSERT INTO customer (id, full_name_en, created_by) VALUES ($1,$2,'test')`,
    [customerId, opts.name],
  );
  await pool.query(
    `INSERT INTO customer_phone
       (id, customer_id, phone_normalized, phone_raw, is_primary, created_by)
     VALUES ($1,$2,$3,$3,true,'test')`,
    [newId(), customerId, opts.phone ?? '+96550000000'],
  );
  await pool.query(
    `INSERT INTO customer_order
       (id, order_number, customer_id, status, start_date, end_date, channel, total, created_by,
        delivery_time_frozen, delivery_area_frozen)
     VALUES ($1,$2,$3,'active','2099-05-01','2099-05-31','phone',0,'test','From 5 AM to 4 PM','Salmiya')`,
    [orderId, opts.orderNo, customerId],
  );
  for (const d of opts.days ?? [{ date: DATE }]) {
    await pool.query(
      `INSERT INTO fulfillment_day (id, order_id, date, status, address_frozen, created_by)
       VALUES ($1,$2,$3,$4,'{}','test')`,
      [newId(), orderId, d.date, d.status ?? 'scheduled'],
    );
  }
  if (opts.assignTo) {
    opts.assignTo.assignedOrders.push({
      fleetbaseOrderId,
      localOrderId: orderId,
      orderNumber: opts.orderNo,
    });
  }
  const bc = await barcodes.issueFor(opsActor, customerId);
  return {
    customerId,
    orderId,
    orderNumber: opts.orderNo,
    fleetbaseOrderId,
    barcode: bc.barcode_value,
  };
}

async function auditCount(eventType: string, customerId: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM audit_event
      WHERE event_type=$1 AND related_refs->>'customer_id'=$2`,
    [eventType, customerId],
  );
  return rows[0].n as number;
}

describe('TS-I collection — Fleetbase assignment and seven outcomes', () => {
  it('accepted: persists the verified Fleetbase identity and assignment', async () => {
    const s = await seedCustomer({ name: 'Accepted Cust', orderNo: 'N-COL-OK', assignTo: driverOne });
    const res = await collection.scan(driverOne, { barcode: s.barcode, delivery_date: DATE });

    expect(res.outcome).toBe('accepted');
    expect(res.customer_name).toBe('Accepted Cust');
    expect(res.order_number).toBe('N-COL-OK');
    expect(res.area).toBe('Salmiya');
    expect(res.phone).toBe('+96550000000');
    expect(res.delivery_date).toBe(DATE);
    expect(res.collected_at).toBeTruthy();
    expect(res.message_ar).toBeTruthy();
    expect(await auditCount('collection.accepted', s.customerId)).toBe(1);

    const { rows } = await pool.query(
      `SELECT fleetbase_user_uuid, fleetbase_driver_id, fleetbase_order_id, driver_id, route_id
         FROM box_collection WHERE customer_id=$1 AND delivery_date=$2`,
      [s.customerId, DATE],
    );
    expect(rows).toEqual([expect.objectContaining({
      fleetbase_user_uuid: driverOne.userUuid,
      fleetbase_driver_id: driverOne.driverId,
      fleetbase_order_id: s.fleetbaseOrderId,
      driver_id: null,
      route_id: null,
    })]);
  });

  it('duplicate: the same customer cannot be collected twice on the same day', async () => {
    const s = await seedCustomer({ name: 'Dup Cust', orderNo: 'N-COL-DUP', assignTo: driverOne });
    const first = await collection.scan(driverOne, { barcode: s.barcode, delivery_date: DATE });
    const second = await collection.scan(driverOne, { barcode: s.barcode, delivery_date: DATE });

    expect(first.outcome).toBe('accepted');
    expect(second.outcome).toBe('duplicate');
    expect(second.collected_at).toBe(first.collected_at);
    expect(await auditCount('collection.duplicate', s.customerId)).toBe(1);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM box_collection WHERE customer_id=$1 AND delivery_date=$2`,
      [s.customerId, DATE],
    );
    expect(rows[0].n).toBe(1);
  });

  it('wrong_driver: refuses another driver and discloses no customer data', async () => {
    const s = await seedCustomer({
      name: 'Other Driver Cust',
      orderNo: 'N-COL-WD',
      assignTo: driverTwo,
      phone: '+96551111111',
    });
    const res = await collection.scan(driverOne, { barcode: s.barcode, delivery_date: DATE });

    expect(res.outcome).toBe('wrong_driver');
    expect(res.customer_id).toBeNull();
    expect(res.customer_name).toBeNull();
    expect(res.order_number).toBeNull();
    expect(res.area).toBeNull();
    expect(res.phone).toBeNull();
    expect(res.assigned_driver_ref).toBeNull();
    expect(await auditCount('collection.wrong_driver', s.customerId)).toBe(1);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM box_collection WHERE customer_id=$1`, [s.customerId],
    );
    expect(rows[0].n).toBe(0);
  });

  it('wrong_driver: an order on nobody’s Fleetbase manifest is refused', async () => {
    const s = await seedCustomer({ name: 'Unassigned Cust', orderNo: 'N-COL-UN', assignTo: null });
    const res = await collection.scan(driverOne, { barcode: s.barcode, delivery_date: DATE });
    expect(res.outcome).toBe('wrong_driver');
    expect(res.customer_name).toBeNull();
    expect(res.phone).toBeNull();
  });

  it('fails closed when Fleetbase metadata gives a local id and a conflicting order number', async () => {
    const assigned = await seedCustomer({
      name: 'Exact Id Cust',
      orderNo: 'N-COL-EXACT',
      assignTo: null,
    });
    const conflicting = await seedCustomer({
      name: 'Conflicting Number Cust',
      orderNo: 'N-COL-CONFLICT',
      assignTo: null,
    });
    const contradictoryContext: FleetbaseDriverContext = {
      ...driverOne,
      assignedOrders: [{
        fleetbaseOrderId: 'order_contradictory',
        localOrderId: assigned.orderId,
        orderNumber: conflicting.orderNumber,
      }],
    };

    const res = await collection.scan(
      contradictoryContext,
      { barcode: conflicting.barcode, delivery_date: DATE },
    );
    expect(res.outcome).toBe('wrong_driver');
    expect(res.customer_id).toBeNull();
    expect(res.customer_name).toBeNull();
    expect(res.phone).toBeNull();
  });

  it('no_delivery_today: the customer has no scheduled day on this date', async () => {
    const s = await seedCustomer({
      name: 'No Delivery Cust',
      orderNo: 'N-COL-ND',
      days: [{ date: OTHER_DATE }],
      assignTo: driverOne,
    });
    const res = await collection.scan(driverOne, { barcode: s.barcode, delivery_date: DATE });
    expect(res.outcome).toBe('no_delivery_today');
    expect(res.customer_id).toBeNull();
    expect(res.customer_name).toBeNull();
    expect(res.phone).toBeNull();
    expect(await auditCount('collection.no_delivery_today', s.customerId)).toBe(1);
  });

  it('cancelled: assigned driver sees the cancelled outcome and their own stop data', async () => {
    const s = await seedCustomer({
      name: 'Cancelled Cust',
      orderNo: 'N-COL-CX',
      days: [{ date: DATE, status: 'cancelled_day' }],
      assignTo: driverOne,
    });
    const res = await collection.scan(driverOne, { barcode: s.barcode, delivery_date: DATE });
    expect(res.outcome).toBe('cancelled');
    expect(res.customer_name).toBe('Cancelled Cust');
    expect(res.phone).toBe('+96550000000');
    expect(await auditCount('collection.cancelled', s.customerId)).toBe(1);
  });

  it('unknown_barcode: an unrecognised code is refused and audited', async () => {
    const res = await collection.scan(driverOne, { barcode: 'NZC-ZZZZ-ZZZZ-ZZ', delivery_date: DATE });
    expect(res.outcome).toBe('unknown_barcode');
    expect(res.customer_id).toBeNull();

    const other = await collection.scan(driverOne, { barcode: '4901234567894', delivery_date: DATE });
    expect(other.outcome).toBe('unknown_barcode');

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM audit_event WHERE event_type='collection.unknown_barcode'`,
    );
    expect(rows[0].n).toBe(2);
  });

  it('ambiguous_delivery: refuses to guess and discloses no customer data', async () => {
    const s = await seedCustomer({ name: 'Ambiguous Cust', orderNo: 'N-COL-AM1', assignTo: driverOne });
    const secondOrder = newId();
    await pool.query(
      `INSERT INTO customer_order
         (id, order_number, customer_id, status, start_date, end_date, channel, total, created_by)
       VALUES ($1,'N-COL-AM2',$2,'active','2099-05-01','2099-05-31','phone',0,'test')`,
      [secondOrder, s.customerId],
    );
    await pool.query(
      `INSERT INTO fulfillment_day (id, order_id, date, status, address_frozen, created_by)
       VALUES ($1,$2,$3,'scheduled','{}','test')`,
      [newId(), secondOrder, DATE],
    );

    const res = await collection.scan(driverOne, { barcode: s.barcode, delivery_date: DATE });
    expect(res.outcome).toBe('ambiguous_delivery');
    expect(res.customer_id).toBeNull();
    expect(res.customer_name).toBeNull();
    expect(res.order_number).toBeNull();
    expect(res.phone).toBeNull();
    expect(await auditCount('collection.ambiguous_delivery', s.customerId)).toBe(1);
  });
});

describe('TS-I collection — merge, idempotency, manifest, immutability', () => {
  it('an aliased barcode still collects for the surviving customer', async () => {
    const survivor = await seedCustomer({ name: 'Survivor', orderNo: 'N-COL-SV', assignTo: driverOne });
    const merged = await seedCustomer({ name: 'Merged Away', orderNo: 'N-COL-MG', assignTo: driverOne });

    await pool.query(
      `UPDATE customer_barcode
          SET customer_id=$1, pre_merge_status=status, status='alias',
              merged_from_customer_id=$2, merged_at=now()
        WHERE customer_id=$2`,
      [survivor.customerId, merged.customerId],
    );

    const res = await collection.scan(driverOne, { barcode: merged.barcode, delivery_date: DATE });
    expect(res.outcome).toBe('accepted');
    expect(res.customer_id).toBe(survivor.customerId);
    expect(res.order_number).toBe('N-COL-SV');
  });

  it('same-driver retry repeats accepted; another driver cannot replay it', async () => {
    const s = await seedCustomer({ name: 'Retry Cust', orderNo: 'N-COL-RT', assignTo: driverOne });
    const key = `scan-${newId()}`;

    const first = await collection.scan(driverOne, { barcode: s.barcode, delivery_date: DATE }, key);
    const retry = await collection.scan(driverOne, { barcode: s.barcode, delivery_date: DATE }, key);
    const crossDriver = await collection.scan(driverTwo, { barcode: s.barcode, delivery_date: DATE }, key);
    const withoutKey = await collection.scan(driverOne, { barcode: s.barcode, delivery_date: DATE });

    expect(first.outcome).toBe('accepted');
    expect(retry.outcome).toBe('accepted');
    expect(retry.collected_at).toBe(first.collected_at);
    expect(crossDriver.outcome).toBe('wrong_driver');
    expect(crossDriver.customer_name).toBeNull();
    expect(withoutKey.outcome).toBe('duplicate');
  });

  it('concurrent scans still record exactly one collection', async () => {
    const s = await seedCustomer({ name: 'Concurrent Cust', orderNo: 'N-COL-CC', assignTo: driverOne });
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        collection.scan(driverOne, { barcode: s.barcode, delivery_date: DATE })),
    );
    expect(results.filter((r) => r.outcome === 'accepted')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'duplicate')).toHaveLength(3);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM box_collection WHERE customer_id=$1`, [s.customerId],
    );
    expect(rows[0].n).toBe(1);
  });

  it('manifest contains only exact Fleetbase assignments for the current driver', async () => {
    const mine = await collection.manifest(driverOne, DATE);
    const theirs = await collection.manifest(driverTwo, DATE);

    expect(mine.driver_ref).toBe('A1');
    expect(mine.total).toBe(mine.collected + mine.remaining);
    expect(mine.entries).toHaveLength(mine.total);
    expect(mine.collected).toBeGreaterThan(0);
    expect(mine.entries.every((entry) => typeof entry.phone === 'string')).toBe(true);
    expect(theirs.driver_ref).toBe('A2');
    expect(theirs.collected).toBe(0);
    const mineIds = new Set(mine.entries.map((entry) => entry.customer_id));
    expect(theirs.entries.some((entry) => mineIds.has(entry.customer_id))).toBe(false);
  });

  it('collections are append-only at the database level', async () => {
    const { rows } = await pool.query('SELECT id FROM box_collection LIMIT 1');
    const id = rows[0].id as string;
    await expect(pool.query(`UPDATE box_collection SET device_ref='tamper' WHERE id=$1`, [id]))
      .rejects.toThrow(/append-only/i);
    await expect(pool.query(`DELETE FROM box_collection WHERE id=$1`, [id]))
      .rejects.toThrow(/append-only/i);
  });
});
