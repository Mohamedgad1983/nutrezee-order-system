import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../../platform/db/tx';
import { AuditService } from '../../platform/audit/audit.service';
import { OutboxService } from '../../platform/outbox/outbox.service';
import { SettingsReader } from '../../platform/settings/settings-reader';
import { IdempotencyConflictError, IdempotencyService } from '../../platform/idempotency/idempotency.service';
import { TransitionEngine, TransitionError } from '../../platform/transition/transition-engine';
import type { StaffContext } from '../../platform/auth/session.service';
import { newId } from '../../platform/ids';
import { CustomerService } from '../m04-customers/customer.service';
import { CatalogService } from '../m05-catalog/catalog.service';
import { MessageRefError, MessageRefService, type MessageRefInput } from '../m17-whatsapp/message-ref.service';

export type DraftChannel = 'whatsapp' | 'phone' | 'walk_in' | 'staff' | 'other';
export type DraftState = 'open' | 'submitted' | 'returned' | 'converted' | 'rejected' | 'cancelled' | 'expired';

export interface DraftItemInput {
  productId: string;
  qty?: number;
  note?: string;
}

export interface DraftAddressInline {
  label?: string;
  areaId?: string;
  addressText?: string;
  deliveryNotes?: string;
  contactPhone?: string;
}

export interface DraftInput {
  channel: DraftChannel;
  customerId?: string;
  unverifiedCustomer?: boolean;
  unverifiedReason?: string;
  packageId?: string;
  startDate?: string;
  endDate?: string;
  addressId?: string;
  addressInline?: DraftAddressInline;
  slotId?: string;
  methodId?: string;
  couponCode?: string;
  expectedPaymentMethod?: string;
  priceEstimate?: number;
  notes?: string;
  items?: DraftItemInput[];
  whatsappRef?: MessageRefInput;
}

export interface DraftUpdateInput extends Partial<DraftInput> {
  version: number;
}

export interface CompletenessWarning {
  field: string;
  rule: string;
  detail?: unknown;
}

export interface CompletenessSnapshot {
  missing: string[];
  warnings: CompletenessWarning[];
  checked_at: string;
}

export interface AllergyConflict {
  product_id: string;
  allergen_id: string;
  allergen_name: string;
  severity: 'note' | 'avoid' | 'severe' | null;
  source: 'declared' | 'derived_from_ingredient';
}

export interface DraftRecord {
  id: string;
  state: DraftState;
  channel: DraftChannel;
  customer_id: string | null;
  unverified_customer: boolean;
  unverified_reason: string | null;
  package_id: string | null;
  start_date: string | null;
  end_date: string | null;
  address_id: string | null;
  address_inline: DraftAddressInline | null;
  slot_id: string | null;
  method_id: string | null;
  coupon_code: string | null;
  expected_payment_method: string | null;
  price_estimate: number | null;
  completeness: CompletenessSnapshot;
  allergy_conflicts: AllergyConflict[];
  notes: string | null;
  submitted_at: string | null;
  version: number;
  items: Array<{ id: string; product_id: string; qty: number; note: string | null }>;
  whatsapp_ref_attached: boolean;
}

export interface ReviewDraftMeta {
  id: string;
  state: DraftState;
  channel: DraftChannel;
  customer_id: string | null;
  created_by: string | null;
  completeness: CompletenessSnapshot;
  allergy_conflicts: AllergyConflict[];
}

export class DraftError extends Error {
  constructor(
    readonly code:
      | 'validation_failed'
      | 'not_found'
      | 'conflict_stale'
      | 'immutable_state'
      | 'incomplete'
      | 'idempotency_conflict',
    readonly detail?: unknown,
  ) {
    super(code);
  }
}

const CHANNELS = new Set<DraftChannel>(['whatsapp', 'phone', 'walk_in', 'staff', 'other']);
const EDITABLE_STATES = new Set<DraftState>(['open', 'returned']);
const DEFAULT_REQUIRED_FIELDS = [
  'customer',
  'channel',
  'selection',
  'start_date',
  'address',
  'area',
  'delivery_slot',
  'delivery_method',
  'expected_payment_method',
];

// M01 draft intake: completeness, incomplete queue, allergy conflicts, aging alerts.
// Business choices come from ASSUMPTION_REGISTER.md and stay settings/config driven.
export class DraftService {
  constructor(
    private readonly pool: Pool,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsReader,
    private readonly idempotency: IdempotencyService,
    private readonly transitions: TransitionEngine,
    private readonly customers: CustomerService,
    private readonly catalog: CatalogService,
    private readonly messageRefs: MessageRefService,
  ) {
    this.transitions.registerValidator('completeness', async (req, client) => {
      if (req.subjectType !== 'draft_order') return;
      await this.assertCompleteInTx(client, req.subjectId);
    });
  }

  async createDraft(
    actor: StaffContext,
    input: DraftInput,
    idempotencyKey?: string,
  ): Promise<{ id: string; replay: boolean }> {
    this.validateDraftInput(input, actor.roles);
    await this.assertReferencedRecords(input);
    const requestHash = this.idempotency.hashRequest(input);
    return withTransaction(this.pool, async (client) => {
      if (idempotencyKey) {
        const claim = await this.idempotency.claimInTx(client, idempotencyKey, 'draft.create', requestHash);
        if (claim.replay) {
          if (!claim.responseRef) throw new DraftError('idempotency_conflict');
          return { id: claim.responseRef, replay: true };
        }
      }
      const id = newId();
      await client.query(
        `INSERT INTO draft_order
          (id, channel, customer_id, unverified_customer, unverified_reason, package_id,
           start_date, end_date, address_id, address_inline, slot_id, method_id,
           coupon_code, expected_payment_method, price_estimate, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          id, input.channel, input.customerId ?? null, input.unverifiedCustomer ?? false,
          input.unverifiedReason ?? null, input.packageId ?? null, input.startDate ?? null,
          input.endDate ?? null, input.addressId ?? null,
          input.addressInline ? JSON.stringify(input.addressInline) : null,
          input.slotId ?? null, input.methodId ?? null, input.couponCode ?? null,
          input.expectedPaymentMethod ?? null, input.priceEstimate ?? null, input.notes ?? null,
          actor.staffId,
        ],
      );
      await this.replaceItemsInTx(client, actor, id, input.items ?? []);
      if (input.whatsappRef) {
        const normalized = await this.customers.normalize(input.whatsappRef.senderPhone);
        await this.messageRefs.attachInTx(client, actor, id, { ...input.whatsappRef, senderPhone: normalized });
      }
      const summary = await this.recomputeDraftInTx(client, id);
      await this.audit.writeInTx(client, {
        eventType: 'order.draft_created',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'draft_order',
        entityId: id,
        severity: 'info',
        after: { channel: input.channel, missing: summary.missing },
      });
      await this.outbox.writeInTx(client, {
        eventType: 'order.draft_created',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        refs: { draft: id },
        payload: { channel: input.channel, missing: summary.missing },
      });
      if (idempotencyKey) await this.idempotency.storeResponseInTx(client, idempotencyKey, id);
      return { id, replay: false };
    });
  }

  async updateDraft(actor: StaffContext, draftId: string, patch: DraftUpdateInput): Promise<void> {
    if (!Number.isInteger(patch.version)) throw new DraftError('validation_failed', { field: 'version' });
    await withTransaction(this.pool, async (client) => {
      const existing = await this.loadDraftRowInTx(client, draftId, true);
      if (existing.version !== patch.version) throw new DraftError('conflict_stale');
      if (!EDITABLE_STATES.has(existing.state)) throw new DraftError('immutable_state', { state: existing.state });

      const merged = this.mergeInput(existing, await this.itemsForDraftInTx(client, draftId), patch);
      this.validateDraftInput(merged, actor.roles, true);
      await this.assertReferencedRecords(merged);

      const fields: Array<[string, unknown]> = [
        ['channel', patch.channel],
        ['customer_id', patch.customerId],
        ['unverified_customer', patch.unverifiedCustomer],
        ['unverified_reason', patch.unverifiedReason],
        ['package_id', patch.packageId],
        ['start_date', patch.startDate],
        ['end_date', patch.endDate],
        ['address_id', patch.addressId],
        ['address_inline', patch.addressInline === undefined ? undefined : JSON.stringify(patch.addressInline)],
        ['slot_id', patch.slotId],
        ['method_id', patch.methodId],
        ['coupon_code', patch.couponCode],
        ['expected_payment_method', patch.expectedPaymentMethod],
        ['price_estimate', patch.priceEstimate],
        ['notes', patch.notes],
      ];
      const sets = ['updated_at = now()', 'updated_by = $2', 'version = version + 1'];
      const params: unknown[] = [draftId, actor.staffId];
      for (const [column, value] of fields) {
        if (value === undefined) continue;
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      }
      if (sets.length > 3) await client.query(`UPDATE draft_order SET ${sets.join(', ')} WHERE id = $1`, params);
      if (patch.items !== undefined) await this.replaceItemsInTx(client, actor, draftId, patch.items);
      if (patch.whatsappRef) {
        const normalized = await this.customers.normalize(patch.whatsappRef.senderPhone);
        await this.messageRefs.attachInTx(client, actor, draftId, { ...patch.whatsappRef, senderPhone: normalized });
      }
      const summary = await this.recomputeDraftInTx(client, draftId);
      await this.audit.writeInTx(client, {
        eventType: 'order.draft_edited',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'draft_order',
        entityId: draftId,
        severity: 'info',
        after: { missing: summary.missing, patch_fields: Object.keys(patch).filter((k) => k !== 'version') },
      });
      await this.outbox.writeInTx(client, {
        eventType: 'order.draft_edited',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        refs: { draft: draftId },
        payload: { missing: summary.missing },
      });
    });
  }

  async attachWhatsappRef(actor: StaffContext, draftId: string, input: MessageRefInput): Promise<void> {
    const normalized = await this.customers.normalize(input.senderPhone);
    await withTransaction(this.pool, async (client) => {
      const draft = await this.loadDraftRowInTx(client, draftId, true);
      if (!EDITABLE_STATES.has(draft.state)) throw new DraftError('immutable_state', { state: draft.state });
      await this.messageRefs.attachInTx(client, actor, draftId, { ...input, senderPhone: normalized });
      const summary = await this.recomputeDraftInTx(client, draftId);
      await this.audit.writeInTx(client, {
        eventType: 'order.draft_edited',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'draft_order',
        entityId: draftId,
        severity: 'info',
        after: { whatsapp_ref_attached: true, missing: summary.missing },
      });
      await this.outbox.writeInTx(client, {
        eventType: 'order.draft_edited',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        refs: { draft: draftId },
        payload: { whatsapp_ref_attached: true, missing: summary.missing },
      });
    });
  }

  async submitDraft(actor: StaffContext, draftId: string): Promise<void> {
    const draft = await this.getDraft(draftId);
    await this.transitions.transition({
      machine: 'draft',
      subjectType: 'draft_order',
      subjectId: draftId,
      from: draft.state,
      to: 'submitted',
      actor,
      eventType: 'order.submitted',
      refs: draft.customer_id ? { customer: draft.customer_id } : undefined,
      apply: async (client) => {
        await client.query(
          `UPDATE draft_order SET state = 'submitted', submitted_at = now(),
             updated_at = now(), updated_by = $2, version = version + 1 WHERE id = $1`,
          [draftId, actor.staffId],
        );
      },
    });
  }

  async cancelDraft(actor: StaffContext, draftId: string, reasonCode: string, note?: string): Promise<void> {
    const draft = await this.getDraft(draftId);
    await this.transitions.transition({
      machine: 'draft',
      subjectType: 'draft_order',
      subjectId: draftId,
      from: draft.state,
      to: 'cancelled',
      actor,
      reason: { code: reasonCode, note },
      eventType: 'order.draft_cancelled',
      refs: draft.customer_id ? { customer: draft.customer_id } : undefined,
      apply: async (client) => {
        await client.query(
          `UPDATE draft_order SET state = 'cancelled', updated_at = now(),
             updated_by = $2, version = version + 1 WHERE id = $1`,
          [draftId, actor.staffId],
        );
      },
    });
  }

  async getDraft(draftId: string): Promise<DraftRecord> {
    return withTransaction(this.pool, async (client) => {
      const row = await this.loadDraftRowInTx(client, draftId, false);
      const items = await this.itemsForDraftInTx(client, draftId);
      const hasRef = await this.messageRefs.hasRefInTx(client, draftId);
      return this.toRecord(row, items, hasRef);
    });
  }

  async listDrafts(filters: { state?: DraftState; channel?: DraftChannel } = {}): Promise<DraftRecord[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (filters.state) {
      params.push(filters.state);
      clauses.push(`state = $${params.length}`);
    }
    if (filters.channel) {
      params.push(filters.channel);
      clauses.push(`channel = $${params.length}`);
    }
    const { rows } = await this.pool.query(
      `SELECT * FROM draft_order ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
       ORDER BY created_at DESC LIMIT 100`,
      params,
    );
    const out: DraftRecord[] = [];
    for (const row of rows) {
      const id = row.id as string;
      const items = await this.itemsForDraft(id);
      const hasRef = await this.hasWhatsappRef(id);
      out.push(this.toRecord(this.castDraftRow(row), items, hasRef));
    }
    return out;
  }

  async incompleteQueue(): Promise<DraftRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM draft_order
       WHERE state IN ('open','returned')
         AND jsonb_array_length(completeness->'missing') > 0
       ORDER BY created_at ASC LIMIT 100`,
    );
    const out: DraftRecord[] = [];
    for (const row of rows) {
      const id = row.id as string;
      out.push(this.toRecord(this.castDraftRow(row), await this.itemsForDraft(id), await this.hasWhatsappRef(id)));
    }
    return out;
  }

  async fireAgingAlerts(actor: StaffContext | 'system' = 'system'): Promise<string[]> {
    const hours = await this.settings.get<number>('draft_aging_alert_hours', 4);
    const { rows } = await this.pool.query(
      `SELECT d.id FROM draft_order d
       WHERE d.state IN ('open','returned')
         AND d.created_at <= now() - make_interval(hours => $1)
         AND NOT EXISTS (
           SELECT 1 FROM outbox_event o
           WHERE o.event_type = 'order.draft_aging_alert'
             AND o.refs->>'draft' = d.id
         )
       ORDER BY d.created_at ASC LIMIT 100`,
      [hours],
    );
    const ids = rows.map((r) => r.id as string);
    for (const id of ids) {
      await withTransaction(this.pool, async (client) => {
        await this.audit.writeInTx(client, {
          eventType: 'order.draft_aging_alert',
          actor: actor === 'system' ? 'system' : { id: actor.staffId, role: actor.roles[0] ?? 'none' },
          entityType: 'draft_order',
          entityId: id,
          severity: 'warn',
          after: { threshold_hours: hours },
        });
        await this.outbox.writeInTx(client, {
          eventType: 'order.draft_aging_alert',
          actor: actor === 'system' ? { system: 'draft-aging' } : { id: actor.staffId, role: actor.roles[0] ?? 'none' },
          refs: { draft: id },
          payload: { threshold_hours: hours },
        });
      });
    }
    return ids;
  }

  async submittedReviewMetas(limit = 100): Promise<ReviewDraftMeta[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM draft_order WHERE state = 'submitted' ORDER BY submitted_at NULLS LAST, created_at LIMIT $1`,
      [limit],
    );
    return rows.map((r) => this.toReviewMeta(this.castDraftRow(r)));
  }

  async reviewMeta(draftId: string): Promise<ReviewDraftMeta> {
    return withTransaction(this.pool, async (client) =>
      this.toReviewMeta(await this.loadDraftRowInTx(client, draftId, false)),
    );
  }

  async transitionFromReviewInTx(
    client: PoolClient,
    actor: StaffContext,
    draftId: string,
    to: 'returned' | 'rejected',
    reason: { code: string; note?: string },
  ): Promise<void> {
    const draft = await this.loadDraftRowInTx(client, draftId, true);
    await this.transitions.transitionInTx(
      {
        machine: 'draft',
        subjectType: 'draft_order',
        subjectId: draftId,
        from: draft.state,
        to,
        actor,
        reason,
        eventType: to === 'returned' ? 'order.returned' : 'order.rejected',
        refs: draft.customer_id ? { customer: draft.customer_id } : undefined,
        apply: async (tx) => {
          await tx.query(
            `UPDATE draft_order SET state = $2,
               returned_at = CASE WHEN $2 = 'returned' THEN now() ELSE returned_at END,
               updated_at = now(), updated_by = $3, version = version + 1 WHERE id = $1`,
            [draftId, to, actor.staffId],
          );
        },
      },
      client,
    );
  }

  async transitionToConvertedInTx(
    client: PoolClient,
    draftId: string,
    orderId: string,
  ): Promise<void> {
    const draft = await this.loadDraftRowInTx(client, draftId, true);
    await this.transitions.transitionInTx(
      {
        machine: 'draft',
        subjectType: 'draft_order',
        subjectId: draftId,
        from: draft.state,
        to: 'converted',
        actor: 'system',
        eventType: 'order.approved',
        refs: { created_order_ref: orderId, ...(draft.customer_id ? { customer_id: draft.customer_id } : {}) },
        apply: async (tx) => {
          await tx.query(
            `UPDATE draft_order SET state = 'converted',
               updated_at = now(), updated_by = 'system', version = version + 1 WHERE id = $1`,
            [draftId],
          );
        },
      },
      client,
    );
  }

  private validateDraftInput(input: DraftInput, actorRoles: string[], patch = false): void {
    if (!patch && !input.channel) throw new DraftError('validation_failed', { field: 'channel' });
    if (input.channel && !CHANNELS.has(input.channel)) throw new DraftError('validation_failed', { field: 'channel' });
    if (input.customerId && input.unverifiedCustomer) {
      throw new DraftError('validation_failed', { field: 'customer_id|unverified_customer' });
    }
    if (input.priceEstimate !== undefined && input.priceEstimate !== null && input.priceEstimate < 0) {
      throw new DraftError('validation_failed', { field: 'price_estimate' });
    }
    if (input.startDate && !this.isDate(input.startDate)) throw new DraftError('validation_failed', { field: 'start_date' });
    if (input.endDate && !this.isDate(input.endDate)) throw new DraftError('validation_failed', { field: 'end_date' });
    if (input.startDate && input.endDate && input.startDate > input.endDate) {
      throw new DraftError('validation_failed', { field: 'date_range' });
    }
    if (input.startDate && input.startDate < this.today()) {
      if (input.unverifiedReason !== 'OM_BACKDATE_OVERRIDE') {
        throw new DraftError('validation_failed', { field: 'start_date', rule: 'no_backdate_without_om_override' });
      }
      // ASM-015: backdated start is an OM override — the marker alone is not enough
      if (!actorRoles.some((r) => r === 'ops_manager' || r === 'super_admin')) {
        throw new DraftError('validation_failed', { field: 'start_date', rule: 'backdate_override_requires_om' });
      }
    }
    if (input.addressInline) {
      if (!input.addressInline.addressText?.trim()) throw new DraftError('validation_failed', { field: 'address_inline.addressText' });
      if (!input.addressInline.areaId) throw new DraftError('validation_failed', { field: 'address_inline.areaId' });
    }
    for (const item of input.items ?? []) {
      if (!item.productId) throw new DraftError('validation_failed', { field: 'items.productId' });
      if (item.qty !== undefined && (!Number.isInteger(item.qty) || item.qty <= 0)) {
        throw new DraftError('validation_failed', { field: 'items.qty' });
      }
    }
  }

  private async assertReferencedRecords(input: DraftInput): Promise<void> {
    if (input.customerId && !(await this.customers.exists(input.customerId))) {
      throw new DraftError('not_found', { field: 'customer_id' });
    }
    if (input.packageId && !(await this.catalog.packageExists(input.packageId))) {
      throw new DraftError('not_found', { field: 'package_id' });
    }
    if (input.addressId) {
      const address = await this.customers.getAddressForIntake(input.addressId, input.customerId);
      if (!address?.active) throw new DraftError('validation_failed', { field: 'address_id' });
    }
    for (const item of input.items ?? []) {
      if (!(await this.catalog.productExists(item.productId))) {
        throw new DraftError('not_found', { field: 'items.productId', product_id: item.productId });
      }
    }
  }

  private async replaceItemsInTx(
    client: PoolClient,
    actor: StaffContext,
    draftId: string,
    items: DraftItemInput[],
  ): Promise<void> {
    await client.query('DELETE FROM draft_item WHERE draft_id = $1', [draftId]);
    for (const item of items) {
      await client.query(
        `INSERT INTO draft_item (id, draft_id, product_id, qty, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [newId(), draftId, item.productId, item.qty ?? 1, item.note ?? null, actor.staffId],
      );
    }
  }

  private async assertCompleteInTx(client: PoolClient, draftId: string): Promise<void> {
    const summary = await this.recomputeDraftInTx(client, draftId);
    if (summary.missing.length > 0) {
      throw new TransitionError('validation_failed', `missing: ${summary.missing.join(',')}`);
    }
  }

  private async recomputeDraftInTx(client: PoolClient, draftId: string): Promise<CompletenessSnapshot> {
    const row = await this.loadDraftRowInTx(client, draftId, true);
    const items = await this.itemsForDraftInTx(client, draftId);
    const hasRef = await this.messageRefs.hasRefInTx(client, draftId);
    const conflicts = await this.computeConflicts(row.customer_id, items);
    const summary = await this.computeCompleteness(row, items, conflicts, hasRef);
    await client.query(
      `UPDATE draft_order SET completeness = $2, allergy_conflicts = $3,
         updated_at = COALESCE(updated_at, now()) WHERE id = $1`,
      [draftId, JSON.stringify(summary), JSON.stringify(conflicts)],
    );
    return summary;
  }

  private async computeConflicts(
    customerId: string | null,
    items: Array<{ product_id: string; qty: number; note: string | null }>,
  ): Promise<AllergyConflict[]> {
    if (!customerId || items.length === 0) return [];
    const allergies = await this.customers.allergiesForIntake(customerId);
    if (allergies.length === 0) return [];
    const byAllergen = new Map(allergies.map((a) => [a.allergenId, a]));
    const conflicts: AllergyConflict[] = [];
    for (const item of items) {
      for (const resolved of await this.catalog.resolveAllergens(item.product_id)) {
        const allergy = byAllergen.get(resolved.allergenId);
        if (!allergy) continue;
        conflicts.push({
          product_id: item.product_id,
          allergen_id: resolved.allergenId,
          allergen_name: resolved.nameEn,
          severity: allergy.severity,
          source: resolved.source,
        });
      }
    }
    return conflicts;
  }

  private async computeCompleteness(
    row: DraftRow,
    items: Array<{ product_id: string; qty: number; note: string | null }>,
    conflicts: AllergyConflict[],
    hasWhatsappRef: boolean,
  ): Promise<CompletenessSnapshot> {
    const required = await this.settings.get<string[]>('draft_submit_required_fields', DEFAULT_REQUIRED_FIELDS);
    const missing: string[] = [];
    const warnings: CompletenessWarning[] = [];
    const requireField = (name: string, missingWhen: boolean) => {
      if (required.includes(name) && missingWhen) missing.push(name);
    };

    requireField('customer', !row.customer_id && !row.unverified_customer);
    if (row.unverified_customer && !row.unverified_reason?.trim()) missing.push('unverified_reason');
    requireField('channel', !row.channel);
    if (row.channel === 'whatsapp' && !hasWhatsappRef) missing.push('whatsapp_reference');
    requireField('selection', !row.package_id && items.length === 0);
    requireField('start_date', !row.start_date);
    const inlineAddress = row.address_inline;
    requireField('address', !row.address_id && !inlineAddress?.addressText);
    const addressHasArea = row.address_id
      ? await this.savedAddressHasArea(row.address_id)
      : Boolean(inlineAddress?.areaId);
    requireField('area', !addressHasArea);
    requireField('delivery_slot', !row.slot_id);
    requireField('delivery_method', !row.method_id);
    requireField('expected_payment_method', !row.expected_payment_method);

    if (conflicts.length > 0) {
      warnings.push({ field: 'allergy_conflicts', rule: 'requires_review', detail: conflicts });
    }
    if (row.coupon_code && await this.settings.get<string>('coupon_validation_mode', 'warn') === 'warn') {
      warnings.push({ field: 'coupon_code', rule: 'validity_unverified' });
    }
    if (row.slot_id && await this.slotCapacityWarns(row.slot_id)) {
      warnings.push({ field: 'slot_id', rule: 'capacity_unverified_or_full' });
    }
    return { missing: [...new Set(missing)], warnings, checked_at: new Date().toISOString() };
  }

  private async savedAddressHasArea(addressId: string): Promise<boolean> {
    const address = await this.customers.getAddressForIntake(addressId);
    return Boolean(address?.active && address.areaId);
  }

  private async slotCapacityWarns(slotId: string): Promise<boolean> {
    const mode = await this.settings.get<string>('slot_capacity_mode', 'warn');
    if (mode !== 'warn') return false;
    const { rows } = await this.pool.query('SELECT capacity FROM delivery_slot WHERE id = $1', [slotId]);
    return rows.length === 0 || rows[0].capacity === null;
  }

  private async loadDraftRowInTx(client: PoolClient, draftId: string, lock: boolean): Promise<DraftRow> {
    const { rows } = await client.query(
      `SELECT * FROM draft_order WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
      [draftId],
    );
    if (rows.length === 0) throw new DraftError('not_found');
    return this.castDraftRow(rows[0] as Record<string, unknown>);
  }

  private async itemsForDraft(draftId: string): Promise<Array<{ id: string; product_id: string; qty: number; note: string | null }>> {
    const { rows } = await this.pool.query(
      `SELECT id, product_id, qty, note FROM draft_item WHERE draft_id = $1 ORDER BY created_at`,
      [draftId],
    );
    return rows.map((r) => ({
      id: r.id as string,
      product_id: r.product_id as string,
      qty: r.qty as number,
      note: r.note as string | null,
    }));
  }

  private async itemsForDraftInTx(
    client: PoolClient,
    draftId: string,
  ): Promise<Array<{ id: string; product_id: string; qty: number; note: string | null }>> {
    const { rows } = await client.query(
      `SELECT id, product_id, qty, note FROM draft_item WHERE draft_id = $1 ORDER BY created_at`,
      [draftId],
    );
    return rows.map((r) => ({
      id: r.id as string,
      product_id: r.product_id as string,
      qty: r.qty as number,
      note: r.note as string | null,
    }));
  }

  private async hasWhatsappRef(draftId: string): Promise<boolean> {
    return this.messageRefs.hasRefInTx(this.pool, draftId); // M17 read API (ADR-010)
  }

  private toRecord(
    row: DraftRow,
    items: Array<{ id: string; product_id: string; qty: number; note: string | null }>,
    whatsappRefAttached: boolean,
  ): DraftRecord {
    return {
      id: row.id,
      state: row.state,
      channel: row.channel,
      customer_id: row.customer_id,
      unverified_customer: row.unverified_customer,
      unverified_reason: row.unverified_reason,
      package_id: row.package_id,
      start_date: row.start_date,
      end_date: row.end_date,
      address_id: row.address_id,
      address_inline: row.address_inline,
      slot_id: row.slot_id,
      method_id: row.method_id,
      coupon_code: row.coupon_code,
      expected_payment_method: row.expected_payment_method,
      price_estimate: row.price_estimate,
      completeness: row.completeness,
      allergy_conflicts: row.allergy_conflicts,
      notes: row.notes,
      submitted_at: row.submitted_at,
      version: row.version,
      items,
      whatsapp_ref_attached: whatsappRefAttached,
    };
  }

  private toReviewMeta(row: DraftRow): ReviewDraftMeta {
    return {
      id: row.id,
      state: row.state,
      channel: row.channel,
      customer_id: row.customer_id,
      created_by: row.created_by,
      completeness: row.completeness,
      allergy_conflicts: row.allergy_conflicts,
    };
  }

  private mergeInput(
    row: DraftRow,
    items: Array<{ product_id: string; qty: number; note: string | null }>,
    patch: DraftUpdateInput,
  ): DraftInput {
    return {
      channel: patch.channel ?? row.channel,
      customerId: patch.customerId ?? row.customer_id ?? undefined,
      unverifiedCustomer: patch.unverifiedCustomer ?? row.unverified_customer,
      unverifiedReason: patch.unverifiedReason ?? row.unverified_reason ?? undefined,
      packageId: patch.packageId ?? row.package_id ?? undefined,
      startDate: patch.startDate ?? row.start_date ?? undefined,
      endDate: patch.endDate ?? row.end_date ?? undefined,
      addressId: patch.addressId ?? row.address_id ?? undefined,
      addressInline: patch.addressInline ?? row.address_inline ?? undefined,
      slotId: patch.slotId ?? row.slot_id ?? undefined,
      methodId: patch.methodId ?? row.method_id ?? undefined,
      couponCode: patch.couponCode ?? row.coupon_code ?? undefined,
      expectedPaymentMethod: patch.expectedPaymentMethod ?? row.expected_payment_method ?? undefined,
      priceEstimate: patch.priceEstimate ?? row.price_estimate ?? undefined,
      notes: patch.notes ?? row.notes ?? undefined,
      items: patch.items ?? items.map((i) => ({ productId: i.product_id, qty: i.qty, note: i.note ?? undefined })),
      whatsappRef: patch.whatsappRef,
    };
  }

  private castDraftRow(row: Record<string, unknown>): DraftRow {
    return {
      id: row.id as string,
      state: row.state as DraftState,
      channel: row.channel as DraftChannel,
      customer_id: row.customer_id as string | null,
      unverified_customer: row.unverified_customer as boolean,
      unverified_reason: row.unverified_reason as string | null,
      package_id: row.package_id as string | null,
      start_date: this.dateString(row.start_date),
      end_date: this.dateString(row.end_date),
      address_id: row.address_id as string | null,
      address_inline: (row.address_inline as DraftAddressInline | null) ?? null,
      slot_id: row.slot_id as string | null,
      method_id: row.method_id as string | null,
      coupon_code: row.coupon_code as string | null,
      expected_payment_method: row.expected_payment_method as string | null,
      price_estimate: row.price_estimate === null ? null : Number(row.price_estimate),
      completeness: (row.completeness as CompletenessSnapshot | null) ?? { missing: [], warnings: [], checked_at: '' },
      allergy_conflicts: (row.allergy_conflicts as AllergyConflict[] | null) ?? [],
      notes: row.notes as string | null,
      submitted_at: row.submitted_at ? new Date(row.submitted_at as string).toISOString() : null,
      created_by: row.created_by as string | null,
      version: row.version as number,
    };
  }

  // node-postgres returns `date` columns as LOCAL-midnight Date objects; UTC getters
  // shift the calendar day east of UTC (A10 fixed M03 the same way).
  private dateString(value: unknown): string | null {
    if (!value) return null;
    if (value instanceof Date) {
      const y = value.getFullYear();
      const m = String(value.getMonth() + 1).padStart(2, '0');
      const d = String(value.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return String(value).slice(0, 10);
  }

  private isDate(value: string): boolean {
    return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  }

  private today(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
}

interface DraftRow {
  id: string;
  state: DraftState;
  channel: DraftChannel;
  customer_id: string | null;
  unverified_customer: boolean;
  unverified_reason: string | null;
  package_id: string | null;
  start_date: string | null;
  end_date: string | null;
  address_id: string | null;
  address_inline: DraftAddressInline | null;
  slot_id: string | null;
  method_id: string | null;
  coupon_code: string | null;
  expected_payment_method: string | null;
  price_estimate: number | null;
  completeness: CompletenessSnapshot;
  allergy_conflicts: AllergyConflict[];
  notes: string | null;
  submitted_at: string | null;
  created_by: string | null;
  version: number;
}

export function toDraftError(e: unknown): DraftError | TransitionError | MessageRefError | IdempotencyConflictError | unknown {
  if (e instanceof DraftError || e instanceof TransitionError || e instanceof MessageRefError) return e;
  if (e instanceof IdempotencyConflictError) return e;
  return e;
}
