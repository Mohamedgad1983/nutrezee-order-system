import {
  BadRequestException, Body, Controller, Get, HttpCode, NotFoundException,
  Param, Post, Query, Req, UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthError, SessionService, type StaffContext } from '../../platform/auth/session.service';
import { AccessService } from '../../platform/rbac/access.service';
import { requirePermission } from '../../platform/rbac/permission.util';
import { TransitionError } from '../../platform/transition/transition-engine';
import { KitchenError, KitchenService, type TicketStatus } from './kitchen.service';

const COOKIE = 'nz_session';

@Controller()
export class KitchenController {
  constructor(
    private readonly sessions: SessionService,
    private readonly access: AccessService,
    private readonly kitchen: KitchenService,
  ) {}

  @Get('kitchen/board')
  async board(
    @Req() req: Request,
    @Query('date') date?: string,
    @Query('section_id') sectionId?: string,
    @Query('unrouted') unrouted?: string,
  ) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'kitchen.board.read');
    if (!date) throw new BadRequestException({ error_code: 'validation_failed', field: 'date' });
    return this.wrap(async () => ({
      items: await this.kitchen.board({ date, sectionId, unrouted: unrouted === 'true' }),
      page: { limit: 100 },
    }));
  }

  @Post('kitchen/generate-tickets')
  @HttpCode(200)
  async generate(@Req() req: Request, @Body() body: GenerateBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'kitchen.ticket.generate');
    if (!body.date) throw new BadRequestException({ error_code: 'validation_failed', field: 'date' });
    return this.wrap(() => this.kitchen.generateTickets(ctx, body.date as string, body.generation_batch));
  }

  @Post('tickets/:id/transitions')
  @HttpCode(200)
  async transitionTicket(@Req() req: Request, @Param('id') id: string, @Body() body: TransitionBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'kitchen.ticket.transition');
    return this.wrap(async () => {
      await this.kitchen.transitionTicket(
        ctx,
        id,
        body.to as TicketStatus,
        { deviceSession: body.device_session, nameTap: body.name_tap },
        body.reason_code ? { code: body.reason_code, note: body.note } : undefined,
      );
      return { ok: true };
    });
  }

  @Post('kitchen/fulfillment-days/:dayId/pack')
  @HttpCode(200)
  async confirmPacked(@Req() req: Request, @Param('dayId') dayId: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'kitchen.day.pack');
    return this.wrap(async () => {
      await this.kitchen.confirmPacked(ctx, dayId);
      return { ok: true };
    });
  }

  @Post('tickets/:id/escalations')
  @HttpCode(201)
  async raiseEscalation(@Req() req: Request, @Param('id') id: string, @Body() body: EscalationBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'kitchen.escalation.raise');
    return this.wrap(async () => ({
      id: await this.kitchen.raiseEscalation(ctx, id, {
        typeCode: body.type_code,
        proposedSubstituteId: body.proposed_substitute_id,
        notes: body.notes,
      }),
    }));
  }

  @Post('kitchen/escalations/:id/resolve')
  @HttpCode(200)
  async resolveEscalation(@Req() req: Request, @Param('id') id: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'kitchen.escalation.resolve');
    return this.wrap(async () => {
      await this.kitchen.resolveEscalation(ctx, id);
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
      if (e instanceof KitchenError) {
        if (e.code === 'not_found') throw new NotFoundException({ error_code: e.code, detail: e.detail });
        throw new BadRequestException({ error_code: e.code, detail: e.detail });
      }
      if (e instanceof TransitionError) throw new BadRequestException({ error_code: e.code, detail: e.detail });
      throw e;
    }
  }
}

interface GenerateBody {
  date?: string;
  generation_batch?: string;
}

interface TransitionBody {
  to?: string;
  reason_code?: string;
  note?: string;
  device_session?: string;
  name_tap?: string;
}

interface EscalationBody {
  type_code?: string;
  proposed_substitute_id?: string;
  notes?: string;
}
