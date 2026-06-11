import {
  BadRequestException, Body, ConflictException, Controller, Get, HttpCode,
  NotFoundException, Param, Post, Query, Req, UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ReviewError, ReviewService, type ReviewDecision, type ReviewQueueRecord, type ReviewQueueState } from './review.service';
import { AuthError, SessionService, type StaffContext } from '../../platform/auth/session.service';
import { AccessService, type VisibilityClass } from '../../platform/rbac/access.service';
import { requirePermission } from '../../platform/rbac/permission.util';
import { TransitionError } from '../../platform/transition/transition-engine';
import { MASK_SENTINEL } from '../../platform/masking/masking';

const COOKIE = 'nz_session';

@Controller()
export class ReviewController {
  constructor(
    private readonly sessions: SessionService,
    private readonly access: AccessService,
    private readonly review: ReviewService,
  ) {}

  @Get('review-queue')
  async list(
    @Req() req: Request,
    @Query('state') state?: ReviewQueueState,
    @Query('late') late?: string,
  ) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'review.queue.read');
    const grants = await this.access.visibilityGrants(ctx.roles);
    const items = (await this.review.listQueue(ctx, { state, onlyLate: late === 'true' }))
      .map((item) => this.maskQueueRecord(item, grants));
    return { items, page: { limit: 100 } };
  }

  // api_standards rule 4: allergy-conflict warning detail is HEALTH data.
  private maskQueueRecord(item: ReviewQueueRecord, grants: Set<VisibilityClass>): ReviewQueueRecord & { masked: boolean } {
    if (grants.has('health')) return { ...item, masked: false };
    let masked = false;
    const warnings = item.warnings.map((w) => {
      if (w.field !== 'allergy_conflicts' || w.detail === undefined) return w;
      masked = true;
      return { ...w, detail: MASK_SENTINEL };
    });
    return { ...item, warnings, masked };
  }

  @Post('review-queue/:draftId/claim')
  @HttpCode(200)
  async claim(@Req() req: Request, @Param('draftId') draftId: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'review.claim');
    return this.wrap(async () => {
      await this.review.claim(ctx, draftId);
      return { ok: true };
    });
  }

  @Post('review-queue/sync')
  @HttpCode(200)
  async sync(@Req() req: Request) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'review.claim');
    return { queued: await this.review.syncSubmittedDrafts(ctx) };
  }

  @Post('review-queue/sla-alerts')
  @HttpCode(200)
  async fireSlaAlerts(@Req() req: Request) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'review.queue.read');
    return { alerted: await this.review.fireSlaAlerts(ctx) };
  }

  @Post('drafts/:id/decisions')
  @HttpCode(200)
  async decide(
    @Req() req: Request,
    @Param('id') draftId: string,
    @Body() body: DecisionBody,
  ) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'review.decide');
    return this.wrap(async () => {
      await this.review.decide(ctx, draftId, {
        decision: body.decision as ReviewDecision,
        reasonCode: body.reason_code,
        note: body.note,
        warningsOverridden: body.warnings_overridden?.map((o) => ({ field: o.field, reason: o.reason })),
      });
      return { ok: true };
    });
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
      if (e instanceof ReviewError) {
        if (e.code === 'not_found') throw new NotFoundException({ error_code: e.code, detail: e.detail });
        if (e.code === 'conflict_in_review') throw new ConflictException({ error_code: e.code, detail: e.detail });
        throw new BadRequestException({ error_code: e.code, detail: e.detail });
      }
      if (e instanceof TransitionError) throw new BadRequestException({ error_code: e.code, detail: e.detail });
      throw e;
    }
  }
}

interface DecisionBody {
  decision?: string;
  reason_code?: string;
  note?: string;
  warnings_overridden?: Array<{ field: string; reason: string }>;
}
