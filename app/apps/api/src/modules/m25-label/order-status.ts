// WP-OPS-A72 — "order status by customer phone" for the Fleet-Ops console (pure helpers).
// Distance and time are estimates from the driver's last app position and straight-line distance;
// they are offered only while that position is fresh, never guessed from an old one.

export interface LatLng { lat: number; lng: number }

export interface DriverPosition extends LatLng { updatedAt: string | null; online: boolean }

export const POSITION_FRESH_MINUTES = 15;
const ROAD_FACTOR = 1.35; // straight line → road distance in Kuwait's grid, approximate
const AVERAGE_SPEED_KMH = 28;
const MINUTES_PER_STOP = 4;

export function phoneDigits(raw: string): string | null {
  const latin = String(raw ?? '').replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));
  let digits = latin.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('965') && digits.length > 8) digits = digits.slice(3);
  return digits.length >= 7 && digits.length <= 15 ? digits : null;
}

export function parsePin(value: unknown): LatLng | null {
  if (typeof value !== 'string') return null;
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(value);
  if (!match) return null;
  return validPin(Number(match[1]), Number(match[2]));
}

export function validPin(lat: unknown, lng: unknown): LatLng | null {
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180 || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

export function haversineKm(a: LatLng, b: LatLng): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type DeliveryState = 'delivered' | 'on_the_way' | 'with_driver' | 'not_dispatched';

export function deliveryState(fleetbaseStatus: string | null | undefined): DeliveryState {
  const status = String(fleetbaseStatus ?? '').toLowerCase();
  if (status === 'completed') return 'delivered';
  if (['started', 'driver_enroute', 'enroute', 'in_progress'].includes(status)) return 'on_the_way';
  if (status === 'dispatched') return 'with_driver';
  return 'not_dispatched';
}

export interface LiveEstimate {
  distance_km: number;
  eta_minutes: number;
  orders_ahead: number;
  /** undelivered orders of the same driver that have no usable pin, so they could not be ranked */
  orders_unranked: number;
  position_age_minutes: number;
  exact_pin: boolean;
}

export type LiveUnavailable = 'driver_position_missing' | 'driver_position_stale' | 'customer_pin_missing' | 'already_delivered';

export function liveEstimate(input: {
  now: Date;
  position: DriverPosition | null;
  target: { pin: LatLng | null; exactPin: boolean; state: DeliveryState };
  /** the same driver's other undelivered orders of the day */
  others: Array<LatLng | null>;
}): { live: LiveEstimate } | { unavailable: LiveUnavailable } {
  if (input.target.state === 'delivered') return { unavailable: 'already_delivered' };
  if (!input.position) return { unavailable: 'driver_position_missing' };
  const updated = input.position.updatedAt ? Date.parse(input.position.updatedAt) : NaN;
  const age = Number.isFinite(updated) ? (input.now.getTime() - updated) / 60000 : Infinity;
  if (!(age >= -5 && age <= POSITION_FRESH_MINUTES)) return { unavailable: 'driver_position_stale' };
  if (!input.target.pin) return { unavailable: 'customer_pin_missing' };
  const direct = haversineKm(input.position, input.target.pin);
  const ahead = input.others.filter((pin) => pin !== null && haversineKm(input.position!, pin) < direct).length;
  const distance = direct * ROAD_FACTOR;
  return {
    live: {
      distance_km: Math.round(distance * 10) / 10,
      eta_minutes: Math.max(1, Math.round((distance / AVERAGE_SPEED_KMH) * 60 + ahead * MINUTES_PER_STOP)),
      orders_ahead: ahead,
      orders_unranked: input.others.filter((pin) => pin === null).length,
      position_age_minutes: Math.max(0, Math.round(age)),
      exact_pin: input.target.exactPin,
    },
  };
}
