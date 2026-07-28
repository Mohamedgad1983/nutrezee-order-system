import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { newId } from '../../apps/api/src/platform/ids';
import { AuditService } from '../../apps/api/src/platform/audit/audit.service';
import { OutboxService } from '../../apps/api/src/platform/outbox/outbox.service';
import { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import { MergeService } from '../../apps/api/src/modules/m04-customers/merge.service';
import { BarcodeService } from '../../apps/api/src/modules/m25-label/barcode.service';
import { LabelService } from '../../apps/api/src/modules/m25-label/label.service';
import { isValidBarcodeValue } from '../../apps/api/src/modules/m25-label/code128';
import type { StaffContext } from '../../apps/api/src/platform/auth/session.service';

// TS-I — permanent customer barcode + exact legacy label (WP-LBL-01/02, amendment A27).
// Covers the A27 completion gates: same customer keeps one barcode across dates, different
// customers never collide, no PII in the value, reprints preserve the barcode, merge keeps the
// old barcode working as an alias (and undo restores it), and nutrition is never fabricated.

let pool: Pool;
let barcodes: BarcodeService;
let labels: LabelService;
let merges: MergeService;

const actor: StaffContext = {
  staffId: 'ops-1', name: 'Ops One', email: 'o@t', locale: 'en',
  roles: ['ops_manager'], sessionId: 's',
};

const DATE_A = '2099-04-10';
const DATE_B = '2099-04-11';

interface Seeded { customerId: string; orderId: string; orderNo: string }

beforeAll(async () => {
  pool = await freshDb();
  const audit = new AuditService();
  barcodes = new BarcodeService(pool, audit);
  labels = new LabelService(pool, audit, barcodes);
  merges = new MergeService(pool, audit, new OutboxService(), new SettingsReader(pool));
  merges.registerRelinkStep(BarcodeService.customerRelinkStep());
}, 60_000);

afterAll(async () => { await pool.end(); });

async function seed(name: string, orderNo: string, opts?: { phone?: string }): Promise<Seeded> {
  const customerId = newId();
  const orderId = newId();
  await pool.query(
    `INSERT INTO customer (id, full_name_en, notes, created_by) VALUES ($1,$2,$3,'test')`,
    [customerId, name, '90p - 110c'],
  );
  if (opts?.phone) {
    await pool.query(
      `INSERT INTO customer_phone (id, customer_id, phone_normalized, is_primary, created_by)
       VALUES ($1,$2,$3,true,'test')`,
      [newId(), customerId, opts.phone],
    );
  }
  await pool.query(
    `INSERT INTO address (id, customer_id, address_text, block, street, building, house_no,
                          delivery_notes, created_by)
     VALUES ($1,$2,'Abu Ftaira','5','20','61','3','Beside the mosque','test')`,
    [newId(), customerId],
  );
  await pool.query(
    `INSERT INTO customer_order
       (id, order_number, customer_id, status, start_date, end_date, channel, total, created_by,
        package_name_frozen_en, delivery_method_frozen, delivery_time_frozen, delivery_area_frozen)
     VALUES ($1,$2,$3,'active','2099-04-01','2099-04-30','phone',0,'test',
             '630 - 1730 calories (almost)','Call upon arrival','From 5 AM to 4 PM','Abu Ftaira')`,
    [orderId, orderNo, customerId],
  );
  for (const d of [DATE_A, DATE_B]) {
    await pool.query(
      `INSERT INTO fulfillment_day (id, order_id, date, status, address_frozen, created_by)
       VALUES ($1,$2,$3,'scheduled','{}','test')`,
      [newId(), orderId, d],
    );
  }
  return { customerId, orderId, orderNo };
}

describe('TS-I barcode — one permanent, PII-free barcode per customer', () => {
  it('issues a valid barcode and is idempotent across repeated calls', async () => {
    const s = await seed('Mariam Khaled', 'N-LBL-1', { phone: '51712730' });
    const first = await barcodes.issueFor(actor, s.customerId);
    const second = await barcodes.issueFor(actor, s.customerId);
    const third = await barcodes.getForCustomer(s.customerId);

    expect(isValidBarcodeValue(first.barcode_value)).toBe(true);
    expect(second.barcode_value).toBe(first.barcode_value);
    expect(third?.barcode_value).toBe(first.barcode_value);
    expect(second.id).toBe(first.id);

    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM customer_barcode WHERE customer_id=$1`, [s.customerId],
    );
    expect(rows[0].n).toBe(1);
  });

  it('concurrent first issuance still yields exactly one barcode', async () => {
    const s = await seed('Race Customer', 'N-LBL-RACE');
    const results = await Promise.all(
      Array.from({ length: 5 }, () => barcodes.issueFor(actor, s.customerId)),
    );
    const values = new Set(results.map((r) => r.barcode_value));
    expect(values.size).toBe(1);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM customer_barcode WHERE customer_id=$1 AND status='active'`,
      [s.customerId],
    );
    expect(rows[0].n).toBe(1);
  });

  it('different customers always get different barcodes', async () => {
    const a = await seed('Cust A', 'N-LBL-A');
    const b = await seed('Cust B', 'N-LBL-B');
    const [ba, bb] = [await barcodes.issueFor(actor, a.customerId), await barcodes.issueFor(actor, b.customerId)];
    expect(ba.barcode_value).not.toBe(bb.barcode_value);
  });

  it('encodes no PII — the value shares nothing with customer id, name or phone', async () => {
    const s = await seed('Distinctive Personname', 'N-LBL-PII', { phone: '51712730' });
    const bc = await barcodes.issueFor(actor, s.customerId);
    const payload = bc.barcode_value.replace(/^NZC-/, '').replace(/-/g, '');
    expect(bc.barcode_value).not.toContain(s.customerId);
    expect(bc.barcode_value).not.toContain('51712730');
    for (const part of ['DISTINCTIVE', 'PERSONNAME']) {
      expect(payload).not.toContain(part);
    }
    // and it is not a deterministic function of the customer id: a second customer whose row is
    // created identically gets an unrelated value
    const other = await seed('Distinctive Personname', 'N-LBL-PII2', { phone: '51712730' });
    const bc2 = await barcodes.issueFor(actor, other.customerId);
    expect(bc2.barcode_value).not.toBe(bc.barcode_value);
  });

  it('resolves a scanned value, tolerating scanner formatting', async () => {
    const s = await seed('Scan Me', 'N-LBL-SCAN');
    const bc = await barcodes.issueFor(actor, s.customerId);
    const bare = bc.barcode_value.replace(/-/g, '').toLowerCase();
    const resolved = await barcodes.resolve(bare);
    expect(resolved?.customer_id).toBe(s.customerId);
    expect(await barcodes.resolve('NZC-XXXX-XXXX-XX')).toBeNull();
    expect(await barcodes.resolve('')).toBeNull();
  });

  it('replacement is audited, disables the old value and issues a new one', async () => {
    const s = await seed('Replace Me', 'N-LBL-REP');
    const before = await barcodes.issueFor(actor, s.customerId);
    const after = await barcodes.replace(actor, s.customerId, 'label destroyed in the kitchen');

    expect(after.barcode_value).not.toBe(before.barcode_value);
    expect(await barcodes.resolve(before.barcode_value)).toBeNull();      // old one stops working
    expect((await barcodes.resolve(after.barcode_value))?.customer_id).toBe(s.customerId);

    const { rows } = await pool.query(
      `SELECT status, replacement_reason FROM customer_barcode WHERE id=$1`, [before.id],
    );
    expect(rows[0].status).toBe('disabled');
    expect(rows[0].replacement_reason).toBe('label destroyed in the kitchen');

    const audit = await pool.query(
      `SELECT count(*)::int AS n FROM audit_event WHERE event_type='barcode.replaced'`,
    );
    expect(audit.rows[0].n).toBeGreaterThan(0);
  });

  it('replacement without a reason is rejected', async () => {
    const s = await seed('No Reason', 'N-LBL-NOREASON');
    await barcodes.issueFor(actor, s.customerId);
    await expect(barcodes.replace(actor, s.customerId, '   ')).rejects.toMatchObject({ code: 'validation_failed' });
  });
});

describe('TS-I barcode — customer merge preserves the old label', () => {
  it("keeps the loser's barcode working as an alias for the surviving customer", async () => {
    const winner = await seed('Winner Cust', 'N-LBL-W');
    const loser = await seed('Loser Cust', 'N-LBL-L');
    const winnerBc = await barcodes.issueFor(actor, winner.customerId);
    const loserBc = await barcodes.issueFor(actor, loser.customerId);

    const mergeId = await merges.merge(actor, winner.customerId, loser.customerId);

    // a label printed BEFORE the merge still scans, and now resolves to the survivor
    const resolvedOld = await barcodes.resolve(loserBc.barcode_value);
    expect(resolvedOld?.customer_id).toBe(winner.customerId);
    expect(resolvedOld?.status).toBe('alias');

    // the winner keeps exactly one ACTIVE barcode, unchanged
    const active = await barcodes.getForCustomer(winner.customerId);
    expect(active?.barcode_value).toBe(winnerBc.barcode_value);

    // undo restores ownership to the loser, with its original active status
    await merges.undo(actor, mergeId);
    const restored = await barcodes.resolve(loserBc.barcode_value);
    expect(restored?.customer_id).toBe(loser.customerId);
    expect(restored?.status).toBe('active');
    expect((await barcodes.getForCustomer(winner.customerId))?.barcode_value).toBe(winnerBc.barcode_value);
  });
});

describe('TS-I label — exact legacy content, honest nutrition', () => {
  it('resolves Fleetbase bridge metadata by authoritative id, otherwise exact order number', async () => {
    const direct = await seed('Direct Fleetbase Ref', 'N-LBL-FB-DIRECT');
    const numbered = await seed('Number Fleetbase Ref', 'N-LBL-FB-NUMBER');

    await expect(labels.resolveFleetbaseOrder({
      id: 'order_direct',
      meta: { nutrezee_order_id: direct.orderId, source_order_number: numbered.orderNo },
    })).resolves.toBe(direct.orderId);

    await expect(labels.resolveFleetbaseOrder({
      id: 'order_number',
      meta: { source_order_number: numbered.orderNo },
    })).resolves.toBe(numbered.orderId);

    await expect(labels.resolveFleetbaseOrder({
      id: 'order_stale',
      meta: { nutrezee_order_id: 'stale-local-id', source_order_number: numbered.orderNo },
    })).rejects.toMatchObject({
      code: 'not_found',
      detail: { reason: 'fleetbase_order_not_in_nutrezee' },
    });
  });

  it('builds every legacy field from an authoritative source', async () => {
    const s = await seed('mariam khlaed almajed', 'N-LBL-DOC', { phone: '51712730' });
    const doc = await labels.build(actor, s.orderId, DATE_A);

    expect(doc.full_name).toBe('mariam khlaed almajed');
    expect(doc.subscription_date_display).toBe('Friday 10th April 2099');
    expect(doc.delivery_time).toBe('From 5 AM to 4 PM');
    expect(doc.delivery_method).toBe('Call upon arrival');
    expect(doc.package_name).toBe('630 - 1730 calories (almost)');
    expect(doc.order_number).toBe('N-LBL-DOC');       // the legacy "User ID" on the right
    expect(doc.phone).toBe('51712730');
    expect(doc.notes).toBe('90p - 110c');
    expect(doc.address).toMatchObject({ block: '5', street: '20', building: '61', flat: '3' });
    expect(doc.address.direction).toBe('Beside the mosque');
    // days_remaining comes from the analytics view: MAX(fulfillment_day.date) - today
    expect(typeof doc.days_remaining === 'number' || doc.days_remaining === null).toBe(true);
    expect(isValidBarcodeValue(doc.barcode_value)).toBe(true);
    expect(doc.barcode_svg.startsWith('<svg')).toBe(true);
  });

  it('renders an explicit empty state instead of inventing dishes or nutrition', async () => {
    const s = await seed('No Dish Data', 'N-LBL-NODISH');
    const doc = await labels.build(actor, s.orderId, DATE_A);
    expect(doc.meal_source).toBe('no_dish_source');
    expect(doc.meals).toHaveLength(0);
    expect(doc.totals).toEqual({ protein: null, carbs: null, fat: null, calories: null, complete: false });
  });

  it('sums Total Nutrition exactly as the legacy label does', async () => {
    const s = await seed('Has Dish Data', 'N-LBL-DISH');
    const dayId = newId();
    await pool.query(
      `INSERT INTO customer_dish_day (id, customer_id, customer_order_id, legacy_internal_id, meal_date, created_at)
       VALUES ($1,$2,$3,'legacy-1',$4, now())`,
      [dayId, s.customerId, s.orderId, DATE_A],
    );
    // the five rows from the reference legacy label
    const reference: Array<[string, number, number, number, number, number]> = [
      ['Eye egg muffin sandwich', 1, 16, 24, 12, 268],
      ['Chicken Maqluba (WL)', 1, 21, 34, 11, 319],
      ['Italian pasta with vegetable', 1, 9, 24, 6, 186],
      ['Quinoa And Vegetables Salad', 1, 2, 12, 6, 110],
      ['Fruit Salad', 1, 1, 11, 0, 48],
    ];
    for (const [name, qty, protein, carbs, fat, calories] of reference) {
      await pool.query(
        `INSERT INTO customer_dish_day_item
           (id, customer_dish_day_id, dish_name, quantity, protein, carbs, fat, calories, legacy_dish_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [newId(), dayId, name, qty, protein, carbs, fat, calories, name],
      );
    }

    const doc = await labels.build(actor, s.orderId, DATE_A);
    expect(doc.meal_source).toBe('dish_day');
    expect(doc.meals).toHaveLength(5);
    expect(doc.meals[0]!.dish_name).toBe('Eye egg muffin sandwich');
    // exactly the totals printed on the reference legacy label
    expect(doc.totals).toEqual({ protein: 49, carbs: 105, fat: 35, calories: 931, complete: true });
  });

  it('flags an incomplete total when a stored row is missing a value', async () => {
    const s = await seed('Partial Dish Data', 'N-LBL-PARTIAL');
    const dayId = newId();
    await pool.query(
      `INSERT INTO customer_dish_day (id, customer_id, customer_order_id, legacy_internal_id, meal_date)
       VALUES ($1,$2,$3,'legacy-2',$4)`,
      [dayId, s.customerId, s.orderId, DATE_A],
    );
    await pool.query(
      `INSERT INTO customer_dish_day_item (id, customer_dish_day_id, dish_name, quantity, protein, calories)
       VALUES ($1,$2,'Mystery dish',1,10,200)`,
      [newId(), dayId],
    );
    const doc = await labels.build(actor, s.orderId, DATE_A);
    expect(doc.totals.protein).toBe(10);
    expect(doc.totals.carbs).toBeNull();
    expect(doc.totals.complete).toBe(false);
  });
});

describe('TS-I label printing — audited, reprint needs a reason, barcode never changes', () => {
  it('keeps the same barcode across delivery dates and reprints', async () => {
    const s = await seed('Stable Barcode', 'N-LBL-STABLE');
    const dayA = await labels.build(actor, s.orderId, DATE_A);
    const dayB = await labels.build(actor, s.orderId, DATE_B);
    expect(dayB.barcode_value).toBe(dayA.barcode_value);

    const printed = await labels.recordPrint(actor, s.orderId, DATE_A, { kind: 'print' });
    const reprinted = await labels.recordPrint(actor, s.orderId, DATE_A, {
      kind: 'reprint', reason: 'printer jammed',
    });
    expect(printed.barcode_value).toBe(dayA.barcode_value);
    expect(reprinted.barcode_value).toBe(dayA.barcode_value);

    const after = await labels.build(actor, s.orderId, DATE_A);
    expect(after.barcode_value).toBe(dayA.barcode_value);
  });

  it('rejects a reprint with no reason', async () => {
    const s = await seed('Needs Reason', 'N-LBL-REASON');
    await expect(labels.recordPrint(actor, s.orderId, DATE_A, { kind: 'reprint', reason: '  ' }))
      .rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('records print history and audits both kinds', async () => {
    const s = await seed('History Cust', 'N-LBL-HIST');
    await labels.recordPrint(actor, s.orderId, DATE_A, { kind: 'print' });
    await labels.recordPrint(actor, s.orderId, DATE_A, { kind: 'reprint', reason: 'smudged' });

    const history = await labels.printHistory(s.orderId, DATE_A);
    expect(history).toHaveLength(2);
    expect(history[0]!.print_kind).toBe('reprint');
    expect(history[0]!.reason).toBe('smudged');

    const audit = await pool.query(
      `SELECT event_type FROM audit_event
        WHERE event_type IN ('label.printed','label.reprinted')
          AND related_refs->>'order_id' = $1`,
      [s.orderId],
    );
    expect(audit.rows.map((r) => r.event_type as string).sort()).toEqual(['label.printed', 'label.reprinted']);
  });

  it('print_event rows are append-only at the database level', async () => {
    const s = await seed('Append Only', 'N-LBL-APPEND');
    const printed = await labels.recordPrint(actor, s.orderId, DATE_A, { kind: 'print' });
    await expect(pool.query(`UPDATE label_print_event SET reason='tamper' WHERE id=$1`, [printed.id]))
      .rejects.toThrow(/append-only/i);
    await expect(pool.query(`DELETE FROM label_print_event WHERE id=$1`, [printed.id]))
      .rejects.toThrow(/append-only/i);
  });

  it('batch build returns one label per scheduled order on the date', async () => {
    const docs = await labels.buildBatch(actor, DATE_B);
    expect(docs.length).toBeGreaterThan(1);
    expect(docs.every((d) => d.delivery_date === DATE_B)).toBe(true);
    expect(new Set(docs.map((d) => d.barcode_value)).size).toBe(docs.length); // no shared barcodes
  });
});
