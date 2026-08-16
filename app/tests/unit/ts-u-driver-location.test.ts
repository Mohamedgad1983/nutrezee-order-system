import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isKuwaitCoordinate } from '../../apps/api/src/modules/m25-label/driver-location.service';
import {
  FleetbaseIdentityService,
  type FleetbaseIdentityGateway,
  type FleetbaseOrderProjection,
} from '../../apps/api/src/modules/m25-label/fleetbase-identity.service';

class LocationGateway implements FleetbaseIdentityGateway {
  constructor(private readonly assigned: FleetbaseOrderProjection[]) {}
  async session() { return { user: 'driver-user', type: 'driver', verified: true }; }
  async drivers() { return [{ public_id: 'driver_1', internal_id: 'A1' }]; }
  async driversForUser() { return [{ public_id: 'driver_1', internal_id: 'A1' }]; }
  async assignedOrders() { return this.assigned; }
  async orders() { return this.assigned; }
  async order() { return this.assigned[0]!; }
}

describe('TS-U A30 assigned-driver location projection', () => {
  it('accepts only finite coordinates inside the same strict Kuwait bounds as dispatch', () => {
    expect(isKuwaitCoordinate(29.3339, 48.0758)).toBe(true);
    expect(isKuwaitCoordinate(0, 0)).toBe(false);
    expect(isKuwaitCoordinate(25.2, 55.3)).toBe(false);
    expect(isKuwaitCoordinate(Number.NaN, 48)).toBe(false);
    expect(isKuwaitCoordinate('29.3', 48)).toBe(false);
  });

  it('projects only the current assigned order and labels its fallback without anchor identity', async () => {
    const identity = new FleetbaseIdentityService(new LocationGateway([{
      id: 'order_missing_pin',
      meta: {
        delivery_date: '2099-05-12',
        source_order_number: 'PARTNER-101',
        source_customer_ref: 'customer-ref-101',
        routing_area: 'Salmiya',
        call_customer_required: true,
        pin_source: 'known_stop_anchor',
        location_accuracy: 'known_stop_not_customer_pin',
        fallback_source: 'known_stop_anchor',
        fallback_latitude: 29.3327,
        fallback_longitude: 48.0684,
      },
      customer: { name: 'Assigned Customer', phone: '+96550000001' },
    }]));

    const context = await identity.driverContext('token', '2099-05-12');
    expect(context.assignedOrders).toEqual([expect.objectContaining({
      fleetbaseOrderId: 'order_missing_pin',
      orderNumber: 'PARTNER-101',
      sourceCustomerRef: 'customer-ref-101',
      customerName: 'Assigned Customer',
      phone: '+96550000001',
      area: 'Salmiya',
      callCustomerRequired: true,
      authoritativePinValid: false,
      fallbackSource: 'known_stop_anchor',
      fallbackLocation: { latitude: 29.3327, longitude: 48.0684 },
    })]);
    expect(JSON.stringify(context.assignedOrders)).not.toContain('anchor_customer');
  });

  it('marks a valid Partner pin authoritative so capture cannot override it', async () => {
    const identity = new FleetbaseIdentityService(new LocationGateway([{
      id: 'order_partner_pin',
      meta: {
        delivery_date: '2099-05-12', source_order_number: 'PARTNER-102',
        source_customer_ref: 'customer-ref-102', call_customer_required: false,
        pin_source: 'vendor', location_accuracy: 'customer_pin',
      },
    }]));
    const context = await identity.driverContext('token', '2099-05-12');
    expect(context.assignedOrders[0]?.authoritativePinValid).toBe(true);
    expect(context.assignedOrders[0]?.callCustomerRequired).toBe(false);
  });
});

describe('TS-U A30 operational surfaces', () => {
  it('keeps the location bridge manual and preserves Partner-first provenance', () => {
    const bridge = readFileSync(resolve('../ops/fleetbase/nutreeze-orders.php'), 'utf8');
    const runner = readFileSync(resolve('../ops/fleetbase/nutreeze-orders-run.sh'), 'utf8');
    const unattended = readFileSync(resolve('../ops/fleetbase/nutreeze-daily-sync.sh'), 'utf8');
    expect(bridge).toContain("const LOCATION_RECOVERY_AUTHORIZATION = 'A30'");
    expect(bridge).toContain("'pin_source' => 'driver_capture'");
    expect(bridge).toContain("'pin_source' => 'known_stop_anchor'");
    expect(bridge).toContain('valid Partner pin > latest approved Nutrezee capture');
    expect(runner).toContain('--confirm-location-recovery=');
    expect(runner).toContain('driver_customer_location_capture');
    expect(unattended).not.toContain('--confirm-location-recovery=');
  });

  it('registers Driver Locations only inside the supported Fleet-Ops Resources extension', () => {
    const extension = readFileSync(resolve('../ops/fleetbase/extensions/nutrezee-labels-engine/addon/extension.js'), 'utf8');
    const component = readFileSync(resolve('../ops/fleetbase/extensions/nutrezee-labels-engine/addon/components/driver-locations.js'), 'utf8');
    expect(extension).toContain("label: 'Driver Locations'");
    expect(extension).toContain("section: 'management'");
    expect(extension).toContain("'driver-locations'");
    expect(component).toContain('/nz/fleet-ops/driver-locations');
    expect(component).toContain('/correct');
    expect(component).not.toContain('customer_name');
    expect(component).not.toContain('customer_phone');
  });
});
