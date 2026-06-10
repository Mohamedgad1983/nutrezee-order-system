import { BadRequestException } from '@nestjs/common';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { PaymentController } from '../../apps/api/src/modules/m07-payments/payment.controller';
import { PaymentError, type PaymentService } from '../../apps/api/src/modules/m07-payments/payment.service';
import type { SessionService, StaffContext } from '../../apps/api/src/platform/auth/session.service';
import type { AccessService } from '../../apps/api/src/platform/rbac/access.service';

const financeCtx: StaffContext = {
  staffId: 'finance-c', name: 'Finance C', email: 'finance-c@t', locale: 'en', roles: ['finance'], sessionId: 's-finance',
};
const agentCtx: StaffContext = {
  staffId: 'agent-c', name: 'Agent C', email: 'agent-c@t', locale: 'en', roles: ['order_agent'], sessionId: 's-agent',
};
const req = { cookies: { nz_session: 'session-1' } } as unknown as Request;

function controllerWith(payments: Partial<PaymentService>, ctx: StaffContext = financeCtx) {
  const sessions = { validate: vi.fn().mockResolvedValue(ctx) } as unknown as SessionService;
  const access = {
    decide: vi.fn().mockResolvedValue({ allowed: true, enforced: false, mode: 'log' }),
  } as unknown as AccessService;
  return { controller: new PaymentController(sessions, access, payments as PaymentService), access };
}

describe('TS-C API contract — payments controller (WP-11)', () => {
  it('reads full payment state for finance and masked state for order agents', async () => {
    const paymentForOrder = vi.fn().mockResolvedValue({ id: 'pay-1', status: 'paid', masked: false });
    const finance = controllerWith({ paymentForOrder }, financeCtx);
    await expect(finance.controller.getForOrder(req, 'order-1'))
      .resolves.toEqual({ payment: { id: 'pay-1', status: 'paid', masked: false } });
    expect(paymentForOrder).toHaveBeenCalledWith('order-1', true);

    const agent = controllerWith({ paymentForOrder }, agentCtx);
    await agent.controller.getForOrder(req, 'order-1');
    expect(paymentForOrder).toHaveBeenLastCalledWith('order-1', false);
  });

  it('records link-sent and queues status requests under order payment routes', async () => {
    const recordLinkSent = vi.fn().mockResolvedValue({ id: 'pay-1', status: 'link_sent' });
    const requestStatusChange = vi.fn().mockResolvedValue({ id: 'review-1', payment_id: 'pay-1' });
    const { controller } = controllerWith({ recordLinkSent, requestStatusChange });

    await expect(controller.recordLinkSent(req, 'order-1', { link_ref: 'link-1', method: 'online_link' }))
      .resolves.toEqual({ id: 'pay-1', status: 'link_sent' });
    await expect(controller.requestStatus(req, 'order-1', { requested_status: 'paid', evidence_note: 'receipt' }))
      .resolves.toEqual({ id: 'review-1', payment_id: 'pay-1' });

    expect(recordLinkSent).toHaveBeenCalledWith(financeCtx, 'order-1', { linkRef: 'link-1', method: 'online_link' });
    expect(requestStatusChange).toHaveBeenCalledWith(financeCtx, 'order-1', {
      requestedStatus: 'paid',
      evidenceNote: 'receipt',
      method: undefined,
    });
  });

  it('lists review queue and decides finance reviews', async () => {
    const listReviewQueue = vi.fn().mockResolvedValue([{ id: 'review-1' }]);
    const decideReview = vi.fn().mockResolvedValue(undefined);
    const { controller } = controllerWith({ listReviewQueue, decideReview });

    await expect(controller.reviewQueue(req, 'waiting')).resolves.toEqual({ items: [{ id: 'review-1' }], page: { limit: 100 } });
    await expect(controller.decideReview(req, 'review-1', {
      decision: 'approve',
      evidence_note: 'matched',
      transaction_ref: 'TX-1',
      reason_code: 'other',
    })).resolves.toEqual({ ok: true });

    expect(listReviewQueue).toHaveBeenCalledWith('waiting');
    expect(decideReview).toHaveBeenCalledWith(financeCtx, 'review-1', {
      decision: 'approve',
      evidenceNote: 'matched',
      transactionRef: 'TX-1',
      reasonCode: 'other',
      note: undefined,
    });
  });

  it('returns not_enabled for refund stubs', async () => {
    const requestRefund = vi.fn().mockRejectedValue(new PaymentError('not_enabled', { feature: 'refunds_enabled' }));
    const decideRefund = vi.fn().mockRejectedValue(new PaymentError('not_enabled', { feature: 'refunds_enabled' }));
    const { controller } = controllerWith({ requestRefund, decideRefund });

    await expect(controller.requestRefund(req)).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.decideRefund(req)).rejects.toBeInstanceOf(BadRequestException);
  });
});
