import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../../platform/db/tx';
import { AuditService } from '../../platform/audit/audit.service';
import { OutboxService } from '../../platform/outbox/outbox.service';
import { TransitionEngine } from '../../platform/transition/transition-engine';
import type { StaffContext } from '../../platform/auth/session.service';
import { newId } from '../../platform/ids';
import { OrderService, type FulfillmentDayForKitchen, type OrderItemForKitchen } from '../m03-orders/order.service';
import { CatalogService } from '../m05-catalog/catalog.service';
import { CustomerService } from '../m04-customers/customer.service';

export type TicketStatus = 'queued' | 'in_progress' | 'prepared' | 'blocked';

export class KitchenError extends Error {
  constructor(
    readonly code: 'validation_failed' | 'not_found' | 'allergy_conflict',
    readonly detail?: unknown,
  ) {
    super(code);
  }
}

export interface KitchenBoardTicket {
  id: string;
  fulfillment_day_id: string;
  order_id: string;
  date: string;
  section_id: string | null;
  section_code: string | null;
  section_name_en: string | null;
  unrouted: boolean;
  status: TicketStatus;
  allergy_marker: boolean;
  item_refs: Array<Record<string, unknown>>;
}

export interface TicketActorInput {
  deviceSession?: string;
  nameTap?: string;
}

interface TicketGroup {
  sectionId: string | null;
  sectionCode: string | null;
  unrouted: boolean;
  itemRefs: Array<Record<string, unknown>>;
  allergyMarker: boolean;
}

export class KitchenService {
  constructor(
    private readonly pool: Pool,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly transitions: TransitionEngine,
    private readonly orders: OrderService,
    private readonly catalog: CatalogService,
    private readonly customers: CustomerService,
  ) {
    this.transitions.registerValidator('all_tickets_prepared', async (req, client) => {
      if (req.subjectType !== 'fulfillment_day') return;
      await this.assertAllTicketsPreparedInTx(client, req.subjectId);
    });
  }

  async generateTickets(
    actor: StaffContext | 'system',
    date: string,
    generationBatch = `cutoff:${date}`,
  ): Promise<{ generation_batch: string; days_seen: number; days_queued: number; tickets_created: number; unrouted: number }> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new KitchenError('validation_failed', { field: 'date' });
    const days = await this.orders.fulfillmentDaysForKitchen(date);
    let daysQueued = 0;
    let ticketsCreated = 0;
    let unrouted = 0;

    for (const day of days) {
      const items = await this.orders.orderItemsForKitchen(day.id);
      if (items.length === 0) continue;
      const groups = await this.groupItems(items);
      unrouted += groups.filter((g) => g.unrouted).length;
      const result = await withTransaction(this.pool, async (client) => {
        let created = 0;
        for (const group of groups) {
          const { rows } = await client.query(
            `INSERT INTO kitchen_ticket
              (id, fulfillment_day_id, section_id, unrouted, item_refs, allergy_marker, generation_batch, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [
              newId(), day.id, group.sectionId, group.unrouted, JSON.stringify(group.itemRefs),
              group.allergyMarker, generationBatch, actor === 'system' ? 'system' : actor.staffId,
            ],
          );
          if (rows.length > 0) created += 1;
        }
        if (day.status === 'scheduled') {
          await this.orders.transitionDayInTx(client, 'system', day.id, 'kitchen_queued');
          daysQueued += 1;
        }
        if (created > 0) await this.writeGeneratedEventsInTx(client, actor, day, groups, generationBatch, created);
        return created;
      });
      ticketsCreated += result;
    }
    return { generation_batch: generationBatch, days_seen: days.length, days_queued: daysQueued, tickets_created: ticketsCreated, unrouted };
  }

  async board(filters: { date: string; sectionId?: string; unrouted?: boolean }): Promise<KitchenBoardTicket[]> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(filters.date)) throw new KitchenError('validation_failed', { field: 'date' });
    const clauses = ['fd.date = $1'];
    const params: unknown[] = [filters.date];
    if (filters.sectionId) {
      params.push(filters.sectionId);
      clauses.push(`kt.section_id = $${params.length}`);
    }
    if (filters.unrouted) clauses.push('kt.unrouted');
    const { rows } = await this.pool.query(
      `SELECT kt.*, fd.order_id, fd.date, s.code AS section_code, s.name_en AS section_name_en
       FROM kitchen_ticket kt
       JOIN fulfillment_day fd ON fd.id = kt.fulfillment_day_id
       LEFT JOIN section_master s ON s.id = kt.section_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY kt.unrouted DESC, s.code NULLS LAST, kt.created_at`,
      params,
    );
    return rows.map((r) => ({
      id: r.id as string,
      fulfillment_day_id: r.fulfillment_day_id as string,
      order_id: r.order_id as string,
      date: this.dateString(r.date),
      section_id: r.section_id as string | null,
      section_code: r.section_code as string | null,
      section_name_en: r.section_name_en as string | null,
      unrouted: r.unrouted as boolean,
      status: r.status as TicketStatus,
      allergy_marker: r.allergy_marker as boolean,
      item_refs: (r.item_refs as Array<Record<string, unknown>> | null) ?? [],
    }));
  }

  async transitionTicket(
    actor: StaffContext,
    ticketId: string,
    to: TicketStatus,
    actorInput: TicketActorInput,
    reason?: { code: string; note?: string },
  ): Promise<void> {
    if (!['in_progress', 'prepared', 'blocked'].includes(to)) throw new KitchenError('validation_failed', { field: 'to' });
    await withTransaction(this.pool, async (client) => {
      const ticket = await this.loadTicketInTx(client, ticketId, true);
      const reasonId = to === 'blocked' ? await this.reasonCodeId('ticket_block', reason?.code) : null;
      await this.transitions.transitionInTx({
        machine: 'ticket',
        subjectType: 'kitchen_ticket',
        subjectId: ticketId,
        from: ticket.status,
        to,
        actor,
        reason,
        eventType: 'kitchen.ticket_status_changed',
        refs: { ticket_id: ticketId, fulfillment_day_id: ticket.fulfillment_day_id },
        apply: async (tx) => {
          await tx.query(
            `UPDATE kitchen_ticket SET status = $2, blocked_reason_id = $3,
             updated_at = now(), updated_by = $4, version = version + 1 WHERE id = $1`,
            [ticketId, to, reasonId, actor.staffId],
          );
          await tx.query(
            `INSERT INTO ticket_status_event (id, ticket_id, from_status, to_status, actor, reason_code_id)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [newId(), ticketId, ticket.status, to, JSON.stringify(this.ticketActor(actor, actorInput)), reasonId],
          );
        },
      }, client);
      await this.rollupDayInTx(client, actor, ticket.fulfillment_day_id, to);
    });
  }

  async confirmPacked(actor: StaffContext, dayId: string): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      await this.assertAllTicketsPreparedInTx(client, dayId);
      await this.orders.transitionDayInTx(client, actor, dayId, 'packed');
    });
  }

  async raiseEscalation(
    actor: StaffContext,
    ticketId: string,
    input: { typeCode?: string; proposedSubstituteId?: string; notes?: string },
  ): Promise<string> {
    const ticket = await this.ticketForRead(ticketId);
    const day = await this.orders.dayForKitchen(ticket.fulfillment_day_id);
    if (input.proposedSubstituteId) await this.assertSubstituteSafe(day.customerId, input.proposedSubstituteId);
    const code = input.typeCode ?? 'other';
    const typeId = await this.reasonCodeId('escalation', code);
    const id = newId();
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO escalation (id, ticket_id, type_code_id, proposed_substitute_id, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, ticketId, typeId, input.proposedSubstituteId ?? null, input.notes ?? null, actor.staffId],
      );
      await this.audit.writeInTx(client, {
        eventType: 'kitchen.escalation_raised',
        actor: this.auditActor(actor),
        entityType: 'escalation',
        entityId: id,
        severity: 'high',
        relatedRefs: { ticket_id: ticketId, fulfillment_day_id: day.id, order_id: day.orderId },
        after: { type_code: code, proposed_substitute_id: input.proposedSubstituteId ?? null },
      });
      await this.outbox.writeInTx(client, {
        eventType: 'kitchen.escalation_raised',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        refs: { ticket_id: ticketId, fulfillment_day_id: day.id, order_id: day.orderId },
        payload: { type: code, proposed_substitute_id: input.proposedSubstituteId ?? null },
      });
    });
    return id;
  }

  async resolveEscalation(actor: StaffContext, escalationId: string): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const { rows } = await client.query(
        `SELECT e.state, e.ticket_id, kt.fulfillment_day_id
         FROM escalation e JOIN kitchen_ticket kt ON kt.id = e.ticket_id
         WHERE e.id = $1 FOR UPDATE`,
        [escalationId],
      );
      if (rows.length === 0) throw new KitchenError('not_found');
      if (rows[0].state !== 'open') throw new KitchenError('validation_failed', { state: rows[0].state });
      const day = await this.orders.dayForKitchen(rows[0].fulfillment_day_id as string);
      await client.query(
        `UPDATE escalation SET state = 'resolved', resolved_by = $2, resolved_at = now(),
         updated_at = now(), updated_by = $2, version = version + 1 WHERE id = $1`,
        [escalationId, actor.staffId],
      );
      await this.audit.writeInTx(client, {
        eventType: 'kitchen.escalation_resolved',
        actor: this.auditActor(actor),
        entityType: 'escalation',
        entityId: escalationId,
        severity: 'info',
        relatedRefs: { ticket_id: rows[0].ticket_id as string, fulfillment_day_id: day.id, order_id: day.orderId },
        after: { state: 'resolved' },
      });
      await this.outbox.writeInTx(client, {
        eventType: 'kitchen.escalation_resolved',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        refs: { ticket_id: rows[0].ticket_id as string, fulfillment_day_id: day.id, order_id: day.orderId },
        payload: { state: 'resolved' },
      });
    });
  }

  private async groupItems(items: OrderItemForKitchen[]): Promise<TicketGroup[]> {
    const groups = new Map<string, TicketGroup>();
    for (const item of items) {
      const route = item.productId ? await this.catalog.routingForKitchenProduct(item.productId) : null;
      const key = route?.sectionId ?? 'unrouted';
      const group = groups.get(key) ?? {
        sectionId: route?.sectionId ?? null,
        sectionCode: route?.sectionCode ?? null,
        unrouted: !route,
        itemRefs: [],
        allergyMarker: false,
      };
      group.itemRefs.push({
        order_item_id: item.id,
        product_id: item.productId,
        name_en: item.nameEn,
        qty: item.qty,
        allergen_count: item.allergensFrozen.length,
      });
      if (item.allergensFrozen.length > 0) group.allergyMarker = true;
      groups.set(key, group);
    }
    return [...groups.values()];
  }

  private async writeGeneratedEventsInTx(
    client: PoolClient,
    actor: StaffContext | 'system',
    day: FulfillmentDayForKitchen,
    groups: TicketGroup[],
    generationBatch: string,
    created: number,
  ): Promise<void> {
    const perSection = groups.reduce<Record<string, number>>((acc, group) => {
      const key = group.sectionCode ?? 'unrouted';
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    const unroutedCount = groups.filter((g) => g.unrouted).length;
    await this.audit.writeInTx(client, {
      eventType: 'kitchen.ticket_generated',
      actor: actor === 'system' ? 'system' : this.auditActor(actor),
      entityType: 'fulfillment_day',
      entityId: day.id,
      severity: unroutedCount > 0 ? 'warn' : 'info',
      relatedRefs: { fulfillment_day_id: day.id, order_id: day.orderId },
      after: { generation_batch: generationBatch, created, per_section: perSection, unrouted: unroutedCount },
    });
    await this.outbox.writeInTx(client, {
      eventType: 'kitchen.ticket_generated',
      actor: actor === 'system' ? { system: 'kitchen-generator' } : { id: actor.staffId, role: actor.roles[0] ?? 'none' },
      refs: { fulfillment_day_id: day.id, order_id: day.orderId },
      payload: { generation_batch: generationBatch, date: day.date, per_section: perSection, unrouted: unroutedCount },
    });
  }

  private async rollupDayInTx(client: PoolClient, actor: StaffContext, dayId: string, ticketTo: TicketStatus): Promise<void> {
    const day = await this.orders.dayForKitchen(dayId);
    if (ticketTo === 'in_progress' && day.status === 'kitchen_queued') {
      await this.orders.transitionDayInTx(client, actor, dayId, 'in_preparation');
      return;
    }
    if (ticketTo === 'prepared' && day.status === 'in_preparation' && await this.allTicketsPreparedInTx(client, dayId)) {
      await this.orders.transitionDayInTx(client, actor, dayId, 'ready_to_pack');
    }
  }

  private async assertAllTicketsPreparedInTx(client: PoolClient, dayId: string): Promise<void> {
    if (!await this.allTicketsPreparedInTx(client, dayId)) {
      throw new KitchenError('validation_failed', { field: 'ticket_status' });
    }
  }

  private async allTicketsPreparedInTx(client: PoolClient, dayId: string): Promise<boolean> {
    const count = await client.query(
      `SELECT count(*)::int AS n FROM kitchen_ticket WHERE fulfillment_day_id = $1`,
      [dayId],
    );
    if ((count.rows[0]?.n as number | undefined) === 0) return false;
    const { rows } = await client.query(
      `SELECT 1 FROM kitchen_ticket
       WHERE fulfillment_day_id = $1 AND status != 'prepared' LIMIT 1`,
      [dayId],
    );
    return rows.length === 0;
  }

  private async assertSubstituteSafe(customerId: string, productId: string): Promise<void> {
    if (!(await this.catalog.productExists(productId))) throw new KitchenError('not_found', { field: 'proposed_substitute_id' });
    const [allergens, allergies] = await Promise.all([
      this.catalog.resolveAllergens(productId),
      this.customers.allergiesForIntake(customerId),
    ]);
    const customerAllergenIds = new Set(allergies.map((a) => a.allergenId));
    const conflicts = allergens.filter((a) => customerAllergenIds.has(a.allergenId));
    if (conflicts.length > 0) throw new KitchenError('allergy_conflict', { conflicts });
  }

  private async loadTicketInTx(client: PoolClient, ticketId: string, lock: boolean): Promise<{ id: string; fulfillment_day_id: string; status: TicketStatus }> {
    const { rows } = await client.query(
      `SELECT id, fulfillment_day_id, status FROM kitchen_ticket WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
      [ticketId],
    );
    if (rows.length === 0) throw new KitchenError('not_found');
    return {
      id: rows[0].id as string,
      fulfillment_day_id: rows[0].fulfillment_day_id as string,
      status: rows[0].status as TicketStatus,
    };
  }

  private async ticketForRead(ticketId: string): Promise<{ id: string; fulfillment_day_id: string; status: TicketStatus }> {
    return withTransaction(this.pool, (client) => this.loadTicketInTx(client, ticketId, false));
  }

  private async reasonCodeId(domain: 'ticket_block' | 'escalation', code?: string): Promise<string> {
    if (!code) throw new KitchenError('validation_failed', { field: 'reason_code' });
    const { rows } = await this.pool.query(
      `SELECT id FROM reason_code WHERE domain = $1 AND code = $2 AND active`,
      [domain, code],
    );
    if (rows.length === 0) throw new KitchenError('validation_failed', { field: 'reason_code' });
    return rows[0].id as string;
  }

  private ticketActor(actor: StaffContext, input: TicketActorInput): Record<string, string> {
    return {
      staff_id: actor.staffId,
      role: actor.roles[0] ?? 'none',
      device_session: input.deviceSession ?? actor.sessionId,
      name_tap: input.nameTap ?? actor.name,
    };
  }

  private auditActor(actor: StaffContext): { id: string; role: string } {
    return { id: actor.staffId, role: actor.roles[0] ?? 'none' };
  }

  private dateString(value: unknown): string {
    if (value instanceof Date) {
      const y = value.getFullYear();
      const m = String(value.getMonth() + 1).padStart(2, '0');
      const d = String(value.getDate()).padStart(2, '0');
      return `${y}-${m}-${d}`;
    }
    return String(value).slice(0, 10);
  }
}
