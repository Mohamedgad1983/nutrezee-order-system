// WP-LBL-A97 — the kitchen's WhatsApp stickers kept in the system: create, edit, stop, restore (TS-I).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { AuditService } from '../../apps/api/src/platform/audit/audit.service';
import type { StaffContext } from '../../apps/api/src/platform/auth/session.service';
import {
  KitchenStickerService, areasWithDriver, cleanSticker, stickerMobile,
} from '../../apps/api/src/modules/m25-label/kitchen-sticker.service';
import { freshDb } from '../helpers/db';

let pool: Pool;
let stickers: KitchenStickerService;
const actor = { staffId: 'fleetbase:manager-1', roles: ['fleetbase_operator'], permissions: [] } as unknown as StaffContext;
const omar = {
  mobile: '+965 6681-8181', name: 'Omar', box: '9027', area: 'Salam', block: '6', street: '25', house: '60',
  meals_per_day: '2', snacks_per_day: 1, breakfast: 0, protein_g: 150, carb_g: 300,
  notes: 'DRY FOOD\n2 Meals Chicken + Rice', start_date: '2099-10-19', end_date: '',
};

describe('TS-I kitchen stickers (A97)', () => {
  beforeAll(async () => {
    pool = await freshDb();
    stickers = new KitchenStickerService(pool, new AuditService(pool));
  });
  afterAll(async () => { await pool.end(); });

  it('cleans what the manager types', () => {
    expect(stickerMobile('0096566818181')).toBe('66818181');
    expect(() => stickerMobile('6681818')).toThrow();
    expect(cleanSticker(omar)).toMatchObject({ mobile: '66818181', meals_per_day: 2, notes: 'DRY FOOD 2 Meals Chicken + Rice', end_date: null });
    expect(() => cleanSticker({ ...omar, name: ' ' })).toThrow();
    expect(() => cleanSticker({ ...omar, end_date: '2099-10-01' })).toThrow();
    expect(() => cleanSticker({ ...omar, meals_per_day: 'x' })).toThrow();
  });

  it('creates, edits, stops and restores with an audit row each, one live sticker per phone', async () => {
    const created = await stickers.create(actor, omar);
    expect(created).toMatchObject({ mobile: '66818181', name: 'Omar', active: true, start_date: '2099-10-19' });
    await expect(stickers.create(actor, { ...omar, name: 'Other' })).rejects.toMatchObject({ code: 'conflict' });

    const edited = await stickers.update(actor, created.id, { ...omar, notes: 'Green salad only', end_date: '2099-11-01' });
    expect(edited).toMatchObject({ notes: 'Green salad only', end_date: '2099-11-01' });

    const stopped = await stickers.setActive(actor, created.id, false);
    expect(stopped.active).toBe(false);
    const again = await stickers.create(actor, { ...omar, name: 'Omar new' });
    await expect(stickers.setActive(actor, created.id, true)).rejects.toMatchObject({ code: 'conflict' });
    await stickers.setActive(actor, again.id, false);
    expect((await stickers.setActive(actor, created.id, true)).active).toBe(true);

    expect((await stickers.list()).map((s) => [s.name, s.active])).toEqual([['Omar', true], ['Omar new', false]]);
    const audit = await pool.query(
      `SELECT event_type, related_refs->>'changed_fields' AS changed FROM audit_event WHERE entity_type = 'kitchen_sticker' ORDER BY occurred_at, id`,
    );
    expect(audit.rows.map((r) => r.event_type)).toEqual([
      'label.kitchen_sticker_created', 'label.kitchen_sticker_updated', 'label.kitchen_sticker_stopped',
      'label.kitchen_sticker_created', 'label.kitchen_sticker_stopped', 'label.kitchen_sticker_restored',
    ]);
    expect(audit.rows[1].changed).toBe('notes,end_date');
  });

  it('lists the legacy areas of the day with their driver', () => {
    expect(areasWithDriver([
      { source: 'partner', areaLabel: 'Salam', driverName: 'Arsad', driverLabel: 'x' },
      { source: 'partner', areaLabel: 'Salam', driverName: 'Other', driverLabel: 'y' },
      { source: 'whatsapp', areaLabel: 'Adan', driverName: 'Bilal', driverLabel: 'z' },
      { source: 'partner', areaLabel: 'Bayan', driverName: null, driverLabel: null },
    ])).toEqual([{ label: 'Bayan', driver: null }, { label: 'Salam', driver: 'Arsad' }]);
  });
});
