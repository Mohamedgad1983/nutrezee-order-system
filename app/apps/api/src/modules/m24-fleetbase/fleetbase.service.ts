// m24-fleetbase — orchestration for the nutrezee → Fleetbase order bridge.
// Reads nutrezee order/address READ-ONLY, freezes the address, gates on a REAL coordinate
// (never sends Point(0,0)), creates the Fleetbase order idempotently, and records status back.
// Writes ONLY to the new `fleetbase_dispatch` bridge table + audit — never to live order tables.
import { ulid } from 'ulid';
import type { Pool, PoolClient } from 'pg';
import { AuditService } from '../../platform/audit/audit.service';
import { SettingsReader } from '../../platform/settings/settings-reader';
import { withTransaction } from '../../platform/db/tx';
import { FleetbaseClient } from './fleetbase.client';
import { freezeAddress, geoState } from './address-assembler';
import { mapEventToState, mapOrder } from './order-mapper';
import type { DispatchState, FleetbasePlace, NutrezeeOrderContext } from './fleetbase.types';

export interface DispatchResult {
  bridge_id: string;
  order_number: string;
  state: DispatchState;
  geo_state: 'ready' | 'pending_geocoding';
  fleetbase_order_id: string | null;
  reason?: string;
}

export class FleetbaseService {
  private client: FleetbaseClient | null = null;

  constructor(
    private readonly pool: Pool,
    private readonly audit: AuditService,
    private readonly settings: SettingsReader,
    clientOverride?: FleetbaseClient, // for tests / harness
  ) {
    this.client = clientOverride ?? null;
  }

  private getClient(): FleetbaseClient {
    if (!this.client) this.client = FleetbaseClient.fromEnv();
    return this.client;
  }

  /** Read-only assembly of one order's dropoff context (order → customer → address → area). */
  async loadContext(orderId: string): Promise<NutrezeeOrderContext | null> {
    const { rows } = await this.pool.query(
      `SELECT o.id AS order_id, o.order_number, o.customer_id,
              c.full_name_en AS customer_name_en, c.email AS customer_email,
              (SELECT p.phone_normalized FROM customer_phone p
                 WHERE p.customer_id = o.customer_id ORDER BY p.is_primary DESC NULLS LAST LIMIT 1) AS customer_phone,
              o.package_name_frozen_en AS package_name,
              COALESCE((SELECT min(fd.date)::text FROM fulfillment_day fd WHERE fd.order_id = o.id),
                       o.start_date::text) AS scheduled_date,
              a.id AS address_id, a.area_id, ar.name_en AS area_name_en, ar.name_ar AS area_name_ar,
              a.block, a.street, a.house_no, a.building, a.address_text, a.delivery_notes, a.location_pin
         FROM customer_order o
         JOIN customer c ON c.id = o.customer_id
         LEFT JOIN address a ON a.customer_id = o.customer_id AND a.active = true
         LEFT JOIN area ar ON ar.id = a.area_id
        WHERE o.id = $1
        LIMIT 1`,
      [orderId],
    );
    return rows.length ? (rows[0] as NutrezeeOrderContext) : null;
  }

  /** The central-kitchen pickup place (config). Must carry real coords to be dispatchable. */
  async getPickupPlace(): Promise<FleetbasePlace> {
    return this.settings.get<FleetbasePlace>('fleetbase_pickup_place', {
      name: 'Nutrezee Central Kitchen',
      street1: 'Pickup location pending configuration',
      city: 'Kuwait',
      country: 'KW',
    });
  }

  /**
   * Create (or re-confirm) the Fleetbase order for a nutrezee order.
   * GEO GATE: if the dropoff has no real coordinate, the order is held in
   * `pending_geocoding` and is NOT sent to Fleetbase (no Point(0,0) ever).
   */
  async dispatchOrder(orderId: string, opts?: { actorId?: string; dispatch?: boolean }): Promise<DispatchResult> {
    const ctx = await this.loadContext(orderId);
    if (!ctx) throw new Error(`order ${orderId} not found`);

    // idempotency: if we already created the Fleetbase order, return it.
    const existing = await this.pool.query(
      `SELECT id, fleetbase_order_id, dispatch_state FROM fleetbase_dispatch WHERE order_id = $1`,
      [orderId],
    );
    if (existing.rows.length && existing.rows[0].fleetbase_order_id) {
      const r = existing.rows[0];
      return { bridge_id: r.id, order_number: ctx.order_number, state: r.dispatch_state, geo_state: 'ready', fleetbase_order_id: r.fleetbase_order_id };
    }

    const gs = geoState(ctx);
    const frozen = freezeAddress(ctx);
    const actor = opts?.actorId ? { id: opts.actorId, role: 'system' } : 'system';

    if (gs === 'pending_geocoding') {
      // HOLD + FLAG. Record the intent; do not contact Fleetbase.
      const bridgeId = await this.upsertBridge({
        ctx, geoState: gs, dispatchState: 'pending_geocoding', frozen,
        fleetbaseOrderId: null, lastEvent: 'held:pending_geocoding', lastError: null, actor,
      });
      return { bridge_id: bridgeId, order_number: ctx.order_number, state: 'pending_geocoding', geo_state: gs, fleetbase_order_id: null, reason: 'no real coordinate (location_pin) — geocoding required before dispatch' };
    }

    // geo READY → build + create the Fleetbase order.
    const pickup = await this.getPickupPlace();
    const body = mapOrder(ctx, { pickup, dispatch: opts?.dispatch ?? false });
    const client = this.getClient();

    // idempotency on the Fleetbase side too: skip if internal_id already exists.
    const already = await client.findByInternalId(ctx.order_number).catch(() => null);
    let fbId: string;
    let lastEvent: string;
    try {
      if (already) {
        fbId = already.id;
        lastEvent = 'reused:existing_fleetbase_order';
      } else {
        // Fleetbase requires a contact (with email) as the order customer — upsert by phone.
        const email = ctx.customer_email && ctx.customer_email.includes('@')
          ? ctx.customer_email
          : `${ctx.order_number}@orders.nutrezee.local`;
        body.customer = await client.upsertContact({
          name: ctx.customer_name_en ?? `Order ${ctx.order_number}`,
          phone: ctx.customer_phone ?? '+96500000000',
          email,
        });
        const created = await client.createOrder(body);
        fbId = created.id;
        lastEvent = 'created:fleetbase_order';
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const bridgeId = await this.upsertBridge({
        ctx, geoState: gs, dispatchState: 'failed', frozen,
        fleetbaseOrderId: null, lastEvent: 'create_failed', lastError: msg.slice(0, 300), actor,
      });
      return { bridge_id: bridgeId, order_number: ctx.order_number, state: 'failed', geo_state: gs, fleetbase_order_id: null, reason: msg.slice(0, 200) };
    }

    const bridgeId = await this.upsertBridge({
      ctx, geoState: gs, dispatchState: 'created', frozen,
      fleetbaseOrderId: fbId, lastEvent, lastError: null, actor,
    });
    return { bridge_id: bridgeId, order_number: ctx.order_number, state: 'created', geo_state: gs, fleetbase_order_id: fbId };
  }

  private async upsertBridge(p: {
    ctx: NutrezeeOrderContext; geoState: 'ready' | 'pending_geocoding'; dispatchState: DispatchState;
    frozen: unknown; fleetbaseOrderId: string | null; lastEvent: string; lastError: string | null;
    actor: { id: string; role: string } | 'system';
  }): Promise<string> {
    return withTransaction(this.pool, async (client: PoolClient) => {
      const { rows } = await client.query(
        `INSERT INTO fleetbase_dispatch
           (id, order_id, order_number, fleetbase_order_id, geo_state, has_real_coordinate,
            frozen_address, area_id, dispatch_state, last_event, last_error, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,'m24-fleetbase')
         ON CONFLICT (order_id) DO UPDATE SET
            fleetbase_order_id = COALESCE(EXCLUDED.fleetbase_order_id, fleetbase_dispatch.fleetbase_order_id),
            geo_state = EXCLUDED.geo_state,
            has_real_coordinate = EXCLUDED.has_real_coordinate,
            frozen_address = EXCLUDED.frozen_address,
            area_id = EXCLUDED.area_id,
            dispatch_state = EXCLUDED.dispatch_state,
            last_event = EXCLUDED.last_event,
            last_error = EXCLUDED.last_error,
            updated_at = now(), updated_by = 'm24-fleetbase',
            version = fleetbase_dispatch.version + 1
         RETURNING id`,
        [
          ulid(), p.ctx.order_id, p.ctx.order_number, p.fleetbaseOrderId, p.geoState,
          p.geoState === 'ready', JSON.stringify(p.frozen), p.ctx.area_id, p.dispatchState,
          p.lastEvent, p.lastError,
        ],
      );
      const bridgeId = rows[0].id as string;
      await this.audit.writeInTx(client, {
        eventType: 'fleetbase.dispatch_recorded',
        actor: p.actor,
        entityType: 'fleetbase_dispatch',
        entityId: bridgeId,
        before: null,
        after: { order_number: p.ctx.order_number, dispatch_state: p.dispatchState, geo_state: p.geoState, fleetbase_order_id: p.fleetbaseOrderId, event: p.lastEvent },
        severity: p.dispatchState === 'failed' ? 'warn' : 'info',
        relatedRefs: { order_id: p.ctx.order_id },
      });
      return bridgeId;
    });
  }

  /**
   * Apply a Fleetbase webhook event to the bridge row (status flowing back).
   * NOTE: writing the status back onto the REAL nutrezee order/fulfillment status goes through
   * the transition engine and is GATED behind real-order approval — here we update the bridge
   * record + audit only.
   */
  async applyWebhookEvent(event: string, data: { id?: string; internal_id?: string; status?: string }): Promise<{ matched: boolean; state: DispatchState | null }> {
    const fbId = data.id;
    const internalId = data.internal_id;
    const { rows } = await this.pool.query(
      `SELECT id, order_id, order_number, dispatch_state FROM fleetbase_dispatch
        WHERE ($1::text IS NOT NULL AND fleetbase_order_id = $1)
           OR ($2::text IS NOT NULL AND order_number = $2)
        LIMIT 1`,
      [fbId ?? null, internalId ?? null],
    );
    if (!rows.length) return { matched: false, state: null };
    const row = rows[0];
    const mapped = mapEventToState(event);
    const newState: DispatchState = mapped ?? row.dispatch_state;

    await withTransaction(this.pool, async (client: PoolClient) => {
      await client.query(
        `UPDATE fleetbase_dispatch
            SET fleetbase_status = COALESCE($1, fleetbase_status),
                dispatch_state = $2, last_event = $3, updated_at = now(), updated_by = 'fleetbase-webhook',
                version = version + 1
          WHERE id = $4`,
        [data.status ?? null, newState, event, row.id],
      );
      await this.audit.writeInTx(client, {
        eventType: 'fleetbase.webhook_received',
        actor: 'system',
        entityType: 'fleetbase_dispatch',
        entityId: row.id,
        before: { dispatch_state: row.dispatch_state },
        after: { dispatch_state: newState, event, fleetbase_status: data.status ?? null },
        severity: 'info',
        relatedRefs: { order_id: row.order_id },
      });
    });
    return { matched: true, state: newState };
  }
}
