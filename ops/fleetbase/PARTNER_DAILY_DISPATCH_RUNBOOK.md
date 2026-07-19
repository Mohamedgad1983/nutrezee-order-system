# Partner API daily Fleetbase dispatch

This bridge reads the Partner API daily meal snapshot and creates one
integration-owned Fleetbase transport order per distinct delivery. It does not
write to the Partner API or the legacy application.

## Safety contract

- The source of truth is `GET /integration/meal-history`, joined to
  `GET /integration/orders` by the source order number.
- A stable date-scoped Fleetbase prefix makes an unchanged source snapshot
  idempotent. Once a job is dispatched, source and driver hashes are immutable;
  a changed snapshot fails before it can alter the live job.
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
- Rows with a missing, malformed, transposed, zero, or outside-Kuwait pin remain
  `created`, unassigned, **unscheduled**, and explicitly held. The display-only
  fallback centroid is never dispatched to a driver or used as the real pin.
- Pickup, dropoff, driver, tracking, source count, and duplicate reconciliation
  are checked inside the write path. Any unexplained order aborts the transaction.
- Existing orders outside the governed `created`/`dispatched`/`canceled` states
  are never reset by the bridge.
- Logs contain aggregate counts and error codes, not API keys, passwords, names,
  phones, or addresses.

## Protected files on the VPS

The config directory must be root-owned mode `0700`:

- `/opt/fleetbase/api/storage/app/integrations/config`

All three files must be root-owned regular files with mode `0600`:

- `/root/nutreeze-vendor.key`
- `/opt/fleetbase/api/storage/app/integrations/config/nutreeze-driver-roster.json`
- `/opt/fleetbase/api/storage/app/integrations/config/nutreeze-pickup.json`

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

Use the delivery date and the independently proven 2026 history boundary shown
below for both commands. The first pass produces aggregate `daily_orders` and
`source_digest`; pass both values back to the write so a changed or partial
second snapshot fails:

```sh
/opt/fleetbase/integrations/nutreeze-orders/run.sh \
  --delivery-date=YYYY-MM-DD \
  --meal-since=2026-01-01T00:00:00+03:00 \
  --limit=1000 \
  --dry-run

/opt/fleetbase/integrations/nutreeze-orders/run.sh \
  --delivery-date=YYYY-MM-DD \
  --meal-since=2026-01-01T00:00:00+03:00 \
  --limit=1000 \
  --expected-count=SOURCE_COUNT \
  --expected-digest=64_CHARACTER_SOURCE_DIGEST \
  --verify \
  --confirm-daily-sync=YYYY-MM-DD
```

The write command is valid only when `daily_verification.passed=true`,
`unexplained_orders=0`, and `duplicate_internal_ids=0`.
A zero-row API snapshot fails closed; a confirmed no-delivery day additionally
requires `--confirm-zero-day=YYYY-MM-DD`.

## Timer (installed, deliberately disabled)

The supplied timer targets 07:00 Kuwait (04:00 UTC), after the documented 06:00
Partner snapshot. The service accepts only the 06:45–07:45 Kuwait window, does
not replay missed timers, waits for a healthy Fleetbase application container,
and performs two independent API passes whose count and digest must match.

Do **not** enable unattended execution yet. The Partner envelopes expose a
per-page `count`, not an authoritative total for a delivery date; two matching
passes therefore prove snapshot stability but cannot independently prove that
the source published every expected delivery. The complete July 19 cursor walk
exposed 954 deliveries, while the manager dashboard reports 981; the 27-row
upstream discrepancy remains unresolved. Future dates require an authoritative
Partner daily total (or an operations-approved expected-count manifest) before
enabling the timer. The 2026 scan also uses the independently tested
`2026-01-01T00:00:00+03:00` history floor and must be revisited before 2027.

Confirm it remains disabled with:

```sh
systemctl is-enabled nutreeze-partner-daily.timer
journalctl -u nutreeze-partner-daily.service --since today
```

## API key rotation

Mohamed can rotate the Partner key after handover:

1. Put the replacement value in a new root-owned mode-`0600` file.
2. Atomically replace `/root/nutreeze-vendor.key`.
3. Run a `--dry-run` for the current delivery date.
4. Revoke the old key only after the dry run returns HTTP 200 and reconciles.

No application rebuild or container restart is required.
