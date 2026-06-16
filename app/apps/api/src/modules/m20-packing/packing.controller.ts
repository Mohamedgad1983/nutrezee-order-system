import {
  BadRequestException, Body, Controller, Get, HttpCode, NotFoundException,
  Param, Post, Query, Req, UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthError, SessionService, type StaffContext } from '../../platform/auth/session.service';
import { AccessService } from '../../platform/rbac/access.service';
import { requirePermission } from '../../platform/rbac/permission.util';
import { maskFields } from '../../platform/masking/masking';
import { PackingError, PackingService } from './packing.service';

const COOKIE = 'nz_session';

@Controller('packing')
export class PackingController {
  constructor(
    private readonly sessions: SessionService,
    private readonly access: AccessService,
    private readonly packing: PackingService,
  ) {}

  @Get('batches')
  async listBatches(@Req() req: Request, @Query('date') date?: string, @Query('status') status?: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'packing.batch.read');
    return this.wrap(async () => ({ items: await this.packing.listBatches({ date, status }), page: { limit: 200 } }));
  }

  @Post('batches')
  @HttpCode(201)
  async createBatch(@Req() req: Request, @Body() body: CreateBatchBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'packing.batch.create');
    if (!body?.delivery_date) throw new BadRequestException({ error_code: 'validation_failed', field: 'delivery_date' });
    return this.wrap(() => this.packing.createBatch(ctx, {
      kitchen_id: body.kitchen_id, branch_id: body.branch_id,
      delivery_date: body.delivery_date, delivery_time: body.delivery_time, area: body.area,
    }));
  }

  @Get('batches/:id')
  async getBatch(@Req() req: Request, @Param('id') id: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'packing.batch.read');
    const grants = await this.access.visibilityGrants(ctx.roles);
    return this.wrap(async () => {
      const { batch, orders } = await this.packing.getBatch(id);
      const masked = orders.map((o) => maskFields(o as unknown as Record<string, unknown>, { customer_name: 'pii' }, grants));
      return { batch, orders: masked.map((m) => ({ ...m.data, masked: m.masked })) };
    });
  }

  @Post('batches/:id/orders/:orderId/mark-packed')
  @HttpCode(200)
  async markPacked(@Req() req: Request, @Param('id') id: string, @Param('orderId') orderId: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'packing.batch.pack');
    return this.wrap(async () => { await this.packing.markPacked(ctx, id, orderId); return { ok: true }; });
  }

  @Post('batches/:id/orders/:orderId/issue')
  @HttpCode(200)
  async issue(@Req() req: Request, @Param('id') id: string, @Param('orderId') orderId: string, @Body() body: IssueBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'packing.batch.issue');
    return this.wrap(async () => { await this.packing.flagIssue(ctx, id, orderId, body ?? {}); return { ok: true }; });
  }

  @Post('batches/:id/handoff')
  @HttpCode(200)
  async handoff(@Req() req: Request, @Param('id') id: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'packing.batch.handoff');
    return this.wrap(() => this.packing.handoff(ctx, id));
  }

  @Post('labels/:orderId/preview')
  @HttpCode(200)
  async previewLabel(@Req() req: Request, @Param('orderId') orderId: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'packing.label.read');
    const grants = await this.access.visibilityGrants(ctx.roles);
    return this.wrap(async () => {
      const label = await this.packing.previewLabel(orderId);
      const { data, masked } = maskFields(label as unknown as Record<string, unknown>, { customer_display_name: 'pii' }, grants);
      return { ...data, masked };
    });
  }

  @Post('labels/:orderId/mark-printed')
  @HttpCode(200)
  async markPrinted(@Req() req: Request, @Param('orderId') orderId: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'packing.label.print');
    return this.wrap(() => this.packing.markPrinted(ctx, orderId));
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
      if (e instanceof PackingError) {
        if (e.code === 'not_found') throw new NotFoundException({ error_code: e.code, detail: e.detail });
        throw new BadRequestException({ error_code: e.code, detail: e.detail });
      }
      throw e;
    }
  }
}

interface CreateBatchBody {
  kitchen_id?: string; branch_id?: string; delivery_date: string; delivery_time?: string; area?: string;
}
interface IssueBody { status?: string; reason?: string; notes?: string }
