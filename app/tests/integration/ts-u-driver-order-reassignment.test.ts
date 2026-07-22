import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { AuditService } from '../../apps/api/src/platform/audit/audit.service';
import type { StaffContext } from '../../apps/api/src/platform/auth/session.service';
import { DriverOrderReassignmentService } from '../../apps/api/src/modules/m24-fleetbase/driver-order-reassignment.service';
import type { FleetbaseCredentialDriver } from '../../apps/api/src/modules/m24-fleetbase/fleetbase-credentials.client';
import {
  FleetbaseOrderManagerClientError,
  type FleetbaseAssignedOrder,
  type FleetbaseAssignedOrders,
  type FleetbaseOrderManagerGateway,
} from '../../apps/api/src/modules/m24-fleetbase/fleetbase-order-manager.client';

const SOURCE = 'driver_AAAAAA';
const TARGET = 'driver_BBBBBB';

function makeOrder(index: number, overrides: Partial<FleetbaseAssignedOrder> = {}): FleetbaseAssignedOrder {
  const token = String(index).padStart(6, '0');
  return {
    uuid: `00000000-0000-4000-8000-${token.padStart(12, '0')}`,
    public_id: `order_${token}`,
    driver_assigned_uuid: '11111111-1111-4111-8111-111111111111',
    tracking: `TRACK-${token}`,
    status: 'dispatched',
    dispatched: true,
    scheduled_at: '2026-07-22T08:00:00+03:00',
    started_at: null,
    ...overrides,
  };
}

class FakeOrderGateway implements FleetbaseOrderManagerGateway {
  drivers: FleetbaseCredentialDriver[] = [
    { uuid: '11111111-1111-4111-8111-111111111111', public_id: SOURCE, name: 'Source Driver', status: 'available', online: true },
    { uuid: '22222222-2222-4222-8222-222222222222', public_id: TARGET, name: 'Target Driver', status: 'available', online: false },
  ];
  assignments = new Map<string, FleetbaseAssignedOrder[]>([[SOURCE, []], [TARGET, []]]);
  current = new Map<string, string | null>([[SOURCE, null], [TARGET, null]]);
  bulkCalls: Array<{ uuids: string[]; targetUuid: string }> = [];
  failOnBulkCall: number | null = null;
  sourceReads = 0;
  removeOnSourceRead: { read: number; orderId: string } | null = null;

  async listDrivers(): Promise<FleetbaseCredentialDriver[]> { return this.drivers; }

  async listAssignedOrders(driverPublicId: string): Promise<FleetbaseAssignedOrders> {
    if (driverPublicId === SOURCE) {
      this.sourceReads += 1;
      if (this.removeOnSourceRead?.read === this.sourceReads) {
        this.assignments.set(SOURCE, (this.assignments.get(SOURCE) ?? [])
          .filter((order) => order.public_id !== this.removeOnSourceRead?.orderId));
      }
    }
    return {
      driver: this.drivers.find((driver) => driver.public_id === driverPublicId) ?? null,
      current: this.current.get(driverPublicId) ?? null,
      orders: [...(this.assignments.get(driverPublicId) ?? [])],
    };
  }

  async bulkAssignDriver(orderUuids: string[], targetDriverUuid: string): Promise<void> {
    this.bulkCalls.push({ uuids: [...orderUuids], targetUuid: targetDriverUuid });
    if (this.failOnBulkCall === this.bulkCalls.length) {
      throw new FleetbaseOrderManagerClientError(503, 'fleetbase_unavailable');
    }
    const targetDriver = this.drivers.find((driver) => driver.uuid === targetDriverUuid);
    if (!targetDriver?.public_id) throw new Error('target_missing');
    const moved: FleetbaseAssignedOrder[] = [];
    for (const [driverId, orders] of this.assignments) {
      const retained: FleetbaseAssignedOrder[] = [];
      for (const order of orders) {
        if (order.uuid && orderUuids.includes(order.uuid)) {
          moved.push({ ...order, driver_assigned_uuid: targetDriverUuid });
        } else {
          retained.push(order);
        }
      }
      this.assignments.set(driverId, retained);
    }
    this.assignments.set(targetDriver.public_id, [...(this.assignments.get(targetDriver.public_id) ?? []), ...moved]);
  }
}

let pool: Pool;
let gateway: FakeOrderGateway;
let service: DriverOrderReassignmentService;
const actor: StaffContext = {
  staffId: 'staff-logistics-reassign',
  name: 'Logistics Manager',
  email: 'logistics-reassign@example.test',
  locale: 'en',
  roles: ['logistics_manager'],
  sessionId: 'session-logistics-reassign',
};

beforeAll(async () => {
  pool = await freshDb();
  await pool.query(
    `INSERT INTO staff_user (id,name_en,email,created_by) VALUES ($1,$2,$3,'test')`,
    [actor.staffId, actor.name, actor.email],
  );
}, 60_000);

beforeEach(() => {
  gateway = new FakeOrderGateway();
  service = new DriverOrderReassignmentService(pool, new AuditService(), gateway);
});

afterAll(async () => { await pool.end(); });

describe('WP-OPS-03 unlimited driver order reassignment', () => {
  it('grants Logistics Manager every delivery permission but no unrelated admin permission', async () => {
    const { rows } = await pool.query(
      `SELECT p.code FROM role_permission rp
       JOIN role r ON r.id=rp.role_id JOIN permission p ON p.id=rp.permission_id
       WHERE r.code='logistics_manager' ORDER BY p.code`,
    );
    const permissions = rows.map((row) => row.code);
    expect(permissions).toEqual([
      'delivery.assign',
      'delivery.driver.credentials.rotate',
      'delivery.driver.manage',
      'delivery.driver.read',
      'delivery.order.reassign',
      'delivery.route.manage',
      'delivery.route.read',
      'delivery.status.update',
    ]);
    expect(permissions).not.toContain('staff.manage');
    expect(permissions).not.toContain('payment.status.update');
  });

  it('returns a PII-minimized order list and blocks started/current/terminal orders', async () => {
    const movable = makeOrder(1) as FleetbaseAssignedOrder & { customer?: unknown; payload?: unknown };
    movable.customer = { name: 'Secret Customer', phone: '+96560000000' };
    movable.payload = { description: 'Private meal' };
    const started = makeOrder(2, { status: 'enroute', started_at: '2026-07-22T08:10:00+03:00' });
    const current = makeOrder(3);
    const completed = makeOrder(4, { status: 'completed', started_at: null });
    gateway.assignments.set(SOURCE, [movable, started, current, completed]);
    gateway.current.set(SOURCE, current.uuid as string);

    const list = await service.listOrders(SOURCE, '2026-07-22');
    expect(list.map((order) => [order.id, order.eligible, order.blocked_reason])).toEqual([
      ['order_000001', true, null],
      ['order_000002', false, 'started'],
      ['order_000003', false, 'current_job'],
      ['order_000004', false, 'terminal'],
    ]);
    const serialized = JSON.stringify(list);
    expect(serialized).not.toContain('Secret Customer');
    expect(serialized).not.toContain('+96560000000');
    expect(serialized).not.toContain('Private meal');
    expect(serialized).not.toContain('11111111-1111-4111-8111-111111111111');
  });

  it('accepts more than 100 orders, chunks upstream calls, and records secret-free outcomes', async () => {
    const orders = Array.from({ length: 205 }, (_, index) => makeOrder(index + 1));
    gateway.assignments.set(SOURCE, orders);
    const result = await service.reassign(actor, {
      source_driver_id: SOURCE,
      target_driver_id: TARGET,
      order_ids: orders.map((order) => order.public_id),
    });

    expect(result).toMatchObject({ status: 'completed', requested_count: 205, completed_count: 205, failed_count: 0 });
    expect(gateway.bulkCalls.map((call) => call.uuids.length)).toEqual([100, 100, 5]);
    expect(gateway.bulkCalls.every((call) => call.targetUuid === '22222222-2222-4222-8222-222222222222')).toBe(true);

    const batch = await pool.query(
      `SELECT source_driver_public_id,target_driver_public_id,status,requested_count,completed_count,failed_count
       FROM driver_order_reassignment WHERE id=$1`,
      [result.reassignment_id],
    );
    expect(batch.rows[0]).toMatchObject({ status: 'completed', requested_count: 205, completed_count: 205, failed_count: 0 });
    const items = await pool.query(
      `SELECT status,count(*)::int AS total FROM driver_order_reassignment_item
       WHERE reassignment_id=$1 GROUP BY status`,
      [result.reassignment_id],
    );
    expect(items.rows).toEqual([{ status: 'completed', total: 205 }]);
    const audit = await pool.query(
      `SELECT event_type,severity,related_refs,before,after FROM audit_event WHERE entity_id=$1 ORDER BY occurred_at`,
      [result.reassignment_id],
    );
    expect(audit.rows.map((row) => row.event_type)).toEqual([
      'delivery.driver_order_reassignment_requested',
      'delivery.driver_order_reassignment_completed',
    ]);
    expect(audit.rows.every((row) => row.severity === 'high')).toBe(true);
    const persisted = JSON.stringify({ batch: batch.rows, items: items.rows, audit: audit.rows });
    expect(persisted).not.toContain('11111111-1111-4111-8111-111111111111');
    expect(persisted).not.toContain('22222222-2222-4222-8222-222222222222');
  });

  it('rejects arbitrary UUIDs, same-driver moves, and unsafe orders before creating a batch', async () => {
    const started = makeOrder(10, { status: 'enroute', started_at: '2026-07-22T08:10:00+03:00' });
    gateway.assignments.set(SOURCE, [started]);
    const before = await pool.query(`SELECT count(*)::int AS total FROM driver_order_reassignment`);

    await expect(service.reassign(actor, {
      source_driver_id: '11111111-1111-4111-8111-111111111111',
      target_driver_id: TARGET,
      order_ids: [started.public_id],
    })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(service.reassign(actor, {
      source_driver_id: SOURCE,
      target_driver_id: SOURCE,
      order_ids: [started.public_id],
    })).rejects.toMatchObject({ code: 'validation_failed' });
    await expect(service.reassign(actor, {
      source_driver_id: SOURCE,
      target_driver_id: TARGET,
      order_ids: [started.public_id],
    })).rejects.toMatchObject({ code: 'validation_failed' });

    const after = await pool.query(`SELECT count(*)::int AS total FROM driver_order_reassignment`);
    expect(after.rows[0].total).toBe(before.rows[0].total);
    expect(gateway.bulkCalls).toHaveLength(0);
  });

  it('does not override an order that left the source driver after preflight', async () => {
    const orders = [makeOrder(20), makeOrder(21)];
    gateway.assignments.set(SOURCE, orders);
    gateway.removeOnSourceRead = { read: 2, orderId: orders[0]!.public_id as string };
    const result = await service.reassign(actor, {
      source_driver_id: SOURCE,
      target_driver_id: TARGET,
      order_ids: orders.map((order) => order.public_id),
    });

    expect(result).toMatchObject({ status: 'partial', requested_count: 2, completed_count: 1, failed_count: 1 });
    expect(result.failed_orders).toEqual([{ id: orders[0]!.public_id, reason: 'source_changed' }]);
    expect(gateway.bulkCalls[0]?.uuids).toEqual([orders[1]!.uuid]);
  });

  it('fails closed when another reassignment already holds the same order', async () => {
    const order = makeOrder(25);
    gateway.assignments.set(SOURCE, [order]);
    await pool.query(
      `INSERT INTO driver_order_reassignment
         (id,source_driver_public_id,target_driver_public_id,status,requested_count,requested_by,created_by)
       VALUES ('reassignment-in-flight',$1,$2,'requested',1,$3,$3)`,
      [SOURCE, TARGET, actor.staffId],
    );
    await pool.query(
      `INSERT INTO driver_order_reassignment_item
         (id,reassignment_id,fleetbase_order_public_id,status,created_by)
       VALUES ('reassignment-item-in-flight','reassignment-in-flight',$1,'pending',$2)`,
      [order.public_id, actor.staffId],
    );

    await expect(service.reassign(actor, {
      source_driver_id: SOURCE,
      target_driver_id: TARGET,
      order_ids: [order.public_id],
    })).rejects.toMatchObject({
      code: 'validation_failed',
      detail: { field: 'order_ids', reason: 'reassignment_in_progress' },
    });
    expect(gateway.bulkCalls).toHaveLength(0);
    const rows = await pool.query(
      `SELECT id FROM driver_order_reassignment WHERE source_driver_public_id=$1 AND status='requested'`,
      [SOURCE],
    );
    expect(rows.rows).toEqual([{ id: 'reassignment-in-flight' }]);

    await pool.query(`DELETE FROM driver_order_reassignment_item WHERE reassignment_id='reassignment-in-flight'`);
    await pool.query(`DELETE FROM driver_order_reassignment WHERE id='reassignment-in-flight'`);
  });

  it('records an honest partial result when a later upstream chunk fails', async () => {
    const orders = Array.from({ length: 150 }, (_, index) => makeOrder(index + 300));
    gateway.assignments.set(SOURCE, orders);
    gateway.failOnBulkCall = 2;
    const result = await service.reassign(actor, {
      source_driver_id: SOURCE,
      target_driver_id: TARGET,
      order_ids: orders.map((order) => order.public_id),
    });

    expect(result).toMatchObject({ status: 'partial', requested_count: 150, completed_count: 100, failed_count: 50 });
    expect(result.failed_orders).toHaveLength(50);
    expect(result.failed_orders.every((item) => item.reason === 'upstream_failed')).toBe(true);
    const batch = await pool.query(
      `SELECT status,completed_count,failed_count FROM driver_order_reassignment WHERE id=$1`,
      [result.reassignment_id],
    );
    expect(batch.rows[0]).toMatchObject({ status: 'partial', completed_count: 100, failed_count: 50 });
  });
});
