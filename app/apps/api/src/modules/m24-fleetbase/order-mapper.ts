// m24-fleetbase — pure mapper: nutrezee order context → Fleetbase POST /v1/orders body.
import { assembleDropoff } from './address-assembler';
import type { FleetbaseOrderCreate, FleetbasePlace, NutrezeeOrderContext } from './fleetbase.types';

export const ORDER_TYPE = 'transport'; // the seeded Fleetbase order-config key

export interface MapOptions {
  pickup: FleetbasePlace; // the central kitchen (from config)
  dispatch?: boolean; // default false — hold dispatch until a fleet exists for the area
}

/**
 * Build the create-order payload. Caller guarantees geo is READY (real dropoff coordinate)
 * before invoking this — we never emit an order whose dropoff would geocode to Point(0,0).
 */
export function mapOrder(ctx: NutrezeeOrderContext, opts: MapOptions): FleetbaseOrderCreate {
  const dropoff = assembleDropoff(ctx);
  const body: FleetbaseOrderCreate = {
    type: ORDER_TYPE,
    internal_id: ctx.order_number, // idempotency / correlation key on the Fleetbase side
    dispatch: opts.dispatch ?? false,
    meta: {
      external_ref: ctx.order_number,
      nutrezee_order_id: ctx.order_id,
      nutrezee_customer_id: ctx.customer_id,
      area_id: ctx.area_id,
    },
    payload: {
      pickup: opts.pickup,
      dropoff,
      entities: ctx.package_name ? [{ name: ctx.package_name }] : undefined,
    },
  };
  if (ctx.scheduled_date) body.scheduled_at = ctx.scheduled_date;
  // body.customer (a Fleetbase contact public_id) is set by the service after upserting the contact.
  if (ctx.delivery_notes) body.notes = ctx.delivery_notes;
  return body;
}

/** Map a Fleetbase webhook event name → our DispatchState (best-effort; canceled has one 'l'). */
export function mapEventToState(event: string):
  | 'created' | 'dispatched' | 'completed' | 'canceled' | 'failed' | null {
  switch (event) {
    case 'order.created':
    case 'order.ready':
      return 'created';
    case 'order.dispatched':
    case 'order.driver_assigned':
      return 'dispatched';
    case 'order.completed':
      return 'completed';
    case 'order.canceled':
      return 'canceled';
    case 'order.failed':
    case 'order.dispatch_failed':
      return 'failed';
    default:
      return null; // entity.activity / waypoint.activity / driver.location_changed etc. — tracked but no state change
  }
}
