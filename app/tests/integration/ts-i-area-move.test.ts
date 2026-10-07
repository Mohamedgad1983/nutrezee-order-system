// WP-OPS-A77 — one-day area move between drivers: decision ledger rules (TS-I).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { AuditService } from '../../apps/api/src/platform/audit/audit.service';
import type { StaffContext } from '../../apps/api/src/platform/auth/session.service';
import {
  AreaMoveError, AreaMoveService, areaMoveKey, driverLoads, type AreaMoveDriver,
} from '../../apps/api/src/modules/m25-label/area-move.service';
import type { BatchLabelCandidate } from '../../apps/api/src/modules/m25-label/label.service';
import { freshDb } from '../helpers/db';

let pool: Pool;
let moves: AreaMoveService;
const actor = { staffId: 'fleetbase:operator-1', roles: ['fleetbase_operator'], permissions: [] } as unknown as StaffContext;
const TODAY = '2099-05-10';
const TOMORROW = '2099-05-11';

const directory: AreaMoveDriver[] = [
  { id: 'driver_a', name: 'Arsad', phone: '+96550000001', vehicle_number: '11-111' },
  { id: 'driver_b', name: 'Bilal', phone: '+96550000002', vehicle_number: '22-222' },
  { id: 'driver_c', name: 'No Plate', phone: '+96550000003', vehicle_number: null },
];
const order = (n: number, area: string, driver: string | null): BatchLabelCandidate => ({
  selectionId: `s${n}`, localOrderId: `o${n}`, orderNumber: String(n), areaKey: area, areaLabel: area,
  driverId: driver, driverLabel: null, driverRef: driver, driverPhone: null, vehicleNumber: null, driverColor: null,
});
const candidates = [
  order(1, 'Salmiya', 'driver_a'), order(2, 'Salmiya', 'driver_a'), order(3, 'salmiya ', 'driver_a'),
  order(4, 'Hateen', 'driver_a'), order(5, 'Jabriya', 'driver_b'),
];
const day = { candidates, directory };

describe('TS-I area move between drivers (A77)', () => {
  beforeAll(async () => {
    pool = await freshDb();
    moves = new AreaMoveService(pool, new AuditService(pool));
  });
  afterAll(async () => { await pool.end(); });

  it('shows the load per driver and area, including a driver with no orders', () => {
    expect(areaMoveKey('  Sabah   Al Salem ')).toBe('sabah al salem');
    const loads = driverLoads(candidates, directory);
    expect(loads.map((l) => [l.id, l.orders])).toEqual([['driver_a', 4], ['driver_b', 1], ['driver_c', 0]]);
    expect(loads[0]!.areas).toEqual([
      { area_key: 'salmiya', area_label: 'Salmiya', orders: 3 }, { area_key: 'hateen', area_label: 'Hateen', orders: 1 },
    ]);
  });

  it('records a move with an audit row, and a second move of the same area replaces the first', async () => {
    const first = await moves.create(actor, { deliveryDate: TOMORROW, today: TODAY, areaKey: 'SALMIYA', toDriverId: 'driver_b' }, day);
    expect(first).toMatchObject({
      delivery_date: TOMORROW, area_key: 'salmiya', area_label: 'Salmiya', from_driver_id: 'driver_a',
      from_driver_name: 'Arsad', to_driver_id: 'driver_b', to_driver_name: 'Bilal', orders_at_request: 3,
    });
    const audit = await pool.query(`SELECT event_type, severity FROM audit_event WHERE entity_id = $1`, [first.id]);
    expect(audit.rows).toEqual([{ event_type: 'delivery.area_moved', severity: 'high' }]);

    const second = await moves.create(actor, { deliveryDate: TOMORROW, today: TODAY, areaKey: 'Salmiya', toDriverId: 'driver_a' }, {
      directory, candidates: candidates.map((c) => (areaMoveKey(c.areaLabel) === 'salmiya' ? { ...c, driverId: 'driver_b' } : c)),
    });
    const active = await moves.active(TOMORROW);
    expect(active.map((m) => m.id)).toEqual([second.id]);
    const all = await pool.query(`SELECT count(*)::int AS n FROM delivery_area_move WHERE delivery_date = $1`, [TOMORROW]);
    expect(all.rows[0].n).toBe(2); // history kept
    expect(await moves.active(TODAY)).toEqual([]); // another day is untouched
  });

  it('refuses what would break the day', async () => {
    const attempt = (over: Partial<{ deliveryDate: string; areaKey: string; toDriverId: string }>) => moves.create(
      actor, { deliveryDate: TOMORROW, today: TODAY, areaKey: 'Hateen', toDriverId: 'driver_b', ...over }, day,
    ).then(() => 'created', (e: unknown) => (e instanceof AreaMoveError ? `${e.code}:${(e.detail as { reason?: string }).reason}` : 'other'));
    expect(await attempt({ deliveryDate: '2099-05-09' })).toBe('validation_failed:past_day');
    expect(await attempt({ areaKey: 'Nowhere' })).toBe('validation_failed:area_not_in_day');
    expect(await attempt({ toDriverId: 'driver_zzz' })).toBe('validation_failed:driver_not_found');
    expect(await attempt({ toDriverId: 'driver_c' })).toBe('validation_failed:driver_without_phone_or_vehicle');
    expect(await attempt({ toDriverId: 'driver_a' })).toBe('conflict:area_already_with_driver');
  });

  it('cancels once, with an audit row, and never for a past day', async () => {
    const move = await moves.create(actor, { deliveryDate: TOMORROW, today: TODAY, areaKey: 'Hateen', toDriverId: 'driver_b' }, day);
    await moves.cancel(actor, move.id, TODAY);
    expect((await moves.active(TOMORROW)).some((m) => m.id === move.id)).toBe(false);
    await expect(moves.cancel(actor, move.id, TODAY)).rejects.toMatchObject({ code: 'conflict' });
    await expect(moves.cancel(actor, 'missing', TODAY)).rejects.toMatchObject({ code: 'not_found' });
    const audit = await pool.query(`SELECT event_type FROM audit_event WHERE entity_id = $1 ORDER BY occurred_at`, [move.id]);
    expect(audit.rows.map((r) => r.event_type)).toEqual(['delivery.area_moved', 'delivery.area_move_cancelled']);
    const other = await moves.create(actor, { deliveryDate: TOMORROW, today: TODAY, areaKey: 'Jabriya', toDriverId: 'driver_a' }, day);
    await expect(moves.cancel(actor, other.id, '2099-05-12')).rejects.toMatchObject({ code: 'conflict' });
  });
});
