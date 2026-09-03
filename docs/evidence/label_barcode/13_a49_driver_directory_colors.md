# 13 — A49: Fleet-Ops driver directory fix + stable per-driver label colours

Date: 2026-09-03 · Owner ask: "لكل سائق لون مختلف … علشان يكون سهل عليهم يحملوا الأوردرات في سيارتهم".
Branch `build/wp-lbl-a49-driver-directory-colors` → `fix/a45-console-performance`.

## Finding (Verified on staging)

Opening a driver-assigned order (NUT0275153784KW, RAVI) in Label & Barcode failed with
`upstream_unavailable: assigned_driver_not_in_company_directory`. Fleetbase's httpd log showed
`GET /int/v1/drivers?limit=-1&with[]=vehicle → 200, 123 KB`, so the request succeeded; the API's
`arrayPayload()` accepted only a plain list or `{data: [...]}`, while Fleetbase 0.7.48 wraps internal
collections as `{ drivers: [...] }` (`HasApiControllerBehavior` → `$resourceClass::wrap(plural)`).
The directory was therefore always empty and **every assigned driver failed**; only driver-less
(held) orders could print. The internal `Index/Driver` resource also carries no `vehicle` and a
numeric `id`, so unwrapping alone would then have failed on the plate. The public
`/v1/drivers?limit=-1` (verified with the company API key, read-only) returns a plain list of all 12
company drivers with `id` = public id, `phone`, `vehicle.plate_number`, `created_at`.

## Change

- `HttpFleetbaseIdentityGateway.drivers()` → `GET /v1/drivers?limit=-1`; `arrayPayload()` also
  unwraps `{drivers|orders|vehicles: [...]}` defensively.
- Colour assignment (A28 "public id owns the colour") amended: the colour pool is the plated drivers
  in Fleetbase `created_at` order (ties by public id). Adding a driver appends a colour and never
  recolours existing units; drivers without a plate (the 3 non-real rows) take no colour.
- Resulting staging mapping (9 real units, creation order 2026-07-18 12:50): Vineesh red, Salato blue,
  Nicholas green, AMAN orange, Naseer purple, IBRAHIM/RAMZI teal, Arsad pink, fairoz navy, RAVI brown.

## Tests

TS-U identity: public directory URL + wrapped/plain unwrapping; colour stability/plate exclusion;
existing colour/plate/phone fail-closed tests unchanged. Full Vitest green locally.
