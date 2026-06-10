import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../db/tx';
import { AuditService } from '../audit/audit.service';
import { OutboxService } from '../outbox/outbox.service';
import type { StaffContext } from '../auth/session.service';

export type Machine = 'order' | 'fulfillment' | 'payment' | 'ticket' | 'draft';

export class TransitionError extends Error {
  constructor(
    readonly code:
      | 'transition_not_allowed'        // no active (from,to) row for the machine
      | 'transition_not_allowed_role'   // row exists, caller's roles not permitted
      | 'reason_required'
      | 'validator_not_registered'      // fail closed (DEC-005 flexibility, no silent skips)
      | 'validation_failed',
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
  }
}

export interface TransitionRequest {
  machine: Machine;
  subjectType: string;               // e.g. 'order', 'fulfillment_day', 'draft_order'
  subjectId: string;
  from: string;
  to: string;
  actor: StaffContext | 'system';
  reason?: { code: string; note?: string };
  refs?: Record<string, string>;
  eventType: string;                 // e.g. 'order.status_changed' (event_catalog name)
  severity?: 'info' | 'warn' | 'high';
  /** The OWNING module's write, executed inside the same transaction (ADR-010:
   *  the engine never writes business tables itself). */
  apply: (client: PoolClient) => Promise<void>;
}

export type Validator = (req: TransitionRequest, client: PoolClient) => Promise<void>;

interface ConfigRow {
  allowed_roles: string[];
  validations: string[];
  requires_reason: boolean;
}

// Config-seeded transition engine (backend_foundation §6, amendment A3).
// One transaction per transition: role check -> validators -> owning-module apply ->
// audit -> outbox. Rules live in transition_config (workshop-editable, zero redeploy).
export class TransitionEngine {
  private cache: Map<string, ConfigRow> | null = null;
  private loadedAt = 0;
  private readonly validators = new Map<string, Validator>();

  constructor(
    private readonly pool: Pool,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly ttlMs = 10_000,
  ) {}

  registerValidator(name: string, fn: Validator): void {
    this.validators.set(name, fn);
  }

  invalidate(): void {
    this.cache = null;
  }

  async transition(req: TransitionRequest): Promise<void> {
    const rule = await this.rule(req.machine, req.from, req.to);
    if (!rule) throw new TransitionError('transition_not_allowed', `${req.machine}: ${req.from} -> ${req.to}`);

    const actorRoles = req.actor === 'system' ? ['system'] : req.actor.roles;
    if (!rule.allowed_roles.some((r) => actorRoles.includes(r))) {
      throw new TransitionError('transition_not_allowed_role', `${req.machine}: ${req.from} -> ${req.to}`);
    }
    if (rule.requires_reason && !req.reason?.code) throw new TransitionError('reason_required');

    // resolve validators BEFORE opening the transaction — unknown = fail closed
    const fns = rule.validations.map((name) => {
      const fn = this.validators.get(name);
      if (!fn) throw new TransitionError('validator_not_registered', name);
      return fn;
    });

    await withTransaction(this.pool, async (client) => {
      for (const fn of fns) await fn(req, client);
      await req.apply(client);
      await this.audit.writeInTx(client, {
        eventType: req.eventType,
        actor: req.actor === 'system' ? 'system' : { id: req.actor.staffId, role: req.actor.roles[0] ?? 'none' },
        entityType: req.subjectType,
        entityId: req.subjectId,
        relatedRefs: req.refs,
        before: { status: req.from },
        after: { status: req.to },
        severity: req.severity ?? 'info',
        reason: req.reason ? `${req.reason.code}${req.reason.note ? `: ${req.reason.note}` : ''}` : undefined,
      });
      await this.outbox.writeInTx(client, {
        eventType: req.eventType,
        actor: req.actor === 'system' ? { system: 'transition' } : { id: req.actor.staffId, role: req.actor.roles[0] ?? 'none' },
        refs: { ...(req.refs ?? {}), [req.subjectType]: req.subjectId },
        payload: { machine: req.machine, from: req.from, to: req.to, reason: req.reason ?? null },
      });
    });
  }

  /** All active rules for a machine (the generated TS-U suite reads this). */
  async rulesFor(machine: Machine): Promise<Array<{ from: string; to: string } & ConfigRow>> {
    await this.ensureLoaded();
    const out: Array<{ from: string; to: string } & ConfigRow> = [];
    for (const [key, row] of this.cache ?? []) {
      const [m, from, to] = key.split('::');
      if (m === machine && from !== undefined && to !== undefined) out.push({ from, to, ...row });
    }
    return out;
  }

  private async rule(machine: Machine, from: string, to: string): Promise<ConfigRow | undefined> {
    await this.ensureLoaded();
    return this.cache?.get(`${machine}::${from}::${to}`);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.cache && Date.now() - this.loadedAt < this.ttlMs) return;
    const { rows } = await this.pool.query(
      `SELECT machine, from_status, to_status, allowed_roles, validations, requires_reason
       FROM transition_config WHERE active`,
    );
    const cache = new Map<string, ConfigRow>();
    for (const r of rows) {
      cache.set(`${r.machine}::${r.from_status}::${r.to_status}`, {
        allowed_roles: r.allowed_roles,
        validations: r.validations,
        requires_reason: r.requires_reason,
      });
    }
    this.cache = cache;
    this.loadedAt = Date.now();
  }
}
