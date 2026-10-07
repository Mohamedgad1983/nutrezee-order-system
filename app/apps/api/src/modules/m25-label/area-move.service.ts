// WP-OPS-A77 — one-day move of an area from one driver to another.
// This module owns only the decision ledger (delivery_area_move). Fleetbase orders are changed by the
// Fleetbase sync, which reads the active rows of the day; nothing here writes to Fleetbase or legacy.
import type { Pool, PoolClient } from 'pg';
import { AuditService } from '../../platform/audit/audit.service';
import type { StaffContext } from '../../platform/auth/session.service';
import { withTransaction } from '../../platform/db/tx';
import { newId } from '../../platform/ids';
import type { BatchLabelCandidate } from './label.service';

export class AreaMoveError extends Error {
  constructor(
    readonly code: 'validation_failed' | 'not_found' | 'conflict',
    readonly detail?: unknown,
  ) {
    super(code);
  }
}

export interface AreaMoveDriver { id: string; name: string | null; phone: string | null; vehicle_number: string | null }

export interface AreaMoveRow {
  id: string;
  delivery_date: string;
  area_key: string;
  area_label: string;
  from_driver_id: string | null;
  from_driver_name: string | null;
  to_driver_id: string;
  to_driver_name: string | null;
  orders_at_request: number;
  created_at: string;
  created_by: string;
}

/** The same key the sync derives from an order's routing area. */
export function areaMoveKey(label: string | null | undefined): string {
  return String(label ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

export interface AreaLoad { area_key: string; area_label: string; orders: number }
export interface DriverLoad extends AreaMoveDriver { orders: number; areas: AreaLoad[] }

/** Orders per driver and, inside each driver, per area — from the day's Batch Labels set. */
export function driverLoads(candidates: BatchLabelCandidate[], directory: AreaMoveDriver[]): DriverLoad[] {
  const byDriver = new Map<string, DriverLoad>();
  for (const driver of directory) byDriver.set(driver.id, { ...driver, orders: 0, areas: [] });
  for (const candidate of candidates) {
    if (!candidate.driverId) continue;
    let load = byDriver.get(candidate.driverId);
    if (!load) {
      load = {
        id: candidate.driverId, name: candidate.driverName ?? null, phone: candidate.driverPhone,
        vehicle_number: candidate.vehicleNumber, orders: 0, areas: [],
      };
      byDriver.set(candidate.driverId, load);
    }
    load.orders += 1;
    const key = areaMoveKey(candidate.areaLabel);
    const area = load.areas.find((a) => a.area_key === key);
    if (area) area.orders += 1;
    else load.areas.push({ area_key: key, area_label: candidate.areaLabel, orders: 1 });
  }
  const loads = [...byDriver.values()];
  for (const load of loads) load.areas.sort((a, b) => b.orders - a.orders || a.area_label.localeCompare(b.area_label));
  return loads.sort((a, b) => b.orders - a.orders || String(a.name ?? '').localeCompare(String(b.name ?? '')));
}

export class AreaMoveService {
  constructor(private readonly pool: Pool, private readonly audit: AuditService) {}

  async active(deliveryDate: string): Promise<AreaMoveRow[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM delivery_area_move WHERE delivery_date = $1 AND cancelled_at IS NULL ORDER BY created_at`,
      [deliveryDate],
    );
    return rows.map(toRow);
  }

  /**
   * Records the decision. The area must exist in the day's set and the target must be a driver who can
   * carry labels (phone and vehicle plate), otherwise the labels of the area could not be printed.
   * A second move of the same area on the same day replaces the first.
   */
  async create(
    actor: StaffContext,
    input: { deliveryDate: string; today: string; areaKey: string; toDriverId: string },
    day: { candidates: BatchLabelCandidate[]; directory: AreaMoveDriver[] },
  ): Promise<AreaMoveRow> {
    if (input.deliveryDate < input.today) throw new AreaMoveError('validation_failed', { field: 'delivery_date', reason: 'past_day' });
    const key = areaMoveKey(input.areaKey);
    const inArea = day.candidates.filter((c) => areaMoveKey(c.areaLabel) === key);
    if (key === '' || inArea.length === 0) throw new AreaMoveError('validation_failed', { field: 'area_key', reason: 'area_not_in_day' });
    const target = day.directory.find((d) => d.id === input.toDriverId);
    if (!target) throw new AreaMoveError('validation_failed', { field: 'to_driver_id', reason: 'driver_not_found' });
    if (!target.phone || !target.vehicle_number) {
      throw new AreaMoveError('validation_failed', { field: 'to_driver_id', reason: 'driver_without_phone_or_vehicle' });
    }
    const current = new Map<string, number>();
    for (const c of inArea) if (c.driverId) current.set(c.driverId, (current.get(c.driverId) ?? 0) + 1);
    const fromId: string | null = [...current.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    if (current.size === 1 && fromId === target.id) {
      throw new AreaMoveError('conflict', { reason: 'area_already_with_driver' });
    }
    const from = day.directory.find((d) => d.id === fromId) ?? null;
    return withTransaction(this.pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`area-move:${input.deliveryDate}:${key}`]);
      const previous = await this.cancelActiveInTx(client, actor, input.deliveryDate, key);
      const id = newId();
      const { rows } = await client.query(
        `INSERT INTO delivery_area_move
           (id, delivery_date, area_key, area_label, from_driver_id, from_driver_name, to_driver_id, to_driver_name,
            orders_at_request, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [id, input.deliveryDate, key, inArea[0]!.areaLabel, fromId, from?.name ?? null, target.id, target.name,
          inArea.length, actor.staffId],
      );
      await this.audit.writeInTx(client, {
        eventType: 'delivery.area_moved',
        actor: { id: actor.staffId, role: roleOf(actor) },
        entityType: 'delivery_area_move', entityId: id,
        severity: 'high',
        relatedRefs: { delivery_date: input.deliveryDate, area_key: key, ...(previous ? { replaced_move_id: previous } : {}) },
        before: { driver_id: fromId },
        after: { driver_id: target.id, orders: inArea.length },
      });
      return toRow(rows[0]);
    });
  }

  async cancel(actor: StaffContext, id: string, today: string): Promise<AreaMoveRow> {
    return withTransaction(this.pool, async (client) => {
      const { rows } = await client.query(`SELECT * FROM delivery_area_move WHERE id = $1 FOR UPDATE`, [id]);
      if (rows.length === 0) throw new AreaMoveError('not_found', { id });
      const row = toRow(rows[0]);
      if (rows[0].cancelled_at !== null) throw new AreaMoveError('conflict', { reason: 'already_cancelled' });
      if (row.delivery_date < today) throw new AreaMoveError('conflict', { reason: 'past_day' });
      await client.query(
        `UPDATE delivery_area_move SET cancelled_at = now(), cancelled_by = $2 WHERE id = $1`, [id, actor.staffId],
      );
      await this.audit.writeInTx(client, {
        eventType: 'delivery.area_move_cancelled',
        actor: { id: actor.staffId, role: roleOf(actor) },
        entityType: 'delivery_area_move', entityId: id,
        severity: 'high',
        relatedRefs: { delivery_date: row.delivery_date, area_key: row.area_key },
        before: { driver_id: row.to_driver_id },
        after: { driver_id: row.from_driver_id },
      });
      return row;
    });
  }

  private async cancelActiveInTx(
    client: PoolClient, actor: StaffContext, deliveryDate: string, key: string,
  ): Promise<string | null> {
    const { rows } = await client.query(
      `UPDATE delivery_area_move SET cancelled_at = now(), cancelled_by = $3
        WHERE delivery_date = $1 AND area_key = $2 AND cancelled_at IS NULL RETURNING id`,
      [deliveryDate, key, actor.staffId],
    );
    return rows.length > 0 ? (rows[0].id as string) : null;
  }
}

function roleOf(actor: StaffContext): string {
  return actor.roles.includes('fleetbase_admin') ? 'fleetbase_admin' : 'fleetbase_operator';
}

function toRow(raw: Record<string, unknown>): AreaMoveRow {
  const date = raw.delivery_date;
  return {
    id: raw.id as string,
    // node-postgres hands a DATE back as a local-midnight Date; format it without a timezone shift.
    delivery_date: date instanceof Date
      ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      : String(date).slice(0, 10),
    area_key: raw.area_key as string,
    area_label: raw.area_label as string,
    from_driver_id: (raw.from_driver_id as string) ?? null,
    from_driver_name: (raw.from_driver_name as string) ?? null,
    to_driver_id: raw.to_driver_id as string,
    to_driver_name: (raw.to_driver_name as string) ?? null,
    orders_at_request: Number(raw.orders_at_request),
    created_at: raw.created_at instanceof Date ? raw.created_at.toISOString() : String(raw.created_at),
    created_by: raw.created_by as string,
  };
}
