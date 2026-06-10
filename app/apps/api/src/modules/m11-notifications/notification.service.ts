import type { Pool, PoolClient } from 'pg';
import { withTransaction } from '../../platform/db/tx';
import { AuditService } from '../../platform/audit/audit.service';
import { OutboxService, type DomainEvent } from '../../platform/outbox/outbox.service';
import { SettingsReader } from '../../platform/settings/settings-reader';
import type { StaffContext } from '../../platform/auth/session.service';
import { newId } from '../../platform/ids';

type RecipientType = 'staff_role' | 'staff_user' | 'customer';
type Channel = 'internal' | 'email' | 'whatsapp' | 'push' | 'sms';

export class NotificationError extends Error {
  constructor(
    readonly code: 'validation_failed' | 'not_found' | 'not_enabled',
    readonly detail?: unknown,
  ) {
    super(code);
  }
}

export interface NotificationTemplateInput {
  code?: string;
  channel?: Channel;
  bodyEn?: string;
  bodyAr?: string;
  active?: boolean;
}

export interface NotificationLogRecord {
  id: string;
  template_code: string;
  template_version: number;
  source_event_id: string | null;
  recipient_type: RecipientType;
  recipient_ref: string;
  channel: Channel;
  status: 'sent' | 'failed';
  at: string;
  payload_summary: Record<string, unknown>;
}

interface TriggerRule {
  event_type: string;
  template: string;
  recipient_type: RecipientType;
  recipient_ref: string;
  enabled?: boolean;
}

interface TemplateRow {
  id: string;
  code: string;
  channel: Channel;
  body_en: string;
  body_ar: string | null;
  version: number;
  active: boolean;
}

const ACTIVE_CHANNELS = new Set<Channel>(['internal', 'email']);

export class NotificationService {
  constructor(
    private readonly pool: Pool,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly settings: SettingsReader,
  ) {}

  async upsertTemplate(actor: StaffContext, input: NotificationTemplateInput): Promise<{ id: string; version: number }> {
    const code = input.code?.trim();
    const bodyEn = input.bodyEn?.trim();
    if (!code) throw new NotificationError('validation_failed', { field: 'code' });
    if (!bodyEn) throw new NotificationError('validation_failed', { field: 'body_en' });
    const channel = input.channel ?? 'internal';
    this.assertActiveChannel(channel);
    return withTransaction(this.pool, async (client) => {
      const existing = await client.query(`SELECT * FROM notification_template WHERE code = $1 FOR UPDATE`, [code]);
      if (existing.rows.length === 0) {
        const id = newId();
        await client.query(
          `INSERT INTO notification_template (id, code, channel, body_en, body_ar, active, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [id, code, channel, bodyEn, input.bodyAr ?? null, input.active ?? true, actor.staffId],
        );
        await this.auditTemplateChange(client, actor, id, code, 1, 'created');
        return { id, version: 1 };
      }
      const row = existing.rows[0] as TemplateRow;
      const nextVersion = row.version + 1;
      await client.query(
        `UPDATE notification_template SET channel = $2, body_en = $3, body_ar = $4,
         active = $5, version = $6, updated_at = now(), updated_by = $7,
         version_row = version_row + 1 WHERE id = $1`,
        [row.id, channel, bodyEn, input.bodyAr ?? null, input.active ?? row.active, nextVersion, actor.staffId],
      );
      await this.auditTemplateChange(client, actor, row.id, row.code, nextVersion, 'updated');
      return { id: row.id, version: nextVersion };
    });
  }

  async listTemplates(): Promise<TemplateRow[]> {
    const { rows } = await this.pool.query(
      `SELECT id, code, channel, body_en, body_ar, version, active
       FROM notification_template ORDER BY code`,
    );
    return rows as TemplateRow[];
  }

  async routeEvent(eventId: string): Promise<{ sent: number; skipped: number }> {
    const event = await this.outboxEvent(eventId);
    const map = await this.settings.get<Record<string, TriggerRule>>('notification_trigger_map', {});
    let sent = 0;
    let skipped = 0;
    for (const [trigger, rule] of Object.entries(map)) {
      if (rule.enabled === false || rule.event_type !== event.eventType) continue;
      if (!this.matchesTrigger(trigger, event)) {
        skipped += 1;
        continue;
      }
      if (await this.logSendForRule(event, rule, trigger)) sent += 1;
      else skipped += 1;
    }
    return { sent, skipped };
  }

  async logs(limit = 100): Promise<NotificationLogRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT nl.*, nt.code AS template_code
       FROM notification_log nl
       JOIN notification_template nt ON nt.id = nl.template_id
       ORDER BY nl.at DESC, nl.id DESC
       LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({
      id: r.id as string,
      template_code: r.template_code as string,
      template_version: Number(r.template_version),
      source_event_id: r.source_event_id as string | null,
      recipient_type: r.recipient_type as RecipientType,
      recipient_ref: r.recipient_ref as string,
      channel: r.channel as Channel,
      status: r.status as 'sent' | 'failed',
      at: new Date(r.at as Date).toISOString(),
      payload_summary: r.payload_summary as Record<string, unknown>,
    }));
  }

  private async auditTemplateChange(
    client: PoolClient,
    actor: StaffContext,
    id: string,
    code: string,
    version: number,
    action: 'created' | 'updated',
  ): Promise<void> {
    await this.audit.writeInTx(client, {
      eventType: 'notification.template_changed',
      actor: { id: actor.staffId, role: actor.roles[0] ?? 'none' },
      entityType: 'notification_template',
      entityId: id,
      severity: 'warn',
      after: { code, version, action },
    });
  }

  private async logSendForRule(event: DomainEvent, rule: TriggerRule, trigger: string): Promise<boolean> {
    if (rule.recipient_type === 'customer') throw new NotificationError('not_enabled', { feature: 'customer_notifications' });
    const template = await this.template(rule.template);
    this.assertActiveChannel(template.channel);
    return withTransaction(this.pool, async (client) => {
      const id = newId();
      try {
        await client.query(
          `INSERT INTO notification_log
            (id, template_id, template_version, source_event_id, recipient_type,
             recipient_ref, channel, status, payload_summary)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'sent',$8)`,
          [
            id, template.id, template.version, event.eventId, rule.recipient_type,
            rule.recipient_ref, template.channel, JSON.stringify({
              trigger,
              event_type: event.eventType,
              refs: event.refs,
              payload: this.summarizePayload(event.payload),
            }),
          ],
        );
      } catch (e) {
        if ((e as { code?: string }).code === '23505') return false;
        throw e;
      }
      await this.audit.writeInTx(client, {
        eventType: 'notification.sent',
        actor: 'system',
        entityType: 'notification_log',
        entityId: id,
        severity: 'info',
        relatedRefs: { event_id: event.eventId },
        after: { template: template.code, version: template.version, recipient_type: rule.recipient_type },
      });
      await this.outbox.writeInTx(client, {
        eventType: 'notification.sent',
        actor: { system: 'notification-router' },
        refs: { notification_log_id: id, source_event_id: event.eventId },
        payload: { template: template.code, version: template.version, channel: template.channel },
      });
      return true;
    });
  }

  private async template(code: string): Promise<TemplateRow> {
    const { rows } = await this.pool.query(
      `SELECT * FROM notification_template WHERE code = $1 AND active`,
      [code],
    );
    if (rows.length === 0) throw new NotificationError('not_found', { template: code });
    return rows[0] as TemplateRow;
  }

  private async outboxEvent(eventId: string): Promise<DomainEvent> {
    const { rows } = await this.pool.query(
      `SELECT id, event_type, version, occurred_at, actor, refs, payload
       FROM outbox_event WHERE id = $1`,
      [eventId],
    );
    if (rows.length === 0) throw new NotificationError('not_found', { event_id: eventId });
    const row = rows[0];
    return {
      eventId: row.id as string,
      eventType: row.event_type as string,
      version: Number(row.version),
      occurredAt: new Date(row.occurred_at as Date).toISOString(),
      actor: row.actor as DomainEvent['actor'],
      refs: row.refs as Record<string, string>,
      payload: row.payload as Record<string, unknown>,
    };
  }

  private matchesTrigger(trigger: string, event: DomainEvent): boolean {
    switch (trigger) {
      case 'unrouted_items':
        return Number(event.payload.unrouted ?? 0) > 0;
      case 'ticket_blocked':
        return event.payload.to === 'blocked';
      case 'ready_to_pack':
        return event.payload.to === 'ready_to_pack';
      case 'payment_failed':
        return event.payload.to === 'failed';
      case 'reconciliation_divergent':
        return event.payload.state === 'divergent';
      default:
        return true;
    }
  }

  private assertActiveChannel(channel: Channel): void {
    if (!ACTIVE_CHANNELS.has(channel)) throw new NotificationError('not_enabled', { channel });
  }

  private summarizePayload(payload: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of ['from', 'to', 'date', 'unrouted', 'state', 'threshold_hours']) {
      if (key in payload) out[key] = payload[key];
    }
    return out;
  }
}
