import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { withTransaction } from '../../apps/api/src/platform/db/tx';
import { AuditService, type Severity } from '../../apps/api/src/platform/audit/audit.service';
import { newId } from '../../apps/api/src/platform/ids';

// The five audit acceptance tests (audit_architecture §MVP tests) land incrementally:
// #2 immutability and #3 same-transaction here (WP-01 DoD); #1 full-order
// reconstruction, #4 masked rendering at query UI, #5 HIGH-review query arrive with
// the modules that produce those flows (WP-09+ / staging per test_strategy gates).
let pool: Pool;
const audit = new AuditService();

beforeAll(async () => {
  pool = await freshDb();
}, 60_000);
afterAll(async () => {
  await pool.end();
});

describe('TS-A audit — acceptance #2: immutability', () => {
  it('no UPDATE path: trigger rejects mutation even for the table owner', async () => {
    const id = newId();
    await withTransaction(pool, (c) =>
      audit.writeInTx(c, {
        eventType: 'order.approved', actor: { id: 'staff-x', role: 'ops_manager' },
        entityType: 'order', entityId: id, severity: 'high', reason: 'test',
      }),
    );
    await expect(pool.query("UPDATE audit_event SET severity = 'info' WHERE entity_id = $1", [id]))
      .rejects.toThrow(/append-only/);
    await expect(pool.query('DELETE FROM audit_event WHERE entity_id = $1', [id]))
      .rejects.toThrow(/append-only/);
    // and the service surface itself exposes no update/delete methods
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(audit));
    expect(surface).not.toContain('update');
    expect(surface).not.toContain('delete');
  });
});

describe('TS-A audit — acceptance #3: same-transaction write', () => {
  it('forced audit-write failure blocks the business write', async () => {
    const id = newId();
    await expect(
      withTransaction(pool, async (c) => {
        await c.query(`INSERT INTO area (id, code, name_en, name_ar) VALUES ($1, $2, 'A', 'أ')`, [id, `tsa-${id}`]);
        await audit.writeInTx(c, {
          eventType: 'settings.changed', actor: 'system',
          entityType: 'area', entityId: id,
          severity: 'invalid' as Severity,
        });
      }),
    ).rejects.toThrow();
    const area = await pool.query('SELECT 1 FROM area WHERE id = $1', [id]);
    expect(area.rowCount).toBe(0);
  });

  it('HIGH events carry the mandatory reason for overrides (schema-level spot check)', async () => {
    const id = newId();
    await withTransaction(pool, (c) =>
      audit.writeInTx(c, {
        eventType: 'rbac.role_assigned', actor: { id: 'staff-y', role: 'super_admin' },
        entityType: 'role_assignment', entityId: id, severity: 'high', reason: 'grant: test',
      }),
    );
    const { rows } = await pool.query(
      "SELECT severity, reason FROM audit_event WHERE entity_id = $1", [id],
    );
    expect(rows[0]).toEqual({ severity: 'high', reason: 'grant: test' });
  });
});
