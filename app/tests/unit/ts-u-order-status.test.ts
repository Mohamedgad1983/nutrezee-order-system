// WP-OPS-A72 — order status by customer phone: pure rules (TS-U).
import { describe, expect, it } from 'vitest';
import {
  deliveryState, haversineKm, liveEstimate, parsePin, phoneDigits, validPin,
} from '../../apps/api/src/modules/m25-label/order-status';

describe('TS-U order status by phone (A72)', () => {
  it('reads a phone however the operator types it', () => {
    expect(phoneDigits('5512 3456')).toBe('55123456');
    expect(phoneDigits('+965 55123456')).toBe('55123456');
    expect(phoneDigits('0096555123456')).toBe('55123456');
    expect(phoneDigits('٥٥١٢٣٤٥٦')).toBe('55123456');
    expect(phoneDigits('+966 55 123 4567')).toBe('966551234567');
    expect(phoneDigits('12345')).toBeNull();
    expect(phoneDigits('')).toBeNull();
  });

  it('accepts only real pins', () => {
    expect(parsePin('29.31, 48.02')).toEqual({ lat: 29.31, lng: 48.02 });
    expect(parsePin('0,0')).toBeNull();
    expect(parsePin('abc')).toBeNull();
    expect(parsePin(null)).toBeNull();
    expect(validPin(95, 10)).toBeNull();
    expect(validPin('29', 48)).toBeNull();
  });

  it('maps Fleetbase statuses to what the operator tells the customer', () => {
    expect(deliveryState('completed')).toBe('delivered');
    expect(deliveryState('started')).toBe('on_the_way');
    expect(deliveryState('dispatched')).toBe('with_driver');
    expect(deliveryState('created')).toBe('not_dispatched');
    expect(deliveryState(null)).toBe('not_dispatched');
  });

  const now = new Date('2026-10-06T09:00:00Z');
  const driver = { lat: 29.30, lng: 48.00, updatedAt: '2026-10-06T08:55:00Z', online: true };
  const target = { pin: { lat: 29.34, lng: 48.00 }, exactPin: true, state: 'with_driver' as const };

  it('estimates distance, time and the orders before it from a fresh driver position', () => {
    const result = liveEstimate({
      now, position: driver, target,
      others: [{ lat: 29.31, lng: 48.00 }, { lat: 29.32, lng: 48.00 }, { lat: 29.40, lng: 48.00 }, null],
    });
    if (!('live' in result)) throw new Error('expected an estimate');
    expect(result.live.orders_ahead).toBe(2);
    expect(result.live.orders_unranked).toBe(1);
    expect(result.live.position_age_minutes).toBe(5);
    const direct = haversineKm(driver, target.pin);
    expect(direct).toBeGreaterThan(4.3);
    expect(direct).toBeLessThan(4.6);
    expect(result.live.distance_km).toBeCloseTo(direct * 1.35, 1);
    expect(result.live.eta_minutes).toBe(Math.round((direct * 1.35 / 28) * 60 + 8));
  });

  it('never guesses: says why there is no estimate', () => {
    expect(liveEstimate({ now, position: null, target, others: [] })).toEqual({ unavailable: 'driver_position_missing' });
    expect(liveEstimate({ now, position: { ...driver, updatedAt: '2026-10-06T08:30:00Z' }, target, others: [] }))
      .toEqual({ unavailable: 'driver_position_stale' });
    expect(liveEstimate({ now, position: { ...driver, updatedAt: null }, target, others: [] }))
      .toEqual({ unavailable: 'driver_position_stale' });
    expect(liveEstimate({ now, position: driver, target: { ...target, pin: null }, others: [] }))
      .toEqual({ unavailable: 'customer_pin_missing' });
    expect(liveEstimate({ now, position: driver, target: { ...target, state: 'delivered' }, others: [] }))
      .toEqual({ unavailable: 'already_delivered' });
  });
});
