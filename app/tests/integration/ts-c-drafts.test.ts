import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { DraftController } from '../../apps/api/src/modules/m01-intake/draft.controller';
import type { DraftService } from '../../apps/api/src/modules/m01-intake/draft.service';
import type { SessionService, StaffContext } from '../../apps/api/src/platform/auth/session.service';
import type { AccessService } from '../../apps/api/src/platform/rbac/access.service';

const ctx: StaffContext = {
  staffId: 'agent-1', name: 'Agent', email: 'agent@t', locale: 'en', roles: ['order_agent'], sessionId: 's',
};

function controllerWith(drafts: Partial<DraftService>) {
  const sessions = { validate: vi.fn().mockResolvedValue(ctx) } as unknown as SessionService;
  const access = {
    decide: vi.fn().mockResolvedValue({ allowed: true, enforced: false, mode: 'log' }),
  } as unknown as AccessService;
  return new DraftController(sessions, access, drafts as DraftService);
}

const req = { cookies: { nz_session: 'session-1' } } as unknown as Request;

describe('TS-C API contract — drafts controller (WP-07)', () => {
  it('requires Idempotency-Key on create operations', async () => {
    const c = controllerWith({ createDraft: vi.fn() });
    await expect(c.create(req, undefined, { channel: 'phone' })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('maps create request fields to the M01 service contract', async () => {
    const createDraft = vi.fn().mockResolvedValue({ id: 'draft-1', replay: false });
    const c = controllerWith({ createDraft });
    const result = await c.create(req, 'idem-1', {
      channel: 'whatsapp',
      customer_id: 'cust-1',
      start_date: '2099-01-01',
      expected_payment_method: 'online_link',
      items: [{ product_id: 'prod-1', qty: 2 }],
      whatsapp_ref: { sender_phone: '0500000000', message_at: '2099-01-01T08:00:00Z' },
    });
    expect(result).toEqual({ id: 'draft-1', replay: false });
    expect(createDraft).toHaveBeenCalledWith(ctx, expect.objectContaining({
      channel: 'whatsapp',
      customerId: 'cust-1',
      startDate: '2099-01-01',
      expectedPaymentMethod: 'online_link',
      items: [{ productId: 'prod-1', qty: 2, note: undefined }],
      whatsappRef: { senderPhone: '0500000000', messageAt: '2099-01-01T08:00:00Z', refNote: undefined },
    }), 'idem-1');
  });

  it('uses POST for aging alerts and returns the alert ids', async () => {
    const fireAgingAlerts = vi.fn().mockResolvedValue(['draft-1']);
    const c = controllerWith({ fireAgingAlerts });
    await expect(c.fireAgingAlerts(req)).resolves.toEqual({ alerted: ['draft-1'] });
  });
});
