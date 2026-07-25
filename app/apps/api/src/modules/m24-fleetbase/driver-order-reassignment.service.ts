import type { Pool, PoolClient } from 'pg';
import { AuditService } from '../../platform/audit/audit.service';
import type { StaffContext } from '../../platform/auth/session.service';
import { withTransaction } from '../../platform/db/tx';
import { newId } from '../../platform/ids';
import type { FleetbaseCredentialDriver } from './fleetbase-credentials.client';
import {
  FleetbaseOrderManagerClient,
  FleetbaseOrderManagerClientError,
  type FleetbaseAssignedOrder,
  type FleetbaseOrderManagerGateway,
} from './fleetbase-order-manager.client';

const UPSTREAM_CHUNK_SIZE = 100;
const TERMINAL_STATUSES = new Set(['completed', 'canceled', 'cancelled']);

export interface ReassignmentDriverView {
  id: string;
  name: string;
  status: string | null;
  online: boolean;
}

export interface ReassignmentOrderView {
  id: string;
  tracking: string | null;
  status: string;
  scheduled_at: string | null;
  dispatched: boolean;
  eligible: boolean;
  blocked_reason: 'started' | 'current_job' | 'terminal' | 'invalid_record' | null;
}

export type ReassignmentFailureCode =
  | 'source_changed'
  | 'upstream_failed'
  | 'verification_failed'
  | 'verification_unavailable';

export interface ReassignmentResult {
  reassignment_id: string;
  status: 'completed' | 'partial' | 'failed';
  requested_count: number;
  completed_count: number;
  failed_count: number;
  failed_orders: Array<{ id: string; reason: ReassignmentFailureCode }>;
}

export class DriverOrderReassignmentError extends Error {
  constructor(
    readonly code: 'validation_failed' | 'not_found' | 'integration_unavailable' | 'upstream_rejected',
    readonly detail?: Record<string, unknown>,
  ) {
    super(code);
  }
}

interface Outcome {
  id: string;
  status: 'completed' | 'failed';
  failureCode?: ReassignmentFailureCode;
}

export class DriverOrderReassignmentService {
  private gateway: FleetbaseOrderManagerGateway | null;

  constructor(
    private readonly pool: Pool,
    private readonly audit: AuditService,
    gateway?: FleetbaseOrderManagerGateway,
  ) {
    this.gateway = gateway ?? null;
  }

  async listDrivers(): Promise<ReassignmentDriverView[]> {
    const drivers = await this.call(() => this.client().listDrivers());
    return drivers
      .filter((driver) => Boolean(driver.public_id && driver.uuid))
      .map((driver) => this.driverView(driver))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async listOrders(driverPublicId: string, date?: string): Promise<ReassignmentOrderView[]> {
    this.validateDriverId(driverPublicId);
    if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new DriverOrderReassignmentError('validation_failed', { field: 'date' });
    }
    const assigned = await this.call(() => this.client().listAssignedOrders(driverPublicId));
    if (!assigned.driver?.uuid || assigned.driver.public_id !== driverPublicId) {
      throw new DriverOrderReassignmentError('not_found');
    }
    return assigned.orders
      .filter((order) => typeof order.public_id === 'string' && /^order_[A-Za-z0-9]+$/.test(order.public_id))
      .filter((order) => date === undefined || calendarDate(order.scheduled_at) === date)
      .map((order) => this.orderView(order, assigned.current, assigned.driver?.uuid))
      .sort((a, b) => (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? '') || a.id.localeCompare(b.id));
  }

  async reassign(
    actor: StaffContext,
    input: { source_driver_id?: string; target_driver_id?: string; order_ids?: unknown },
  ): Promise<ReassignmentResult> {
    const sourceId = input.source_driver_id ?? '';
    const targetId = input.target_driver_id ?? '';
    this.validateDriverId(sourceId);
    this.validateDriverId(targetId);
    if (sourceId === targetId) {
      throw new DriverOrderReassignmentError('validation_failed', { field: 'target_driver_id' });
    }
    const orderIds = this.validateOrderIds(input.order_ids);

    const drivers = await this.call(() => this.client().listDrivers());
    const source = drivers.find((driver) => driver.public_id === sourceId && driver.uuid);
    const target = drivers.find((driver) => driver.public_id === targetId && driver.uuid);
    if (!source?.uuid || !target?.uuid) throw new DriverOrderReassignmentError('not_found');

    const preflight = await this.call(() => this.client().listAssignedOrders(sourceId));
    if (preflight.driver?.uuid !== source.uuid || preflight.driver.public_id !== sourceId) {
      throw new DriverOrderReassignmentError('integration_unavailable');
    }
    const preflightById = new Map(preflight.orders.map((order) => [order.public_id, order]));
    const invalid = orderIds.filter((id) => {
      const order = preflightById.get(id);
      return !order
        || order.driver_assigned_uuid !== source.uuid
        || this.blockedReason(order, preflight.current) !== null;
    });
    if (invalid.length > 0) {
      throw new DriverOrderReassignmentError('validation_failed', {
        field: 'order_ids',
        unavailable_order_ids: invalid,
      });
    }

    const reassignmentId = newId();
    try {
      await this.createRequest(actor, reassignmentId, sourceId, targetId, orderIds);
    } catch (error) {
      if (isPendingOrderConflict(error)) {
        throw new DriverOrderReassignmentError('validation_failed', {
          field: 'order_ids',
          reason: 'reassignment_in_progress',
        });
      }
      throw error;
    }

    const outcomes = new Map<string, Outcome>();
    let stopRemaining = false;
    for (const chunkIds of chunks(orderIds, UPSTREAM_CHUNK_SIZE)) {
      if (stopRemaining) {
        for (const id of chunkIds) outcomes.set(id, { id, status: 'failed', failureCode: 'upstream_failed' });
        continue;
      }

      const current = await this.safeAssignedOrders(sourceId);
      if (!current || current.driver?.uuid !== source.uuid || current.driver.public_id !== sourceId) {
        for (const id of chunkIds) outcomes.set(id, { id, status: 'failed', failureCode: 'verification_unavailable' });
        stopRemaining = true;
        continue;
      }
      const currentById = new Map(current.orders.map((order) => [order.public_id, order]));
      const safeOrders: FleetbaseAssignedOrder[] = [];
      for (const id of chunkIds) {
        const order = currentById.get(id);
        if (
          !order
          || order.driver_assigned_uuid !== source.uuid
          || this.blockedReason(order, current.current) !== null
          || !order.uuid
        ) {
          outcomes.set(id, { id, status: 'failed', failureCode: 'source_changed' });
        } else {
          safeOrders.push(order);
        }
      }
      if (safeOrders.length === 0) continue;

      try {
        await this.call(() => this.client().bulkAssignDriver(
          safeOrders.map((order) => order.uuid as string),
          target.uuid as string,
        ));
      } catch {
        for (const order of safeOrders) {
          outcomes.set(order.public_id as string, { id: order.public_id as string, status: 'failed', failureCode: 'upstream_failed' });
        }
        stopRemaining = true;
        continue;
      }

      const targetState = await this.safeAssignedOrders(targetId);
      if (!targetState || targetState.driver?.uuid !== target.uuid || targetState.driver.public_id !== targetId) {
        for (const order of safeOrders) {
          outcomes.set(order.public_id as string, { id: order.public_id as string, status: 'failed', failureCode: 'verification_unavailable' });
        }
        stopRemaining = true;
        continue;
      }
      const targetUuids = new Set(targetState.orders
        .filter((order) => order.driver_assigned_uuid === target.uuid)
        .map((order) => order.uuid));
      for (const order of safeOrders) {
        const id = order.public_id as string;
        outcomes.set(id, targetUuids.has(order.uuid)
          ? { id, status: 'completed' }
          : { id, status: 'failed', failureCode: 'verification_failed' });
      }
    }

    for (const id of orderIds) {
      if (!outcomes.has(id)) outcomes.set(id, { id, status: 'failed', failureCode: 'upstream_failed' });
    }
    return this.finish(actor, reassignmentId, sourceId, targetId, orderIds, [...outcomes.values()]);
  }

  private client(): FleetbaseOrderManagerGateway {
    if (!this.gateway) this.gateway = FleetbaseOrderManagerClient.fromEnv();
    return this.gateway;
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof DriverOrderReassignmentError) throw error;
      if (error instanceof FleetbaseOrderManagerClientError) {
        if (error.status === 404) throw new DriverOrderReassignmentError('not_found');
        if ([400, 401, 403, 422].includes(error.status)) {
          throw new DriverOrderReassignmentError('upstream_rejected');
        }
      }
      throw new DriverOrderReassignmentError('integration_unavailable');
    }
  }

  private async safeAssignedOrders(driverId: string) {
    try {
      return await this.call(() => this.client().listAssignedOrders(driverId));
    } catch {
      return null;
    }
  }

  private validateDriverId(id: string): void {
    if (!/^driver_[A-Za-z0-9]+$/.test(id)) {
      throw new DriverOrderReassignmentError('validation_failed', { field: 'driver_id' });
    }
  }

  private validateOrderIds(value: unknown): string[] {
    if (!Array.isArray(value) || value.length === 0) {
      throw new DriverOrderReassignmentError('validation_failed', { field: 'order_ids' });
    }
    const ids = [...new Set(value)];
    if (ids.some((id) => typeof id !== 'string' || !/^order_[A-Za-z0-9]+$/.test(id))) {
      throw new DriverOrderReassignmentError('validation_failed', { field: 'order_ids' });
    }
    return ids as string[];
  }

  private blockedReason(
    order: FleetbaseAssignedOrder,
    currentUuid: string | null,
    expectedDriverUuid?: string,
  ): ReassignmentOrderView['blocked_reason'] {
    if (!order.uuid || !order.public_id) return 'invalid_record';
    if (expectedDriverUuid && order.driver_assigned_uuid !== expectedDriverUuid) return 'invalid_record';
    if (currentUuid === order.uuid) return 'current_job';
    if (order.started_at) return 'started';
    if (TERMINAL_STATUSES.has((order.status ?? '').toLowerCase())) return 'terminal';
    return null;
  }

  private driverView(driver: FleetbaseCredentialDriver): ReassignmentDriverView {
    return {
      id: driver.public_id as string,
      name: driver.name?.trim() || 'Driver',
      status: driver.status ?? null,
      online: driver.online === true,
    };
  }

  private orderView(
    order: FleetbaseAssignedOrder,
    currentUuid: string | null,
    expectedDriverUuid?: string,
  ): ReassignmentOrderView {
    const blocked = this.blockedReason(order, currentUuid, expectedDriverUuid);
    return {
      id: order.public_id ?? 'invalid',
      tracking: order.tracking ?? null,
      status: order.status ?? 'unknown',
      scheduled_at: order.scheduled_at ?? null,
      dispatched: order.dispatched === true,
      eligible: blocked === null,
      blocked_reason: blocked,
    };
  }

  private async createRequest(
    actor: StaffContext,
    reassignmentId: string,
    sourceId: string,
    targetId: string,
    orderIds: string[],
  ): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO driver_order_reassignment
           (id,source_driver_public_id,target_driver_public_id,status,requested_count,requested_by,created_by)
         VALUES ($1,$2,$3,'requested',$4,$5,$5)`,
        [reassignmentId, sourceId, targetId, orderIds.length, actor.staffId],
      );
      for (const orderChunk of chunks(orderIds, 500)) {
        await this.insertItems(client, reassignmentId, actor.staffId, orderChunk);
      }
      await this.audit.writeInTx(client, {
        eventType: 'delivery.driver_order_reassignment_requested',
        actor: this.actor(actor),
        entityType: 'driver_order_reassignment',
        entityId: reassignmentId,
        relatedRefs: { source_driver_id: sourceId, target_driver_id: targetId },
        after: { status: 'requested', requested_count: orderIds.length },
        severity: 'high',
      });
    });
  }

  private async insertItems(client: PoolClient, reassignmentId: string, actorId: string, orderIds: string[]) {
    const params: unknown[] = [];
    const rows = orderIds.map((orderId, index) => {
      const offset = index * 4;
      params.push(newId(), reassignmentId, orderId, actorId);
      return `($${offset + 1},$${offset + 2},$${offset + 3},'pending',$${offset + 4})`;
    });
    await client.query(
      `INSERT INTO driver_order_reassignment_item
         (id,reassignment_id,fleetbase_order_public_id,status,created_by)
       VALUES ${rows.join(',')}`,
      params,
    );
  }

  private async finish(
    actor: StaffContext,
    reassignmentId: string,
    sourceId: string,
    targetId: string,
    orderIds: string[],
    outcomes: Outcome[],
  ): Promise<ReassignmentResult> {
    const completed = outcomes.filter((outcome) => outcome.status === 'completed');
    const failed = outcomes.filter((outcome) => outcome.status === 'failed');
    const status: ReassignmentResult['status'] = completed.length === orderIds.length
      ? 'completed'
      : completed.length > 0 ? 'partial' : 'failed';
    await withTransaction(this.pool, async (client) => {
      for (const outcomeChunk of chunks(outcomes, 200)) {
        await this.updateItems(client, reassignmentId, actor.staffId, outcomeChunk);
      }
      await client.query(
        `UPDATE driver_order_reassignment
            SET status=$2, completed_count=$3, failed_count=$4, completed_at=now(),
                updated_at=now(), updated_by=$5, version=version+1
          WHERE id=$1 AND status='requested'`,
        [reassignmentId, status, completed.length, failed.length, actor.staffId],
      );
      await this.audit.writeInTx(client, {
        eventType: status === 'completed'
          ? 'delivery.driver_order_reassignment_completed'
          : 'delivery.driver_order_reassignment_partial_or_failed',
        actor: this.actor(actor),
        entityType: 'driver_order_reassignment',
        entityId: reassignmentId,
        relatedRefs: { source_driver_id: sourceId, target_driver_id: targetId },
        before: { status: 'requested', requested_count: orderIds.length },
        after: {
          status,
          requested_count: orderIds.length,
          completed_count: completed.length,
          failed_count: failed.length,
        },
        severity: 'high',
      });
    });
    return {
      reassignment_id: reassignmentId,
      status,
      requested_count: orderIds.length,
      completed_count: completed.length,
      failed_count: failed.length,
      failed_orders: failed.map((outcome) => ({ id: outcome.id, reason: outcome.failureCode as ReassignmentFailureCode })),
    };
  }

  private async updateItems(
    client: PoolClient,
    reassignmentId: string,
    actorId: string,
    outcomes: Outcome[],
  ): Promise<void> {
    const params: unknown[] = [reassignmentId, actorId];
    const rows = outcomes.map((outcome, index) => {
      const offset = 3 + index * 3;
      params.push(outcome.id, outcome.status, outcome.failureCode ?? null);
      return `($${offset},$${offset + 1},$${offset + 2})`;
    });
    await client.query(
      `UPDATE driver_order_reassignment_item AS item
          SET status=outcome.status,
              failure_code=outcome.failure_code,
              completed_at=now(), updated_at=now(), updated_by=$2, version=item.version+1
         FROM (VALUES ${rows.join(',')}) AS outcome(order_id,status,failure_code)
        WHERE item.reassignment_id=$1
          AND item.fleetbase_order_public_id=outcome.order_id
          AND item.status='pending'`,
      params,
    );
  }

  private actor(actor: StaffContext): { id: string; role: string } {
    return { id: actor.staffId, role: actor.roles[0] ?? 'none' };
  }
}

function calendarDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match?.[1] ?? null;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

function isPendingOrderConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; constraint?: unknown };
  return candidate.code === '23505'
    && candidate.constraint === 'driver_order_reassignment_item_pending_order_uidx';
}
