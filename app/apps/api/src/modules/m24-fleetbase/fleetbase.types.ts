// m24-fleetbase — types for the nutrezee → Fleetbase order bridge.
// Fleetbase stays config-only (AGPL); all of this is OUR integration code.

/** Geo readiness of an order's dropoff. We NEVER send a junk/0,0 pin to Fleetbase. */
export type GeoState = 'ready' | 'pending_geocoding';

/** Lifecycle of a bridge record on our side. */
export type DispatchState =
  | 'pending_geocoding' // held: dropoff has no real coordinate yet — NOT sent to Fleetbase
  | 'ready' //            has a real coordinate, not yet created in Fleetbase
  | 'created' //          Fleetbase order created (status=created), awaiting dispatch
  | 'dispatched'
  | 'completed'
  | 'canceled'
  | 'failed';

/** A nutrezee location pin as stored in address.location_pin (jsonb). Empty today. */
export interface LocationPin {
  lat?: number;
  lng?: number;
  source?: string;
  confidence?: string;
}

/** Raw nutrezee rows assembled for one order's dropoff (read-only from our DB). */
export interface NutrezeeOrderContext {
  order_id: string;
  order_number: string;
  customer_id: string;
  customer_name_en: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  package_name: string | null;
  scheduled_date: string | null; // fulfillment day / start_date (ISO)
  address_id: string | null;
  area_id: string | null;
  area_name_en: string | null;
  area_name_ar: string | null;
  block: string | null;
  street: string | null;
  house_no: string | null;
  building: string | null;
  address_text: string | null;
  delivery_notes: string | null;
  location_pin: LocationPin | null;
}

/** A Fleetbase "place" object (subset we use). coordinates are [lng, lat] (GeoJSON). */
export interface FleetbasePlace {
  name?: string;
  street1?: string;
  neighborhood?: string;
  city?: string;
  country?: string;
  phone?: string;
  location?: { type: 'Point'; coordinates: [number, number] };
  meta?: Record<string, unknown>;
}

/** The POST /v1/orders body we send. */
export interface FleetbaseOrderCreate {
  type: string; // 'transport'
  internal_id: string; // nutrezee order_number (idempotency / correlation)
  dispatch: boolean;
  scheduled_at?: string;
  notes?: string;
  customer?: string; // Fleetbase contact public_id (contact_xxx) — upserted before order create
  meta?: Record<string, unknown>;
  payload: {
    pickup: FleetbasePlace;
    dropoff: FleetbasePlace;
    entities?: Array<{ name: string }>;
  };
}

/** Frozen snapshot stored on the bridge row so later address edits never misroute past orders. */
export interface FrozenAddress {
  area_id: string | null;
  area_name_en: string | null;
  area_name_ar: string | null;
  block: string | null;
  street: string | null;
  house_no: string | null;
  building: string | null;
  address_text: string | null;
  delivery_notes: string | null;
  location_pin: LocationPin | null;
  composed_street1: string;
}
