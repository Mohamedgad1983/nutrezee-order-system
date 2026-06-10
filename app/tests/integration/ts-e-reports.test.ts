import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Pool } from 'pg';
import { freshDb } from '../helpers/db';
import { AuditService } from '../../apps/api/src/platform/audit/audit.service';
import { ReportService } from '../../apps/api/src/modules/m15-reports/report.service';
import type { StaffContext } from '../../apps/api/src/platform/auth/session.service';
import { newId } from '../../apps/api/src/platform/ids';

let pool: Pool;
let reports: ReportService;

const reportUser: StaffContext = {
  staffId: 'reporter-e12', name: 'Reporter E12', email: 'reporter-e12@t', locale: 'en', roles: ['report_viewer'], sessionId: 's-e12',
};

beforeAll(async () => {
  pool = await freshDb();
  reports = new ReportService(pool, new AuditService());
}, 60_000);

afterAll(async () => {
  await pool.end();
});

async function insertEvent(eventType: string, refs: Record<string, string>, payload: Record<string, unknown>): Promise<void> {
  await pool.query(
    `INSERT INTO outbox_event (id, event_type, actor, refs, payload)
     VALUES ($1,$2,$3,$4,$5)`,
    [newId(), eventType, JSON.stringify({ system: 'projection-test' }), JSON.stringify(refs), JSON.stringify(payload)],
  );
}

describe('TS-E event replay — report projection rebuild equality (WP-12)', () => {
  it('rebuilds report projections deterministically from outbox history', async () => {
    await insertEvent('order.draft_created', { draft: 'draft-e12-1' }, { channel: 'whatsapp' });
    await insertEvent('order.submitted', { draft: 'draft-e12-1' }, {});
    await insertEvent('order.approved', { draft_id: 'draft-e12-1', order_id: 'order-e12-1' }, {});
    await insertEvent('payment.status_changed', { payment_id: 'pay-e12-1', order_id: 'order-e12-1' }, { from: 'link_sent', to: 'paid' });
    await insertEvent(
      'kitchen.ticket_generated',
      { fulfillment_day_id: 'day-e12-1', order_id: 'order-e12-1' },
      { date: '2099-06-01', per_section: { hot: 2, cold: 1 }, unrouted: 1 },
    );
    await insertEvent(
      'fulfillment.status_changed',
      { fulfillment_day_id: 'day-e12-1', order_id: 'order-e12-1' },
      { from: 'kitchen_queued', to: 'ready_to_pack', date: '2099-06-01' },
    );

    const equality = await reports.rebuildEquality();
    expect(equality.equal).toBe(true);
    expect(equality.rebuilt).toEqual(equality.incremental);

    await expect(reports.report('intake-funnel')).resolves.toMatchObject({
      drafts_created: 1,
      submitted: 1,
      approved: 1,
      by_channel: { whatsapp: 1 },
    });
    await expect(reports.report('daily-ops')).resolves.toMatchObject({
      orders_approved: 1,
      payment_paid: 1,
      fulfillment_by_status: { ready_to_pack: 1 },
    });
    await expect(reports.report('kitchen-day-list', { date: '2099-06-01' })).resolves.toEqual({
      tickets_generated: 3,
      unrouted: 1,
      per_section: { cold: 1, hot: 2 },
      ready_to_pack: 1,
      packed: 0,
    });
  });

  it('audits report exports without creating report-owned business tables', async () => {
    await reports.exportReport(reportUser, 'daily-ops', { date: '2099-06-01' });

    const audit = await pool.query(
      `SELECT event_type, severity, entity_type, entity_id, after
       FROM audit_event WHERE event_type = 'data.exported'`,
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({
      event_type: 'data.exported',
      severity: 'warn',
      entity_type: 'report',
      entity_id: 'daily-ops',
    });
    expect(audit.rows[0].after).toMatchObject({ filters: { date: '2099-06-01' }, format: 'json' });
  });
});
