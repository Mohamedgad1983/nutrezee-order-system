import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Headers,
  HttpCode, NotFoundException, Param, Post, Query, Req, UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthError, SessionService, type StaffContext } from '../../platform/auth/session.service';
import { AccessService } from '../../platform/rbac/access.service';
import { requirePermission } from '../../platform/rbac/permission.util';
import { IdempotencyConflictError } from '../../platform/idempotency/idempotency.service';
import { BarcodeError, BarcodeService } from './barcode.service';
import { LabelError, LabelService } from './label.service';
import { CollectionError, CollectionService } from './collection.service';
import {
  FleetbaseIdentityError, FleetbaseIdentityService,
} from './fleetbase-identity.service';

// m25-label — exact legacy label, permanent customer barcode, daily box collection (A27/A28).
//
// Label rendering is POST, not GET: building a label issues the customer's barcode on first use,
// and a GET must never mutate state (CI guard scan-no-get-mutation). This mirrors the existing
// `POST /packing/labels/:orderId/preview` precedent. Every GET here is a pure read.

const COOKIE = 'nz_session';

@Controller()
export class LabelController {
  constructor(
    private readonly sessions: SessionService,
    private readonly access: AccessService,
    private readonly labels: LabelService,
    private readonly barcodes: BarcodeService,
    private readonly collection: CollectionService,
    private readonly fleetbaseIdentity: FleetbaseIdentityService,
  ) {}

  // ---- labels ----

  /** Fleet-Ops order-details extension: resolve the Fleetbase order server-side, then render. */
  @Post('fleet-ops/labels/render')
  @HttpCode(200)
  async renderFleetbase(@Req() req: Request, @Body() body: FleetbaseRenderBody) {
    if (!body?.fleetbase_order_id) {
      throw new BadRequestException({ error_code: 'validation_failed', field: 'fleetbase_order_id' });
    }
    return this.wrap(async () => {
      const { actor, order } = await this.fleetbaseIdentity.verifiedOrderForOperator(
        this.bearer(req), body.fleetbase_order_id,
      );
      const orderId = await this.labels.resolveFleetbaseOrder(order);
      const deliveryDate = this.fleetbaseIdentity.deliveryDateForOrder(order);
      return this.labels.build(actor, orderId, deliveryDate, {
        driverRef: this.labels.fleetbaseDriverRef(order),
      });
    });
  }

  @Get('fleet-ops/labels/:fleetbaseOrderId/print-history')
  async fleetbasePrintHistory(
    @Req() req: Request,
    @Param('fleetbaseOrderId') fleetbaseOrderId: string,
  ) {
    return this.wrap(async () => {
      const { order } = await this.fleetbaseIdentity.verifiedOrderForOperator(
        this.bearer(req), fleetbaseOrderId,
      );
      const orderId = await this.labels.resolveFleetbaseOrder(order);
      const deliveryDate = this.fleetbaseIdentity.deliveryDateForOrder(order);
      return { items: await this.labels.printHistory(orderId, deliveryDate) };
    });
  }

  @Post('fleet-ops/labels/:fleetbaseOrderId/printed')
  @HttpCode(201)
  async recordFleetbasePrint(
    @Req() req: Request,
    @Param('fleetbaseOrderId') fleetbaseOrderId: string,
    @Body() body: FleetbasePrintBody,
  ) {
    const kind = body?.kind === 'reprint' ? 'reprint' : 'print';
    if (kind === 'reprint' && !body.reason?.trim()) {
      throw new BadRequestException({ error_code: 'validation_failed', field: 'reason' });
    }
    return this.wrap(async () => {
      const { actor, order } = await this.fleetbaseIdentity.verifiedOrderForOperator(
        this.bearer(req), fleetbaseOrderId,
      );
      const orderId = await this.labels.resolveFleetbaseOrder(order);
      const deliveryDate = this.fleetbaseIdentity.deliveryDateForOrder(order);
      return this.labels.recordPrint(actor, orderId, deliveryDate, {
        kind, reason: body.reason, batchRef: body.batch_ref,
      });
    });
  }

  @Post('labels/render')
  @HttpCode(200)
  async render(@Req() req: Request, @Body() body: RenderBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'label.read');
    if (!body?.order_id) throw new BadRequestException({ error_code: 'validation_failed', field: 'order_id' });
    if (!body?.delivery_date) throw new BadRequestException({ error_code: 'validation_failed', field: 'delivery_date' });
    return this.wrap(() => this.labels.build(ctx, body.order_id, body.delivery_date));
  }

  @Post('labels/batch')
  @HttpCode(200)
  async batch(@Req() req: Request, @Body() body: BatchBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'label.read');
    if (!body?.delivery_date) throw new BadRequestException({ error_code: 'validation_failed', field: 'delivery_date' });
    return this.wrap(async () => {
      const items = await this.labels.buildBatch(ctx, body.delivery_date, body.driver_id);
      return { items, page: { limit: items.length } };
    });
  }

  @Post('labels/:orderId/printed')
  @HttpCode(201)
  async recordPrint(@Req() req: Request, @Param('orderId') orderId: string, @Body() body: PrintBody) {
    const ctx = await this.ctx(req);
    const kind = body?.kind === 'reprint' ? 'reprint' : 'print';
    await requirePermission(this.access, ctx, kind === 'reprint' ? 'label.reprint' : 'label.print');
    if (!body?.delivery_date) throw new BadRequestException({ error_code: 'validation_failed', field: 'delivery_date' });
    if (kind === 'reprint' && !body.reason?.trim()) {
      throw new BadRequestException({ error_code: 'validation_failed', field: 'reason' });
    }
    return this.wrap(() => this.labels.recordPrint(ctx, orderId, body.delivery_date, {
      kind, reason: body.reason, batchRef: body.batch_ref,
    }));
  }

  @Get('labels/:orderId/print-history')
  async printHistory(@Req() req: Request, @Param('orderId') orderId: string, @Query('date') date?: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'label.read');
    if (!date) throw new BadRequestException({ error_code: 'validation_failed', field: 'date' });
    return this.wrap(async () => ({ items: await this.labels.printHistory(orderId, date) }));
  }

  // ---- barcodes ----

  @Get('barcodes/customer/:customerId')
  async getBarcode(@Req() req: Request, @Param('customerId') customerId: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'barcode.read');
    return this.wrap(async () => ({ barcode: await this.barcodes.getForCustomer(customerId) }));
  }

  @Post('barcodes/customer/:customerId/issue')
  @HttpCode(200)
  async issueBarcode(@Req() req: Request, @Param('customerId') customerId: string) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'barcode.issue');
    return this.wrap(() => this.barcodes.issueFor(ctx, customerId));
  }

  @Post('barcodes/customer/:customerId/replace')
  @HttpCode(200)
  async replaceBarcode(@Req() req: Request, @Param('customerId') customerId: string, @Body() body: ReplaceBody) {
    const ctx = await this.ctx(req);
    await requirePermission(this.access, ctx, 'barcode.replace');
    if (!body?.reason?.trim()) throw new BadRequestException({ error_code: 'validation_failed', field: 'reason' });
    return this.wrap(() => this.barcodes.replace(ctx, customerId, body.reason));
  }

  // ---- collection ----

  @Get('collection/manifest')
  async manifest(@Req() req: Request, @Query('date') date?: string) {
    return this.wrap(async () => {
      const deliveryDate = date ?? await this.collection.today();
      const driver = await this.fleetbaseIdentity.driverContext(this.bearer(req), deliveryDate);
      return this.collection.manifest(driver, deliveryDate);
    });
  }

  @Post('collection/scan')
  @HttpCode(200)
  async scan(
    @Req() req: Request,
    @Body() body: ScanBody,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    if (!body?.barcode?.trim()) throw new BadRequestException({ error_code: 'validation_failed', field: 'barcode' });
    return this.wrap(async () => {
      const deliveryDate = body.delivery_date ?? await this.collection.today();
      const driver = await this.fleetbaseIdentity.driverContext(this.bearer(req), deliveryDate);
      return this.collection.scan(driver, {
        barcode: body.barcode, delivery_date: deliveryDate, device_ref: body.device_ref,
      }, idempotencyKey);
    });
  }

  // ---- plumbing ----

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

  private bearer(req: Request): string {
    const header = req.headers.authorization;
    const match = /^Bearer\s+(.+)$/i.exec(String(header ?? ''));
    if (!match?.[1]) throw new UnauthorizedException({ error_code: 'fleetbase_token_required' });
    return match[1];
  }

  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof IdempotencyConflictError) throw new ConflictException({ error_code: e.code });
      if (e instanceof FleetbaseIdentityError) {
        if (e.code === 'invalid_token') {
          throw new UnauthorizedException({ error_code: e.code });
        }
        if (e.code === 'forbidden' || e.code === 'identity_ambiguous') {
          throw new ForbiddenException({ error_code: e.code, detail: e.detail });
        }
        throw new BadRequestException({ error_code: e.code, detail: e.detail });
      }
      if (e instanceof LabelError || e instanceof BarcodeError || e instanceof CollectionError) {
        if (e.code === 'not_found') throw new NotFoundException({ error_code: e.code, detail: e.detail });
        if (e.code === 'conflict') throw new ConflictException({ error_code: e.code, detail: e.detail });
        if (e.code === 'forbidden') throw new ForbiddenException({ error_code: e.code, detail: e.detail });
        throw new BadRequestException({ error_code: e.code, detail: e.detail });
      }
      throw e;
    }
  }
}

interface RenderBody { order_id: string; delivery_date: string }
interface FleetbaseRenderBody { fleetbase_order_id: string }
interface BatchBody { delivery_date: string; driver_id?: string }
interface PrintBody { delivery_date: string; kind?: 'print' | 'reprint'; reason?: string; batch_ref?: string }
interface FleetbasePrintBody { kind?: 'print' | 'reprint'; reason?: string; batch_ref?: string }
interface ReplaceBody { reason: string }
interface ScanBody { barcode: string; delivery_date?: string; device_ref?: string }
