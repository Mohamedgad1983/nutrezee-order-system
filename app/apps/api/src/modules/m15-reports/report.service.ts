import type { Pool } from 'pg';
import { withTransaction } from '../../platform/db/tx';
import { AuditService } from '../../platform/audit/audit.service';
import type { DomainEvent } from '../../platform/outbox/outbox.service';
import type { StaffContext } from '../../platform/auth/session.service';

export type ReportName = 'intake-funnel' | 'daily-ops' | 'kitchen-day-list';

export class ReportError extends Error {
  constructor(readonly code: 'validation_failed') {
    super(code);
  }
}

export interface ProjectionSnapshot {
  intake_funnel: {
    drafts_created: number;
    submitted: number;
    returned: number;
    approved: number;
    rejected: number;
    by_channel: Record<string, number>;
  };
  daily_ops: {
    orders_approved: number;
    orders_cancelled: number;
    payment_paid: number;
    payment_failed: number;
    fulfillment_by_status: Record<string, number>;
  };
  kitchen_day_list: {
    by_date: Record<string, {
      tickets_generated: number;
      unrouted: number;
      per_section: Record<string, number>;
      ready_to_pack: number;
      packed: number;
    }>;
  };
}

interface ProjectionEvent extends DomainEvent {
  occurredAt: string;
}

export class ReportProjectionBuilder {
  private readonly draftCreated = new Set<string>();
  private readonly submitted = new Set<string>();
  private readonly returned = new Set<string>();
  private readonly approvedDrafts = new Set<string>();
  private readonly rejected = new Set<string>();
  private readonly approvedOrders = new Set<string>();
  private readonly cancelledOrders = new Set<string>();
  private paymentPaid = 0;
  private paymentFailed = 0;
  private readonly byChannel: Record<string, number> = {};
  private readonly fulfillmentByStatus: Record<string, number> = {};
  private readonly kitchenByDate: ProjectionSnapshot['kitchen_day_list']['by_date'] = {};

  apply(event: ProjectionEvent): void {
    const draftRef = event.refs.draft ?? event.refs.draft_id ?? stringPayload(event.payload.draft_id);
    const orderRef = event.refs.order_id ?? stringPayload(event.payload.order_id);
    switch (event.eventType) {
      case 'order.draft_created':
        if (draftRef) this.draftCreated.add(draftRef);
        this.increment(this.byChannel, String(event.payload.channel ?? 'unknown'));
        break;
      case 'order.submitted':
        if (draftRef) this.submitted.add(draftRef);
        break;
      case 'order.returned':
        if (draftRef) this.returned.add(draftRef);
        break;
      case 'order.rejected':
        if (draftRef) this.rejected.add(draftRef);
        break;
      case 'order.approved':
        if (draftRef) this.approvedDrafts.add(draftRef);
        if (orderRef) this.approvedOrders.add(orderRef);
        break;
      case 'order.cancelled':
        if (orderRef) this.cancelledOrders.add(orderRef);
        break;
      case 'fulfillment.status_changed':
        if (typeof event.payload.to === 'string') {
          this.increment(this.fulfillmentByStatus, event.payload.to);
          this.applyKitchenStatus(event);
        }
        break;
      case 'kitchen.ticket_generated':
        this.applyTicketGenerated(event);
        break;
      case 'payment.status_changed':
        if (event.payload.to === 'paid' || event.payload.to === 'collected') this.paymentPaid += 1;
        if (event.payload.to === 'failed') this.paymentFailed += 1;
        break;
      default:
        break;
    }
  }

  snapshot(): ProjectionSnapshot {
    return {
      intake_funnel: {
        drafts_created: this.draftCreated.size,
        submitted: this.submitted.size,
        returned: this.returned.size,
        approved: this.approvedDrafts.size,
        rejected: this.rejected.size,
        by_channel: this.sortedRecord(this.byChannel),
      },
      daily_ops: {
        orders_approved: this.approvedOrders.size,
        orders_cancelled: this.cancelledOrders.size,
        payment_paid: this.paymentPaid,
        payment_failed: this.paymentFailed,
        fulfillment_by_status: this.sortedRecord(this.fulfillmentByStatus),
      },
      kitchen_day_list: {
        by_date: Object.fromEntries(Object.entries(this.kitchenByDate).sort(([a], [b]) => a.localeCompare(b))),
      },
    };
  }

  private applyTicketGenerated(event: ProjectionEvent): void {
    const date = String(event.payload.date ?? event.occurredAt.slice(0, 10));
    const row = this.kitchenRow(date);
    const perSection = event.payload.per_section as Record<string, number> | undefined;
    for (const [section, count] of Object.entries(perSection ?? {})) {
      row.per_section[section] = (row.per_section[section] ?? 0) + Number(count);
      row.tickets_generated += Number(count);
    }
    row.unrouted += Number(event.payload.unrouted ?? 0);
    row.per_section = this.sortedRecord(row.per_section);
  }

  private applyKitchenStatus(event: ProjectionEvent): void {
    const date = String(event.payload.date ?? event.occurredAt.slice(0, 10));
    const row = this.kitchenRow(date);
    if (event.payload.to === 'ready_to_pack') row.ready_to_pack += 1;
    if (event.payload.to === 'packed') row.packed += 1;
  }

  private kitchenRow(date: string): ProjectionSnapshot['kitchen_day_list']['by_date'][string] {
    this.kitchenByDate[date] ??= {
      tickets_generated: 0,
      unrouted: 0,
      per_section: {},
      ready_to_pack: 0,
      packed: 0,
    };
    return this.kitchenByDate[date];
  }

  private increment(record: Record<string, number>, key: string): void {
    record[key] = (record[key] ?? 0) + 1;
  }

  private sortedRecord(record: Record<string, number>): Record<string, number> {
    return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
  }
}

function stringPayload(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export class ReportService {
  constructor(
    private readonly pool: Pool,
    private readonly audit: AuditService,
  ) {}

  async report(name: ReportName, filters: { date?: string } = {}): Promise<unknown> {
    const snapshot = await this.rebuildFromOutbox();
    switch (name) {
      case 'intake-funnel':
        return snapshot.intake_funnel;
      case 'daily-ops':
        return snapshot.daily_ops;
      case 'kitchen-day-list':
        if (filters.date) return snapshot.kitchen_day_list.by_date[filters.date] ?? this.emptyKitchenDay();
        return snapshot.kitchen_day_list;
      default:
        throw new ReportError('validation_failed');
    }
  }

  async exportReport(actor: StaffContext, name: ReportName, filters: { date?: string } = {}): Promise<{
    report: ReportName;
    format: 'json';
    generated_at: string;
    data: unknown;
  }> {
    const data = await this.report(name, filters);
    await withTransaction(this.pool, async (client) => {
      await this.audit.writeInTx(client, {
        eventType: 'data.exported',
        actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
        entityType: 'report',
        entityId: name,
        severity: 'warn',
        after: { filters, format: 'json' },
      });
    });
    return { report: name, format: 'json', generated_at: new Date().toISOString(), data };
  }

  /** Live enterprise overview — real DB aggregates (not the event projection). */
  async overview(): Promise<{
    customers: number; customers_with_order: number; orders: number;
    orders_by_status: Record<string, number>; payments: number; revenue_minor: number;
    addresses: number; areas: number; top_areas: Array<{ name: string; count: number }>;
  }> {
    const { rows: t } = await this.pool.query(
      `SELECT
         (SELECT count(*) FROM customer)::int AS customers,
         (SELECT count(DISTINCT customer_id) FROM customer_order)::int AS customers_with_order,
         (SELECT count(*) FROM customer_order)::int AS orders,
         (SELECT count(*) FROM payment_record)::int AS payments,
         (SELECT coalesce(sum(amount),0) FROM payment_record)::bigint AS revenue_minor,
         (SELECT count(*) FROM address)::int AS addresses,
         (SELECT count(*) FROM area)::int AS areas`,
    );
    const { rows: st } = await this.pool.query("SELECT status, count(*)::int c FROM customer_order GROUP BY status");
    const { rows: areas } = await this.pool.query(
      `SELECT coalesce(a.name_en, a.name_ar, 'unknown') AS name, count(ad.id)::int c
       FROM area a JOIN address ad ON ad.area_id = a.id GROUP BY 1 ORDER BY c DESC LIMIT 6`,
    );
    const orders_by_status: Record<string, number> = {};
    for (const r of st) orders_by_status[r.status as string] = Number(r.c);
    const row = t[0] ?? {};
    return {
      customers: Number(row.customers ?? 0), customers_with_order: Number(row.customers_with_order ?? 0),
      orders: Number(row.orders ?? 0), orders_by_status,
      payments: Number(row.payments ?? 0), revenue_minor: Number(row.revenue_minor ?? 0),
      addresses: Number(row.addresses ?? 0), areas: Number(row.areas ?? 0),
      top_areas: areas.map((r) => ({ name: r.name as string, count: Number(r.c) })),
    };
  }

  async rebuildFromOutbox(): Promise<ProjectionSnapshot> {
    return this.project(await this.events());
  }

  async incrementalFromOutbox(): Promise<ProjectionSnapshot> {
    const builder = new ReportProjectionBuilder();
    for (const event of await this.events()) builder.apply(event);
    return builder.snapshot();
  }

  async rebuildEquality(): Promise<{ equal: boolean; rebuilt: ProjectionSnapshot; incremental: ProjectionSnapshot }> {
    const rebuilt = await this.rebuildFromOutbox();
    const incremental = await this.incrementalFromOutbox();
    return { equal: JSON.stringify(rebuilt) === JSON.stringify(incremental), rebuilt, incremental };
  }

  private project(events: ProjectionEvent[]): ProjectionSnapshot {
    const builder = new ReportProjectionBuilder();
    for (const event of events) builder.apply(event);
    return builder.snapshot();
  }

  private async events(): Promise<ProjectionEvent[]> {
    const { rows } = await this.pool.query(
      `SELECT id, event_type, version, occurred_at, actor, refs, payload
       FROM outbox_event
       ORDER BY occurred_at, id`,
    );
    return rows.map((r) => ({
      eventId: r.id as string,
      eventType: r.event_type as string,
      version: Number(r.version),
      occurredAt: new Date(r.occurred_at as Date).toISOString(),
      actor: r.actor as DomainEvent['actor'],
      refs: r.refs as Record<string, string>,
      payload: r.payload as Record<string, unknown>,
    }));
  }

  private emptyKitchenDay(): ProjectionSnapshot['kitchen_day_list']['by_date'][string] {
    return { tickets_generated: 0, unrouted: 0, per_section: {}, ready_to_pack: 0, packed: 0 };
  }
}
