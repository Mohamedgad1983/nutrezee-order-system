// TS-U — m24-fleetbase pure mapping + the strict geo gate (no DB).
import { describe, expect, it } from 'vitest';
import {
  assembleDropoff,
  composeStreet1,
  geoState,
  hasRealCoordinate,
} from '../../apps/api/src/modules/m24-fleetbase/address-assembler';
import { mapEventToState, mapOrder } from '../../apps/api/src/modules/m24-fleetbase/order-mapper';
import type { NutrezeeOrderContext } from '../../apps/api/src/modules/m24-fleetbase/fleetbase.types';

const baseCtx = (overrides: Partial<NutrezeeOrderContext> = {}): NutrezeeOrderContext => ({
  order_id: 'ord_1',
  order_number: '24673',
  customer_id: 'cus_1',
  customer_name_en: 'Sara',
  customer_phone: '+96599221980',
  customer_email: 'sara@example.com',
  package_name: 'Weekly Lite Plan',
  scheduled_date: '2026-07-01',
  address_id: 'adr_1',
  area_id: 'area_1',
  area_name_en: 'Salmiya',
  area_name_ar: 'السالمية',
  block: '4',
  street: '405',
  house_no: '319',
  building: null,
  address_text: null,
  delivery_notes: 'Ring bell',
  location_pin: null,
  ...overrides,
});

describe('TS-U m24-fleetbase geo gate', () => {
  it('rejects missing / 0,0 / out-of-range coordinates', () => {
    expect(hasRealCoordinate(null)).toBe(false);
    expect(hasRealCoordinate({})).toBe(false);
    expect(hasRealCoordinate({ lat: 0, lng: 0 })).toBe(false); // Fleetbase geocode-miss sentinel
    expect(hasRealCoordinate({ lat: 51.5, lng: -0.12 })).toBe(false); // London — outside Kuwait
  });
  it('accepts a real Kuwait coordinate', () => {
    expect(hasRealCoordinate({ lat: 29.3339, lng: 48.0758 })).toBe(true);
  });
  it('geoState is pending when no real pin, ready when present', () => {
    expect(geoState(baseCtx())).toBe('pending_geocoding');
    expect(geoState(baseCtx({ location_pin: { lat: 29.3339, lng: 48.0758 } }))).toBe('ready');
  });
});

describe('TS-U m24-fleetbase assembly', () => {
  it('composes a Kuwait street1 from structured fields', () => {
    expect(composeStreet1(baseCtx())).toBe('Block 4, Street 405, House 319');
  });
  it('attaches a location ONLY when the pin is real (never sends 0,0)', () => {
    expect(assembleDropoff(baseCtx()).location).toBeUndefined();
    const withPin = assembleDropoff(baseCtx({ location_pin: { lat: 29.3339, lng: 48.0758 } }));
    expect(withPin.location).toEqual({ type: 'Point', coordinates: [48.0758, 29.3339] }); // [lng, lat]
  });
});

describe('TS-U m24-fleetbase order mapping', () => {
  it('builds a transport order with internal_id + dropoff + customer', () => {
    const ctx = baseCtx({ location_pin: { lat: 29.3339, lng: 48.0758 } });
    const body = mapOrder(ctx, { pickup: { name: 'Kitchen', country: 'KW', location: { type: 'Point', coordinates: [47.97, 29.37] } } });
    expect(body.type).toBe('transport');
    expect(body.internal_id).toBe('24673');
    expect(body.dispatch).toBe(false);
    expect(body.payload.dropoff.location).toEqual({ type: 'Point', coordinates: [48.0758, 29.3339] });
    expect(body.payload.entities).toEqual([{ name: 'Weekly Lite Plan' }]);
    expect(body.customer).toBeUndefined(); // set by the service after contact upsert, not the mapper
    expect(body.scheduled_at).toBe('2026-07-01');
  });
  it('maps webhook events to states (canceled has one l; unknown → null)', () => {
    expect(mapEventToState('order.completed')).toBe('completed');
    expect(mapEventToState('order.canceled')).toBe('canceled');
    expect(mapEventToState('order.dispatched')).toBe('dispatched');
    expect(mapEventToState('driver.location_changed')).toBeNull();
  });
});
