import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { newId } from '../../apps/api/src/platform/ids';
import { AuditService } from '../../apps/api/src/platform/audit/audit.service';
import { DeliveryService } from '../../apps/api/src/modules/m21-delivery/delivery.service';
import { PackingService } from '../../apps/api/src/modules/m20-packing/packing.service';
import type { StaffContext } from '../../apps/api/src/platform/auth/session.service';

// TS-I — driver + area assignment foundation (m21-delivery): driver create, assign by area,
// capacity guard, no-duplicate assignment, route creation + status transitions, and the
// packing -> driver handoff integration.

let pool: Pool;
let svc: DeliveryService;
let packing: PackingService;
const actor: StaffContext = { staffId: 'ops-1', name: 'Ops One', email: 'o@t', locale: 'en', roles: ['ops_manager'], sessionId: 's' };
const DATE = '2099-04-10';
const orders: Record<string, string> = {};

beforeAll(async () => {
  pool = await freshDb();
  svc = new DeliveryService(pool, new AuditService());
  packing = new PackingService(pool, new AuditService());
  orders.a = await seedOrder('N-DL-1', 'Salmiya');
  orders.b = await seedOrder('N-DL-2', 'Salmiya');
  orders.c = await seedOrder('N-DL-3', 'Salmiya');
}, 60_000);

afterAll(async () => { await pool.end(); });

async function seedOrder(orderNo: string, area: string): Promise<string> {
  const customerId = newId();
  const id = newId();
  await pool.query(`INSERT INTO customer (id, full_name_en, created_by) VALUES ($1,$2,'test')`, [customerId, `Cust ${orderNo}`]);
  await pool.query(
    `INSERT INTO customer_order
       (id, order_number, customer_id, status, start_date, end_date, channel, total, created_by,
        delivery_method_frozen, delivery_time_frozen, delivery_area_frozen)
     VALUES ($1,$2,$3,'active','2099-04-01','2099-04-30','phone',0,'test','delivery','Morning',$4)`,
    [id, orderNo, customerId, area],
  );
  return id;
}

describe('TS-I delivery — driver + route workflow', () => {
  let driver1: string;
  let driver2: string;

  it('creates drivers with served areas', async () => {
    driver1 = (await svc.createDriver(actor, { name: 'Driver One', phone: '+96599990001', capacity_per_slot: 1, areas: [{ area: 'Salmiya', priority: 10 }] })).id;
    driver2 = (await svc.createDriver(actor, { name: 'Driver Two', phone: '+96599990002', capacity_per_slot: 5, areas: [{ area: 'Salmiya', priority: 50 }] })).id;
    const list = await svc.listDrivers({ area: 'Salmiya' });
    expect(list.length).toBe(2);
  });

  it('suggests drivers by area, ranked by priority then load', async () => {
    const sugg = await svc.suggestDrivers({ area: 'Salmiya', date: DATE });
    expect(sugg[0]!.id).toBe(driver1);             // priority 10 beats 50
    expect(sugg).toHaveLength(2);
  });

  it('assigns an order by area (creates a route + a stop)', async () => {
    const res = await svc.assign(actor, { order_id: orders.a, driver_id: driver1, delivery_date: DATE, area: 'Salmiya' });
    expect(res.route_id).toBeTruthy();
    const { stops } = await svc.getRoute(res.route_id);
    expect(stops).toHaveLength(1);
    expect(stops[0]!.status).toBe('assigned');
  });

  it('enforces the per-slot capacity guard', async () => {
    await expect(svc.assign(actor, { order_id: orders.b, driver_id: driver1, delivery_date: DATE, area: 'Salmiya' }))
      .rejects.toMatchObject({ code: 'conflict' });
  });

  it('blocks duplicate assignment of the same order', async () => {
    await expect(svc.assign(actor, { order_id: orders.a, driver_id: driver2, delivery_date: DATE, area: 'Salmiya' }))
      .rejects.toMatchObject({ code: 'conflict' });
  });

  it('enforces the duplicate-active-assignment guard at the database', async () => {
    const route = await svc.createRoute(actor, { driver_id: driver2, delivery_date: DATE, area_group: 'Salmiya' });
    await expect(pool.query(
      `INSERT INTO delivery_route_order (id, route_id, order_id, status, created_by)
       VALUES ($1,$2,$3,'assigned','test')`,
      [newId(), route.id, orders.a],
    )).rejects.toThrow(/duplicate key/);
  });

  it('drives route status through valid transitions and rejects invalid ones', async () => {
    const route = await svc.createRoute(actor, { driver_id: driver2, delivery_date: '2099-04-11', area_group: 'Hawally' });
    expect(route.status).toBe('assigned');
    await svc.assign(actor, { order_id: orders.b, driver_id: driver2, delivery_date: '2099-04-11', area: 'Salmiya' });
    await svc.setRouteStatus(actor, route.id, 'out_for_delivery');
    await expect(svc.setRouteStatus(actor, route.id, 'assigned')).rejects.toMatchObject({ code: 'conflict' });
    await svc.setRouteStatus(actor, route.id, 'completed');
    const { route: r } = await svc.getRoute(route.id);
    expect(r.status).toBe('completed');
  });

  it('integrates the packing handoff: handed orders appear unassigned and can be assigned', async () => {
    // Pack + hand off order C via the packing module, then it should surface in unassigned with
    // packing_status='handed_to_driver' and be assignable to a driver.
    const { batch } = await packing.createBatch(actor, { delivery_date: DATE, delivery_time: 'Morning', area: 'Salmiya' });
    // batch includes any still-unbatched active Salmiya orders for the date (order C among them)
    const detail = await packing.getBatch(batch.id);
    for (const o of detail.orders) await packing.markPacked(actor, batch.id, o.order_id);
    await packing.handoff(actor, batch.id);

    const unassigned = await svc.listUnassigned({ date: DATE, area: 'Salmiya' });
    const handed = unassigned.find((u) => u.order_id === orders.c);
    expect(handed).toBeTruthy();
    expect(handed!.packing_status).toBe('handed_to_driver');
    const res = await svc.assign(actor, { order_id: orders.c, driver_id: driver2, delivery_date: DATE, area: 'Salmiya' });
    expect(res.stop_id).toBeTruthy();
  });

  it('append-only driver_assignment_history rejects UPDATE/DELETE', async () => {
    const id = newId();
    await pool.query(
      `INSERT INTO driver_assignment_history (id, entity_type, entity_id, to_status) VALUES ($1,'delivery_route',$2,'draft')`,
      [id, newId()],
    );
    await expect(pool.query(`UPDATE driver_assignment_history SET to_status='x' WHERE id=$1`, [id])).rejects.toThrow(/append-only/);
    await expect(pool.query(`DELETE FROM driver_assignment_history WHERE id=$1`, [id])).rejects.toThrow(/append-only/);
  });
});
