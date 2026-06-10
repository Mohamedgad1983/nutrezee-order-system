import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { KitchenController } from '../../apps/api/src/modules/m08-kitchen/kitchen.controller';
import type { KitchenService } from '../../apps/api/src/modules/m08-kitchen/kitchen.service';
import type { SessionService, StaffContext } from '../../apps/api/src/platform/auth/session.service';
import type { AccessService } from '../../apps/api/src/platform/rbac/access.service';

const ctx: StaffContext = {
  staffId: 'chef-1', name: 'Chef', email: 'chef@t', locale: 'en', roles: ['kitchen_user'], sessionId: 'tablet-1',
};
const req = { cookies: { nz_session: 'session-1' } } as unknown as Request;

function controllerWith(kitchen: Partial<KitchenService>) {
  const sessions = { validate: vi.fn().mockResolvedValue(ctx) } as unknown as SessionService;
  const access = {
    decide: vi.fn().mockResolvedValue({ allowed: true, enforced: false, mode: 'log' }),
  } as unknown as AccessService;
  return new KitchenController(sessions, access, kitchen as KitchenService);
}

describe('TS-C API contract — kitchen controller (WP-10)', () => {
  it('maps kitchen board filters to the M08 service contract', async () => {
    const board = vi.fn().mockResolvedValue([{ id: 'ticket-1' }]);
    const c = controllerWith({ board });
    await expect(c.board(req, '2099-01-01', 'seed-section-hot', 'true'))
      .resolves.toEqual({ items: [{ id: 'ticket-1' }], page: { limit: 100 } });
    expect(board).toHaveBeenCalledWith({ date: '2099-01-01', sectionId: 'seed-section-hot', unrouted: true });
  });

  it('requires date on generate and board requests', async () => {
    const c = controllerWith({ board: vi.fn(), generateTickets: vi.fn() });
    await expect(c.board(req, undefined, undefined, undefined)).rejects.toBeInstanceOf(BadRequestException);
    await expect(c.generate(req, {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps ticket generation and transitions', async () => {
    const generateTickets = vi.fn().mockResolvedValue({ tickets_created: 2 });
    const transitionTicket = vi.fn().mockResolvedValue(undefined);
    const confirmPacked = vi.fn().mockResolvedValue(undefined);
    const c = controllerWith({ generateTickets, transitionTicket, confirmPacked });

    await expect(c.generate(req, { date: '2099-01-01', generation_batch: 'manual-1' }))
      .resolves.toEqual({ tickets_created: 2 });
    await expect(c.transitionTicket(req, 'ticket-1', {
      to: 'blocked',
      reason_code: 'other',
      note: 'missing item',
      device_session: 'tablet-1',
      name_tap: 'Chef A',
    })).resolves.toEqual({ ok: true });
    await expect(c.confirmPacked(req, 'day-1')).resolves.toEqual({ ok: true });

    expect(generateTickets).toHaveBeenCalledWith(ctx, '2099-01-01', 'manual-1');
    expect(transitionTicket).toHaveBeenCalledWith(ctx, 'ticket-1', 'blocked', {
      deviceSession: 'tablet-1',
      nameTap: 'Chef A',
    }, { code: 'other', note: 'missing item' });
    expect(confirmPacked).toHaveBeenCalledWith(ctx, 'day-1');
  });

  it('maps escalation raise and resolve endpoints', async () => {
    const raiseEscalation = vi.fn().mockResolvedValue('esc-1');
    const resolveEscalation = vi.fn().mockResolvedValue(undefined);
    const c = controllerWith({ raiseEscalation, resolveEscalation });

    await expect(c.raiseEscalation(req, 'ticket-1', {
      type_code: 'other',
      proposed_substitute_id: 'prod-2',
      notes: 'substitute requested',
    })).resolves.toEqual({ id: 'esc-1' });
    await expect(c.resolveEscalation(req, 'esc-1')).resolves.toEqual({ ok: true });

    expect(raiseEscalation).toHaveBeenCalledWith(ctx, 'ticket-1', {
      typeCode: 'other',
      proposedSubstituteId: 'prod-2',
      notes: 'substitute requested',
    });
    expect(resolveEscalation).toHaveBeenCalledWith(ctx, 'esc-1');
  });
});
