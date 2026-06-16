import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../../platform/db/tx';
import { AuditService } from '../../platform/audit/audit.service';
import type { StaffContext } from '../../platform/auth/session.service';
import { newId } from '../../platform/ids';

// m21-delivery — driver + area assignment foundation. Assigns delivery orders to drivers by
// area / time / capacity, builds delivery routes, and tracks per-stop delivery status. Writes ONLY
// driver/delivery_* tables (single write path); reads order/customer data and freezes a delivery
// snapshot onto each stop. Status changes are guarded + audited in the same transaction and recorded
// append-only in driver_assignment_history. Capacity + duplicate-assignment guards are enforced both
// in code and at the DB (delivery_route_order_active_uq). Promotion of these machines into the seeded
// transition engine / fulfillment dispatch transitions (f9..f14) is the documented follow-up (doc 28).

export type RouteStatus = 'draft' | 'assigned' | 'out_for_delivery' | 'completed' | 'failed';
export type StopStatus = 'assigned' | 'picked_up' | 'delivered' | 'failed' | 'returned';

const ROUTE_TRANSITIONS: Record<RouteStatus, RouteStatus[]> = {
  draft: ['assigned', 'failed'],
  assigned: ['out_for_delivery', 'failed', 'draft'],
  out_for_delivery: ['completed', 'failed'],
  completed: [],
  failed: [],
};
const STOP_TRANSITIONS: Record<StopStatus, StopStatus[]> = {
  assigned: ['picked_up', 'delivered', 'failed', 'returned'],
  picked_up: ['delivered', 'failed', 'returned'],
  delivered: [],
  failed: ['returned', 'assigned'],
  returned: ['assigned'],
};

export class DeliveryError extends Error {
  constructor(readonly code: 'validation_failed' | 'not_found' | 'conflict', readonly detail?: unknown) {
    super(code);
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export class DeliveryService {
  constructor(private readonly pool: Pool, private readonly audit: AuditService) {}

  // ---------- drivers ----------
  async listDrivers(filters: { active?: boolean; area?: string }): Promise<Record<string, unknown>[]> {
    const clauses: string[] = []; const params: unknown[] = [];
    if (filters.active !== undefined) { params.push(filters.active); clauses.push(`d.active = $${params.length}`); }
    if (filters.area) { params.push(filters.area); clauses.push(`EXISTS (SELECT 1 FROM driver_area da WHERE da.driver_id=d.id AND da.area=$${params.length} AND da.active)`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await this.pool.query(
      `SELECT d.*,
              (SELECT coalesce(json_agg(json_build_object('area',da.area,'priority',da.priority,'active',da.active) ORDER BY da.priority),'[]')
                 FROM driver_area da WHERE da.driver_id=d.id) AS areas
       FROM driver d ${where} ORDER BY d.active DESC, d.name LIMIT 500`,
      params,
    );
    return rows;
  }

  async createDriver(
    actor: StaffContext,
    input: { legacy_driver_id?: string; name?: string; phone?: string; active?: boolean; capacity_per_slot?: number; areas?: Array<{ area: string; priority?: number }> },
  ): Promise<{ id: string }> {
    if (!input.name) throw new DeliveryError('validation_failed', { field: 'name' });
    const cap = Number.isFinite(input.capacity_per_slot) ? Math.max(0, Math.trunc(input.capacity_per_slot as number)) : 0;
    return withTransaction(this.pool, async (client) => {
      const id = newId();
      try {
        await client.query(
          `INSERT INTO driver (id, legacy_driver_id, name, phone, active, capacity_per_slot, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [id, input.legacy_driver_id ?? null, input.name, input.phone ?? null, input.active ?? true, cap, actor.staffId],
        );
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new DeliveryError('conflict', { reason: 'legacy_driver_id already exists' });
        throw e;
      }
      for (const a of input.areas ?? []) {
        if (!a.area) continue;
        await client.query(
          `INSERT INTO driver_area (id, driver_id, area, priority, created_by) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (driver_id, area) DO NOTHING`,
          [newId(), id, a.area, Number.isFinite(a.priority) ? a.priority : 100, actor.staffId],
        );
      }
      await this.audit.writeInTx(client, {
        eventType: 'delivery.driver_created', actor: this.actor(actor),
        entityType: 'driver', entityId: id, severity: 'info',
        after: { name: input.name, capacity_per_slot: cap, areas: (input.areas ?? []).map((a) => a.area) },
      });
      return { id };
    });
  }

  // ---------- unassigned + suggestion ----------
  async listUnassigned(filters: { date: string; time?: string; area?: string }): Promise<Record<string, unknown>[]> {
    if (!filters.date || !DATE_RE.test(filters.date)) throw new DeliveryError('validation_failed', { field: 'date' });
    const params: unknown[] = [filters.date];
    let areaClause = ''; let timeClause = '';
    if (filters.area) { params.push(filters.area); areaClause = `AND co.delivery_area_frozen = $${params.length}`; }
    if (filters.time) { params.push(filters.time); timeClause = `AND co.delivery_time_frozen = $${params.length}`; }
    // Candidate = active order in the delivery window, not already on an active route. The latest
    // packing status is surfaced (read across the packing module) so ops can prefer packed orders.
    const { rows } = await this.pool.query(
      `SELECT co.id AS order_id, co.customer_id, c.full_name_en AS customer_name,
              co.delivery_area_frozen AS area, co.delivery_method_frozen, co.delivery_time_frozen,
              (SELECT pbo.packing_status FROM packing_batch_order pbo
                 WHERE pbo.order_id = co.id ORDER BY pbo.created_at DESC LIMIT 1) AS packing_status
       FROM customer_order co
       LEFT JOIN customer c ON c.id = co.customer_id
       WHERE co.start_date <= $1 AND co.end_date >= $1 AND co.status IN ('approved','active')
         ${areaClause} ${timeClause}
         AND NOT EXISTS (SELECT 1 FROM delivery_route_order dro
                          WHERE dro.order_id = co.id AND dro.status IN ('assigned','picked_up'))
       ORDER BY co.delivery_area_frozen NULLS LAST, co.id LIMIT 1000`,
      params,
    );
    return rows;
  }

  /** Rank drivers serving an area by priority then remaining capacity for that date. */
  async suggestDrivers(filters: { area: string; date: string; time?: string }): Promise<Record<string, unknown>[]> {
    if (!filters.area) throw new DeliveryError('validation_failed', { field: 'area' });
    if (!filters.date || !DATE_RE.test(filters.date)) throw new DeliveryError('validation_failed', { field: 'date' });
    const { rows } = await this.pool.query(
      `SELECT d.id, d.name, d.capacity_per_slot, da.priority,
              (SELECT count(*)::int FROM delivery_route_order dro
                 JOIN delivery_route r ON r.id = dro.route_id
                 WHERE r.driver_id = d.id AND r.delivery_date = $2 AND dro.status IN ('assigned','picked_up')) AS assigned_count
       FROM driver d JOIN driver_area da ON da.driver_id = d.id
       WHERE d.active AND da.active AND da.area = $1
       ORDER BY da.priority ASC, assigned_count ASC, d.name LIMIT 50`,
      [filters.area, filters.date],
    );
    return rows.map((r) => ({
      ...r,
      remaining_capacity: r.capacity_per_slot > 0 ? Math.max(0, r.capacity_per_slot - r.assigned_count) : null,
    }));
  }

  // ---------- routes ----------
  async createRoute(
    actor: StaffContext,
    input: { driver_id?: string; delivery_date: string; delivery_time?: string; area_group?: string },
  ): Promise<{ id: string; status: RouteStatus }> {
    if (!input.delivery_date || !DATE_RE.test(input.delivery_date)) throw new DeliveryError('validation_failed', { field: 'delivery_date' });
    return withTransaction(this.pool, async (client) => {
      if (input.driver_id) await this.assertDriver(client, input.driver_id);
      const id = newId();
      const status: RouteStatus = input.driver_id ? 'assigned' : 'draft';
      await client.query(
        `INSERT INTO delivery_route (id, driver_id, delivery_date, delivery_time, area_group, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [id, input.driver_id ?? null, input.delivery_date, input.delivery_time ?? null, input.area_group ?? null, status, actor.staffId],
      );
      await this.audit.writeInTx(client, {
        eventType: 'delivery.route_created', actor: this.actor(actor),
        entityType: 'delivery_route', entityId: id, severity: 'info',
        after: { driver_id: input.driver_id ?? null, delivery_date: input.delivery_date, area_group: input.area_group ?? null, status },
      });
      await this.routeHistory(client, id, input.driver_id ?? null, null, status, actor);
      return { id, status };
    });
  }

  async assign(
    actor: StaffContext,
    input: { order_id?: string; driver_id?: string; delivery_date?: string; delivery_time?: string; area?: string },
  ): Promise<{ route_id: string; stop_id: string }> {
    if (!input.order_id) throw new DeliveryError('validation_failed', { field: 'order_id' });
    if (!input.driver_id) throw new DeliveryError('validation_failed', { field: 'driver_id' });
    return withTransaction(this.pool, async (client) => {
      const order = await this.loadOrderSnapshot(client, input.order_id as string);
      const date = input.delivery_date && DATE_RE.test(input.delivery_date) ? input.delivery_date : null;
      const route = await this.findOrCreateRoute(client, actor, {
        driver_id: input.driver_id as string,
        delivery_date: date ?? (await this.orderDeliveryDate(client, order.order_id)),
        delivery_time: input.delivery_time ?? (order.delivery_time_frozen as string) ?? undefined,
        area_group: input.area ?? (order.area as string) ?? undefined,
      });
      await this.assertCapacity(client, input.driver_id as string, route.delivery_date);
      const stopId = await this.insertStop(client, actor, route.id, order, input.area ?? (order.area as string) ?? null);
      await this.audit.writeInTx(client, {
        eventType: 'delivery.order_assigned', actor: this.actor(actor),
        entityType: 'delivery_route_order', entityId: stopId, severity: 'info',
        relatedRefs: { route_id: route.id, order_id: order.order_id, driver_id: input.driver_id as string },
        after: { status: 'assigned' },
      });
      await this.stopHistory(client, stopId, input.driver_id as string, null, 'assigned', actor);
      return { route_id: route.id, stop_id: stopId };
    });
  }

  async bulkAssign(
    actor: StaffContext,
    input: { driver_id?: string; delivery_date?: string; delivery_time?: string; area?: string; order_ids?: string[] },
  ): Promise<{ assigned: number; skipped: number; route_id: string | null }> {
    if (!input.driver_id) throw new DeliveryError('validation_failed', { field: 'driver_id' });
    if (!input.delivery_date || !DATE_RE.test(input.delivery_date)) throw new DeliveryError('validation_failed', { field: 'delivery_date' });
    let orderIds = input.order_ids ?? [];
    if (orderIds.length === 0) {
      const cands = await this.listUnassigned({ date: input.delivery_date, time: input.delivery_time, area: input.area });
      orderIds = cands.map((c) => c.order_id as string);
    }
    let assigned = 0; let skipped = 0; let routeId: string | null = null;
    return withTransaction(this.pool, async (client) => {
      await this.assertDriver(client, input.driver_id as string);
      const route = await this.findOrCreateRoute(client, actor, {
        driver_id: input.driver_id as string,
        delivery_date: input.delivery_date as string,
        delivery_time: input.delivery_time,
        area_group: input.area,
      });
      routeId = route.id;
      for (const orderId of orderIds) {
        try {
          await this.assertCapacity(client, input.driver_id as string, route.delivery_date);
          const order = await this.loadOrderSnapshot(client, orderId);
          const stopId = await this.insertStop(client, actor, route.id, order, input.area ?? (order.area as string) ?? null);
          await this.stopHistory(client, stopId, input.driver_id as string, null, 'assigned', actor);
          assigned += 1;
        } catch (e) {
          if (e instanceof DeliveryError && e.code === 'conflict') { skipped += 1; continue; }
          throw e;
        }
      }
      await this.audit.writeInTx(client, {
        eventType: 'delivery.bulk_assigned', actor: this.actor(actor),
        entityType: 'delivery_route', entityId: route.id, severity: 'info',
        relatedRefs: { driver_id: input.driver_id as string },
        after: { assigned, skipped, delivery_date: input.delivery_date, area: input.area ?? null },
      });
      return { assigned, skipped, route_id: routeId };
    });
  }

  async listRoutes(filters: { date?: string; status?: string; driver_id?: string }): Promise<Record<string, unknown>[]> {
    const clauses: string[] = []; const params: unknown[] = [];
    if (filters.date) { params.push(filters.date); clauses.push(`r.delivery_date = $${params.length}`); }
    if (filters.status) { params.push(filters.status); clauses.push(`r.status = $${params.length}`); }
    if (filters.driver_id) { params.push(filters.driver_id); clauses.push(`r.driver_id = $${params.length}`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const { rows } = await this.pool.query(
      `SELECT r.*, d.name AS driver_name,
              (SELECT count(*) FROM delivery_route_order o WHERE o.route_id=r.id)::int AS stop_count,
              (SELECT count(*) FROM delivery_route_order o WHERE o.route_id=r.id AND o.status='delivered')::int AS delivered_count
       FROM delivery_route r LEFT JOIN driver d ON d.id=r.driver_id ${where}
       ORDER BY r.delivery_date DESC, r.created_at DESC LIMIT 200`,
      params,
    );
    return rows;
  }

  async getRoute(routeId: string): Promise<{ route: Record<string, unknown>; stops: Record<string, unknown>[] }> {
    const r = await this.pool.query(
      `SELECT r.*, d.name AS driver_name, d.phone AS driver_phone FROM delivery_route r
       LEFT JOIN driver d ON d.id=r.driver_id WHERE r.id=$1`, [routeId],
    );
    if (r.rows.length === 0) throw new DeliveryError('not_found');
    const stops = await this.pool.query(
      `SELECT dro.*, c.full_name_en AS customer_name FROM delivery_route_order dro
       LEFT JOIN customer c ON c.id=dro.customer_id WHERE dro.route_id=$1
       ORDER BY dro.stop_sequence NULLS LAST, dro.created_at`, [routeId],
    );
    return { route: r.rows[0], stops: stops.rows };
  }

  async setRouteStatus(actor: StaffContext, routeId: string, to: string, reason?: string): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const { rows } = await client.query(`SELECT * FROM delivery_route WHERE id=$1 FOR UPDATE`, [routeId]);
      if (rows.length === 0) throw new DeliveryError('not_found');
      const from = rows[0].status as RouteStatus;
      const target = to as RouteStatus;
      if (!ROUTE_TRANSITIONS[from] || !ROUTE_TRANSITIONS[from].includes(target)) {
        throw new DeliveryError('conflict', { reason: `route transition ${from} -> ${to} not allowed` });
      }
      if (target === 'assigned' && !rows[0].driver_id) throw new DeliveryError('conflict', { reason: 'route has no driver' });
      await client.query(
        `UPDATE delivery_route SET status=$2, updated_at=now(), updated_by=$3, version=version+1 WHERE id=$1`,
        [routeId, target, actor.staffId],
      );
      // Completing a route marks its still-in-flight stops delivered.
      if (target === 'completed') {
        await client.query(
          `UPDATE delivery_route_order SET status='delivered', delivered_at=now(), updated_at=now(), updated_by=$2, version=version+1
           WHERE route_id=$1 AND status IN ('assigned','picked_up')`,
          [routeId, actor.staffId],
        );
      }
      await this.audit.writeInTx(client, {
        eventType: 'delivery.route_status_changed', actor: this.actor(actor),
        entityType: 'delivery_route', entityId: routeId, severity: target === 'failed' ? 'warn' : 'info',
        before: { status: from }, after: { status: target }, reason,
      });
      await this.routeHistory(client, routeId, rows[0].driver_id as string | null, from, target, actor, reason);
    });
  }

  async setStopStatus(actor: StaffContext, routeId: string, orderId: string, to: string, reason?: string): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const { rows } = await client.query(
        `SELECT * FROM delivery_route_order WHERE route_id=$1 AND order_id=$2 FOR UPDATE`, [routeId, orderId],
      );
      if (rows.length === 0) throw new DeliveryError('not_found');
      const from = rows[0].status as StopStatus;
      const target = to as StopStatus;
      if (!STOP_TRANSITIONS[from] || !STOP_TRANSITIONS[from].includes(target)) {
        throw new DeliveryError('conflict', { reason: `stop transition ${from} -> ${to} not allowed` });
      }
      await client.query(
        `UPDATE delivery_route_order SET status=$3,
           delivered_at = CASE WHEN $3='delivered' THEN now() ELSE delivered_at END,
           failure_reason = CASE WHEN $3 IN ('failed','returned') THEN $4 ELSE failure_reason END,
           updated_at=now(), updated_by=$5, version=version+1
         WHERE route_id=$1 AND order_id=$2`,
        [routeId, orderId, target, reason ?? null, actor.staffId],
      );
      await this.audit.writeInTx(client, {
        eventType: 'delivery.stop_status_changed', actor: this.actor(actor),
        entityType: 'delivery_route_order', entityId: rows[0].id as string, severity: target === 'failed' ? 'warn' : 'info',
        relatedRefs: { route_id: routeId, order_id: orderId }, before: { status: from }, after: { status: target }, reason,
      });
      await this.stopHistory(client, rows[0].id as string, null, from, target, actor, reason);
    });
  }

  async reassign(actor: StaffContext, routeId: string, driverId: string): Promise<void> {
    if (!driverId) throw new DeliveryError('validation_failed', { field: 'driver_id' });
    await withTransaction(this.pool, async (client) => {
      const { rows } = await client.query(`SELECT * FROM delivery_route WHERE id=$1 FOR UPDATE`, [routeId]);
      if (rows.length === 0) throw new DeliveryError('not_found');
      if (['completed', 'failed'].includes(rows[0].status)) throw new DeliveryError('conflict', { reason: 'route is terminal' });
      await this.assertDriver(client, driverId);
      await this.assertCapacity(client, driverId, this.dateStr(rows[0].delivery_date));
      const prev = rows[0].driver_id as string | null;
      await client.query(
        `UPDATE delivery_route SET driver_id=$2, status=CASE WHEN status='draft' THEN 'assigned' ELSE status END,
         updated_at=now(), updated_by=$3, version=version+1 WHERE id=$1`,
        [routeId, driverId, actor.staffId],
      );
      await this.audit.writeInTx(client, {
        eventType: 'delivery.route_reassigned', actor: this.actor(actor),
        entityType: 'delivery_route', entityId: routeId, severity: 'info',
        before: { driver_id: prev }, after: { driver_id: driverId },
      });
      await this.routeHistory(client, routeId, driverId, rows[0].status as string, rows[0].status as string, actor, `reassigned from ${prev ?? 'none'}`);
    });
  }

  // ---------- helpers ----------
  private async assertDriver(client: PoolClient, driverId: string): Promise<void> {
    const { rows } = await client.query(`SELECT active FROM driver WHERE id=$1`, [driverId]);
    if (rows.length === 0) throw new DeliveryError('not_found', { field: 'driver_id' });
    if (!rows[0].active) throw new DeliveryError('conflict', { reason: 'driver inactive' });
  }

  private async assertCapacity(client: PoolClient, driverId: string, date: string): Promise<void> {
    const { rows } = await client.query(
      `SELECT d.capacity_per_slot,
              (SELECT count(*)::int FROM delivery_route_order dro JOIN delivery_route r ON r.id=dro.route_id
                 WHERE r.driver_id=$1 AND r.delivery_date=$2 AND dro.status IN ('assigned','picked_up')) AS n
       FROM driver d WHERE d.id=$1`,
      [driverId, date],
    );
    const cap = Number(rows[0]?.capacity_per_slot ?? 0);
    const n = Number(rows[0]?.n ?? 0);
    if (cap > 0 && n >= cap) throw new DeliveryError('conflict', { reason: 'capacity_exceeded', capacity: cap, assigned: n });
  }

  private async findOrCreateRoute(
    client: PoolClient, actor: StaffContext,
    input: { driver_id: string; delivery_date: string; delivery_time?: string; area_group?: string },
  ): Promise<{ id: string; delivery_date: string }> {
    const { rows } = await client.query(
      `SELECT id, delivery_date FROM delivery_route
       WHERE driver_id=$1 AND delivery_date=$2 AND coalesce(delivery_time,'')=coalesce($3,'')
         AND coalesce(area_group,'')=coalesce($4,'') AND status IN ('draft','assigned')
       ORDER BY created_at LIMIT 1`,
      [input.driver_id, input.delivery_date, input.delivery_time ?? null, input.area_group ?? null],
    );
    if (rows.length > 0) return { id: rows[0].id as string, delivery_date: this.dateStr(rows[0].delivery_date) };
    const id = newId();
    await client.query(
      `INSERT INTO delivery_route (id, driver_id, delivery_date, delivery_time, area_group, status, created_by)
       VALUES ($1,$2,$3,$4,$5,'assigned',$6)`,
      [id, input.driver_id, input.delivery_date, input.delivery_time ?? null, input.area_group ?? null, actor.staffId],
    );
    await this.routeHistory(client, id, input.driver_id, null, 'assigned', actor);
    return { id, delivery_date: input.delivery_date };
  }

  private async insertStop(
    client: PoolClient, actor: StaffContext, routeId: string,
    order: { order_id: string; customer_id: string | null; delivery_method_frozen: unknown; delivery_time_frozen: unknown; area: unknown },
    area: string | null,
  ): Promise<string> {
    const seq = await client.query(`SELECT coalesce(max(stop_sequence),0)+1 AS s FROM delivery_route_order WHERE route_id=$1`, [routeId]);
    const id = newId();
    try {
      await client.query(
        `INSERT INTO delivery_route_order
           (id, route_id, order_id, customer_id, area, delivery_method_frozen, delivery_time_frozen, stop_sequence, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'assigned',$9)`,
        [id, routeId, order.order_id, order.customer_id, area, order.delivery_method_frozen ?? null, order.delivery_time_frozen ?? null, seq.rows[0].s, actor.staffId],
      );
    } catch (e) {
      // (route_id, order_id) unique OR order already on an active route (partial-unique) => conflict.
      if ((e as { code?: string }).code === '23505') throw new DeliveryError('conflict', { reason: 'order already assigned', order_id: order.order_id });
      throw e;
    }
    return id;
  }

  private async loadOrderSnapshot(client: PoolClient, orderId: string): Promise<{ order_id: string; customer_id: string | null; delivery_method_frozen: unknown; delivery_time_frozen: unknown; area: unknown }> {
    const { rows } = await client.query(
      `SELECT id AS order_id, customer_id, delivery_method_frozen, delivery_time_frozen, delivery_area_frozen AS area
       FROM customer_order WHERE id=$1`, [orderId],
    );
    if (rows.length === 0) throw new DeliveryError('not_found', { field: 'order_id', order_id: orderId });
    return rows[0] as { order_id: string; customer_id: string | null; delivery_method_frozen: unknown; delivery_time_frozen: unknown; area: unknown };
  }

  private async orderDeliveryDate(client: PoolClient, orderId: string): Promise<string> {
    const { rows } = await client.query(`SELECT start_date FROM customer_order WHERE id=$1`, [orderId]);
    return this.dateStr(rows[0]?.start_date);
  }

  private async routeHistory(client: PoolClient, routeId: string, driverId: string | null, from: string | null, to: string, actor: StaffContext, reason?: string): Promise<void> {
    await client.query(
      `INSERT INTO driver_assignment_history (id, entity_type, entity_id, driver_id, from_status, to_status, actor, reason)
       VALUES ($1,'delivery_route',$2,$3,$4,$5,$6,$7)`,
      [newId(), routeId, driverId, from, to, JSON.stringify(this.actor(actor)), reason ?? null],
    );
  }

  private async stopHistory(client: PoolClient, stopId: string, driverId: string | null, from: string | null, to: string, actor: StaffContext, reason?: string): Promise<void> {
    await client.query(
      `INSERT INTO driver_assignment_history (id, entity_type, entity_id, driver_id, from_status, to_status, actor, reason)
       VALUES ($1,'delivery_route_order',$2,$3,$4,$5,$6,$7)`,
      [newId(), stopId, driverId, from, to, JSON.stringify(this.actor(actor)), reason ?? null],
    );
  }

  private actor(actor: StaffContext): { id: string; role: string } {
    return { id: actor.staffId, role: actor.roles[0] ?? 'none' };
  }

  private dateStr(value: unknown): string {
    if (value instanceof Date) {
      const y = value.getFullYear(); const m = String(value.getMonth() + 1).padStart(2, '0'); const d = String(value.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return String(value).slice(0, 10);
  }
}
