import {
  BadRequestException, Body, Controller, Get, HttpCode, NotFoundException,
  Param, Post, Query, Req, UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthError, SessionService, type StaffContext } from '../../platform/auth/session.service';
import { AccessService } from '../../platform/rbac/access.service';
import { requirePermission } from '../../platform/rbac/permission.util';
import { TransitionError } from '../../platform/transition/transition-engine';
import { PaymentError, PaymentService } from './payment.service';

const COOKIE = 'nz_session';

@Controller()
export class PaymentController {
  constructor(
    private readonly sessions: SessionService,
    private readonly access: AccessService,
    private readonly payments: PaymentService,
  ) {}

  @Get('orders/:id/payments')
  async getForOrder(@Req() req: Request, @Param('id') orderId: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'payment.read');
    return this.wrap(async () => ({
      payment: await this.payments.paymentForOrder(orderId, this.canViewSensitivePayment(ctx)),
    }));
  }

  @Post('orders/:id/payments/link-sent')
  @HttpCode(200)
  async recordLinkSent(@Req() req: Request, @Param('id') orderId: string, @Body() body: LinkSentBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'payment.link.record');
    return this.wrap(() => this.payments.recordLinkSent(ctx, orderId, {
      linkRef: body.link_ref,
      method: body.method,
    }));
  }

  @Post('orders/:id/payments/status-requests')
  @HttpCode(201)
  async requestStatus(@Req() req: Request, @Param('id') orderId: string, @Body() body: StatusRequestBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'payment.review.request');
    return this.wrap(() => this.payments.requestStatusChange(ctx, orderId, {
      requestedStatus: body.requested_status,
      evidenceNote: body.evidence_note,
      method: body.method,
    }));
  }

  @Get('payment-reviews')
  async reviewQueue(@Req() req: Request, @Query('state') state?: 'waiting' | 'in_review' | 'decided') {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'payment.review.decide');
    return this.wrap(async () => ({
      items: await this.payments.listReviewQueue(state),
      page: { limit: 100 },
    }));
  }

  @Post('payment-reviews/:id/decisions')
  @HttpCode(200)
  async decideReview(@Req() req: Request, @Param('id') reviewId: string, @Body() body: ReviewDecisionBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'payment.review.decide');
    return this.wrap(async () => {
      await this.payments.decideReview(ctx, reviewId, {
        decision: body.decision,
        evidenceNote: body.evidence_note,
        transactionRef: body.transaction_ref,
        reasonCode: body.reason_code,
        note: body.note,
      });
      return { ok: true };
    });
  }

  @Post('orders/:id/payments/refund-requests')
  @HttpCode(400)
  async requestRefund(@Req() req: Request) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'payment.refund.request');
    return this.wrap(() => this.payments.requestRefund());
  }

  @Post('payment-refunds/:id/decisions')
  @HttpCode(400)
  async decideRefund(@Req() req: Request) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'payment.refund.decide');
    return this.wrap(() => this.payments.decideRefund());
  }

  private canViewSensitivePayment(ctx: StaffContext): boolean {
    return ctx.roles.some((role) => ['finance', 'ops_manager', 'super_admin'].includes(role));
  }

  private async ctx(req: Request): Promise<StaffContext> {
    const sessionId = (req as Request & { cookies?: Record<string, string> }).cookies?.[COOKIE];
    if (!sessionId) throw new UnauthorizedException({ error_code: 'no_session' });
    try {
      return await this.sessions.validate(sessionId);
    } catch (e) {
      if (e instanceof AuthError) throw new UnauthorizedException({ error_code: e.code });
      throw e;
    }
  }

  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof PaymentError) {
        if (e.code === 'not_found') throw new NotFoundException({ error_code: e.code, detail: e.detail });
        throw new BadRequestException({ error_code: e.code, detail: e.detail });
      }
      if (e instanceof TransitionError) throw new BadRequestException({ error_code: e.code, detail: e.detail });
      throw e;
    }
  }
}

interface LinkSentBody {
  link_ref?: string;
  method?: string;
}

interface StatusRequestBody {
  requested_status?: string;
  evidence_note?: string;
  method?: string;
}

interface ReviewDecisionBody {
  decision?: 'approve' | 'reject';
  evidence_note?: string;
  transaction_ref?: string;
  reason_code?: string;
  note?: string;
}
