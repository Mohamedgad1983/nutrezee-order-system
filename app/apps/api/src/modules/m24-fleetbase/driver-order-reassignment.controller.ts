import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthError, SessionService, type StaffContext } from '../../platform/auth/session.service';
import { AccessService } from '../../platform/rbac/access.service';
import {
  DriverOrderReassignmentError,
  DriverOrderReassignmentService,
} from './driver-order-reassignment.service';

const COOKIE = 'nz_session';
const ALLOWED_ROLES = new Set(['logistics_manager', 'super_admin']);
const PERMISSION = 'delivery.order.reassign';

@Controller('driver-order-reassignments')
export class DriverOrderReassignmentController {
  constructor(
    private readonly sessions: SessionService,
    private readonly access: AccessService,
    private readonly reassignments: DriverOrderReassignmentService,
  ) {}

  @Get('drivers')
  async drivers(@Req() req: Request) {
    await this.authorize(req);
    return this.wrap(async () => ({ items: await this.reassignments.listDrivers(), page: { limit: 500 } }));
  }

  @Get('drivers/:driverId/orders')
  async orders(
    @Req() req: Request,
    @Param('driverId') driverId: string,
    @Query('date') date?: string,
  ) {
    await this.authorize(req);
    return this.wrap(async () => ({ items: await this.reassignments.listOrders(driverId, date) }));
  }

  @Post()
  @HttpCode(200)
  async reassign(
    @Req() req: Request,
    @Body() body: { source_driver_id?: string; target_driver_id?: string; order_ids?: unknown },
  ) {
    const ctx = await this.authorize(req);
    return this.wrap(() => this.reassignments.reassign(ctx, body ?? {}));
  }

  private async authorize(req: Request): Promise<StaffContext> {
    const ctx = await this.ctx(req);
    if (!ctx.roles.some((role) => ALLOWED_ROLES.has(role))) {
      throw new ForbiddenException({ error_code: 'role_denied', permission: PERMISSION });
    }
    const decision = await this.access.decide(ctx.roles, PERMISSION, ctx.staffId);
    if (!decision.allowed) {
      throw new ForbiddenException({ error_code: 'role_denied', permission: PERMISSION });
    }
    return ctx;
  }

  private async ctx(req: Request): Promise<StaffContext> {
    const sessionId = (req as Request & { cookies?: Record<string, string> }).cookies?.[COOKIE];
    if (!sessionId) throw new UnauthorizedException({ error_code: 'no_session' });
    try {
      return await this.sessions.validate(sessionId);
    } catch (error) {
      if (error instanceof AuthError) throw new UnauthorizedException({ error_code: error.code });
      throw error;
    }
  }

  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof DriverOrderReassignmentError) {
        if (error.code === 'validation_failed') {
          throw new BadRequestException({ error_code: error.code, detail: error.detail });
        }
        if (error.code === 'not_found') throw new NotFoundException({ error_code: error.code });
        throw new ServiceUnavailableException({ error_code: error.code });
      }
      throw error;
    }
  }
}
