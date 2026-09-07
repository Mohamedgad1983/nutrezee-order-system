# A61 — driver activity flow: "not delivered" + one-decision delivery

Owner directive 2026-09-07 ("نفّذ البندين 1 و2 كوحدة واحدة"). Config + ops-script change only;
no Fleetbase vendor code, no schema change, no Navigator change.

## What changed (live 2026-09-07, Fleetbase company `2db920aa…`, config `order_config_zYjt2qXcAX` Transport)

`transport.flow.json` replaces the Transport order-config flow:

```
created → dispatched → started ─┬→ completed            (Delivered / تم التسليم, complete)
                                ├→ nd_no_answer         ┐
                                ├→ nd_no_bin            │ code not_delivered
                                ├→ nd_wrong_address     │ → completed | returned_to_kitchen
                                ├→ nd_refused           │
                                └→ nd_postponed         ┘
```

- `enroute` removed: the driver taps **Start** once, then makes **one decision** (Delivered or a
  not-delivered reason). A not-delivered order stays active for a retry (→ Delivered) or
  → Returned to kitchen.
- Reason keys share code `not_delivered` (status text carries the reason, EN / AR); Fleetbase
  resolves the current activity by code, so all reasons have identical children.
- No activity has `logic`/`events`; only `completed` has `complete:true`
  (`updateActivity` would otherwise convert the status to `completed`). `require_pod` stays false
  (photo proof is a separate owner decision, item 3).

`nutreeze-complete-past-orders.php` (cron `/etc/cron.d/nutreeze-complete-past-orders`, 01:00
Europe/Berlin = 02:00 Kuwait in summer) now closes past-day orders by rule:

| status at 02:00 | becomes | tracking row | tag |
|---|---|---|---|
| dispatched | completed | COMPLETED | `a29_complete_past_orders` (transitional) |
| started | completed | COMPLETED | `a61_started_not_completed` |
| not_delivered | expired | EXPIRED "Closed without delivery" | `a61_not_delivered_closed` |
| returned_to_kitchen | expired | EXPIRED | `a61_returned_closed` |

`expired` is a Fleetbase-native inactive status (excluded by the `active` order filter Navigator
queries with), distinct from Partner cancellations (`canceled`) and deliveries (`completed`).

## Files

- `transport.flow.json` — the flow (internalIds generated 2026-09-07).
- `apply-transport-flow.php` — validates + dry-runs; writes with `--apply --confirm=NUTREEZE`
  (Eloquent save + cache invalidation). Runs inside `fleetbase-application-1`.
- `verify-transport-flow.php` — read-only: next activities per status under the live config.
- `probe-rollback.php` — model-path test on a real order inside a rolled-back transaction.
- `nutreeze-complete-past-orders.php`, `run-daily-completion.sh` — VPS copies live in
  `/opt/fleetbase/api/storage/app/integrations/` (root, 0700).

## Rollback

```
docker exec fleetbase-database-1 sh -c 'mysql -uroot "$MYSQL_DATABASE"' < /opt/fleetbase/backups/a61-pre/order_configs-20260907T0748Z.sql
cp /opt/fleetbase/backups/a61-pre/nutreeze-complete-past-orders.php /opt/fleetbase/backups/a61-pre/run-daily-completion.sh /opt/fleetbase/api/storage/app/integrations/
```
