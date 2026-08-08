# 03 — Collection scan verification (WP-LBL-03 / WP-LBL-04)

> All seven approved outcomes exercised over **real HTTP** against a running API, plus
> idempotent retry, duplicate prevention and the audit trail. 2026-07-27.

## 1. Setup

Local demo database `nutrezee_lbl_demo` (migrations 0001–0027), API on :3000, admin + API behind a
local proxy on :5199 standing in for `docker/nginx.admin.conf`.

Two drivers, each with a Nutreeze **staff account** linked by `driver.staff_user_id` — the
authentication model chosen for A27:

| Driver | staff login | `legacy_driver_id` | route |
|---|---|---|---|
| Driver A1 | `driver.a1@nutreeze.test` | `A1` | today's route, 3 orders |
| Driver A2 | `driver.a2@nutreeze.test` | `A2` | today's route, 1 order |

Sign-in returns `roles: ["driver"]` and the manifest resolves the driver from the session:

```
POST /auth/login  → 200 {"staff_id":"…","name":"Driver A1","roles":["driver"],"locale":"en"}
GET  /collection/manifest?date=2026-07-27
     → {"driver_ref":"A1","total":2,"collected":0,"remaining":2,
        "entries":[{"order_number":"26497","customer_name":"***","masked":true, …}]}
```

`customer_name` comes back **masked** for the driver role. That is deliberate: visibility grants
aggregate per role, so granting `pii` on `collection.manifest.read` would have given every driver
blanket PII access across the whole API. Drivers identify the stop by order number, area and time.

## 2. The seven outcomes — real HTTP responses

Each row is the actual response body from `POST /collection/scan` as Driver A1.

| Scenario | Outcome | Response detail |
|---|---|---|
| A1's own customer, first scan | `accepted` | order 26496 — "Collected — daily box recorded." |
| same customer, scanned again | `duplicate` | "Already collected today." |
| customer on A2's route | `wrong_driver` | `assigned_driver_ref: "A2"` — "Not on your manifest today." |
| delivery scheduled 5 days out | `no_delivery_today` | "This customer has no delivery today." |
| today's day is `cancelled_day` | `cancelled` | "Today's delivery is cancelled." |
| `NZC-ZZZZ-ZZZZ-ZZ` (unissued) | `unknown_barcode` | "Barcode not recognised." |
| customer with 2 live days today | `ambiguous_delivery` | "More than one active delivery — contact operations." |

Every response also carries `message_ar`, so the driver app renders the outcome in the driver's own
language without re-wording it.

## 3. Idempotent retry

A retried request must repeat its original **accepted** answer rather than degrade to `duplicate`,
which would read to a driver as a failure:

```
first  (Idempotency-Key K)  → accepted  | 2026-07-27T10:45:09.514Z
retry  (same key K)         → accepted  | 2026-07-27T10:45:09.514Z   ← same timestamp
fresh scan (no key)         → duplicate | 2026-07-27T10:45:09.514Z   ← correctly a duplicate
rows in box_collection      → 1
```

## 4. Audit — every outcome, accepted and rejected

```
collection.accepted           2
collection.ambiguous_delivery 1
collection.cancelled          1
collection.duplicate          3
collection.no_delivery_today  1
collection.unknown_barcode    1
collection.wrong_driver       1
```

All seven event types present. Rejections are audited in their own transaction; the accepted scan
is audited in the **same** transaction as the `box_collection` insert.

`box_collection` is append-only at the database level — an attempted `DELETE` during this session
was refused by the `forbid_mutation()` trigger, which is why the retry check used a second customer
rather than clearing the table.

## 5. Concurrency

Covered by `tests/integration/ts-i-collection.test.ts`: four simultaneous scans of the same box
produce exactly **1 accepted and 3 duplicates**, with one row recorded. The winner is arbitrated by
the `UNIQUE (customer_id, delivery_date)` index rather than by application timing.

## 6. Driver app

`__tests__/nutrezee-collection-test.js` (15 tests) covers the client and the outcome presentation:

- the API base is derived from the host the app already uses → `https://ops.nutreeze.com/nz`;
- credentials go in the POST body, never the URL;
- all seven outcomes are carried back verbatim, rejections included;
- the `Idempotency-Key` header is sent when supplied and omitted when not;
- an **HTML** body is reported as `api_unreachable` — which is exactly what a proxy allow-list miss
  looks like from the device, and is the current state of `/nz/collection/*` until the admin image
  is redeployed;
- a server `error_code` is surfaced without leaking the raw body (no SQL detail reaches the driver);
- a transport failure reports `network`, never "wrong credentials";
- only `accepted` may render as a success; an unrecognised outcome degrades to `error`;
- every outcome and error string exists in **both** languages, the Arabic strings contain real
  Arabic characters, and the EN/AR namespaces have identical leaf keys.

Driver app suite: **64 suites / 327 tests passing** (baseline 63 / 312).

## 7. Known limitation — camera scanning cannot be verified in the Simulator

The iOS Simulator has no camera, so `useCameraDevice('back')` returns nothing and the live
`Code 128` capture path cannot be exercised there; the screen renders its "no camera" state. Camera
capture requires a physical device, and is part of the operational pilot (print ten labels, scan
them from paper) rather than something the Simulator can prove.

What *is* verified without a camera: the Code 128 payload itself round-trips — the rendered label's
barcode SVG is decoded back to its printed text by an independent decoder in the admin validation
(50/50 checks), and every scan outcome is proven end to end over HTTP above.
