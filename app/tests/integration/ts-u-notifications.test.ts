import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { AuditService } from '../../apps/api/src/platform/audit/audit.service';
import { OutboxService } from '../../apps/api/src/platform/outbox/outbox.service';
import { SettingsReader } from '../../apps/api/src/platform/settings/settings-reader';
import type { StaffContext } from '../../apps/api/src/platform/auth/session.service';
import { NotificationService } from '../../apps/api/src/modules/m11-notifications/notification.service';
import { newId } from '../../apps/api/src/platform/ids';

let pool: Pool;
let notifications: NotificationService;

const admin: StaffContext = {
  staffId: 'admin-n11', name: 'Admin N11', email: 'admin-n11@t', locale: 'en', roles: ['admin'], sessionId: 's-admin',
};

beforeAll(async () => {
  pool = await freshDb();
  notifications = new NotificationService(
    pool,
    new AuditService(),
    new OutboxService(),
    new SettingsReader(pool, 0),
  );
}, 60_000);

afterAll(async () => {
  await pool.end();
});

async function insertEvent(eventType: string, payload: Record<string, unknown>, refs: Record<string, string> = {}): Promise<string> {
  const id = newId();
  await pool.query(
    `INSERT INTO outbox_event (id, event_type, actor, refs, payload)
     VALUES ($1,$2,$3,$4,$5)`,
    [id, eventType, JSON.stringify({ system: 'test' }), JSON.stringify(refs), JSON.stringify(payload)],
  );
  return id;
}

describe('TS-U unit — notifications router (WP-12)', () => {
  it('routes configured internal alerts from outbox events and dedupes replays', async () => {
    const sourceEvent = await insertEvent(
      'kitchen.ticket_generated',
      { date: '2099-05-01', per_section: { hot: 2 }, unrouted: 1 },
      { fulfillment_day_id: 'day-n11-1' },
    );

    await expect(notifications.routeEvent(sourceEvent)).resolves.toEqual({ sent: 1, skipped: 0 });
    await expect(notifications.routeEvent(sourceEvent)).resolves.toEqual({ sent: 0, skipped: 1 });

    const logs = await notifications.logs();
    expect(logs.filter((l) => l.source_event_id === sourceEvent)).toHaveLength(1);
    expect(logs.find((l) => l.source_event_id === sourceEvent)).toMatchObject({
      template_code: 'unrouted_items',
      recipient_type: 'staff_role',
      recipient_ref: 'ops_manager',
      channel: 'internal',
      status: 'sent',
    });

    const audit = await pool.query(
      `SELECT count(*)::int AS n FROM audit_event
       WHERE event_type = 'notification.sent' AND related_refs->>'event_id' = $1`,
      [sourceEvent],
    );
    expect(audit.rows[0].n).toBe(1);
  });

  it('uses notification_trigger_map as configurable routing, not hard-coded template selection', async () => {
    await pool.query(
      `UPDATE setting SET value = $1::jsonb WHERE key = 'notification_trigger_map'`,
      [JSON.stringify({
        custom_unrouted: {
          event_type: 'kitchen.ticket_generated',
          template: 'ready_to_pack',
          recipient_type: 'staff_role',
          recipient_ref: 'kitchen_user',
          enabled: true,
        },
      })],
    );
    const sourceEvent = await insertEvent(
      'kitchen.ticket_generated',
      { date: '2099-05-02', per_section: { cold: 1 }, unrouted: 1 },
      { fulfillment_day_id: 'day-n11-2' },
    );

    await expect(notifications.routeEvent(sourceEvent)).resolves.toEqual({ sent: 1, skipped: 0 });
    expect(await notifications.logs()).toContainEqual(expect.objectContaining({
      source_event_id: sourceEvent,
      template_code: 'ready_to_pack',
      recipient_ref: 'kitchen_user',
    }));
  });

  it('versions editable templates and keeps dormant channels behind not_enabled', async () => {
    const created = await notifications.upsertTemplate(admin, {
      code: 'ops_exception',
      channel: 'internal',
      bodyEn: 'Ops exception needs attention',
      bodyAr: 'Ops exception needs attention',
    });
    const updated = await notifications.upsertTemplate(admin, {
      code: 'ops_exception',
      channel: 'email',
      bodyEn: 'Ops exception needs attention now',
      bodyAr: 'Ops exception needs attention now',
    });

    expect(created.version).toBe(1);
    expect(updated).toMatchObject({ id: created.id, version: 2 });
    expect(await notifications.listTemplates()).toContainEqual(expect.objectContaining({
      code: 'ops_exception',
      channel: 'email',
      version: 2,
    }));

    await expect(notifications.upsertTemplate(admin, {
      code: 'customer_whatsapp',
      channel: 'whatsapp',
      bodyEn: 'Customer message',
    })).rejects.toMatchObject({ code: 'not_enabled' });
  });
});
