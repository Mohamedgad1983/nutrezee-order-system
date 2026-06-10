import {
  BadRequestException, Body, Controller, Get, HttpCode, NotFoundException,
  Post, Query, Req, UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthError, SessionService, type StaffContext } from '../../platform/auth/session.service';
import { AccessService } from '../../platform/rbac/access.service';
import { requirePermission } from '../../platform/rbac/permission.util';
import { NotificationError, NotificationService } from './notification.service';

const COOKIE = 'nz_session';

@Controller()
export class NotificationController {
  constructor(
    private readonly sessions: SessionService,
    private readonly access: AccessService,
    private readonly notifications: NotificationService,
  ) {}

  @Get('templates')
  async templates(@Req() req: Request) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'notification.template.manage');
    return { items: await this.notifications.listTemplates(), page: { limit: 100 } };
  }

  @Post('templates')
  @HttpCode(201)
  async upsertTemplate(@Req() req: Request, @Body() body: TemplateBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'notification.template.manage');
    return this.wrap(() => this.notifications.upsertTemplate(ctx, {
      code: body.code,
      channel: body.channel,
      bodyEn: body.body_en,
      bodyAr: body.body_ar,
      active: body.active,
    }));
  }

  @Post('notifications/route-event')
  @HttpCode(200)
  async routeEvent(@Req() req: Request, @Body() body: { event_id?: string }) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'notification.trigger.run');
    if (!body.event_id) throw new BadRequestException({ error_code: 'validation_failed', field: 'event_id' });
    return this.wrap(() => this.notifications.routeEvent(body.event_id as string));
  }

  @Get('notifications')
  async logs(@Req() req: Request, @Query('limit') limit?: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'notification.log.read');
    return this.wrap(async () => ({
      items: await this.notifications.logs(limit ? Number(limit) : 100),
      page: { limit: limit ? Number(limit) : 100 },
    }));
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
      if (e instanceof NotificationError) {
        if (e.code === 'not_found') throw new NotFoundException({ error_code: e.code, detail: e.detail });
        throw new BadRequestException({ error_code: e.code, detail: e.detail });
      }
      throw e;
    }
  }
}

interface TemplateBody {
  code?: string;
  channel?: 'internal' | 'email' | 'whatsapp' | 'push' | 'sms';
  body_en?: string;
  body_ar?: string;
  active?: boolean;
}
