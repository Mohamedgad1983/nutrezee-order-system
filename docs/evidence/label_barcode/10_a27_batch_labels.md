# 10 — A27/A28 Fleet-Ops batch labels by driver or area

> **Status:** implementation and CI complete on 2026-07-29; staging deployment verification is
> recorded in section 8.

## 1. Corrected operational requirement

The existing `https://ops.nutreeze.com/` Fleet-Ops Console remains the sole operations admin.
Its Resources section now contains a supported `Batch Labels` extension page where an operator
can:

- choose the current day's driver or area;
- select all orders in that group or a subset;
- prepare all selected labels together;
- open one browser print dialog for the complete batch; and
- confirm the successful physical print separately.

Each printed page is one 100 × 70 mm legacy-format label with the customer's one permanent,
non-PII Code 128 barcode. The individual `Label & Barcode` order-details tab remains available.

## 2. The `39` correction

The previously reported `39` was **not** a Partner snapshot count. It was the count of local
`fulfillment_day` rows for 2026-07-29. That local table is not a complete operational source and
must never stand in for the daily Partner → Fleetbase order set.

Verified PII-free Partner snapshot evidence:

| Delivery date | Partner daily orders | Dispatchable | Status |
|---|---:|---:|---|
| 2026-07-27 | 892 | 679 | stable two-pass, explicitly non-authoritative |
| 2026-07-28 | 901 | 680 | stable two-pass, explicitly non-authoritative |
| 2026-07-29 | no completed manifest | — | first source pass repeatedly failed |

The 2026-07-28 manifest is
`/var/lib/nutreeze-partner-snapshots/2026-07-28.json`; it says
`daily_orders=901`, `orders_dispatchable=680`, `fleetbase_written=false`, and
`stable_two_pass_not_authoritative`.

The snapshot is deliberately read-only and does not feed Fleetbase. Batch Labels therefore reads
the operator-visible current-day Fleetbase order set, not the snapshot file and not the local
fulfillment count. If that Fleetbase set is empty or any order is not mapped to authoritative
label data, printing is blocked rather than silently producing a partial batch.

## 3. Fail-closed source contract

`GET /fleet-ops/labels/batch/options`:

- derives Kuwait today on the server;
- uses Fleetbase's supported `scheduled_at` filter through the caller's existing bearer token;
- paginates the complete exact-current-day set and excludes held/cancelled work;
- maps each Fleetbase order to the Nutrezee order/fulfillment data;
- returns `source_total`, fully mapped `total`, and `unmapped`; and
- sets `ready=true` only when the complete source set is mapped.

The page shows all three numbers. A zero source produces an explicit “daily orders not ready”
state. A nonzero mismatch shows the exact unmapped count and disables driver/area printing.
Preview and print confirmation re-run the same completeness guard server-side, so a stale or
modified browser cannot bypass it.

Historical mapping analysis proved this guard is necessary. Of 946 Fleetbase orders for
2026-07-20, only 523 had a usable `sync_record` order mapping and only 104 matched directly by
`source_order_number`. Printing the local subset would therefore have omitted hundreds of real
orders.

## 4. Batch selection and label rendering

Selection identifiers are opaque hashes of the server date and local order identifier. The server
revalidates every selection against the caller-visible current-day source set. Driver and area
values come from Fleetbase assignment/order metadata; the browser cannot submit arbitrary
customer or upstream UUID values.

`POST /fleet-ops/labels/batch/preview` issues the customer's permanent barcode idempotently and
returns the exact legacy-format labels plus print history. Missing dish/nutrition source renders
the explicit existing empty state; no meal or nutrition value is inferred or fabricated.

The operational batch maximum is 500 labels, which covers the requested example of roughly 100
orders for one driver while bounding one browser print operation.

## 5. Honest print and reprint governance

Opening the browser print dialog creates no print record. After the dialog closes, the operator
must choose either:

- `Confirm printed`, which calls `POST /fleet-ops/labels/batch/printed`; or
- `Cancel — do not record`, which makes no API call.

The server classifies each selected label as first print or reprint. If any label was printed
before, a reprint reason is mandatory. Confirmation takes advisory locks and records the complete
batch in one PostgreSQL transaction with one `batch_ref`, one event per label, and same-transaction
audit. A cancelled dialog cannot create false print history.

## 6. Supported Fleet-Ops extension boundary

The extension registers:

```text
menuService.registerMenuItem(
  "engine:fleet-ops",
  MenuItem({ section: "management", slug: "nutrezee-batch-labels", component: "batch-labels" })
)
```

Fleet-Ops 0.7.48 reserves `/fleet-ops/operations/:value` for order details, so using its
`operations` extension section caused `nutrezee-batch-labels` to be treated as an order public
ID. The supported `management` registry renders under the user-facing **Resources** section and
uses Fleet-Ops' non-conflicting virtual page route:
`/fleet-ops/management/nutrezee-batch-labels`. No Fleetbase route or application/vendor source
was modified. The separately identifiable extension is
`@nutrezee/fleetops-labels-engine` v0.2.1.

## 7. Verification before deployment

- Focused label, Fleetbase-identity and extension tests: 40/40 passed.
- Full Vitest: 69 files / 386 tests passed.
- ESLint passed.
- API typecheck and build passed.
- PR #44 push and pull-request runs `30415333374` and `30415335261` each passed the complete
  14-job matrix: lint, typecheck, build, Docker validation, boundary scan, no-GET-mutation scan,
  and TS-U/I/M/R/A/C/E/S.
- Commit: `d040ddb feat(WP-LBL-A27): add Fleet-Ops batch label printing`.

## 8. Staging deployment and live verification

The correction is deployed to the existing `https://ops.nutreeze.com/` Fleet-Ops admin:

| Component | Live evidence |
|---|---|
| Fleetbase Console | `v0.7.48-a28.4`; image `sha256:8703df307259757abc553edf3bdea5adbf25596ab430b7390a3a3dfa55b0a0cd` |
| Extension | `@nutrezee/fleetops-labels-engine` `v0.2.1`; ten extensions present in the live manifest |
| Nutrezee API | image `sha256:d6db705521a321a61d8127c2fa28f7e5c9473ba11a7289938a9f06b70f4da532` |
| Public health | `GET /nz/health` → `200 {"status":"ok","service":"nutrezee-api"}` |
| Auth boundary | no-token `GET /nz/fleet-ops/labels/batch/options` → `401 fleetbase_token_required` |
| Console cache safety | HTML returns `Cache-Control: no-cache, must-revalidate` and `Clear-Site-Data: "cache"`; cookies and local storage are not cleared |

The first authenticated real-data load exposed that an unfiltered `/v1/orders?limit=-1` request
timed out against Fleetbase's 1,964-order stored history. The API was corrected to send the
server-selected Kuwait date through Fleetbase's supported `scheduled_at` filter and read bounded
100-order pages. The shipped artefact was inspected for that exact request shape before the API
container was recreated. The authenticated browser then loaded the page successfully under:

```text
Fleet-Ops → Resources → Nutrezee Batch Labels
/fleet-ops/management/nutrezee-batch-labels
```

The live user shown was `MOHAMED MOSTAFA ALI GADELRAB`. The page returned the honest current-day
result for `2026-07-29`: `source_total=0`, `total=0`, assigned drivers `0`, and areas `0`, with
the explicit warning that the complete Partner → Fleetbase dispatch set is not ready and that no
partial local count will be printed. It did **not** substitute the local `39`. This is a successful
read-only proof of the real Fleetbase boundary, but there was no current-day customer batch
available to preview or print.

No print action was taken and no database row was changed. Post-deployment counts remained:

```text
customer=19,483
customer_order=20,204
fulfillment_day=530,540
address=9,542
customer_barcode=1
label_print_event=1
box_collection=1
```

## 9. Safety and rollback

Before any container swap:

| Artefact | Evidence |
|---|---|
| PostgreSQL dump | `/opt/nutrezee/backups/nutrezee-pre-a27-batch-20260729T0455Z.sql.gz` |
| Dump integrity | 21,218,828 bytes; `gzip -t` passed; 86 `COPY` blocks |
| Dump sha256 | `ee0b6b517c24d1fa4ea85e57e20fd9ff57f5dd4a717ca00f1b1a2eb05599fa5a` |
| API rollback image | `nutrezee-api:pre-a27-batch-20260729` → `0ceb8fa3eff1…` |
| API pagination rollback image | `nutrezee-api:pre-a27-pagination-20260729` → `8677d87b2e43…` |
| Console rollback image | `fleetbase-console:pre-a27-batch-20260729` → `9bf50d8d817f…` |
| Console source backup | `/opt/fleetbase/backups/a27-batch-console-src-20260729T0455Z.tar.gz` |

There is no database migration in this correction. Rollback retags the two preserved images and
recreates only the API and Console containers. PostgreSQL, Caddy, Fleetbase API, Partner and
legacy systems are not part of the swap.

## 10. Remaining operational dependency

A real current-day customer batch can appear only after the complete Partner day has been loaded
into Fleetbase and the orders are fully mapped to authoritative Nutrezee label data. On
2026-07-29 the read-only snapshot service was still retrying
`first_source_pass/source_read_failed`, no completed snapshot existed, and Fleetbase had no
current-day operational set. Batch Labels intentionally shows “not ready” instead of the
misleading local count of 39.

The exact physical scaling and camera decode from paper still require the previously documented
printer/device pilot. No physical print is claimed by this software deployment.
