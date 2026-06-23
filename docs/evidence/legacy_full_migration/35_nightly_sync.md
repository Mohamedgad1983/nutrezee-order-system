# 35 — Nightly legacy → staging sync (auto-apply pipeline) + adversarial safety review

**Date:** 2026-06-23 · **Status: BUILT, hardened, NOT yet enabled (owner one-time enable)** · Follows docs 32–34.
**Goal:** a real nightly job that pulls **new** legacy orders into the new system unattended, safely.

---

## 1. Pipeline (`ops/sync/run-nightly-legacy-sync.sh`, 02:30 Asia/Kuwait)
Chains the pieces proven in docs 33–34, plus an incremental fetch:
1. **Legacy refresh** — `legacy-detail-extract.mjs orders-index` (full listing) + `orders-detail` (skips already-archived → only **new** orders).
2. **Validate the fetch** — index row-count ≥ `MIN_INDEX_ROWS` (10k) and ≥ 4 statuses, else **ABORT** (a partial/empty fetch = legacy down).
3. **Enrich** — `order_number → internal_id → "Contact no"` (the verified id chain); validate output is a non-empty JSON array.
4. **Snapshot** — `pg_dump` **before any DB write**, integrity-checked (`pg_restore -l`), dumps > 14 days pruned.
5. **Customers** — extract genuinely-missing (single real name + valid KW mobile; shared/test phones quarantined); **cap** `MAX_NEW_CUSTOMERS` (500); governed import.
6. **Plan + cap** — dry-run; **abort** if `would_create` > `MAX_NEW_ORDERS` (1000) or `would_fail` > 0; stop early if 0.
7. **Orders** — governed M19 apply (idempotent, **fail-fast**).
8. **Correctness probe (FAIL-CLOSED)** — for every order created since the run started: stored customer phone == legacy page phone, phone maps to exactly **one** customer (collision guard), source page present, and probe-pair-count ≥ apply's created-count. Any failure ⇒ **ABORT before relink** + alert.
9. **Relink** meal-history (exit captured in the summary).

## 2. Adversarial safety review (4 reviewers, before enabling)
A workflow of 4 reviewers (data-integrity, blast-radius, auto-creation, ops/secrets) audited the draft. Their high-value findings and dispositions:

**Fixed:**
- **Silent no-op on legacy down** — a partial/empty fetch used to log "0 new" and exit clean. Now step 2 validates the index and aborts with an alert. (Most important — and exactly the failure mode behind the legacy "DataTables Ajax error" seen 2026-06-23.)
- **Apply scripts didn't fail on a chunk HTTP/row error** — `apply-order-sync.mjs` + `apply-customer-import.mjs` now set a `hadError` flag and `process.exit(1)`; the orchestrator `die()`s.
- **Probe could pass trivially** (0 orders / missing source pages / clock-window). Now fail-closed, keyed to `RUN_START`, with created-count and collision checks.
- **Temp files hold phone numbers** and weren't cleaned on failure paths → `trap … EXIT`.
- **No anomaly cap** → caps on customers + orders per night.
- **Snapshot** not integrity-checked / unbounded → `pg_restore -l` validate + prune.
- **enrich vs probe phone-normalization mismatch** → enrich now emits only `+965`+8-digit (else null → order skipped, never guess-linked).

**Deliberately NOT done (would be wrong or impractical):**
- *Reject `total == 0` orders* — legacy orders here legitimately carry 0 amount (the extract has no amounts); rejecting would drop every order.
- *Wrap steps 5–6 in one DB transaction* — they are separate processes/HTTP calls; impractical. The snapshot + fail-closed probe + idempotency are the rollback path.
- *Unique temp-admin email per run / DATABASE_URL out of env* — consistent with the existing proven scripts on a private VPS; logged as future hardening, not blockers.

## 3. Why the owner must enable it (one-time)
The assistant is blocked by design from (a) legacy login and (b) installing systemd units. So the **one-time enablement is owner-run** (`ops/sync/README-nightly-sync.md`): install the unit + a **supervised first run** (watch the probe pass) + enable the timer. After that, systemd fires it nightly autonomously — that path is not blocked.

## 4. Verification
- `bash -n` + `node --check` (orchestrator, both apply scripts, enrich, embedded probe) — all pass.
- Hardened scripts deployed to the VPS + staged in `nutrezee-api-1:/srv`.
- The legacy-touching first run is owner-supervised (the assistant can't fetch legacy) — that run is the live validation gate before the timer is enabled.

## 5. Artifacts
`ops/sync/run-nightly-legacy-sync.sh`, `ops/sync/README-nightly-sync.md`, `ops/systemd/nutrezee-nightly-legacy-sync.{service,timer}`; fail-fast `apply-order-sync.mjs` + `apply-customer-import.mjs`; tightened `enrich-orders.mjs`.
