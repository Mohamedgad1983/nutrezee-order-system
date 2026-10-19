// WP-LBL-A97 — Fleet-Ops "Kitchen Stickers" page: the drivers' manager keeps the kitchen's WhatsApp
// stickers (A95) here instead of a Publisher file. Authenticated by the operator's Fleetbase bearer.
import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, HttpCode, NotFoundException,
  Param, Post, Req, ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { CollectionError, CollectionService } from './collection.service';
import { FleetbaseIdentityError, FleetbaseIdentityService } from './fleetbase-identity.service';
import { KitchenStickerError, KitchenStickerService, areasWithDriver, type KitchenStickerInput } from './kitchen-sticker.service';
import { LabelService } from './label.service';

@Controller('fleet-ops/kitchen-stickers')
export class KitchenStickerController {
  constructor(
    private readonly stickers: KitchenStickerService,
    private readonly labels: LabelService,
    private readonly collection: CollectionService,
    private readonly fleetbaseIdentity: FleetbaseIdentityService,
  ) {}

  /**
   * Every sticker, plus the areas of the next delivery day with their driver, so the page can offer
   * an area the WhatsApp sync will match and show who carries it. Pure read.
   */
  @Get()
  async overview(@Req() req: Request) {
    return this.wrap(async () => {
      const bearer = this.bearer(req);
      const day = await this.collection.batchDay();
      const [{ orders }, stickers] = await Promise.all([
        this.fleetbaseIdentity.ordersForOperatorDate(bearer, day.deliveryDate),
        this.stickers.list(),
      ]);
      const candidates = await this.labels.batchCandidates(day.deliveryDate, orders);
      return { delivery_date: day.deliveryDate, today: day.today, stickers, areas: areasWithDriver(candidates) };
    });
  }

  @Post()
  @HttpCode(201)
  async create(@Req() req: Request, @Body() body: KitchenStickerInput) {
    return this.wrap(async () => this.stickers.create(await this.actor(req), body ?? {}));
  }

  @Post(':id')
  @HttpCode(200)
  async update(@Req() req: Request, @Param('id') id: string, @Body() body: KitchenStickerInput) {
    return this.wrap(async () => this.stickers.update(await this.actor(req), id, body ?? {}));
  }

  @Post(':id/stop')
  @HttpCode(200)
  async stop(@Req() req: Request, @Param('id') id: string) {
    return this.wrap(async () => this.stickers.setActive(await this.actor(req), id, false));
  }

  @Post(':id/restore')
  @HttpCode(200)
  async restore(@Req() req: Request, @Param('id') id: string) {
    return this.wrap(async () => this.stickers.setActive(await this.actor(req), id, true));
  }

  private actor(req: Request) {
    return this.fleetbaseIdentity.operatorContext(this.bearer(req));
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
      if (e instanceof KitchenStickerError) {
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
