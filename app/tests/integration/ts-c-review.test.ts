import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { ReviewController } from '../../apps/api/src/modules/m02-review/review.controller';
import type { ReviewService } from '../../apps/api/src/modules/m02-review/review.service';
import type { SessionService, StaffContext } from '../../apps/api/src/platform/auth/session.service';
import type { AccessService } from '../../apps/api/src/platform/rbac/access.service';

const ctx: StaffContext = {
  staffId: 'ops-1', name: 'Ops', email: 'ops@t', locale: 'en', roles: ['ops_manager'], sessionId: 's',
};

function controllerWith(review: Partial<ReviewService>) {
  const sessions = { validate: vi.fn().mockResolvedValue(ctx) } as unknown as SessionService;
  const access = {
    decide: vi.fn().mockResolvedValue({ allowed: true, enforced: false, mode: 'log' }),
    visibilityGrants: vi.fn().mockResolvedValue(new Set(['pii', 'health', 'payment'])),
  } as unknown as AccessService;
  return new ReviewController(sessions, access, review as ReviewService);
}

const req = { cookies: { nz_session: 'session-1' } } as unknown as Request;

describe('TS-C API contract — review controller (WP-08)', () => {
  it('maps review queue filters to the M02 service contract', async () => {
    const listQueue = vi.fn().mockResolvedValue([{ id: 'queue-1' }]);
    const c = controllerWith({ listQueue });
    await expect(c.list(req, 'waiting', 'true')).resolves.toEqual({ items: [{ id: 'queue-1', masked: false }], page: { limit: 100 } });
    expect(listQueue).toHaveBeenCalledWith(ctx, { state: 'waiting', onlyLate: true });
  });

  it('claims a review queue item with POST', async () => {
    const claim = vi.fn().mockResolvedValue(undefined);
    const c = controllerWith({ claim });
    await expect(c.claim(req, 'draft-1')).resolves.toEqual({ ok: true });
    expect(claim).toHaveBeenCalledWith(ctx, 'draft-1');
  });

  it('syncs submitted drafts into the queue with POST', async () => {
    const syncSubmittedDrafts = vi.fn().mockResolvedValue(['draft-1']);
    const c = controllerWith({ syncSubmittedDrafts });
    await expect(c.sync(req)).resolves.toEqual({ queued: ['draft-1'] });
    expect(syncSubmittedDrafts).toHaveBeenCalledWith(ctx);
  });

  it('maps decision request fields to the M02 service contract', async () => {
    const decide = vi.fn().mockResolvedValue(undefined);
    const c = controllerWith({ decide });
    await expect(c.decide(req, 'draft-1', {
      decision: 'approve',
      warnings_overridden: [{ field: 'allergy_conflicts', reason: 'confirmed' }],
      note: 'approved by phone',
    })).resolves.toEqual({ ok: true });
    expect(decide).toHaveBeenCalledWith(ctx, 'draft-1', {
      decision: 'approve',
      reasonCode: undefined,
      note: 'approved by phone',
      warningsOverridden: [{ field: 'allergy_conflicts', reason: 'confirmed' }],
    });
  });
});
