import {
  BadRequestException, Body, Controller, Get, HttpCode, NotFoundException,
  Param, Post, Query, Req, UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthError, SessionService, type StaffContext } from '../../platform/auth/session.service';
import { AccessService, type VisibilityClass } from '../../platform/rbac/access.service';
import { requirePermission } from '../../platform/rbac/permission.util';
import { TransitionError } from '../../platform/transition/transition-engine';
import { maskFields } from '../../platform/masking/masking';
import { OrderError, OrderService, type OrderRecord, type OrderStatus, type FulfillmentStatus } from './order.service';

const COOKIE = 'nz_session';

@Controller('orders')
export class OrderController {
  constructor(
    private readonly sessions: SessionService,
    private readonly access: AccessService,
    private readonly orders: OrderService,
  ) {}

  @Post()
  @HttpCode(201)
  async createFromDraft(@Req() req: Request, @Body() body: { draft_id?: string }) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'order.create_from_review');
    if (!body.draft_id) throw new BadRequestException({ error_code: 'validation_failed', field: 'draft_id' });
    return this.wrap(() => this.orders.createFromApprovedDraft(ctx, body.draft_id as string));
  }

  @Get()
  async list(@Req() req: Request, @Query('status') status?: OrderStatus) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'order.read');
    const grants = await this.access.visibilityGrants(ctx.roles);
    const items = (await this.orders.listOrders({ status })).map((o) => this.maskOrder(o, grants));
    return { items, page: { limit: 100 } };
  }

  @Get(':id/fulfillment-days')
  async listDays(@Req() req: Request, @Param('id') id: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'fulfillment.read');
    return { items: await this.orders.listDays(id), page: { limit: 100 } };
  }

  @Get(':id')
  async get(@Req() req: Request, @Param('id') id: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'order.read');
    const grants = await this.access.visibilityGrants(ctx.roles);
    return this.wrap(async () => this.maskOrder(await this.orders.getOrder(id), grants));
  }

  // api_standards rule 4: money fields are PAYMENT-class at serialization.
  private maskOrder(order: OrderRecord, grants: Set<VisibilityClass>): OrderRecord & { masked: boolean } {
    const { data, masked } = maskFields(
      order as unknown as Record<string, unknown>,
      { total: 'payment' },
      grants,
    );
    return { ...(data as unknown as OrderRecord), masked };
  }

  @Post(':id/transitions')
  @HttpCode(200)
  async transitionOrder(@Req() req: Request, @Param('id') id: string, @Body() body: TransitionBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'order.transition');
    return this.wrap(async () => {
      await this.orders.transitionOrder(ctx, id, body.to as OrderStatus, this.reason(body));
      return { ok: true };
    });
  }

  @Post('fulfillment-days/:dayId/transitions')
  @HttpCode(200)
  async transitionDay(@Req() req: Request, @Param('dayId') dayId: string, @Body() body: TransitionBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'fulfillment.transition');
    return this.wrap(async () => {
      await this.orders.transitionDay(ctx, dayId, body.to as FulfillmentStatus, this.reason(body));
      return { ok: true };
    });
  }

  @Post(':id/change-requests')
  @HttpCode(201)
  async createChangeRequest(@Req() req: Request, @Param('id') id: string, @Body() body: { diff?: Record<string, unknown> }) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'change_request.create');
    if (!body.diff || Object.keys(body.diff).length === 0) {
      throw new BadRequestException({ error_code: 'validation_failed', field: 'diff' });
    }
    return this.wrap(async () => ({ id: await this.orders.createChangeRequest(ctx, id, body.diff as Record<string, unknown>) }));
  }

  @Post('change-requests/:changeRequestId/decisions')
  @HttpCode(200)
  async decideChangeRequest(
    @Req() req: Request,
    @Param('changeRequestId') changeRequestId: string,
    @Body() body: { decision?: 'approve' | 'reject' },
  ) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'change_request.decide');
    if (body.decision !== 'approve' && body.decision !== 'reject') {
      throw new BadRequestException({ error_code: 'validation_failed', field: 'decision' });
    }
    return this.wrap(async () => {
      await this.orders.decideChangeRequest(ctx, changeRequestId, body.decision === 'approve');
      return { ok: true };
    });
  }

  @Post(':id/exceptions')
  @HttpCode(201)
  async createException(@Req() req: Request, @Param('id') id: string, @Body() body: ExceptionBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'exception.create');
    return this.wrap(async () => ({
      id: await this.orders.createException(ctx, {
        typeCode: body.type_code,
        refs: { ...(body.refs ?? {}), order_id: id },
        severity: body.severity,
        notes: body.notes,
      }),
    }));
  }

  @Post('exceptions/:exceptionId/resolve')
  @HttpCode(200)
  async resolveException(@Req() req: Request, @Param('exceptionId') exceptionId: string, @Body() body: ResolveExceptionBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'exception.resolve');
    return this.wrap(async () => {
      await this.orders.resolveException(ctx, exceptionId, { resolutionCode: body.resolution_code, notes: body.notes });
      return { ok: true };
    });
  }

  private reason(body: TransitionBody): { code: string; note?: string } | undefined {
    return body.reason_code ? { code: body.reason_code, note: body.note } : undefined;
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
      if (e instanceof OrderError) {
        if (e.code === 'not_found') throw new NotFoundException({ error_code: e.code, detail: e.detail });
        throw new BadRequestException({ error_code: e.code, detail: e.detail });
      }
      if (e instanceof TransitionError) throw new BadRequestException({ error_code: e.code, detail: e.detail });
      throw e;
    }
  }
}

interface TransitionBody {
  to?: string;
  reason_code?: string;
  note?: string;
}

interface ExceptionBody {
  type_code?: string;
  refs?: Record<string, string>;
  severity?: 'info' | 'warn' | 'high';
  notes?: string;
}

interface ResolveExceptionBody {
  resolution_code?: string;
  notes?: string;
}
