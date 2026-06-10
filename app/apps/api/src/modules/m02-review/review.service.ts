import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../../platform/db/tx';
import { AuditService } from '../../platform/audit/audit.service';
import { OutboxService } from '../../platform/outbox/outbox.service';
import { SettingsReader } from '../../platform/settings/settings-reader';
import type { StaffContext } from '../../platform/auth/session.service';
import { newId } from '../../platform/ids';
import { DraftService, type CompletenessWarning, type ReviewDraftMeta } from '../m01-intake/draft.service';

export type ReviewQueueState = 'waiting' | 'in_review' | 'decided';
export type ReviewDecision = 'approve' | 'reject' | 'return' | 'hold';

export interface WarningOverrideInput {
  field: string;
  reason: string;
}

export interface ReviewDecisionInput {
  decision: ReviewDecision;
  reasonCode?: string;
  note?: string;
  warningsOverridden?: WarningOverrideInput[];
}

export interface ReviewQueueRecord {
  id: string;
  draft_id: string;
  entered_at: string;
  sla_due_at: string;
  sla_late: boolean;
  reviewer_id: string | null;
  queue_state: ReviewQueueState;
  draft_state: string;
  channel: string;
  created_by: string | null;
  missing: string[];
  warnings: CompletenessWarning[];
}

export class ReviewError extends Error {
  constructor(
    readonly code:
      | 'validation_failed'
      | 'not_found'
      | 'conflict_in_review'
      | 'immutable_state'
      | 'override_required',
    readonly detail?: unknown,
  ) {
    super(code);
  }
}

export class ReviewService {
  constructor(
    private readonly pool: Pool,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsReader,
    private readonly drafts: DraftService,
  ) {}

  async syncSubmittedDrafts(actor: StaffContext | 'system' = 'system'): Promise<string[]> {
    const metas = await this.drafts.submittedReviewMetas();
    const minutes = await this.settings.get<number>('review_sla_minutes', 120);
    const created: string[] = [];
    for (const meta of metas) {
      if (await this.hasApproval(meta.id)) continue;
      const queueId = newId();
      const createdBy = actor === 'system' ? 'system' : actor.staffId;
      const { rows } = await this.pool.query(
        `INSERT INTO review_queue_item (id, draft_id, sla_due_at, created_by)
         VALUES ($1,$2, now() + make_interval(mins => $3), $4)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [queueId, meta.id, minutes, createdBy],
      );
      if (rows.length > 0) created.push(meta.id);
    }
    return created;
  }

  async listQueue(
    actor: StaffContext,
    filters: { state?: ReviewQueueState; onlyLate?: boolean } = {},
  ): Promise<ReviewQueueRecord[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.state) {
      params.push(filters.state);
      clauses.push(`queue_state = $${params.length}`);
    }
    if (filters.onlyLate) clauses.push('sla_due_at < now()');
    const { rows } = await this.pool.query(
      `SELECT * FROM review_queue_item ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
       ORDER BY queue_state, sla_due_at ASC, entered_at ASC LIMIT 100`,
      params,
    );
    const out: ReviewQueueRecord[] = [];
    for (const row of rows) {
      const meta = await this.drafts.reviewMeta(row.draft_id as string);
      if (actor.roles.includes('order_agent') && !this.isManager(actor) && meta.created_by !== actor.staffId) {
        continue;
      }
      out.push(this.toQueueRecord(row, meta));
    }
    return out;
  }

  async claim(actor: StaffContext, draftId: string): Promise<void> {
    this.assertManager(actor);
    await this.syncSubmittedDrafts(actor);
    const meta = await this.drafts.reviewMeta(draftId);
    if (meta.state !== 'submitted') throw new ReviewError('immutable_state', { state: meta.state });
    await withTransaction(this.pool, async (client) => {
      const item = await this.loadActiveQueueInTx(client, draftId, true);
      if (item.queue_state === 'in_review' && item.reviewer_id && item.reviewer_id !== actor.staffId) {
        throw new ReviewError('conflict_in_review', { reviewer_id: item.reviewer_id });
      }
      await client.query(
        `UPDATE review_queue_item SET queue_state = 'in_review', reviewer_id = $2,
           updated_at = now(), updated_by = $2, version = version + 1 WHERE id = $1`,
        [item.id, actor.staffId],
      );
      await this.audit.writeInTx(client, {
        eventType: 'review.opened',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'review_queue_item',
        entityId: item.id,
        severity: 'info',
        relatedRefs: { draft: draftId },
        after: { reviewer_equals_creator: meta.created_by === actor.staffId },
      });
    });
  }

  async decide(actor: StaffContext, draftId: string, input: ReviewDecisionInput): Promise<void> {
    this.assertManager(actor);
    this.validateDecisionShape(input);
    await this.syncSubmittedDrafts(actor);
    const meta = await this.drafts.reviewMeta(draftId);
    if (meta.state !== 'submitted') throw new ReviewError('immutable_state', { state: meta.state });
    const reasonCodeId = await this.reasonCodeId(input);
    const requiredOverrides = input.decision === 'approve' ? this.requiredOverrideFields(meta) : [];
    this.assertOverrides(requiredOverrides, input.warningsOverridden ?? []);

    await withTransaction(this.pool, async (client) => {
      const item = await this.loadActiveQueueInTx(client, draftId, true);
      if (item.queue_state === 'in_review' && item.reviewer_id && item.reviewer_id !== actor.staffId) {
        throw new ReviewError('conflict_in_review', { reviewer_id: item.reviewer_id });
      }
      await this.insertDecisionInTx(client, actor, draftId, input, reasonCodeId);
      if (input.decision === 'hold') {
        await client.query(
          `UPDATE review_queue_item SET queue_state = 'in_review', reviewer_id = $2,
             updated_at = now(), updated_by = $2, version = version + 1 WHERE id = $1`,
          [item.id, actor.staffId],
        );
        await this.audit.writeInTx(client, {
          eventType: 'review.held',
          actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
          entityType: 'review_queue_item',
          entityId: item.id,
          severity: 'info',
          relatedRefs: { draft: draftId },
          reason: input.note,
        });
        return;
      }

      await client.query(
        `UPDATE review_queue_item SET queue_state = 'decided', reviewer_id = $2,
           updated_at = now(), updated_by = $2, version = version + 1 WHERE id = $1`,
        [item.id, actor.staffId],
      );

      if (input.decision === 'return' || input.decision === 'reject') {
        await this.drafts.transitionFromReviewInTx(
          client,
          actor,
          draftId,
          input.decision === 'return' ? 'returned' : 'rejected',
          { code: input.reasonCode as string, note: input.note },
        );
        return;
      }

      await this.writeApprovalInTx(client, actor, draftId, input.warningsOverridden ?? []);
    });
  }

  private async hasApproval(draftId: string): Promise<boolean> {
    const { rows } = await this.pool.query(
      `SELECT 1 FROM review_decision WHERE draft_id = $1 AND decision = 'approve' LIMIT 1`,
      [draftId],
    );
    return rows.length > 0;
  }

  private validateDecisionShape(input: ReviewDecisionInput): void {
    if (!['approve', 'reject', 'return', 'hold'].includes(input.decision)) {
      throw new ReviewError('validation_failed', { field: 'decision' });
    }
    if ((input.decision === 'reject' || input.decision === 'return') && !input.reasonCode) {
      throw new ReviewError('validation_failed', { field: 'reason_code' });
    }
  }

  private async reasonCodeId(input: ReviewDecisionInput): Promise<string | null> {
    if (input.decision !== 'reject' && input.decision !== 'return') return null;
    const domain = input.decision === 'reject' ? 'rejection' : 'return_to_draft';
    const { rows } = await this.pool.query(
      `SELECT id FROM reason_code WHERE domain = $1 AND code = $2 AND active`,
      [domain, input.reasonCode],
    );
    if (rows.length === 0) throw new ReviewError('validation_failed', { field: 'reason_code' });
    return rows[0].id as string;
  }

  private requiredOverrideFields(meta: ReviewDraftMeta): string[] {
    return [...new Set(meta.completeness.warnings.map((w) => w.field))].sort();
  }

  private assertOverrides(required: string[], provided: WarningOverrideInput[]): void {
    if (required.length === 0) return;
    const withReasons = new Set(provided.filter((o) => o.reason?.trim()).map((o) => o.field));
    const missing = required.filter((field) => !withReasons.has(field));
    if (missing.length > 0) throw new ReviewError('override_required', { fields: missing });
  }

  private async loadActiveQueueInTx(
    client: PoolClient,
    draftId: string,
    lock: boolean,
  ): Promise<{ id: string; reviewer_id: string | null; queue_state: ReviewQueueState }> {
    const { rows } = await client.query(
      `SELECT id, reviewer_id, queue_state FROM review_queue_item
       WHERE draft_id = $1 AND queue_state != 'decided'
       ORDER BY entered_at DESC LIMIT 1${lock ? ' FOR UPDATE' : ''}`,
      [draftId],
    );
    if (rows.length === 0) throw new ReviewError('not_found');
    return {
      id: rows[0].id as string,
      reviewer_id: rows[0].reviewer_id as string | null,
      queue_state: rows[0].queue_state as ReviewQueueState,
    };
  }

  private async insertDecisionInTx(
    client: PoolClient,
    actor: StaffContext,
    draftId: string,
    input: ReviewDecisionInput,
    reasonCodeId: string | null,
  ): Promise<void> {
    await client.query(
      `INSERT INTO review_decision
        (id, draft_id, decision, reason_code_id, note, warnings_overridden, decided_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        newId(), draftId, input.decision, reasonCodeId, input.note ?? null,
        JSON.stringify(input.warningsOverridden ?? []), actor.staffId,
      ],
    );
  }

  private async writeApprovalInTx(
    client: PoolClient,
    actor: StaffContext,
    draftId: string,
    warningsOverridden: WarningOverrideInput[],
  ): Promise<void> {
    const severity: 'high' | 'info' = warningsOverridden.length > 0 ? 'high' : 'info';
    const reason = warningsOverridden.length > 0
      ? `override: ${warningsOverridden.map((o) => o.field).join(',')}`
      : undefined;
    await this.audit.writeInTx(client, {
      eventType: 'order.approved',
      actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
      entityType: 'draft_order',
      entityId: draftId,
      severity,
      reason,
      after: { conversion_pending_wp09: true, warnings_overridden: warningsOverridden },
    });
    await this.outbox.writeInTx(client, {
      eventType: 'order.approved',
      actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
      refs: { draft: draftId },
      payload: { conversion_pending_wp09: true, warnings_overridden: warningsOverridden },
    });
  }

  private toQueueRecord(row: Record<string, unknown>, meta: ReviewDraftMeta): ReviewQueueRecord {
    return {
      id: row.id as string,
      draft_id: row.draft_id as string,
      entered_at: new Date(row.entered_at as string).toISOString(),
      sla_due_at: new Date(row.sla_due_at as string).toISOString(),
      sla_late: new Date(row.sla_due_at as string).getTime() < Date.now(),
      reviewer_id: row.reviewer_id as string | null,
      queue_state: row.queue_state as ReviewQueueState,
      draft_state: meta.state,
      channel: meta.channel,
      created_by: meta.created_by,
      missing: meta.completeness.missing,
      warnings: meta.completeness.warnings,
    };
  }

  private assertManager(actor: StaffContext): void {
    if (!this.isManager(actor)) throw new ReviewError('validation_failed', { field: 'role' });
  }

  private isManager(actor: StaffContext): boolean {
    return actor.roles.includes('ops_manager') || actor.roles.includes('super_admin');
  }
}
