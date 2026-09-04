import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { newId } from '../../apps/api/src/platform/ids';
import { AuditService } from '../../apps/api/src/platform/audit/audit.service';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service';
import { BarcodeService } from '../../apps/api/src/modules/m25-label/barcode.service';
import { CollectionService } from '../../apps/api/src/modules/m25-label/collection.service';
import type { StaffContext } from '../../apps/api/src/platform/auth/session.service';

// TS-I — daily box collection scan (WP-LBL-03, amendment A27).
// Every one of the seven approved outcomes is exercised, plus duplicate prevention, idempotent
// retry, the driver manifest, and the rule that EVERY outcome (accepted or rejected) is audited.

let pool: Pool;
let barcodes: BarcodeService;
let collection: CollectionService;

const DATE = '2099-05-12';
const OTHER_DATE = '2099-05-13';

/** Two drivers, each signed in as their own staff user. */
const driverOne: StaffContext = {
  staffId: 'staff-driver-1', name: 'Driver One', email: 'd1@t', locale: 'en',
  roles: ['driver'], sessionId: 's1',
};
const driverTwo: StaffContext = {
  staffId: 'staff-driver-2', name: 'Driver Two', email: 'd2@t', locale: 'en',
  roles: ['driver'], sessionId: 's2',
};
const opsActor: StaffContext = {
  staffId: 'ops-1', name: 'Ops', email: 'o@t', locale: 'en', roles: ['ops_manager'], sessionId: 's',
};

let driverOneId: string;
let driverTwoId: string;
let routeOne: string;
let routeTwo: string;

beforeAll(async () => {
  pool = await freshDb();
  const audit = new AuditService();
  barcodes = new BarcodeService(pool, audit);
  collection = new CollectionService(pool, audit, barcodes, new IdempotencyService());

  driverOneId = await seedDriver(driverOne.staffId, 'Driver One', 'A1');
  driverTwoId = await seedDriver(driverTwo.staffId, 'Driver Two', 'A2');
  routeOne = await seedRoute(driverOneId, DATE);
  routeTwo = await seedRoute(driverTwoId, DATE);
}, 60_000);

afterAll(async () => { await pool.end(); });

async function seedDriver(staffUserId: string, name: string, legacyRef: string): Promise<string> {
  await pool.query(
    `INSERT INTO staff_user (id, name_en, email, created_by) VALUES ($1,$2,$3,'test')`,
    [staffUserId, name, `${staffUserId}@test.local`],
  );
  const id = newId();
  await pool.query(
    `INSERT INTO driver (id, legacy_driver_id, name, active, staff_user_id, created_by)
     VALUES ($1,$2,$3,true,$4,'test')`,
    [id, legacyRef, name, staffUserId],
  );
  return id;
}

async function seedRoute(driverId: string, date: string): Promise<string> {
  const id = newId();
  await pool.query(
    `INSERT INTO delivery_route (id, driver_id, delivery_date, status, created_by)
     VALUES ($1,$2,$3,'assigned','test')`,
    [id, driverId, date],
  );
  return id;
}

interface Seeded { customerId: string; orderId: string; barcode: string }

async function seedCustomer(opts: {
  name: string; orderNo: string;
  days?: Array<{ date: string; status?: string }>;
  assignTo?: string | null;   // route id, or null for "scheduled but unassigned"
}): Promise<Seeded> {
  const customerId = newId();
  const orderId = newId();
  await pool.query(
    `INSERT INTO customer (id, full_name_en, created_by) VALUES ($1,$2,'test')`,
    [customerId, opts.name],
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
    await pool.query(
      `INSERT INTO delivery_route_order (id, route_id, order_id, customer_id, status, created_by)
       VALUES ($1,$2,$3,$4,'assigned','test')`,
      [newId(), opts.assignTo, orderId, customerId],
    );
  }
  const bc = await barcodes.issueFor(opsActor, customerId);
  return { customerId, orderId, barcode: bc.barcode_value };
}

async function auditCount(eventType: string, customerId: string): Promise<number> {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM audit_event
      WHERE event_type=$1 AND related_refs->>'customer_id'=$2`,
    [eventType, customerId],
  );
  return rows[0].n as number;
}

describe('TS-I collection — the seven approved outcomes', () => {
  it('accepted: the assigned driver collects the daily box', async () => {
    const s = await seedCustomer({ name: 'Accepted Cust', orderNo: 'N-COL-OK', assignTo: routeOne });
    const res = await collection.scan(driverOne, { barcode: s.barcode, delivery_date: DATE });

    expect(res.outcome).toBe('accepted');
    expect(res.customer_name).toBe('Accepted Cust');
    expect(res.order_number).toBe('N-COL-OK');
    expect(res.delivery_date).toBe(DATE);
    expect(res.collected_at).toBeTruthy();
    expect(res.message_ar).toBeTruthy();
    expect(await auditCount('collection.accepted', s.customerId)).toBe(1);
  });

  it('duplicate: the same customer cannot be collected twice on the same day', async () => {
    const s = await seedCustomer({ name: 'Dup Cust', orderNo: 'N-COL-DUP', assignTo: routeOne });
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

  it('wrong_driver: a driver cannot collect another driver’s customer', async () => {
    const s = await seedCustomer({ name: 'Other Driver Cust', orderNo: 'N-COL-WD', assignTo: routeTwo });
    const res = await collection.scan(driverOne, { barcode: s.barcode, delivery_date: DATE });

    expect(res.outcome).toBe('wrong_driver');
    expect(res.assigned_driver_ref).toBe('A2');
    expect(await auditCount('collection.wrong_driver', s.customerId)).toBe(1);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM box_collection WHERE customer_id=$1`, [s.customerId],
    );
    expect(rows[0].n).toBe(0);      // nothing recorded on a rejection
  });

  it('wrong_driver: an order on nobody’s manifest is also refused', async () => {
    const s = await seedCustomer({ name: 'Unassigned Cust', orderNo: 'N-COL-UN', assignTo: null });
    const res = await collection.scan(driverOne, { barcode: s.barcode, delivery_date: DATE });
    expect(res.outcome).toBe('wrong_driver');
    expect(res.assigned_driver_ref).toBeNull();
  });

  it('no_delivery_today: the customer has no scheduled day on this date', async () => {
    const s = await seedCustomer({
      name: 'No Delivery Cust', orderNo: 'N-COL-ND',
      days: [{ date: OTHER_DATE }], assignTo: routeOne,
    });
    const res = await collection.scan(driverOne, { barcode: s.barcode, delivery_date: DATE });
    expect(res.outcome).toBe('no_delivery_today');
    expect(await auditCount('collection.no_delivery_today', s.customerId)).toBe(1);
  });

  it('cancelled: today’s delivery is cancelled', async () => {
    const s = await seedCustomer({
      name: 'Cancelled Cust', orderNo: 'N-COL-CX',
      days: [{ date: DATE, status: 'cancelled_day' }], assignTo: routeOne,
    });
    const res = await collection.scan(driverOne, { barcode: s.barcode, delivery_date: DATE });
    expect(res.outcome).toBe('cancelled');
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

  it('ambiguous_delivery: two live deliveries need operations, not a guess', async () => {
    const s = await seedCustomer({ name: 'Ambiguous Cust', orderNo: 'N-COL-AM1', assignTo: routeOne });
    // a second active order for the SAME customer on the same date
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
    expect(await auditCount('collection.ambiguous_delivery', s.customerId)).toBe(1);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM box_collection WHERE customer_id=$1`, [s.customerId],
    );
    expect(rows[0].n).toBe(0);
  });
});

describe('TS-I collection — merged customer, idempotency, manifest, immutability', () => {
  it('a barcode aliased by a merge still collects for the surviving customer', async () => {
    const survivor = await seedCustomer({ name: 'Survivor', orderNo: 'N-COL-SV', assignTo: routeOne });
    const merged = await seedCustomer({ name: 'Merged Away', orderNo: 'N-COL-MG', assignTo: routeOne });

    // simulate what the merge relink step does
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

  it('a retried scan with the same idempotency key repeats "accepted", not "duplicate"', async () => {
    const s = await seedCustomer({ name: 'Retry Cust', orderNo: 'N-COL-RT', assignTo: routeOne });
    const key = `scan-${newId()}`;

    const first = await collection.scan(driverOne, { barcode: s.barcode, delivery_date: DATE }, key);
    const retry = await collection.scan(driverOne, { barcode: s.barcode, delivery_date: DATE }, key);
    const withoutKey = await collection.scan(driverOne, { barcode: s.barcode, delivery_date: DATE });

    expect(first.outcome).toBe('accepted');
    expect(retry.outcome).toBe('accepted');
    expect(retry.collected_at).toBe(first.collected_at);
    expect(withoutKey.outcome).toBe('duplicate');   // a genuinely new scan still sees the duplicate

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM box_collection WHERE customer_id=$1`, [s.customerId],
    );
    expect(rows[0].n).toBe(1);
  });

  it('concurrent scans of the same box still record exactly one collection', async () => {
    const s = await seedCustomer({ name: 'Concurrent Cust', orderNo: 'N-COL-CC', assignTo: routeOne });
    const results = await Promise.all(
      Array.from({ length: 4 }, () => collection.scan(driverOne, { barcode: s.barcode, delivery_date: DATE })),
    );
    expect(results.filter((r) => r.outcome === 'accepted')).toHaveLength(1);
    expect(results.filter((r) => r.outcome === 'duplicate')).toHaveLength(3);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM box_collection WHERE customer_id=$1`, [s.customerId],
    );
    expect(rows[0].n).toBe(1);
  });

  it('the manifest reports assigned / collected / remaining for the signed-in driver only', async () => {
    const mine = await collection.manifest(driverOne, DATE);
    const theirs = await collection.manifest(driverTwo, DATE);

    expect(mine.driver_ref).toBe('A1');
    expect(mine.total).toBe(mine.collected + mine.remaining);
    expect(mine.entries).toHaveLength(mine.total);
    expect(mine.collected).toBeGreaterThan(0);
    // driver two only ever had the wrong_driver customer assigned, never collected
    expect(theirs.driver_ref).toBe('A2');
    expect(theirs.collected).toBe(0);
    // no customer of driver two appears on driver one's manifest
    const mineIds = new Set(mine.entries.map((e) => e.customer_id));
    expect(theirs.entries.some((e) => mineIds.has(e.customer_id))).toBe(false);
  });

  it('a staff user who is not a linked driver cannot scan or read a manifest', async () => {
    await expect(collection.scan(opsActor, { barcode: 'NZC-AAAA-AAAA-AA', delivery_date: DATE }))
      .rejects.toMatchObject({ code: 'forbidden' });
    await expect(collection.manifest(opsActor, DATE)).rejects.toMatchObject({ code: 'forbidden' });
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
