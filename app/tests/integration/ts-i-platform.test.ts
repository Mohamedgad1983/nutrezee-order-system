import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { withTransaction } from '../../apps/api/src/platform/db/tx';
import { AuditReadQueue, AuditService, type Severity } from '../../apps/api/src/platform/audit/audit.service';
import { OutboxDispatcher, OutboxService, type DomainEvent } from '../../apps/api/src/platform/outbox/outbox.service';
import { IdempotencyConflictError, IdempotencyService } from '../../apps/api/src/platform/idempotency/idempotency.service';
import { newId } from '../../apps/api/src/platform/ids';

let pool: Pool;
const audit = new AuditService();
const outbox = new OutboxService();
const idem = new IdempotencyService();

beforeAll(async () => {
  pool = await freshDb();
}, 60_000);
afterAll(async () => {
  await pool.end();
});

const flagInsert = (id: string) =>
  `INSERT INTO feature_flag (id, key, on_flag) VALUES ('${id}', 'tsi-${id}', false)`;

describe('TS-I integration — same-transaction audit (audit acceptance #3)', () => {
  it('business write + audit commit together', async () => {
    const id = newId();
    await withTransaction(pool, async (c) => {
      await c.query(flagInsert(id));
      await audit.writeInTx(c, {
        eventType: 'settings.changed', actor: 'system',
        entityType: 'feature_flag', entityId: id, severity: 'info',
      });
    });
    const flag = await pool.query('SELECT 1 FROM feature_flag WHERE id = $1', [id]);
    const evt = await pool.query("SELECT 1 FROM audit_event WHERE entity_id = $1", [id]);
    expect(flag.rowCount).toBe(1);
    expect(evt.rowCount).toBe(1);
  });

  it('a failed audit write aborts the business write (forced failure)', async () => {
    const id = newId();
    await expect(
      withTransaction(pool, async (c) => {
        await c.query(flagInsert(id));
        await audit.writeInTx(c, {
          eventType: 'settings.changed', actor: 'system',
          entityType: 'feature_flag', entityId: id,
          severity: 'bogus' as Severity, // violates the severity CHECK constraint
        });
      }),
    ).rejects.toThrow();
    const flag = await pool.query('SELECT 1 FROM feature_flag WHERE id = $1', [id]);
    expect(flag.rowCount).toBe(0); // rolled back with the audit failure
  });
});

describe('TS-I integration — append-only enforcement (physical_schema §4)', () => {
  it('audit_event rejects UPDATE and DELETE at the database', async () => {
    const id = newId();
    await withTransaction(pool, (c) =>
      audit.writeInTx(c, {
        eventType: 'settings.changed', actor: 'system',
        entityType: 'test', entityId: id, severity: 'info',
      }),
    );
    await expect(pool.query("UPDATE audit_event SET reason = 'x' WHERE entity_id = $1", [id]))
      .rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM audit_event WHERE entity_id = $1', [id]))
      .rejects.toThrow(/append-only/);
  });
});

describe('TS-I integration — transactional outbox', () => {
  it('event commits atomically with the business write; rollback leaves neither', async () => {
    const okId = newId();
    await withTransaction(pool, async (c) => {
      await c.query(flagInsert(okId));
      await outbox.writeInTx(c, {
        eventType: 'settings.changed', actor: { system: 'test' }, refs: { flag: okId }, payload: {},
      });
    });
    const badId = newId();
    await expect(
      withTransaction(pool, async (c) => {
        await c.query(flagInsert(badId));
        await outbox.writeInTx(c, {
          eventType: 'settings.changed', actor: { system: 'test' }, refs: { flag: badId }, payload: {},
        });
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');

    const events = await pool.query(
      "SELECT refs->>'flag' AS flag FROM outbox_event WHERE refs->>'flag' = ANY($1)",
      [[okId, badId]],
    );
    expect(events.rows.map((r) => r.flag)).toEqual([okId]);
  });

  it('dispatcher delivers at-least-once with no redelivery after success; failure leaves event queued', async () => {
    const seen: string[] = [];
    const dispatcher = new OutboxDispatcher(pool);
    dispatcher.register(async (e: DomainEvent) => {
      if (e.payload['boom'] === true) throw new Error('handler failure');
      seen.push(e.eventId);
    });

    const goodRef = newId();
    await withTransaction(pool, (c) =>
      outbox.writeInTx(c, { eventType: 'test.good', actor: { system: 't' }, refs: { r: goodRef }, payload: {} }),
    );
    await dispatcher.sweep();
    const seenAfterFirst = seen.length;
    await dispatcher.sweep(); // already dispatched — must not redeliver
    expect(seen.length).toBe(seenAfterFirst);

    await withTransaction(pool, (c) =>
      outbox.writeInTx(c, { eventType: 'test.bad', actor: { system: 't' }, refs: {}, payload: { boom: true } }),
    );
    await dispatcher.sweep();
    const stuck = await pool.query(
      "SELECT count(*)::int AS n FROM outbox_event WHERE event_type = 'test.bad' AND dispatched_at IS NULL",
    );
    expect(stuck.rows[0].n).toBe(1); // retried next sweep, never silently dropped
  });
});

describe('TS-I integration — idempotency keys', () => {
  it('claim, replay with stored response, conflict on different request', async () => {
    const key = `key-${newId()}`;
    const hash = idem.hashRequest({ a: 1 });

    const first = await withTransaction(pool, async (c) => {
      const r = await idem.claimInTx(c, key, 'test.create', hash);
      await idem.storeResponseInTx(c, key, 'resource-123');
      return r;
    });
    expect(first.replay).toBe(false);

    const second = await withTransaction(pool, (c) => idem.claimInTx(c, key, 'test.create', hash));
    expect(second).toEqual({ replay: true, responseRef: 'resource-123' });

    await expect(
      withTransaction(pool, (c) => idem.claimInTx(c, key, 'test.create', idem.hashRequest({ a: 2 }))),
    ).rejects.toThrow(IdempotencyConflictError);
  });

  it('a rolled-back claim releases the key', async () => {
    const key = `key-${newId()}`;
    const hash = idem.hashRequest({});
    await expect(
      withTransaction(pool, async (c) => {
        await idem.claimInTx(c, key, 'test.create', hash);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    const again = await withTransaction(pool, (c) => idem.claimInTx(c, key, 'test.create', hash));
    expect(again.replay).toBe(false);
  });
});

describe('TS-I integration — audit read queue (async-tolerant sensitive reads)', () => {
  it('enqueued read-audit drains into audit_event', async () => {
    const queue = new AuditReadQueue(pool, audit);
    const id = newId();
    await queue.enqueue({
      eventType: 'customer.pii_viewed', actor: 'system',
      entityType: 'customer', entityId: id, severity: 'info',
    });
    const drained = await queue.drain();
    expect(drained).toBeGreaterThanOrEqual(1);
    const evt = await pool.query(
      "SELECT 1 FROM audit_event WHERE event_type = 'customer.pii_viewed' AND entity_id = $1",
      [id],
    );
    expect(evt.rowCount).toBe(1);
  });
});
