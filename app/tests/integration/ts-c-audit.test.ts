import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { AuditController } from '../../apps/api/src/platform/audit/audit.controller';
import type { AuditQueryService } from '../../apps/api/src/platform/audit/audit-query.service';
import type { SessionService, StaffContext } from '../../apps/api/src/platform/auth/session.service';
import type { AccessService } from '../../apps/api/src/platform/rbac/access.service';

const ctx: StaffContext = {
  staffId: 'a', name: 'A', email: 'a@t', locale: 'en', roles: ['super_admin'], sessionId: 's',
};
const req = { cookies: { nz_session: 's1' } } as unknown as Request;

function controllerWith(grants: Set<string>, list: ReturnType<typeof vi.fn>) {
  const sessions = { validate: vi.fn().mockResolvedValue(ctx) } as unknown as SessionService;
  const access = {
    decide: vi.fn().mockResolvedValue({ allowed: true, enforced: false, mode: 'log' }),
    visibilityGrants: vi.fn().mockResolvedValue(grants),
  } as unknown as AccessService;
  return new AuditController(sessions, access, { list } as unknown as AuditQueryService);
}

const ROW = {
  id: '1', event_type: 'staff.created', actor_id: 'a', actor_role: 'super_admin',
  entity_type: 'staff_user', entity_id: 'x', severity: 'high', reason: 'bootstrap',
  occurred_at: 't', related_refs: {}, before: null, after: { secret: 'v' },
};

describe('TS-C API contract — audit controller (WP-UI-03c)', () => {
  it('passes filters through and shows before/after to a full-visibility caller', async () => {
    const list = vi.fn().mockResolvedValue([ROW]);
    const c = controllerWith(new Set(['pii', 'health', 'payment']), list);
    const res = await c.list(req, 'staff_user', 'high', undefined, '50', '0');
    expect(list).toHaveBeenCalledWith({ entityType: 'staff_user', severity: 'high', eventType: undefined, limit: 50, offset: 0 });
    expect(res.page).toEqual({ limit: 100 });
    expect(res.items[0]).toMatchObject({ id: '1', after: { secret: 'v' }, masked: false });
  });

  it('masks before/after when the caller lacks full visibility', async () => {
    const list = vi.fn().mockResolvedValue([ROW]);
    const c = controllerWith(new Set(['pii']), list); // missing health + payment
    const res = await c.list(req, undefined, undefined, undefined, undefined, undefined);
    expect(res.items[0].after).toBe('***');
    expect(res.items[0].before).toBeNull(); // was null → stays null
    expect(res.items[0].masked).toBe(true);
  });
});
