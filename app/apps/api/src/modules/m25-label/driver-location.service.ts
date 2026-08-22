import type { Pool, PoolClient } from 'pg';
import type {
  DriverLocationCaptureMethod, DriverLocationCaptureResultContract,
  DriverLocationManifestContract, DriverLocationManifestEntryContract,
  FleetOpsDriverLocationContract,
} from '@nutrezee/shared';
import type { StaffContext } from '../../platform/auth/session.service';
import { AuditService } from '../../platform/audit/audit.service';
import { withTransaction } from '../../platform/db/tx';
import {
  IdempotencyConflictError, IdempotencyService,
} from '../../platform/idempotency/idempotency.service';
import { newId } from '../../platform/ids';
import type { FleetbaseAssignedOrder, FleetbaseDriverContext } from './fleetbase-identity.service';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KW_LAT = [28.4, 30.2] as const;
const KW_LNG = [46.4, 48.6] as const;

export class DriverLocationError extends Error {
  constructor(
    readonly code: 'validation_failed' | 'forbidden' | 'conflict' | 'not_found',
    readonly detail?: unknown,
  ) {
    super(code);
  }
}

interface CaptureRow {
  id: string;
  partner_customer_ref: string;
  fleetbase_order_id: string;
  source_order_number: string | null;
  delivery_date: string | Date;
  fleetbase_driver_id: string | null;
  latitude: number | string;
  longitude: number | string;
  accuracy_meters: number | string | null;
  capture_method: DriverLocationCaptureMethod | 'operator_correction';
  supersedes_id: string | null;
  correction_reason: string | null;
  created_at: string | Date;
}

interface CaptureInput {
  fleetbase_order_id: string;
  latitude: number;
  longitude: number;
  capture_method: DriverLocationCaptureMethod;
  accuracy_meters?: number;
}

export function isKuwaitCoordinate(latitude: unknown, longitude: unknown): boolean {
  return typeof latitude === 'number' && Number.isFinite(latitude)
    && typeof longitude === 'number' && Number.isFinite(longitude)
    && latitude >= KW_LAT[0] && latitude <= KW_LAT[1]
    && longitude >= KW_LNG[0] && longitude <= KW_LNG[1]
    && !(latitude === 0 && longitude === 0);
}

/**
 * A30 owns only the append-only Nutrezee capture ledger. Fleetbase assignments and Partner pins
 * are read-only authorities supplied by FleetbaseIdentityService on every request.
 */
export class DriverLocationService {
  constructor(
    private readonly pool: Pool,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async manifest(actor: FleetbaseDriverContext, deliveryDate: string): Promise<DriverLocationManifestContract> {
    this.assertDate(deliveryDate);
    const recoverable = actor.assignedOrders.filter((item) =>
      item.callCustomerRequired === true && item.authoritativePinValid !== true,
    );
    const refs = [...new Set(recoverable.map((item) => item.sourceCustomerRef).filter(isString))];
    const latest = await this.latestForRefs(refs);
    const entries = recoverable.map((assignment) =>
      this.manifestEntry(assignment, latest.get(assignment.sourceCustomerRef ?? '')),
    ).sort((a, b) =>
      stateOrder(a.state) - stateOrder(b.state)
      || (a.area ?? '').localeCompare(b.area ?? '')
      || (a.order_number ?? '').localeCompare(b.order_number ?? ''),
    );
    return {
      delivery_date: deliveryDate,
      driver_ref: actor.driverRef,
      total: entries.length,
      pending: entries.filter((item) => item.state === 'needs_capture').length,
      captured: entries.filter((item) => item.state === 'captured').length,
      blocked: entries.filter((item) => item.state === 'blocked').length,
      entries,
    };
  }

  async capture(
    actor: FleetbaseDriverContext,
    deliveryDate: string,
    input: CaptureInput,
    idempotencyKey?: string,
  ): Promise<DriverLocationCaptureResultContract> {
    this.assertDate(deliveryDate);
    const normalized = this.validateCapture(input);
    const assignment = actor.assignedOrders.find((item) =>
      item.fleetbaseOrderId === normalized.fleetbase_order_id,
    );
    if (!assignment) {
      throw new DriverLocationError('forbidden', { reason: 'order_not_assigned' });
    }
    if (assignment.authoritativePinValid === true || assignment.callCustomerRequired !== true) {
      return this.result('partner_pin_available', assignment, null, normalized);
    }
    const sourceCustomerRef = assignment.sourceCustomerRef;
    if (!sourceCustomerRef) {
      throw new DriverLocationError('conflict', { reason: 'missing_customer_reference' });
    }

    const requestHash = idempotencyKey ? this.idempotency.hashRequest({
      fleetbase_driver_id: actor.driverId,
      fleetbase_order_id: normalized.fleetbase_order_id,
      delivery_date: deliveryDate,
      latitude: normalized.latitude,
      longitude: normalized.longitude,
      capture_method: normalized.capture_method,
      accuracy_meters: normalized.accuracy_meters ?? null,
    }) : null;
    if (idempotencyKey && requestHash) {
      const replay = await this.replay(idempotencyKey, actor.driverId, requestHash);
      if (replay) return replay;
    }

    return withTransaction(this.pool, async (client) => {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [sourceCustomerRef]);
      const existing = await this.latestForRef(client, sourceCustomerRef);
      if (existing) {
        return this.result('already_captured', assignment, existing, normalized);
      }

      if (idempotencyKey && requestHash) {
        const claim = await this.idempotency.claimInTx(
          client,
          idempotencyKey,
          'driver_location.capture',
          requestHash,
        );
        if (claim.replay) {
          if (!claim.responseRef) throw new IdempotencyConflictError('idempotency response is incomplete');
          const replayRow = await this.captureById(client, claim.responseRef);
          if (!replayRow || replayRow.fleetbase_driver_id !== actor.driverId) {
            throw new IdempotencyConflictError('idempotency response belongs to a different actor');
          }
          return this.result('accepted', assignment, replayRow, normalized);
        }
      }

      const id = newId();
      const { rows } = await client.query(
        `INSERT INTO driver_customer_location_capture
           (id, partner_customer_ref, fleetbase_order_id, source_order_number, delivery_date,
            fleetbase_user_uuid, fleetbase_driver_id, latitude, longitude, accuracy_meters,
            capture_method, created_by, created_by_role)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         RETURNING *`,
        [id, sourceCustomerRef, assignment.fleetbaseOrderId,
          assignment.orderNumber ?? null, deliveryDate, actor.userUuid, actor.driverId,
          normalized.latitude, normalized.longitude, normalized.accuracy_meters ?? null,
          normalized.capture_method, actor.actorId, actor.actorRole],
      );
      await this.audit.writeInTx(client, {
        eventType: 'driver_location.captured',
        actor: { id: actor.actorId, role: actor.actorRole },
        entityType: 'driver_customer_location_capture',
        entityId: id,
        severity: 'high',
        relatedRefs: {
          fleetbase_driver_id: actor.driverId,
          fleetbase_order_id: assignment.fleetbaseOrderId,
          partner_customer_ref: sourceCustomerRef,
          delivery_date: deliveryDate,
        },
        after: {
          latitude: normalized.latitude,
          longitude: normalized.longitude,
          capture_method: normalized.capture_method,
        },
      });
      if (idempotencyKey) await this.idempotency.storeResponseInTx(client, idempotencyKey, id);
      return this.result('accepted', assignment, rows[0] as CaptureRow, normalized);
    });
  }

  async listForOperator(deliveryDate?: string): Promise<{ items: FleetOpsDriverLocationContract[] }> {
    if (deliveryDate !== undefined) this.assertDate(deliveryDate);
    const values: unknown[] = [];
    const dateClause = deliveryDate ? 'AND c.delivery_date=$1' : '';
    if (deliveryDate) values.push(deliveryDate);
    const { rows } = await this.pool.query(
      `SELECT c.*
         FROM driver_customer_location_capture c
        WHERE NOT EXISTS (
          SELECT 1 FROM driver_customer_location_capture newer WHERE newer.supersedes_id=c.id
        )
        ${dateClause}
        ORDER BY c.delivery_date DESC, c.created_at DESC
        LIMIT 500`,
      values,
    );
    return { items: (rows as CaptureRow[]).map((row) => this.operatorRow(row)) };
  }

  async correct(
    actor: StaffContext,
    captureId: string,
    input: { latitude: number; longitude: number; reason: string; accuracy_meters?: number },
  ): Promise<FleetOpsDriverLocationContract> {
    const reason = String(input.reason ?? '').trim();
    if (!reason || reason.length > 500) {
      throw new DriverLocationError('validation_failed', { field: 'reason' });
    }
    if (!isKuwaitCoordinate(input.latitude, input.longitude)) {
      throw new DriverLocationError('validation_failed', { field: 'coordinates' });
    }
    const accuracy = normalizeAccuracy(input.accuracy_meters);
    return withTransaction(this.pool, async (client) => {
      const current = await this.captureById(client, captureId);
      if (!current) throw new DriverLocationError('not_found', { capture_id: captureId });
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [current.partner_customer_ref]);
      if (await this.hasSupersedingRow(client, current.id)) {
        throw new DriverLocationError('conflict', { reason: 'capture_already_superseded' });
      }
      const id = newId();
      const role = actor.roles.includes('fleetbase_admin') ? 'fleetbase_admin' : 'fleetbase_operator';
      const { rows } = await client.query(
        `INSERT INTO driver_customer_location_capture
           (id, partner_customer_ref, fleetbase_order_id, source_order_number, delivery_date,
            fleetbase_driver_id, latitude, longitude, accuracy_meters, capture_method,
            supersedes_id, correction_reason, created_by, created_by_role)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'operator_correction',$10,$11,$12,$13)
         RETURNING *`,
        [id, current.partner_customer_ref, current.fleetbase_order_id, current.source_order_number,
          dateString(current.delivery_date), current.fleetbase_driver_id, input.latitude,
          input.longitude, accuracy, current.id, reason, actor.staffId, role],
      );
      await this.audit.writeInTx(client, {
        eventType: 'driver_location.corrected',
        actor: { id: actor.staffId, role },
        entityType: 'driver_customer_location_capture', entityId: id,
        severity: 'high', reason,
        relatedRefs: {
          previous_capture_id: current.id,
          fleetbase_order_id: current.fleetbase_order_id,
          partner_customer_ref: current.partner_customer_ref,
        },
        before: { latitude: Number(current.latitude), longitude: Number(current.longitude) },
        after: { latitude: input.latitude, longitude: input.longitude },
      });
      return this.operatorRow(rows[0] as CaptureRow);
    });
  }

  private manifestEntry(
    assignment: FleetbaseAssignedOrder,
    capture?: CaptureRow,
  ): DriverLocationManifestEntryContract {
    const blockedReason = !assignment.sourceCustomerRef
      ? 'missing_customer_reference'
      : (!assignment.fallbackLocation ? 'fallback_unavailable' : null);
    const fallbackSource = assignment.fallbackSource === 'known_stop_anchor'
      ? 'known_stop_anchor' : 'area_centroid';
    return {
      fleetbase_order_id: assignment.fleetbaseOrderId,
      order_number: assignment.orderNumber ?? null,
      customer_name: assignment.customerName ?? null,
      area: assignment.area ?? null,
      phone: assignment.phone ?? null,
      state: capture ? 'captured' : (blockedReason ? 'blocked' : 'needs_capture'),
      blocked_reason: capture ? null : blockedReason,
      fallback: assignment.fallbackLocation ? {
        latitude: assignment.fallbackLocation.latitude,
        longitude: assignment.fallbackLocation.longitude,
        source: fallbackSource,
        label_en: fallbackSource === 'known_stop_anchor'
          ? 'Nearby known stop — not the customer pin'
          : 'Area centre — not the customer pin',
        label_ar: fallbackSource === 'known_stop_anchor'
          ? 'نقطة توصيل قريبة معروفة — ليست موقع العميل'
          : 'مركز المنطقة — ليس موقع العميل',
      } : null,
      exact_location: capture ? {
        latitude: Number(capture.latitude),
        longitude: Number(capture.longitude),
        captured_at: timestamp(capture.created_at),
        capture_method: capture.capture_method,
      } : null,
    };
  }

  private validateCapture(input: CaptureInput): CaptureInput {
    const orderId = String(input?.fleetbase_order_id ?? '').trim();
    if (!orderId) throw new DriverLocationError('validation_failed', { field: 'fleetbase_order_id' });
    if (!isKuwaitCoordinate(input.latitude, input.longitude)) {
      throw new DriverLocationError('validation_failed', { field: 'coordinates' });
    }
    if (input.capture_method !== 'current_gps' && input.capture_method !== 'shared_coordinates') {
      throw new DriverLocationError('validation_failed', { field: 'capture_method' });
    }
    return {
      fleetbase_order_id: orderId,
      latitude: input.latitude,
      longitude: input.longitude,
      capture_method: input.capture_method,
      accuracy_meters: normalizeAccuracy(input.accuracy_meters) ?? undefined,
    };
  }

  private assertDate(value: string): void {
    if (!validDateString(value)) {
      throw new DriverLocationError('validation_failed', { field: 'delivery_date' });
    }
  }

  private async latestForRefs(refs: string[]): Promise<Map<string, CaptureRow>> {
    if (refs.length === 0) return new Map();
    const { rows } = await this.pool.query(
      `SELECT c.*
         FROM driver_customer_location_capture c
        WHERE c.partner_customer_ref = ANY($1::text[])
          AND NOT EXISTS (
            SELECT 1 FROM driver_customer_location_capture newer WHERE newer.supersedes_id=c.id
          )`,
      [refs],
    );
    return new Map((rows as CaptureRow[]).map((row) => [row.partner_customer_ref, row]));
  }

  private async latestForRef(client: PoolClient, ref: string): Promise<CaptureRow | null> {
    const { rows } = await client.query(
      `SELECT c.* FROM driver_customer_location_capture c
        WHERE c.partner_customer_ref=$1
          AND NOT EXISTS (
            SELECT 1 FROM driver_customer_location_capture newer WHERE newer.supersedes_id=c.id
          )
        ORDER BY c.created_at DESC LIMIT 1`,
      [ref],
    );
    return (rows[0] as CaptureRow | undefined) ?? null;
  }

  private async replay(
    key: string,
    driverId: string,
    requestHash: string,
  ): Promise<DriverLocationCaptureResultContract | null> {
    const { rows } = await this.pool.query(
      `SELECT i.operation, i.request_hash, i.response_ref,
              c.id, c.partner_customer_ref, c.fleetbase_order_id, c.source_order_number,
              c.delivery_date, c.fleetbase_driver_id, c.latitude, c.longitude,
              c.accuracy_meters, c.capture_method, c.supersedes_id,
              c.correction_reason, c.created_at
         FROM idempotency_key i
         LEFT JOIN driver_customer_location_capture c ON c.id=i.response_ref
        WHERE i.key=$1 LIMIT 1`,
      [key],
    );
    const record = rows[0] as (CaptureRow & {
      operation: string;
      request_hash: string;
      response_ref: string | null;
    }) | undefined;
    if (!record) return null;
    if (record.operation !== 'driver_location.capture' || record.request_hash !== requestHash) {
      throw new IdempotencyConflictError('idempotency key reused with a different request');
    }
    if (!record.response_ref || !record.id || record.fleetbase_driver_id !== driverId) {
      throw new IdempotencyConflictError('idempotency response is unavailable for this actor');
    }
    return {
      outcome: 'accepted',
      fleetbase_order_id: record.fleetbase_order_id,
      latitude: Number(record.latitude), longitude: Number(record.longitude),
      captured_at: timestamp(record.created_at),
      message_en: 'Exact customer location saved.',
      message_ar: 'تم حفظ موقع العميل الدقيق.',
    };
  }

  private result(
    outcome: DriverLocationCaptureResultContract['outcome'],
    assignment: FleetbaseAssignedOrder,
    row: CaptureRow | null,
    input: CaptureInput,
  ): DriverLocationCaptureResultContract {
    const messages = {
      accepted: ['Exact customer location saved.', 'تم حفظ موقع العميل الدقيق.'],
      already_captured: ['An exact location is already saved.', 'يوجد موقع دقيق محفوظ بالفعل.'],
      partner_pin_available: ['Partner now provides the customer pin; no capture was saved.', 'أصبح موقع العميل متاحًا من Partner؛ لم يتم حفظ موقع جديد.'],
    } as const;
    const [message_en, message_ar] = messages[outcome];
    return {
      outcome,
      fleetbase_order_id: assignment.fleetbaseOrderId,
      latitude: row ? Number(row.latitude) : input.latitude,
      longitude: row ? Number(row.longitude) : input.longitude,
      captured_at: row ? timestamp(row.created_at) : null,
      message_en, message_ar,
    };
  }

  private async captureById(client: PoolClient, id: string): Promise<CaptureRow | null> {
    const { rows } = await client.query(
      'SELECT * FROM driver_customer_location_capture WHERE id=$1 LIMIT 1', [id],
    );
    return (rows[0] as CaptureRow | undefined) ?? null;
  }

  private async hasSupersedingRow(client: PoolClient, id: string): Promise<boolean> {
    const { rowCount } = await client.query(
      'SELECT 1 FROM driver_customer_location_capture WHERE supersedes_id=$1 LIMIT 1', [id],
    );
    return (rowCount ?? 0) > 0;
  }

  private operatorRow(row: CaptureRow): FleetOpsDriverLocationContract {
    return {
      id: row.id,
      partner_customer_ref: row.partner_customer_ref,
      fleetbase_order_id: row.fleetbase_order_id,
      source_order_number: row.source_order_number,
      delivery_date: dateString(row.delivery_date),
      fleetbase_driver_id: row.fleetbase_driver_id,
      latitude: Number(row.latitude), longitude: Number(row.longitude),
      capture_method: row.capture_method,
      accuracy_meters: row.accuracy_meters === null ? null : Number(row.accuracy_meters),
      supersedes_id: row.supersedes_id,
      correction_reason: row.correction_reason,
      captured_at: timestamp(row.created_at),
    };
  }
}

function normalizeAccuracy(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 5000) {
    throw new DriverLocationError('validation_failed', { field: 'accuracy_meters' });
  }
  return value;
}

function dateString(value: string | Date): string {
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  // `pg` parses a DATE at process-local midnight. Converting that object to UTC can move Kuwait
  // dates to the previous day, so preserve its calendar components instead.
  const year = String(value.getFullYear()).padStart(4, '0');
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function timestamp(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function isString(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0;
}

function stateOrder(value: DriverLocationManifestEntryContract['state']): number {
  return value === 'needs_capture' ? 0 : value === 'blocked' ? 1 : 2;
}

function validDateString(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
