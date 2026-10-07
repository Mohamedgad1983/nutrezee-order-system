// WP-OPS-A77 — Fleet-Ops "Move Area" page: one-day move of an area between drivers.
// Authenticated by the operator's existing Fleetbase bearer, like Batch Labels.
import {
  BadRequestException, Body, ConflictException, Controller, Get, HttpCode, NotFoundException, Param, Post,
  Query, Req, UnauthorizedException, ForbiddenException, ServiceUnavailableException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AreaMoveError, AreaMoveService, areaMoveKey, driverLoads } from './area-move.service';
import { CollectionError, CollectionService } from './collection.service';
import { FleetbaseIdentityError, FleetbaseIdentityService } from './fleetbase-identity.service';
import { LabelService } from './label.service';

@Controller('fleet-ops/area-moves')
export class AreaMoveController {
  constructor(
    private readonly moves: AreaMoveService,
    private readonly labels: LabelService,
    private readonly collection: CollectionService,
    private readonly fleetbaseIdentity: FleetbaseIdentityService,
  ) {}

  /** Drivers with their load per area for the day, plus the moves already decided. Pure read. */
  @Get()
  async overview(@Req() req: Request, @Query('delivery_date') requestedDate?: string) {
    return this.wrap(async () => {
      const bearer = this.bearer(req);
      const day = await this.collection.batchDay(requestedDate);
      const state = await this.dayState(bearer, day.deliveryDate);
      const active = await this.moves.active(day.deliveryDate);
      return {
        delivery_date: day.deliveryDate, today: day.today, window: { from: day.today, to: day.to },
        can_edit: day.deliveryDate >= day.today,
        drivers: driverLoads(state.candidates, state.directory),
        moves: active.map((move) => {
          const inArea = state.candidates.filter((c) => areaMoveKey(c.areaLabel) === move.area_key);
          return {
            ...move,
            orders_now: inArea.length,
            orders_with_target: inArea.filter((c) => c.driverId === move.to_driver_id).length,
          };
        }),
      };
    });
  }

  @Post()
  @HttpCode(201)
  async create(@Req() req: Request, @Body() body: { delivery_date?: string; area_key?: string; to_driver_id?: string }) {
    return this.wrap(async () => {
      const bearer = this.bearer(req);
      if (!body?.area_key) throw new BadRequestException({ error_code: 'validation_failed', field: 'area_key' });
      if (!body?.to_driver_id) throw new BadRequestException({ error_code: 'validation_failed', field: 'to_driver_id' });
      const day = await this.collection.batchDay(body.delivery_date);
      const state = await this.dayState(bearer, day.deliveryDate);
      return this.moves.create(
        state.actor,
        { deliveryDate: day.deliveryDate, today: day.today, areaKey: body.area_key, toDriverId: body.to_driver_id },
        state,
      );
    });
  }

  @Post(':id/cancel')
  @HttpCode(200)
  async cancel(@Req() req: Request, @Param('id') id: string) {
    return this.wrap(async () => {
      const actor = await this.fleetbaseIdentity.operatorContext(this.bearer(req));
      const day = await this.collection.batchDay();
      return this.moves.cancel(actor, id, day.today);
    });
  }

  private async dayState(bearer: string, deliveryDate: string) {
    const [{ actor, orders }, directory] = await Promise.all([
      this.fleetbaseIdentity.ordersForOperatorDate(bearer, deliveryDate),
      this.fleetbaseIdentity.driverDirectoryForOperator(bearer),
    ]);
    const candidates = await this.labels.batchCandidates(deliveryDate, orders);
    return { actor, candidates, directory };
  }

  private bearer(req: Request): string {
    const match = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization ?? ''));
    if (!match?.[1]) throw new UnauthorizedException({ error_code: 'fleetbase_token_required' });
    return match[1];
  }

  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof AreaMoveError) {
        const body = { error_code: e.code, detail: e.detail };
        if (e.code === 'not_found') throw new NotFoundException(body);
        if (e.code === 'conflict') throw new ConflictException(body);
        throw new BadRequestException(body);
      }
      if (e instanceof CollectionError) {
        const body = { error_code: e.code, detail: e.detail };
        if (e.code === 'forbidden') throw new ForbiddenException(body);
        throw new BadRequestException(body);
      }
      if (e instanceof FleetbaseIdentityError) {
        if (e.code === 'invalid_token') throw new UnauthorizedException({ error_code: e.code });
        if (e.code === 'forbidden') throw new ForbiddenException({ error_code: e.code, detail: e.detail });
        throw new ServiceUnavailableException({ error_code: e.code, detail: e.detail });
      }
      throw e;
    }
  }
}
