import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { AuditService } from '../../apps/api/src/platform/audit/audit.service';
import { IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service';
import { DriverLocationService } from '../../apps/api/src/modules/m25-label/driver-location.service';
import type {
  FleetbaseDriverContext,
} from '../../apps/api/src/modules/m25-label/fleetbase-identity.service';
import type { StaffContext } from '../../apps/api/src/platform/auth/session.service';

const DATE = '2099-05-12';
let pool: Pool;
let service: DriverLocationService;

const missingAssignment = {
  fleetbaseOrderId: 'order_missing_1',
  orderNumber: 'PARTNER-501',
  sourceCustomerRef: 'customer-ref-501',
  customerName: 'Assigned Customer',
  phone: '+96550000501',
  area: 'Salmiya',
  callCustomerRequired: true,
  authoritativePinValid: false,
  fallbackSource: 'known_stop_anchor' as const,
  fallbackLocation: { latitude: 29.3327, longitude: 48.0684 },
};
const driver: FleetbaseDriverContext = {
  actorId: 'fleetbase:driver-user-1', actorRole: 'fleetbase_driver',
  userUuid: 'driver-user-1', driverId: 'driver_1', driverRef: 'A1',
  assignedOrders: [missingAssignment],
};
const otherDriver: FleetbaseDriverContext = {
  actorId: 'fleetbase:driver-user-2', actorRole: 'fleetbase_driver',
  userUuid: 'driver-user-2', driverId: 'driver_2', driverRef: 'A2', assignedOrders: [],
};
const operator: StaffContext = {
  staffId: 'fleetbase:ops-1', name: 'Fleet-Ops user', email: '', locale: 'en',
  roles: ['fleetbase_operator'], sessionId: 'fleetbase',
};

beforeAll(async () => {
  pool = await freshDb();
  service = new DriverLocationService(pool, new AuditService(), new IdempotencyService());
}, 60_000);

afterAll(async () => { await pool.end(); });

describe('TS-I A30 assigned-driver missing-location recovery', () => {
  it('shows only recovery-required current assignments and never identifies the anchor customer', async () => {
    const manifest = await service.manifest(driver, DATE);
    expect(manifest).toMatchObject({ total: 1, pending: 1, captured: 0, blocked: 0 });
    expect(manifest.entries[0]).toMatchObject({
      fleetbase_order_id: missingAssignment.fleetbaseOrderId,
      customer_name: missingAssignment.customerName,
      phone: missingAssignment.phone,
      state: 'needs_capture',
      fallback: {
        source: 'known_stop_anchor',
        latitude: missingAssignment.fallbackLocation.latitude,
        longitude: missingAssignment.fallbackLocation.longitude,
      },
    });
    expect(JSON.stringify(manifest)).not.toContain('anchor_customer');

    const authoritative: FleetbaseDriverContext = {
      ...driver,
      assignedOrders: [{
        ...missingAssignment,
        fleetbaseOrderId: 'order_valid_partner',
        sourceCustomerRef: 'customer-ref-valid',
        callCustomerRequired: false,
        authoritativePinValid: true,
      }],
    };
    await expect(service.manifest(authoritative, DATE)).resolves.toMatchObject({ total: 0 });
  });

  it('accepts one exact capture with identity/assignment proof and replays idempotently', async () => {
    const first = await service.capture(driver, DATE, {
      fleetbase_order_id: missingAssignment.fleetbaseOrderId,
      latitude: 29.331234,
      longitude: 48.071234,
      capture_method: 'current_gps',
      accuracy_meters: 8,
    }, 'location-idem-1');
    expect(first).toMatchObject({ outcome: 'accepted', latitude: 29.331234, longitude: 48.071234 });
    expect(first.captured_at).toBeTruthy();

    const replay = await service.capture(driver, DATE, {
      fleetbase_order_id: missingAssignment.fleetbaseOrderId,
      latitude: 29.331234,
      longitude: 48.071234,
      capture_method: 'current_gps',
      accuracy_meters: 8,
    }, 'location-idem-1');
    expect(replay).toEqual(first);

    const secondAssignment = {
      ...missingAssignment,
      fleetbaseOrderId: 'order_missing_2',
      orderNumber: 'PARTNER-502',
      sourceCustomerRef: 'customer-ref-502',
    };
    await expect(service.capture({ ...driver, assignedOrders: [secondAssignment] }, DATE, {
      fleetbase_order_id: secondAssignment.fleetbaseOrderId,
      latitude: 29.341234,
      longitude: 48.081234,
      capture_method: 'shared_coordinates',
    }, 'location-idem-1')).rejects.toMatchObject({ code: 'idempotency_conflict' });

    const manifest = await service.manifest(driver, DATE);
    expect(manifest).toMatchObject({ pending: 0, captured: 1 });
    expect(manifest.entries[0]?.exact_location).toMatchObject({
      latitude: 29.331234, longitude: 48.071234, capture_method: 'current_gps',
    });

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM driver_customer_location_capture
        WHERE partner_customer_ref=$1`, [missingAssignment.sourceCustomerRef],
    );
    expect(rows[0].n).toBe(1);
    const audits = await pool.query(
      `SELECT count(*)::int AS n FROM audit_event
        WHERE event_type='driver_location.captured'
          AND related_refs->>'fleetbase_order_id'=$1`, [missingAssignment.fleetbaseOrderId],
    );
    expect(audits.rows[0].n).toBe(1);
  });

  it('rejects an unassigned order and refuses to override a valid Partner pin', async () => {
    await expect(service.capture(otherDriver, DATE, {
      fleetbase_order_id: missingAssignment.fleetbaseOrderId,
      latitude: 29.34, longitude: 48.08, capture_method: 'shared_coordinates',
    })).rejects.toMatchObject({ code: 'forbidden', detail: { reason: 'order_not_assigned' } });

    const authoritative: FleetbaseDriverContext = {
      ...driver,
      assignedOrders: [{
        ...missingAssignment,
        fleetbaseOrderId: 'order_valid_partner', sourceCustomerRef: 'customer-ref-valid',
        callCustomerRequired: false, authoritativePinValid: true,
      }],
    };
    const result = await service.capture(authoritative, DATE, {
      fleetbase_order_id: 'order_valid_partner', latitude: 29.35, longitude: 48.09,
      capture_method: 'shared_coordinates',
    });
    expect(result.outcome).toBe('partner_pin_available');
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM driver_customer_location_capture
        WHERE partner_customer_ref='customer-ref-valid'`,
    );
    expect(rows[0].n).toBe(0);
  });

  it('keeps corrections append-only and requires a Fleet-Ops reason', async () => {
    const listed = await service.listForOperator(DATE);
    const current = listed.items.find((item) => item.partner_customer_ref === missingAssignment.sourceCustomerRef);
    expect(current).toBeTruthy();
    await expect(service.correct(operator, current!.id, {
      latitude: 29.3315, longitude: 48.0715, reason: '',
    })).rejects.toMatchObject({ code: 'validation_failed', detail: { field: 'reason' } });
    await expect(service.correct(operator, current!.id, {
      latitude: 29.3315, longitude: 48.0715, reason: 'x'.repeat(501),
    })).rejects.toMatchObject({ code: 'validation_failed', detail: { field: 'reason' } });

    const corrected = await service.correct(operator, current!.id, {
      latitude: 29.3315, longitude: 48.0715, accuracy_meters: 5,
      reason: 'Customer confirmed a corrected building entrance',
    });
    expect(corrected).toMatchObject({
      capture_method: 'operator_correction', supersedes_id: current!.id,
      latitude: 29.3315, longitude: 48.0715,
    });
    const after = await service.listForOperator(DATE);
    expect(after.items.filter((item) => item.partner_customer_ref === missingAssignment.sourceCustomerRef))
      .toEqual([expect.objectContaining({ id: corrected.id })]);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM driver_customer_location_capture
        WHERE partner_customer_ref=$1`, [missingAssignment.sourceCustomerRef],
    );
    expect(rows[0].n).toBe(2);
    await expect(pool.query(
      'UPDATE driver_customer_location_capture SET latitude=29.4 WHERE id=$1', [current!.id],
    )).rejects.toThrow();
    const audits = await pool.query(
      `SELECT severity, reason FROM audit_event
        WHERE event_type='driver_location.corrected' AND entity_id=$1`, [corrected.id],
    );
    expect(audits.rows).toEqual([expect.objectContaining({
      severity: 'high', reason: 'Customer confirmed a corrected building entrance',
    })]);
  });
});
