import {
  BadRequestException, Body, Controller, Get, HttpCode, NotFoundException,
  Param, Post, Query, Req, UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthError, SessionService, type StaffContext } from '../../platform/auth/session.service';
import { AccessService } from '../../platform/rbac/access.service';
import { requirePermission } from '../../platform/rbac/permission.util';
import { maskFields } from '../../platform/masking/masking';
import { DeliveryError, DeliveryService } from './delivery.service';

const COOKIE = 'nz_session';

@Controller()
export class DeliveryController {
  constructor(
    private readonly sessions: SessionService,
    private readonly access: AccessService,
    private readonly delivery: DeliveryService,
  ) {}

  @Get('drivers')
  async listDrivers(@Req() req: Request, @Query('active') active?: string, @Query('area') area?: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'delivery.driver.read');
    const grants = await this.access.visibilityGrants(ctx.roles);
    return this.wrap(async () => {
      const rows = await this.delivery.listDrivers({ active: active === undefined ? undefined : active === 'true', area });
      return { items: rows.map((r) => this.mask(r, { phone: 'pii' }, grants)), page: { limit: 500 } };
    });
  }

  @Post('drivers')
  @HttpCode(201)
  async createDriver(@Req() req: Request, @Body() body: CreateDriverBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'delivery.driver.manage');
    if (!body?.name) throw new BadRequestException({ error_code: 'validation_failed', field: 'name' });
    return this.wrap(() => this.delivery.createDriver(ctx, body));
  }

  @Get('delivery/unassigned')
  async unassigned(@Req() req: Request, @Query('date') date?: string, @Query('time') time?: string, @Query('area') area?: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'delivery.route.read');
    if (!date) throw new BadRequestException({ error_code: 'validation_failed', field: 'date' });
    const grants = await this.access.visibilityGrants(ctx.roles);
    return this.wrap(async () => {
      const rows = await this.delivery.listUnassigned({ date, time, area });
      return { items: rows.map((r) => this.mask(r, { customer_name: 'pii' }, grants)), page: { limit: 1000 } };
    });
  }

  @Get('delivery/suggest')
  async suggest(@Req() req: Request, @Query('area') area?: string, @Query('date') date?: string, @Query('time') time?: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'delivery.route.read');
    if (!area || !date) throw new BadRequestException({ error_code: 'validation_failed', field: !area ? 'area' : 'date' });
    return this.wrap(async () => ({ items: await this.delivery.suggestDrivers({ area, date, time }), page: { limit: 50 } }));
  }

  @Post('delivery/assign')
  @HttpCode(200)
  async assign(@Req() req: Request, @Body() body: AssignBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'delivery.assign');
    return this.wrap(() => this.delivery.assign(ctx, body ?? {}));
  }

  @Post('delivery/bulk-assign')
  @HttpCode(200)
  async bulkAssign(@Req() req: Request, @Body() body: BulkAssignBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'delivery.assign');
    return this.wrap(() => this.delivery.bulkAssign(ctx, body ?? {}));
  }

  @Post('delivery/routes')
  @HttpCode(201)
  async createRoute(@Req() req: Request, @Body() body: CreateRouteBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'delivery.route.manage');
    if (!body?.delivery_date) throw new BadRequestException({ error_code: 'validation_failed', field: 'delivery_date' });
    return this.wrap(() => this.delivery.createRoute(ctx, body));
  }

  @Get('delivery/routes')
  async listRoutes(@Req() req: Request, @Query('date') date?: string, @Query('status') status?: string, @Query('driver_id') driverId?: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'delivery.route.read');
    return this.wrap(async () => ({ items: await this.delivery.listRoutes({ date, status, driver_id: driverId }), page: { limit: 200 } }));
  }

  @Get('delivery/routes/:id')
  async getRoute(@Req() req: Request, @Param('id') id: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'delivery.route.read');
    const grants = await this.access.visibilityGrants(ctx.roles);
    return this.wrap(async () => {
      const { route, stops } = await this.delivery.getRoute(id);
      return {
        route: this.mask(route, { driver_phone: 'pii' }, grants),
        stops: stops.map((s) => this.mask(s, { customer_name: 'pii' }, grants)),
      };
    });
  }

  @Post('delivery/routes/:id/status')
  @HttpCode(200)
  async routeStatus(@Req() req: Request, @Param('id') id: string, @Body() body: StatusBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'delivery.status.update');
    if (!body?.to) throw new BadRequestException({ error_code: 'validation_failed', field: 'to' });
    return this.wrap(async () => { await this.delivery.setRouteStatus(ctx, id, body.to as string, body.reason); return { ok: true }; });
  }

  @Post('delivery/routes/:id/stops/:orderId/status')
  @HttpCode(200)
  async stopStatus(@Req() req: Request, @Param('id') id: string, @Param('orderId') orderId: string, @Body() body: StatusBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'delivery.status.update');
    if (!body?.to) throw new BadRequestException({ error_code: 'validation_failed', field: 'to' });
    return this.wrap(async () => { await this.delivery.setStopStatus(ctx, id, orderId, body.to as string, body.reason); return { ok: true }; });
  }

  @Post('delivery/routes/:id/reassign')
  @HttpCode(200)
  async reassign(@Req() req: Request, @Param('id') id: string, @Body() body: ReassignBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'delivery.assign');
    if (!body?.driver_id) throw new BadRequestException({ error_code: 'validation_failed', field: 'driver_id' });
    return this.wrap(async () => { await this.delivery.reassign(ctx, id, body.driver_id as string); return { ok: true }; });
  }

  private mask(row: Record<string, unknown>, classes: Record<string, 'pii' | 'health' | 'payment'>, grants: Set<'pii' | 'health' | 'payment'>) {
    const { data, masked } = maskFields(row, classes as never, grants as never);
    return { ...data, masked };
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
      if (e instanceof DeliveryError) {
        if (e.code === 'not_found') throw new NotFoundException({ error_code: e.code, detail: e.detail });
        throw new BadRequestException({ error_code: e.code, detail: e.detail });
      }
      throw e;
    }
  }
}

interface CreateDriverBody { legacy_driver_id?: string; name?: string; phone?: string; active?: boolean; capacity_per_slot?: number; areas?: Array<{ area: string; priority?: number }> }
interface AssignBody { order_id?: string; driver_id?: string; delivery_date?: string; delivery_time?: string; area?: string }
interface BulkAssignBody { driver_id?: string; delivery_date?: string; delivery_time?: string; area?: string; order_ids?: string[] }
interface CreateRouteBody { driver_id?: string; delivery_date: string; delivery_time?: string; area_group?: string }
interface StatusBody { to?: string; reason?: string }
interface ReassignBody { driver_id?: string }
