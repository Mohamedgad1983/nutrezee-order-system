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
import { DriverLocationError, DriverLocationService } from './driver-location.service';

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
    private readonly driverLocations: DriverLocationService,
  ) {}

  // ---- labels ----

  /** Pure current-day options for the Fleet-Ops Batch Labels page. */
  @Get('fleet-ops/labels/batch/options')
  async fleetbaseBatchOptions(@Req() req: Request) {
    return this.wrap(async () => {
      const deliveryDate = await this.collection.currentDay();
      const { orders } = await this.fleetbaseIdentity.ordersForOperatorDate(
        this.bearer(req), deliveryDate,
      );
      const candidates = await this.labels.batchCandidates(deliveryDate, orders);
      return batchOptionsResponse(deliveryDate, orders.length, candidates);
    });
  }

  /** Render all selected labels; first-time permanent barcode issuance is intentionally POST. */
  @Post('fleet-ops/labels/batch/preview')
  @HttpCode(200)
  async fleetbaseBatchPreview(@Req() req: Request, @Body() body: FleetbaseBatchBody) {
    return this.wrap(async () => {
      const deliveryDate = await this.collection.currentDay();
      const { actor, orders } = await this.fleetbaseIdentity.ordersForOperatorDate(
        this.bearer(req), deliveryDate,
      );
      const candidates = await this.labels.batchCandidates(deliveryDate, orders);
      assertCompleteBatch(orders.length, candidates.length);
      const selected = this.labels.selectBatchCandidates(candidates, {
        filterType: body?.filter_type,
        filterValue: body?.filter_value,
        selectionIds: body?.selection_ids,
      });
      const items = await this.labels.buildCandidateBatch(actor, deliveryDate, selected);
      return {
        delivery_date: deliveryDate,
        filter_type: body.filter_type,
        filter_value: body.filter_value,
        count: items.length,
        reprint_count: items.filter((item) => item.prior_prints > 0).length,
        items,
      };
    });
  }

  /** Records only an explicitly confirmed physical batch, never a preview or cancelled dialog. */
  @Post('fleet-ops/labels/batch/printed')
  @HttpCode(201)
  async fleetbaseBatchPrinted(@Req() req: Request, @Body() body: FleetbaseBatchPrintBody) {
    return this.wrap(async () => {
      const deliveryDate = await this.collection.currentDay();
      const { actor, orders } = await this.fleetbaseIdentity.ordersForOperatorDate(
        this.bearer(req), deliveryDate,
      );
      const candidates = await this.labels.batchCandidates(deliveryDate, orders);
      assertCompleteBatch(orders.length, candidates.length);
      const selected = this.labels.selectBatchCandidates(candidates, {
        filterType: body?.filter_type,
        filterValue: body?.filter_value,
        selectionIds: body?.selection_ids,
      });
      return this.labels.recordCandidateBatchPrint(actor, deliveryDate, selected, body?.reason);
    });
  }

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
      return this.labels.build(
        actor, orderId, deliveryDate, this.labels.fleetbaseDriverSource(order),
      );
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
      const token = this.bearer(req);
      // Validate the optional client echo before contacting Fleetbase. The server's Kuwait date
      // is the sole authority; a stale or manipulated past/future date is rejected.
      const deliveryDate = await this.collection.currentDay(date);
      const driver = await this.fleetbaseIdentity.driverContext(token, deliveryDate);
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
      const token = this.bearer(req);
      const deliveryDate = await this.collection.currentDay(body.delivery_date);
      const driver = await this.fleetbaseIdentity.driverContext(token, deliveryDate);
      return this.collection.scan(driver, {
        barcode: body.barcode, delivery_date: deliveryDate, device_ref: body.device_ref,
      }, idempotencyKey);
    });
  }

  // ---- assigned-driver missing-location recovery (A30) ----

  @Get('collection/locations')
  async driverLocationManifest(@Req() req: Request, @Query('date') date?: string) {
    return this.wrap(async () => {
      const deliveryDate = await this.collection.currentDay(date);
      const driver = await this.fleetbaseIdentity.driverContext(this.bearer(req), deliveryDate);
      return this.driverLocations.manifest(driver, deliveryDate);
    });
  }

  @Post('collection/locations/capture')
  @HttpCode(200)
  async captureDriverLocation(
    @Req() req: Request,
    @Body() body: DriverLocationCaptureBody,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.wrap(async () => {
      const deliveryDate = await this.collection.currentDay(body?.delivery_date);
      const driver = await this.fleetbaseIdentity.driverContext(this.bearer(req), deliveryDate);
      return this.driverLocations.capture(driver, deliveryDate, {
        fleetbase_order_id: body?.fleetbase_order_id,
        latitude: body?.latitude,
        longitude: body?.longitude,
        capture_method: body?.capture_method,
        accuracy_meters: body?.accuracy_meters,
      }, idempotencyKey);
    });
  }

  @Get('fleet-ops/driver-locations')
  async fleetOpsDriverLocations(@Req() req: Request, @Query('date') date?: string) {
    return this.wrap(async () => {
      await this.fleetbaseIdentity.operatorContext(this.bearer(req));
      return this.driverLocations.listForOperator(date);
    });
  }

  @Post('fleet-ops/driver-locations/:captureId/correct')
  @HttpCode(201)
  async correctDriverLocation(
    @Req() req: Request,
    @Param('captureId') captureId: string,
    @Body() body: DriverLocationCorrectionBody,
  ) {
    return this.wrap(async () => {
      const actor = await this.fleetbaseIdentity.operatorContext(this.bearer(req));
      return this.driverLocations.correct(actor, captureId, {
        latitude: body?.latitude,
        longitude: body?.longitude,
        accuracy_meters: body?.accuracy_meters,
        reason: body?.reason,
      });
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
      if (e instanceof DriverLocationError) {
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
interface FleetbaseBatchBody {
  filter_type: 'driver' | 'area';
  filter_value: string;
  selection_ids?: string[];
}
interface FleetbaseBatchPrintBody extends FleetbaseBatchBody { reason?: string }
interface ReplaceBody { reason: string }
interface ScanBody { barcode: string; delivery_date?: string; device_ref?: string }
interface DriverLocationCaptureBody {
  fleetbase_order_id: string;
  delivery_date?: string;
  latitude: number;
  longitude: number;
  capture_method: 'current_gps' | 'shared_coordinates';
  accuracy_meters?: number;
}
interface DriverLocationCorrectionBody {
  latitude: number;
  longitude: number;
  accuracy_meters?: number;
  reason: string;
}

function batchOptionsResponse(
  deliveryDate: string,
  sourceTotal: number,
  candidates: Awaited<ReturnType<LabelService['batchCandidates']>>,
) {
  const driverMap = new Map<string, { id: string; label: string; count: number }>();
  const areaMap = new Map<string, { id: string; label: string; count: number }>();
  for (const candidate of candidates) {
    if (candidate.driverId) {
      const current = driverMap.get(candidate.driverId);
      driverMap.set(candidate.driverId, {
        id: candidate.driverId,
        label: candidate.driverLabel ?? candidate.driverId,
        count: (current?.count ?? 0) + 1,
      });
    }
    const area = areaMap.get(candidate.areaKey);
    areaMap.set(candidate.areaKey, {
      id: candidate.areaKey,
      label: candidate.areaLabel,
      count: (area?.count ?? 0) + 1,
    });
  }
  const unmapped = Math.max(0, sourceTotal - candidates.length);
  return {
    delivery_date: deliveryDate,
    source_total: sourceTotal,
    total: candidates.length,
    unmapped,
    ready: sourceTotal > 0 && unmapped === 0,
    drivers: [...driverMap.values()].sort((a, b) => a.label.localeCompare(b.label)),
    areas: [...areaMap.values()].sort((a, b) => a.label.localeCompare(b.label)),
    orders: candidates.map((candidate) => ({
      selection_id: candidate.selectionId,
      order_number: candidate.orderNumber,
      driver_id: candidate.driverId,
      driver_label: candidate.driverLabel,
      area_id: candidate.areaKey,
      area: candidate.areaLabel,
    })),
  };
}

function assertCompleteBatch(sourceTotal: number, printableTotal: number): void {
  if (sourceTotal === 0) {
    throw new LabelError('conflict', { reason: 'daily_fleetbase_set_not_ready' });
  }
  if (sourceTotal !== printableTotal) {
    throw new LabelError('conflict', {
      reason: 'daily_order_mapping_incomplete',
      source_total: sourceTotal,
      printable_total: printableTotal,
      unmapped: sourceTotal - printableTotal,
    });
  }
}
