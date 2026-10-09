// WP-OPS-A85 — the print page's own "matches the legacy admin" state. Authenticated by the operator's
// Fleetbase bearer, like Batch Labels. The page calls POST when it opens: the operator does nothing.
import {
  BadRequestException, Body, Controller, ForbiddenException, Get, HttpCode, Post, Query, Req,
  ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { CollectionError, CollectionService } from './collection.service';
import { FleetbaseIdentityError, FleetbaseIdentityService } from './fleetbase-identity.service';
import { PrintCheckError, PrintCheckService } from './print-check.service';

@Controller('fleet-ops/labels/print-check')
export class PrintCheckController {
  constructor(
    private readonly checks: PrintCheckService,
    private readonly collection: CollectionService,
    private readonly fleetbaseIdentity: FleetbaseIdentityService,
  ) {}

  /** Latest result for the day. Pure read (the page polls it while a check is running). */
  @Get()
  async state(@Req() req: Request, @Query('delivery_date') requestedDate?: string) {
    return this.wrap(async () => {
      await this.fleetbaseIdentity.operatorContext(this.bearer(req));
      const day = await this.collection.batchDay(requestedDate);
      return this.checks.state(day.deliveryDate);
    });
  }

  /** The page opened: make sure a fresh check exists or is on its way. */
  @Post()
  @HttpCode(200)
  async ensure(@Req() req: Request, @Body() body: { delivery_date?: string }) {
    return this.wrap(async () => {
      const actor = await this.fleetbaseIdentity.operatorContext(this.bearer(req));
      const day = await this.collection.batchDay(body?.delivery_date);
      // Days already delivered are not re-checked against the legacy screen.
      if (day.deliveryDate < day.today) return this.checks.state(day.deliveryDate);
      return this.checks.ensureFresh(actor, day.deliveryDate);
    });
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
      if (e instanceof PrintCheckError) throw new BadRequestException({ error_code: e.code, detail: e.detail });
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
