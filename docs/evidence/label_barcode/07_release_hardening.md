# 07 — Release hardening: PR, green CI, synthetic driver scan (WP-LBL-A27)

> 2026-07-27. PR **#44** open against `build/partner-daily-fleetbase`, **CI fully green**, and a
> synthetic driver scan performed end to end against **live staging**.

## 1. Pull request

**[#44 — WP-LBL-A27: exact legacy label + permanent customer barcode + collection scan](https://github.com/Mohamedgad1983/nutrezee-order-system/pull/44)**

Base is `build/partner-daily-fleetbase`, not `main`, because `m20-packing`, `m21-delivery`,
`m24-fleetbase` and migrations 0016–0026 exist only on that branch and this work depends on
packing + delivery.

9 commits · 37 files · +4 136 / −9.

**Not purely A27, and the PR says so:** it also carries 43 lines of A25/A26 amendment records
across `AGENTS.md` and the register. Those were sitting *uncommitted* in the working tree from the
preceding driver work when Gate 0 ran; committing them preserved them rather than losing them.

## 2. CI — green

Every check passed, on both the push run and the PR run:

| Job | Result |
|---|---|
| `lint` · `typecheck` · `build` | ✅ |
| `boundary-scan` (cross-module writes) | ✅ |
| `no-get-mutation-scan` | ✅ |
| `docker-validate` | ✅ |
| `ts-a` `ts-c` `ts-e` `ts-i` `ts-m` `ts-r` `ts-s` `ts-u` | ✅ all 8 vs Postgres 16 |

`ts-a` (audit) matters most here — it is cumulative and, once green, a permanent gate. `ts-r` (RBAC
matrix) passing confirms the deliberate decision not to give the `driver` role a `pii` grant.

This satisfies the AGENTS.md rule that a WP is DONE only when its DoD suites pass **in CI** — green
locally was never sufficient.

## 3. Synthetic driver scan — against live staging

Performed through `https://ops.nutreeze.com/nz/*`, the same host and path the driver app uses.

### Fixture

Entirely synthetic; **no real customer, order or driver record was touched**. Everything is
prefixed `a27probe`:

| Object | Id |
|---|---|
| Ops account (`ops_manager`) | `a27probe-ops` / `a27probe.ops@nutreeze.test` |
| Driver account (`driver`) | `a27probe-staff` / `a27probe.driver@nutreeze.test` → driver `A27P` |
| Second driver (`driver`) | `a27probe-staff2` / `a27probe.driver2@nutreeze.test` → driver `A27Q` |
| Customer / order / day | `a27probe-customer` / `A27-PROBE-1` / today, `scheduled` |
| Routes | `a27probe-route` (A27P, carries the order), `a27probe-route2` (A27Q, empty) |

Two accounts deliberately: **ops issues barcodes and prints; drivers scan.** That keeps the driver
account at exactly its real privilege level, so the masking behaviour is genuine rather than an
artefact of over-granting.

### Results

```
ops sign-in                    roles: ["ops_manager"]
barcode issued                 NZC-GQ2W-Y271-CF
issued again (idempotency)     SAME id, SAME value          ← never mints a second barcode
driver sign-in                 roles: ["driver"]
manifest                       driver_ref A27P · total 1 · collected 0 · remaining 1
                               customer_name "***"          ← masked for the driver role
```

| Scan | Outcome | Detail |
|---|---|---|
| 1 — driver A27P, their own box | **accepted** | "Collected — daily box recorded." / "تم الاستلام — تم تسجيل صندوق اليوم." |
| 2 — same box again | **duplicate** | same `collected_at` returned |
| 3 — `NZC-ZZZZ-ZZZZ-ZZ` | **unknown_barcode** | no customer leaked |
| 4 — `nzcgq2wy271cf` (no hyphens, lower case) | **duplicate** | scanner-format tolerance resolved it to the same customer |
| 5 — driver **A27Q** scans A27P's box | **wrong_driver** | `assigned_driver_ref: "A27P"` |

Manifest after: `total 1 · collected 1 · remaining 0`.
Driver A27Q's own manifest: `total 0` — drivers see only their own work.

### What was persisted

```
customer_id        a27probe-customer      driver_id   a27probe-driver
delivery_date      2026-07-27             route_id    a27probe-route
order_id           a27probe-order         barcode     NZC-GQ2W-Y271-CF
fulfillment_day_id a27probe-day           device_ref  a27-probe-device
scanned_at         2026-07-27 16:53:12    created_by  a27probe-staff
```

**Exactly one `box_collection` row from five scans.**

Audit — every outcome, accepted *and* rejected:

```
barcode.issued              info   1
collection.accepted         info   1
collection.duplicate        warn   2
collection.unknown_barcode  warn   1
collection.wrong_driver     warn   1
```

Append-only enforcement confirmed live:

```
UPDATE box_collection → ERROR: append-only table: box_collection does not allow UPDATE
DELETE box_collection → ERROR: append-only table: box_collection does not allow DELETE
```

## 4. Cleanup

The probe fixture is inert (its own customer, order and routes) but it is **live data on staging**
and should be removed once reviewed. `box_collection` is append-only by design, so that one row
cannot be deleted without dropping the trigger — which is the point of the trigger.

```sql
-- removes everything except the append-only collection row
DELETE FROM delivery_route_order WHERE id LIKE 'a27probe%';
DELETE FROM delivery_route       WHERE id LIKE 'a27probe%';
DELETE FROM customer_barcode     WHERE customer_id = 'a27probe-customer';   -- blocked while the
                                                                            -- collection row refs it
DELETE FROM role_assignment      WHERE id LIKE 'a27probe%';
UPDATE staff_user SET active = false WHERE id LIKE 'a27probe%';             -- deactivate, never delete
```

Deactivating the three probe accounts is the safe minimum; their one-off passwords live in
`/root/.a27-probe*-password` on the VPS (mode 600) and are used nowhere else.

## 5. Remaining

- PR #44 is **open, not merged** — merging is yours.
- Migrations **0024–0026 still pending** on staging; a future plain `migrate.mjs` run applies them,
  including 0025's RBAC change.
- A **live Code 128 camera decode** is still unproven — it needs a physical device, and belongs to
  the operational pilot (print ten labels, scan them from paper).
