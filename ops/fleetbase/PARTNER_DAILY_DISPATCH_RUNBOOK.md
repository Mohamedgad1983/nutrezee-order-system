# Partner API daily Fleetbase dispatch

This bridge reads the Partner API daily-delivery source and creates one
integration-owned Fleetbase transport order per distinct order. It does not
write to the Partner API or the legacy application.

## Safety contract

- The source of truth is the exact-date
  `GET /integration/daily-deliveries?delivery_date=YYYY-MM-DD` endpoint. Every
  page must report `mode=live` plus a stable `completeness.per_date` entry. The
  complete cursor walk must equal the declared delivery count, and the
  canonical result must equal `distinct_orders`; any mismatch aborts.
- The endpoint is one row per delivery instance, not necessarily one row per
  order. Fleetbase uses `order_id` as its job identity. A repeated order is
  collapsed only when customer/order/address/routing identity is identical and
  either every member has the same delivery status + `meal_item_count` (newest
  wins) or one newest positive-meal member supersedes zero-meal members. All
  delivery ids and states remain represented in the source digest. Any
  ambiguous duplicate aborts.
- The legacy `time_slot` object may contain null `id`, `title`, `start`, and
  `end` values. Those optional presentation values do not control scheduling;
  every non-null string remains type/length checked, and the bridge continues
  to use only the protected pickup `dispatch_time` for Fleetbase scheduling.
- `/integration/order-items` remains the authoritative Kitchen & Labels item
  source, not the driver-trip membership source. `/integration/orders` and
  `/integration/meal-history` are no longer used to select daily dispatch rows.
- A stable date-scoped Fleetbase prefix makes an unchanged source snapshot
  idempotent. Once a job is dispatched, source and driver hashes are immutable;
  a changed snapshot fails before it can alter the live job.
- Daily mapping v3 stores `partner_daily_deliveries_v1` on every order and
  payload. A date prefix created by the retired meal-history selector is rejected
  before reconciliation, preventing a selector change from canceling old jobs.
- Only canonical source orders in `success` with meal status `ordered` or
  `driver_assigned` and a nonzero, in-Kuwait Partner `location_pin` are scheduled,
  assigned across the fixed 11-driver roster by stable routing-area rendezvous
  hashing, and dispatched by the bridge so they are active in Navigator.
  `dispatch_time` is the displayed operational schedule; dispatch does not wait
  for Fleetbase's native scheduler because its queued lifecycle listener is
  blocked by the separately recorded Redis-prefix issue.
- An explicit source cancellation, or an existing source delivery that disappears
  from a later complete manifest, becomes a canceled, unassigned, unscheduled
  integration-owned tombstone if it has not started. An advanced job fails closed
  for operator intervention.
- By default, rows with a missing, malformed, transposed, zero, or outside-Kuwait
  pin remain `created`, unassigned, **unscheduled**, and explicitly held.
- Sponsor amendment A19 permits one exception for delivery date **2026-07-20**
  only: a manual run with the exact matching
  `--confirm-address-call-dispatch=2026-07-20` may assign an otherwise-approved
  location-held row when its address, customer phone, and a known area centroid
  are all present. Such an order is visibly labeled “NO EXACT PIN - CALL
  CUSTOMER / لا يوجد موقع دقيق - اتصل بالعميل”; the dropoff phone is populated
  for one-tap calling, and metadata preserves that the centroid is not the
  customer pin. Unknown-area country fallbacks remain held. The unattended
  daily script does not contain this option, and the program rejects it for
  every other date.
- Amendment A30 adds the recurring, still-manual missing-location recovery path. With the exact
  `--confirm-location-recovery=YYYY-MM-DD` confirmation, the host runner exports only the latest
  append-only Nutrezee captures (opaque Partner customer reference, coordinate, capture id) into a
  root-owned mode-0600 ephemeral file. For a missing/invalid Partner pin, the bridge uses an exact
  approved capture when present; otherwise it selects a same-area known operational stop nearest
  the published area centroid and labels it as a fallback requiring a customer call. If no known
  stop exists, the area centroid remains the final fallback. A valid Partner pin always wins. The
  anchor customer's identity is never exported or stored on the target order, and the ephemeral
  file is removed after the run. The unattended daily script does not supply the A30 confirmation;
  production activation remains prohibited until explicit release approval.
- The 70-entry A19 area lookup was built from the textual routing-area names in
  the complete July 19 source manifest plus the July 20-only Abbasiya and
  Qadsiya labels. Area names alone (no customer names, phones, detailed
  addresses, or Partner credentials) were cross-checked against the
  OpenStreetMap Nominatim Search API on 2026-07-20 under its public usage
  policy. OpenStreetMap contributors are the source of those approximate area
  points. They are operational grouping aids only, never customer pins or
  evidence of live-nearest-driver routing:
  <https://nominatim.org/release-docs/latest/api/Search/> and
  <https://operations.osmfoundation.org/policies/nominatim/>.
- Pickup, dropoff, driver, tracking, source count, and duplicate reconciliation
  are checked inside the write path. Any unexplained order aborts the transaction.
- Existing orders outside the governed `created`/`dispatched`/`canceled` states
  are never reset by the bridge.
- Logs contain aggregate counts and error codes, not API keys, passwords, names,
  phones, or addresses.

## Protected files on the VPS

The config directory must be root-owned mode `0700`:

- `/opt/fleetbase/api/storage/app/integrations/config`

The core files must be root-owned regular files with mode `0600`:

- `/root/nutreeze-vendor.key`
- `/opt/fleetbase/api/storage/app/integrations/config/nutreeze-driver-roster.json`
- `/opt/fleetbase/api/storage/app/integrations/config/nutreeze-pickup.json`

When exact Driver Orders membership is needed, an optional date-scoped
`driver-orders-YYYYMMDD.json` file lives in the same protected config directory.
It contains only delivery date, order numbers, count and SHA-256 digest—never
customer names, phones, addresses or credentials. The bridge rejects a missing
API member, duplicate, wrong date/count/digest, symlink, wrong owner or mode.

The API key is supplied to the container over standard input. It is never passed
in a command argument or environment variable.

## Deployment constraint

The July 19 rollout recreated only the Fleetbase scheduler to apply its
process-aware healthcheck. Do not recreate the application, queue, database,
cache, console, HTTP, or socket services as part of this bridge. The canonical
application host and the inherited `SESSION_DOMAIN` currently differ; that
browser-session configuration requires a separate change and authenticated
console smoke test.

## Manual preflight and run

Use the same delivery date for both commands. The first pass produces aggregate `daily_orders` and
`source_digest`; pass both values back to the write so a changed or partial
second snapshot fails:

```sh
/opt/fleetbase/integrations/nutreeze-orders/run.sh \
  --delivery-date=YYYY-MM-DD \
  --limit=1000 \
  --dry-run

/opt/fleetbase/integrations/nutreeze-orders/run.sh \
  --delivery-date=YYYY-MM-DD \
  --limit=1000 \
  --expected-count=SOURCE_COUNT \
  --expected-digest=64_CHARACTER_SOURCE_DIGEST \
  --verify \
  --confirm-daily-sync=YYYY-MM-DD
```

Before writing, the source summary must show matching
`delivery_response_rows=source_declared_deliveries` and
`daily_orders=source_declared_distinct_orders`, plus `reconciled=true` on the
second pass. The write command is valid only when `daily_verification.passed=true`,
`unexplained_orders=0`, and `duplicate_internal_ids=0`.
A zero-row API snapshot fails closed; a confirmed no-delivery day additionally
requires `--confirm-zero-day=YYYY-MM-DD`.

For the sponsor-approved A19 run only, append the same exact date confirmation
to both the manifest dry-run and the write:

```sh
--confirm-address-call-dispatch=2026-07-20
```

For an A30 staging/manual proof, append the exact operating date to both passes. The wrapper builds
the governed capture export itself; callers cannot provide their own capture file:

```sh
--confirm-location-recovery=YYYY-MM-DD
```

The summary must keep the Partner-only `source_digest`, and separately report
`orders_dispatchable_saved_pin`, `orders_location_known_stop_anchor`, and
`approved_location_captures_loaded`. Never treat fallback counts as exact customer pins.

When a verified Driver Orders manifest exists, append its protected container
path to both passes:

```sh
--driver-orders-manifest=/fleetbase/api/storage/app/integrations/config/driver-orders-YYYYMMDD.json
```

The summary must show `driver_orders_manifest_checked=true`, its expected
count/digest, and the explicit number of API-only orders excluded.

The source summary must show `orders_location_country_fallback_held=0` before
claiming that every otherwise-approved July 20 delivery was assigned. Do not
add this option to `nutreeze-daily-sync.sh`.

## Read-only daily snapshot timer

Under sponsor amendment A24, `nutreeze-partner-snapshot.timer` runs at 01:00
Kuwait (22:00 UTC on the preceding calendar day). This is five hours before the
previously documented 06:00 Partner publication, so the manifest must remain
explicitly `stable_two_pass_not_authoritative`; it must never be presented as
proof that every delivery for the date was already published. The job performs
two independent `--dry-run` API walks and persists only an allowlisted aggregate
manifest under:

```text
/var/lib/nutreeze-partner-snapshots/YYYY-MM-DD.json
```

The directory is root-only mode `0700`; each manifest is mode `0600`. Raw
Partner responses, customer names, phones, detailed addresses, credentials,
and per-order payloads are never retained. The manifest records the aggregate
count, source digest, location/hold counts, `fleetbase_written=false`, and the
explicit completeness state `stable_two_pass_not_authoritative`. A same-date
rerun is idempotent only when count and digest match; a changed source fails
without overwriting the first snapshot. Sanitized manifests are retained for
30 days under ASM-054.

The snapshot service is intentionally separate from the write service. Enable
and verify only the read-only timer with:

```sh
systemctl enable --now nutreeze-partner-snapshot.timer
systemctl start nutreeze-partner-snapshot.service
systemctl status nutreeze-partner-snapshot.service --no-pager
systemctl list-timers nutreeze-partner-snapshot.timer --no-pager
jq . /var/lib/nutreeze-partner-snapshots/"$(TZ=Asia/Kuwait date +%F)".json
```

## Rolling 48-hour dispatch timer (production active under A37/A38)

The A38 schedule correction targets 01:00 Kuwait (22:00 UTC on the preceding
calendar day) and refreshes **tomorrow and the following day** (+1/+2), giving
drivers a rolling 48-hour horizon without rewriting today's potentially started
work. The executable wrapper permits starts only from 00:45 through 01:45 Kuwait.
Each date performs a dry-run plus count/digest-locked write independently, so one
failed date does not block the other. A zero day requires the same stability plus
explicit zero confirmation. The oneshot service has `Restart=no`, preventing an
API retry storm; the timer tries again only on its next daily trigger.

Confirm the active schedule with:

```sh
systemctl is-enabled nutreeze-partner-daily.timer
systemctl is-active nutreeze-partner-daily.timer
systemctl show nutreeze-partner-daily.service -p Restart -p NRestarts
systemctl list-timers nutreeze-partner-daily.timer --no-pager
journalctl -u nutreeze-partner-daily.service --since today
```

## API key rotation

Mohamed can rotate the Partner key after handover:

1. Put the replacement value in a new root-owned mode-`0600` file.
2. Atomically replace `/root/nutreeze-vendor.key`.
3. Run a `--dry-run` for the current delivery date.
4. Revoke the old key only after the dry run returns HTTP 200 and reconciles.

No application rebuild or container restart is required.
