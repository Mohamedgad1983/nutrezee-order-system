# Incremental Sync (30-minute) — Dry-Run Foundation

**Status:** Built **disabled** (no cron/timer enabled). STAGING only. Production untouched.
**Component:** `tools/legacy-full-migration/incremental-sync.mjs`
**Phase:** 2 foundations, on top of Phase-1 acceptance `STORED_WITH_ACCEPTED_EXCEPTIONS`
**Environment:** NestJS modular monolith + Postgres 16 on VPS; staging `https://13-140-159-201.sslip.io`, operated via the `nutrezee-vps` MCP.
**Legacy source:** `nutreeze.com` admin — **read-only**.

---

## 1. Purpose & scope

Establish a repeatable, overlap-safe mechanism to detect legacy meal-plan orders that are **not yet stored** in staging and prove they would import cleanly — **without applying anything and without sending any WhatsApp message**. This is the *foundation* for a future production incremental sync; this iteration is deliberately a **dry-run only** harness.

Phase-1 baseline already accepted into staging:

| Object | Stored | Notes |
|---|---|---|
| Customers | 19,463 | |
| Orders | 20,103 | safely-importable subset |
| Payments | 11,538 | |
| Deliveries | per-order | stored alongside orders |
| Exceptions | 1,272 | documented in `migration_exception_review` |

**In scope:** change detection vs. a watermark, M19 dry-run, idempotency reasoning, overlap prevention, error handling, safety rails, decoupling from WhatsApp, and what a production version must add.
**Out of scope (this iteration):** any `apply`, any human-review apply gate (designed but not wired), live re-pull from legacy admin (uses on-disk extract), cron scheduling.

---

## 2. Architecture & data flow

```
                       ┌─────────────────────────────────────────────┐
                       │  incremental-sync.mjs  (DRY-RUN, disabled)   │
                       └─────────────────────────────────────────────┘
                                          │
  (1) acquire O_EXCL lockfile  ───────────┤  /tmp/nutrezee-incremental-sync.lock
      (stale-reclaim > 25 min)            │
                                          ▼
  (2) read watermark  ───────►  Postgres: SELECT max(legacy_key) + counts
                                          │              FROM sync_record (object_type='order')
                                          ▼
  (3) read candidate source  ─►  on-disk extract  (orders_history.json, read-only)
                                          │   [PRODUCTION: re-pull from legacy admin, read-only]
                                          ▼
  (4) diff: keep rows NOT in sync_record, validate, normalize to KWD minor units
                                          │
                                          ▼
  (5) bootstrap TEMP super-admin  ─►  Postgres: insert staff_user + super_admin role
      (in-process password)            │   then POST /auth/login → nz_session cookie
                                          ▼
  (6) DRY-RUN import  ─────────►  M19:  POST /imports/active_plans/dry-run   (NEVER /apply)
                                          │   idempotent, audited, chunked (100 rows)
                                          ▼
  (7) delete TEMP super-admin  ─►  Postgres: remove role/session/staff_user
                                          ▼
  (8) emit JSON summary (would_create / would_match / would_fail), release lock
```

The script is a thin **client** of the governed M19 importer. It contains **no business write path** of its own: every decision about create/match/error belongs to M19 inside the API, which keeps single-write-path and same-transaction-audit guarantees intact. The script only reads (watermark, extract) and calls the dry-run endpoint.

| Endpoint | Used here | Reads | Writes |
|---|---|---|---|
| `POST /imports/active_plans/dry-run` | yes | candidate rows | none (simulation only) |
| `POST /imports/active_plans/apply` | **never** | — | — |
| `POST /auth/login` | yes (temp admin) | — | session row |

---

## 3. Change detection & watermark strategy

### 3.1 What the watermark is

The watermark is the **highest numeric legacy order id already recorded in `sync_record`**:

```sql
SELECT max((legacy_key)::bigint) AS max_order, count(*) AS n
FROM sync_record
WHERE object_type='order' AND legacy_key ~ '^[0-9]+$';
```

- **Observed watermark:** `24630` (max legacy order id synced).
- **Observed synced order count:** `20,103`.

`sync_record` is the canonical "what has staging already absorbed" ledger, keyed by `(object_type, legacy_key)`. Using it — rather than a stored cursor file — means the watermark is **derived from durable state**, so it self-heals after a crash and cannot drift from reality.

### 3.2 Two-level detection (high-water + membership set)

A monotonic numeric watermark alone is necessary but not sufficient (legacy ids are not strictly contiguous; back-dated or re-opened orders can appear below the max). The script therefore loads **two membership sets** up front:

| Set | Source | Purpose |
|---|---|---|
| `storedOrders` | `sync_record` where `object_type='order'` | skip any order already absorbed |
| `storedCust` | `sync_record` where `object_type='customer'` | require the order's customer to already exist |

A candidate order is **new** only if its id is absent from `storedOrders`. The numeric watermark/count is logged for operator visibility and is the primary cursor a production pull will use (`id > watermark`), but the membership set is the authoritative gate against double-processing.

### 3.3 Candidate validation & normalization

Before a row becomes a candidate it must pass:

| Check | Rule |
|---|---|
| Not already synced | `id ∉ storedOrders` |
| Valid date window | `start_date`, `end_date` are real `YYYY-MM-DD`, `end ≥ start` |
| Package present | `o.package` non-empty |
| Valid phone | `/^\+\d{8,15}$/` |
| Customer pre-exists | `phone ∈ storedCust` (orders never create customers here) |
| Non-negative money | total ≥ 0 |

Normalization: money is converted to **KWD minor units** (`× 1000`, preferring `paid_amount`, falling back to `package_amount`). `total` and `payment_amount` are emitted as integer minor units; currency is fixed `KWD`. This keeps the script aligned with the platform rule "money in minor units."

### 3.4 Current dry-run result

> **0 candidate new orders.** Every safely-importable legacy order at/under the observed watermark is already present in `sync_record`. The diff correctly produces an empty work set, the importer is not called, and no temp admin is created.

This is the expected steady state for the foundation: it proves the detection path runs end-to-end and finds nothing to do, rather than silently importing.

---

## 4. Why dry-run first

1. **Reversibility.** A dry-run mutates nothing in staging — there is no row to roll back, no audit noise, no partial batch.
2. **Acceptance is frozen.** Phase-1 was accepted *with documented exceptions*. A blind incremental apply could reintroduce the same data-quality classes the exception review already catalogued. Dry-run lets us observe `would_create / would_match / would_fail` and compare against the 1,272-row exception baseline before any human authorizes an apply.
3. **Trust the governed path, verify the inputs.** M19 is the trusted writer; the *unknown* is the incremental feed. Dry-run exercises the real importer logic against the new feed and surfaces validation outcomes without consequence.
4. **Gate, not gun.** Production will add a human-reviewed apply gate (§7). Building dry-run-first makes that gate the *only* way state ever changes — apply is never the default.

---

## 5. Idempotency

The script is **safe to run any number of times**; repeated runs over the same feed converge to the same outcome.

| Layer | Mechanism | Effect |
|---|---|---|
| Detection | `sync_record` membership sets | already-synced ids are dropped before the importer is touched |
| Importer matching | M19 matches by **`order_number` / `sync_record`** | a row that already exists is reported `matched`, never duplicated |
| Money/keys | deterministic normalization (`order_number = legacy_id`, KWD minor units) | identical input → identical request body |
| Mode | endpoint is `/dry-run` | the operation is inherently idempotent (no writes) |

Because the importer keys on `order_number`/`sync_record`, even if a production run later applies, re-running it cannot create a second copy of an order — it resolves to `matched`. The script's own diff is an *optimization* (avoid sending known rows), not the correctness boundary; M19's matching is.

---

## 6. Overlap prevention, error handling, temp-admin lifecycle

### 6.1 Overlap prevention

A 30-minute cadence against a possibly-slow legacy source risks two runs colliding. Two independent guards:

1. **Atomic lockfile (in-process).** `fs.writeFileSync(LOCK, pid, { flag: 'wx' })` — `O_EXCL`; the create fails if the file exists. On failure the script **exits 0** with `{ skipped: 'another sync is running' }` (a benign skip, not an error).
2. **Stale reclaim.** If the lock exists but its mtime is older than **25 minutes** (i.e. a previous run died without releasing), it is unlinked and re-acquired — chosen to be < the 30-minute interval so a crashed run cannot wedge the schedule permanently.
3. **Intended cron wrapper.** The production timer is expected to wrap the command in `flock` as a second, OS-level guard. **Cron/timer is NOT enabled in this iteration.**

The lock is released in a `finally` block on every exit path (success, fatal, or skip-by-empty).

### 6.2 Error handling

| Failure | Handling |
|---|---|
| Lock held | log `skipped`, exit 0 (not a failure) |
| Malformed candidate row | filtered out by validation; never reaches importer |
| Login / cookie missing | throws → caught by top-level `try`, temp admin still deleted |
| Importer non-2xx | counts simply don't increment; run continues over remaining chunks |
| Any fatal exception | `catch` logs `{ fatal }`, **deletes temp admin**, `finally` closes DB + releases lock |
| DB connection drop | `client.end()` guarded; lock released regardless |

Output is **structured JSON lines** (one object per event) with ISO timestamps — greppable, no PII, suitable for log shipping.

### 6.3 Temp super-admin lifecycle

The dry-run endpoint requires an authenticated super-admin session. The script bootstraps a **disposable** one and tears it down:

| Step | Action |
|---|---|
| Create | upsert `staff_user` `sync-temp@nutrezee.local`, assign `super_admin` role, **in-process random 24-byte password** (`crypto.randomBytes`), argon2-hashed |
| Use | `POST /auth/login` → capture `nz_session` cookie only |
| Delete | remove `role_assignment`, `session`, then `staff_user` — in a transaction |

The password is **never printed, never written to disk, never committed**. The temp admin is deleted on success *and* on fatal error. (The sibling `import-runner.mjs` follows the same pattern and additionally writes `staff.created`/`staff.deleted` audit events — a production sync should match that for traceability.)

---

## 7. What a production version adds

This foundation reads an on-disk extract and never applies. The production incremental sync layers the following on top, **without changing the core diff/idempotency/overlap design**:

| Capability | Foundation (now) | Production (target) |
|---|---|---|
| Candidate source | on-disk `orders_history.json` | **re-login to legacy admin (read-only)** each run, pull `orders` where `id > watermark` + **new customers** |
| Customer prerequisite | requires `phone ∈ storedCust` | pull + dry-run **new customers first** (`/imports/customer/dry-run`), then orders |
| Apply | never | dry-run → **human-reviewed apply gate** → `/imports/{...}/apply` only after explicit authorization |
| Scheduling | disabled | enabled 30-min timer wrapped in `flock`; lock + stale-reclaim retained |
| Audit | dry-run only | temp-admin `staff.created`/`staff.deleted` audit events; apply runs produce M19 import-batch audit rows |
| Comparison gate | log counts | diff `would_fail` against the 1,272 accepted-exception baseline; block apply on new failure classes |

**Legacy re-pull constraints (carried from the read-only extractor):** GET-only URL allowlist, credentials from env only (never logged/committed), throttled and resumable, raw HTML captured outside the repo. The sync must never call any legacy mutation endpoint.

**The apply gate is the only path to a state change.** Production never auto-applies: a run produces a dry-run report; a human reviews `would_create / would_match / would_fail` against the accepted baseline; only then is an `apply` run authorized for the reviewed batch.

---

## 8. Safety rails (must always hold)

| Rail | How it's enforced |
|---|---|
| Staging only, never production | runs against staging API/DB; production credentials never present |
| No destructive SQL | only `SELECT` against legacy/extract; temp-admin `DELETE`s are scoped to the bootstrap row, in a transaction |
| Dry-run only (this iteration) | hard-coded `/imports/active_plans/dry-run`; `MIGRATION_APPLY` env is **ignored** |
| No WhatsApp sent | see §9 |
| No raw PII committed | candidate rows live in memory; logs are counts/ids only; extract lives outside the repo |
| No secrets committed | temp-admin password generated in-process, never logged/persisted; legacy creds from env only |
| No overlapping runs | `O_EXCL` lock + 25-min stale reclaim + intended `flock` wrapper |
| Cron not enabled | shipped disabled; no timer/cron unit installed |
| Temp admin removed | deleted on success and on fatal error |

---

## 9. Decoupling from WhatsApp

The sync **cannot** trigger an outbound WhatsApp message, by construction:

1. **It only calls `/imports/active_plans/dry-run`.** A dry-run performs no writes, so it raises no domain events, enqueues no outbox rows, and crosses no module boundary into m17 (whatsapp) or m11 (notifications).
2. **Notification dispatch is event/outbox-driven.** WhatsApp sends are produced by the owning module reacting to *committed* state transitions via the outbox. A dry-run commits nothing, so there is nothing for the dispatcher to act on.
3. **No direct coupling.** The script imports `pg`, argon2, ulid, crypto, fs only — it has no reference to any notification/whatsapp service or template.
4. **Even a future apply stays decoupled.** When production adds an apply gate, the only side effects are whatever M19 + the transition engine legitimately raise for a *real* order import. WhatsApp behavior is governed entirely by notification feature flags / transition config in the API — never by this client. The sync remains a data feed, not a messaging trigger.

---

## 10. Operational quick reference

```bash
# Dry-run (staging, inside the API container which has pg/argon2/ulid + DATABASE_URL):
node tools/legacy-full-migration/incremental-sync.mjs /srv/orders_history.json

# Env:
#   DATABASE_URL   required (staging)
#   API            default http://127.0.0.1:3000
#   LOCK           default /tmp/nutrezee-incremental-sync.lock
#   MIGRATION_APPLY  IGNORED (always dry-run)
```

**Expected output (steady state):**
```json
{"watermark_max_order_id":24630,"synced_orders":20103}
{"candidate_new_orders":0}
{"DRY_RUN_RESULT":true,"would_create":0,"would_match":0,"would_fail":0,"applied":false,"whatsapp_sent":false}
```

**Exit codes:** `0` on success or benign lock-skip; non-zero only on unhandled fatal (after temp-admin cleanup + lock release).

---

**File:** `/Users/it/Documents/NutrezeeOrderSystem/tools/legacy-full-migration/incremental-sync.mjs`
**Companion:** `import-runner.mjs` (catalog import, same temp-admin bootstrap pattern), `legacy-detail-extract.mjs` (read-only legacy pull, GET-only allowlist).
