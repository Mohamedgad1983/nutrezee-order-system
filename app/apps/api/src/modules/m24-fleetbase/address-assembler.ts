// m24-fleetbase — pure address assembly + the STRICT real-coordinate gate.
// Kuwait door-level addressing is Area + Block + Street (+ House/Building).
import type { FleetbasePlace, FrozenAddress, GeoState, LocationPin, NutrezeeOrderContext } from './fleetbase.types';

// Kuwait bounding box (approx) — used to reject 0,0 and obviously-wrong pins.
const KW_LAT = [28.4, 30.2] as const;
const KW_LNG = [46.4, 48.6] as const;

/**
 * A coordinate is "real" only if it is present, numeric, NOT (0,0), and within
 * Kuwait's bounding box. This is what enforces the owner's rule: never treat a
 * Point(0,0)/geocoding-miss as a real location.
 */
export function hasRealCoordinate(pin: LocationPin | null | undefined): boolean {
  if (!pin) return false;
  const { lat, lng } = pin;
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false; // the Fleetbase geocode-miss sentinel
  if (lat < KW_LAT[0] || lat > KW_LAT[1]) return false;
  if (lng < KW_LNG[0] || lng > KW_LNG[1]) return false;
  return true;
}

export function geoState(ctx: NutrezeeOrderContext): GeoState {
  return hasRealCoordinate(ctx.location_pin) ? 'ready' : 'pending_geocoding';
}

const nz = (v: string | null | undefined): string | null => {
  const s = (v ?? '').trim();
  return s.length ? s : null;
};

/** Compose a human-readable Kuwait street1 from the structured fields, with a text fallback. */
export function composeStreet1(ctx: NutrezeeOrderContext): string {
  const parts: string[] = [];
  if (nz(ctx.block)) parts.push(`Block ${ctx.block!.trim()}`);
  if (nz(ctx.street)) parts.push(`Street ${ctx.street!.trim()}`);
  if (nz(ctx.house_no)) parts.push(`House ${ctx.house_no!.trim()}`);
  if (nz(ctx.building)) parts.push(`Bldg ${ctx.building!.trim()}`);
  if (parts.length) return parts.join(', ');
  return nz(ctx.address_text) ?? nz(ctx.area_name_en) ?? 'Address pending';
}

export function freezeAddress(ctx: NutrezeeOrderContext): FrozenAddress {
  return {
    area_id: ctx.area_id,
    area_name_en: ctx.area_name_en,
    area_name_ar: ctx.area_name_ar,
    block: ctx.block,
    street: ctx.street,
    house_no: ctx.house_no,
    building: ctx.building,
    address_text: ctx.address_text,
    delivery_notes: ctx.delivery_notes,
    location_pin: ctx.location_pin,
    composed_street1: composeStreet1(ctx),
  };
}

/**
 * Build the Fleetbase dropoff place. Only attaches a `location` when the pin is REAL.
 * If geo is pending, the caller MUST NOT create the Fleetbase order (we never let
 * Fleetbase geocode a Kuwait text address into a Point(0,0)).
 */
export function assembleDropoff(ctx: NutrezeeOrderContext): FleetbasePlace {
  const place: FleetbasePlace = {
    name: nz(ctx.customer_name_en) ?? `Order ${ctx.order_number}`,
    street1: composeStreet1(ctx),
    neighborhood: nz(ctx.area_name_en) ?? undefined,
    city: nz(ctx.area_name_en) ?? 'Kuwait',
    country: 'KW',
    phone: nz(ctx.customer_phone) ?? undefined,
    meta: {
      nutrezee_address_id: ctx.address_id,
      area_id: ctx.area_id,
      area_ar: ctx.area_name_ar,
      block: ctx.block,
      street: ctx.street,
      house_no: ctx.house_no,
    },
  };
  if (hasRealCoordinate(ctx.location_pin)) {
    place.location = { type: 'Point', coordinates: [ctx.location_pin!.lng!, ctx.location_pin!.lat!] };
  }
  return place;
}
