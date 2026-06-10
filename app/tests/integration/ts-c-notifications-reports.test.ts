import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { NotificationController } from '../../apps/api/src/modules/m11-notifications/notification.controller';
import { NotificationError, type NotificationService } from '../../apps/api/src/modules/m11-notifications/notification.service';
import { ReportController } from '../../apps/api/src/modules/m15-reports/report.controller';
import type { ReportService } from '../../apps/api/src/modules/m15-reports/report.service';
import type { SessionService, StaffContext } from '../../apps/api/src/platform/auth/session.service';
import type { AccessService } from '../../apps/api/src/platform/rbac/access.service';

const ctx: StaffContext = {
  staffId: 'ops-c12', name: 'Ops C12', email: 'ops-c12@t', locale: 'en', roles: ['ops_manager'], sessionId: 's-c12',
};
const req = { cookies: { nz_session: 'session-c12' } } as unknown as Request;

function platform() {
  const sessions = { validate: vi.fn().mockResolvedValue(ctx) } as unknown as SessionService;
  const access = {
    decide: vi.fn().mockResolvedValue({ allowed: true, enforced: false, mode: 'log' }),
  } as unknown as AccessService;
  return { sessions, access };
}

describe('TS-C API contract — notifications and reports (WP-12)', () => {
  it('maps notification template, route, and log endpoints to M11 service calls', async () => {
    const { sessions, access } = platform();
    const notifications = {
      listTemplates: vi.fn().mockResolvedValue([{ code: 'unrouted_items' }]),
      upsertTemplate: vi.fn().mockResolvedValue({ id: 'template-1', version: 2 }),
      routeEvent: vi.fn().mockResolvedValue({ sent: 1, skipped: 0 }),
      logs: vi.fn().mockResolvedValue([{ id: 'log-1' }]),
    } as unknown as NotificationService;
    const c = new NotificationController(sessions, access, notifications);

    await expect(c.templates(req)).resolves.toEqual({ items: [{ code: 'unrouted_items' }], page: { limit: 100 } });
    await expect(c.upsertTemplate(req, {
      code: 'ops_exception',
      channel: 'internal',
      body_en: 'Ops exception',
      body_ar: 'Ops exception',
      active: true,
    })).resolves.toEqual({ id: 'template-1', version: 2 });
    await expect(c.routeEvent(req, { event_id: 'evt-1' })).resolves.toEqual({ sent: 1, skipped: 0 });
    await expect(c.logs(req, '25')).resolves.toEqual({ items: [{ id: 'log-1' }], page: { limit: 25 } });

    expect(notifications.upsertTemplate).toHaveBeenCalledWith(ctx, {
      code: 'ops_exception',
      channel: 'internal',
      bodyEn: 'Ops exception',
      bodyAr: 'Ops exception',
      active: true,
    });
    expect(notifications.routeEvent).toHaveBeenCalledWith('evt-1');
    expect(notifications.logs).toHaveBeenCalledWith(25);
    expect(access.decide).toHaveBeenCalledWith(ctx.roles, 'notification.template.manage', ctx.staffId);
    expect(access.decide).toHaveBeenCalledWith(ctx.roles, 'notification.trigger.run', ctx.staffId);
    expect(access.decide).toHaveBeenCalledWith(ctx.roles, 'notification.log.read', ctx.staffId);
  });

  it('maps M11 service errors without enabling dormant customer channels', async () => {
    const { sessions, access } = platform();
    const notifications = {
      upsertTemplate: vi.fn().mockRejectedValue(new NotificationError('not_enabled', { channel: 'whatsapp' })),
    } as unknown as NotificationService;
    const c = new NotificationController(sessions, access, notifications);

    await expect(c.upsertTemplate(req, {
      code: 'customer_whatsapp',
      channel: 'whatsapp',
      body_en: 'Customer text',
    })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps reports and audited exports to M15 service calls and permissions', async () => {
    const { sessions, access } = platform();
    const reports = {
      report: vi.fn().mockResolvedValue({ submitted: 3 }),
      exportReport: vi.fn().mockResolvedValue({ report: 'daily-ops', format: 'json', generated_at: 'now', data: {} }),
    } as unknown as ReportService;
    const c = new ReportController(sessions, access, reports);

    await expect(c.report(req, 'intake-funnel', undefined))
      .resolves.toEqual({ report: 'intake-funnel', data: { submitted: 3 } });
    await expect(c.export(req, { report: 'daily-ops', date: '2099-05-01' }))
      .resolves.toEqual({ report: 'daily-ops', format: 'json', generated_at: 'now', data: {} });
    await expect(c.report(req, 'unknown' as 'intake-funnel', undefined))
      .rejects.toBeInstanceOf(BadRequestException);

    expect(reports.report).toHaveBeenCalledWith('intake-funnel', { date: undefined });
    expect(reports.exportReport).toHaveBeenCalledWith(ctx, 'daily-ops', { date: '2099-05-01' });
    expect(access.decide).toHaveBeenCalledWith(ctx.roles, 'report.view.intake_funnel', ctx.staffId);
    expect(access.decide).toHaveBeenCalledWith(ctx.roles, 'report.export', ctx.staffId);
    expect(access.decide).toHaveBeenCalledWith(ctx.roles, 'report.view.daily_ops', ctx.staffId);
  });
});
