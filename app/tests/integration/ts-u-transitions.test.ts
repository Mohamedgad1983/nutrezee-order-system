import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { AuditService } from '../../apps/api/src/platform/audit/audit.service';
import { OutboxService } from '../../apps/api/src/platform/outbox/outbox.service';
import {
  TransitionEngine, TransitionError, type Machine, type TransitionRequest,
} from '../../apps/api/src/platform/transition/transition-engine';
import type { StaffContext } from '../../apps/api/src/platform/auth/session.service';
import { newId } from '../../apps/api/src/platform/ids';

// TS-U transition suite — GENERATED from transition_config (test_strategy: "generated
// from the transition_config seed, not hand-written"): every active row produces
// allow / wrong-role / reason cases; absent pairs and inactive rows must reject.
// Workshop edits to the config change the generated cases automatically.

let pool: Pool;
let engine: TransitionEngine;
const MACHINES: Machine[] = ['order', 'fulfillment', 'payment', 'ticket', 'draft'];
const validatorCalls: string[] = [];

const actorWith = (role: string): StaffContext => ({
  staffId: `actor-${role}`, name: role, email: `${role}@t`, locale: 'en', roles: [role], sessionId: 's',
});

function reqFor(machine: Machine, from: string, to: string, role: string, withReason: boolean): TransitionRequest {
  return {
    machine, subjectType: 'test_subject', subjectId: newId(), from, to,
    actor: role === 'system' ? 'system' : actorWith(role),
    reason: withReason ? { code: 'other', note: 'generated test' } : undefined,
    eventType: `${machine}.status_changed`,
    apply: async () => undefined, // owning-module write is out of engine scope (ADR-010)
  };
}

beforeAll(async () => {
  pool = await freshDb();
  engine = new TransitionEngine(pool, new AuditService(), new OutboxService(), 0);
  // Register every validator named in the seeded config as a recording stub —
  // real implementations belong to their owning modules (WP-04+); the engine
  // fails closed on unregistered names (tested below).
  const { rows } = await pool.query(
    `SELECT DISTINCT jsonb_array_elements_text(validations) AS v FROM transition_config`,
  );
  for (const r of rows) {
    engine.registerValidator(r.v, async (req) => {
      validatorCalls.push(`${r.v}:${req.machine}:${req.from}->${req.to}`);
    });
  }
}, 60_000);
afterAll(async () => {
  await pool.end();
});

describe('TS-U unit — transition engine, generated from config', () => {
  it('every ACTIVE rule allows its first permitted role, audits, and emits the event', async () => {
    let cases = 0;
    for (const machine of MACHINES) {
      for (const rule of await engine.rulesFor(machine)) {
        const role = rule.allowed_roles[0] as string;
        const req = reqFor(machine, rule.from, rule.to, role, true);
        await engine.transition(req);
        const audit = await pool.query(
          'SELECT before, after FROM audit_event WHERE entity_id = $1', [req.subjectId],
        );
        expect(audit.rowCount, `${machine} ${rule.from}->${rule.to} audited`).toBe(1);
        expect(audit.rows[0].before).toEqual({ status: rule.from });
        expect(audit.rows[0].after).toEqual({ status: rule.to });
        const evt = await pool.query(
          `SELECT 1 FROM outbox_event WHERE refs->>'test_subject' = $1`, [req.subjectId],
        );
        expect(evt.rowCount, `${machine} ${rule.from}->${rule.to} event emitted`).toBe(1);
        cases += 1;
      }
    }
    expect(cases).toBeGreaterThanOrEqual(40); // seeded active rows
  }, 120_000);

  it('every ACTIVE rule rejects a role outside its allowed list', async () => {
    for (const machine of MACHINES) {
      for (const rule of await engine.rulesFor(machine)) {
        // report_viewer appears in no seeded allowed_roles list
        await expect(
          engine.transition(reqFor(machine, rule.from, rule.to, 'report_viewer', true)),
          `${machine} ${rule.from}->${rule.to} role gate`,
        ).rejects.toMatchObject({ code: 'transition_not_allowed_role' });
      }
    }
  }, 120_000);

  it('every rule with requires_reason rejects a missing reason', async () => {
    for (const machine of MACHINES) {
      for (const rule of await engine.rulesFor(machine)) {
        if (!rule.requires_reason) continue;
        await expect(
          engine.transition(reqFor(machine, rule.from, rule.to, rule.allowed_roles[0] as string, false)),
          `${machine} ${rule.from}->${rule.to} reason gate`,
        ).rejects.toMatchObject({ code: 'reason_required' });
      }
    }
  });

  it('absent pairs and INACTIVE rows reject as transition_not_allowed', async () => {
    await expect(engine.transition(reqFor('order', 'draft', 'active', 'super_admin', true)))
      .rejects.toMatchObject({ code: 'transition_not_allowed' }); // absent pair — review is mandatory
    await expect(engine.transition(reqFor('payment', 'paid', 'refund_requested', 'ops_manager', true)))
      .rejects.toMatchObject({ code: 'transition_not_allowed' }); // inactive until Q20 (DEC-009)
    await expect(engine.transition(reqFor('fulfillment', 'packed', 'assigned_to_driver', 'fleet_supervisor', true)))
      .rejects.toMatchObject({ code: 'transition_not_allowed' }); // dispatch rows dormant until P4
  });

  it('named validators run inside the transition; unregistered validators fail closed', async () => {
    expect(validatorCalls.some((c) => c.startsWith('payment_gate:order:approved->active'))).toBe(true);
    const bare = new TransitionEngine(pool, new AuditService(), new OutboxService(), 0);
    await expect(bare.transition(reqFor('order', 'approved', 'active', 'system', false)))
      .rejects.toMatchObject({ code: 'validator_not_registered' });
  });

  it('a failing validator aborts the whole transition transaction (nothing persists)', async () => {
    const strict = new TransitionEngine(pool, new AuditService(), new OutboxService(), 0);
    strict.registerValidator('completeness', async () => {
      throw new TransitionError('validation_failed', 'mandatory fields missing');
    });
    const req = reqFor('draft', 'open', 'submitted', 'order_agent', false);
    await expect(strict.transition(req)).rejects.toMatchObject({ code: 'validation_failed' });
    const audit = await pool.query('SELECT 1 FROM audit_event WHERE entity_id = $1', [req.subjectId]);
    expect(audit.rowCount).toBe(0);
  });

  it('config edits apply without redeploy: deactivating a rule blocks it after invalidate', async () => {
    await pool.query(
      `UPDATE transition_config SET active = false WHERE machine = 'ticket' AND from_status = 'blocked'`,
    );
    engine.invalidate();
    await expect(engine.transition(reqFor('ticket', 'blocked', 'in_progress', 'kitchen_user', false)))
      .rejects.toMatchObject({ code: 'transition_not_allowed' });
    await pool.query(
      `UPDATE transition_config SET active = true WHERE machine = 'ticket' AND from_status = 'blocked'`,
    );
    engine.invalidate();
    await engine.transition(reqFor('ticket', 'blocked', 'in_progress', 'kitchen_user', false));
  });
});
