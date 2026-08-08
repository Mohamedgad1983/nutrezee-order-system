# Hermes WhatsApp Agents — architecture (dry-run foundation)

> **STATUS: DRY-RUN FOUNDATION — STAGING ONLY. NO MESSAGES ARE SENT. LIVE SENDING IS DISABLED.**
> This document describes the Hermes agent system as built today: a preview pipeline that
> computes *what would be sent*, writes nothing to any live channel, and ships the sender
> agent in a hard-disabled state. There is no cron, no timer, and no WhatsApp API credential
> wired into any runnable path. Production is untouched.

- **Scope:** Nutrezee Order System, Phase-2 foundations.
- **Environment:** staging only — `https://13-140-159-201.sslip.io`, operated via the `nutrezee-vps` MCP.
- **Stack:** NestJS modular monolith + PostgreSQL 16 on a single VPS.
- **Entry point documented here:** `tools/legacy-full-migration/hermes-queue-preview.mjs` (DRY-RUN preview, **0 sends**).
- **Legacy source:** `nutreeze.com` admin — **read-only**, never written.

---

## 1. Purpose and non-goals

### 1.1 Purpose

Hermes is the proposed WhatsApp re-engagement layer that sits on top of the accepted
Phase-1 migration corpus. Its job is to look at the migrated customer/order/payment data,
**segment** customers by plan lifecycle (expiring soon, recently expired, long lapsed),
**build a queue** of candidate WhatsApp messages, run every candidate through a
**compliance guard chain**, and route anything containing an offer or discount into a
**human-approval** workflow.

The current deliverable is the *foundation*: the full pipeline runs end-to-end as a
**dry-run preview** that produces a queue and a per-segment breakdown **without sending a
single message**. The sender agent exists as a typed seam but is disabled at the code level.

### 1.2 Non-goals (explicitly out of scope for this foundation)

- **No live sending.** No WhatsApp Business API call is made from any runnable path.
- **No scheduling.** No cron, no `setInterval`, no in-process timer is enabled. The pipeline
  runs only when a human invokes the preview script by hand.
- **No production access.** All reads/writes target the staging database only.
- **No destructive SQL.** The pipeline issues `SELECT`-only queries plus additive inserts
  into proposed (nullable) staging tables. No `DROP`, `TRUNCATE`, `DELETE`, or schema-altering
  `UPDATE` of existing data.
- **No PII committed.** Phone numbers and names never enter the repo; preview output is
  aggregate counts only, with row-level detail kept in the staging DB.
- **No secrets committed.** No API tokens, cookies, or super-admin passwords land in git.

---

## 2. Phase-1 input corpus (the data Hermes reads)

Phase-1 legacy migration is accepted as **`STORED_WITH_ACCEPTED_EXCEPTIONS`**. Hermes treats
this corpus as read-only ground truth.

| Entity | Rows stored | Notes |
| --- | --- | --- |
| Customers | 19,463 | Includes contact + plan-state attributes |
| Orders | 20,103 | Per-order delivery detail stored |
| Payments | 11,538 | Used for `PENDING_PAYMENT` exclusion |
| Migration exceptions | 1,272 | Documented data-quality issues in `migration_exception_review` |

The **1,272 documented exceptions** are the spine of Hermes eligibility: any customer whose
phone or contact data is flagged there (placeholder, invalid, malformed) is **excluded** from
the messageable population before segmentation runs (see §6).

The governed import remains the only sanctioned write path into the migration tables:

```
POST /imports/{customer|catalog|active_plans}/{dry-run|apply}
```

These M19 endpoints are **idempotent and audited**. Hermes does **not** call them; it only
reads what they produced.

---

## 3. Agent roles

Hermes is composed of five cooperating agents arranged as a linear pipeline. Each agent has a
single responsibility, consumes the previous agent's output, and is independently testable.

```
  ┌────────────┐   ┌──────────────┐   ┌──────────────────┐   ┌──────────────┐   ┌──────────────────────┐
  │ Segmenter  │──▶│ Queue-builder│──▶│ Compliance-guard │──▶│   Approval   │──▶│  Sender [DISABLED]   │
  └────────────┘   └──────────────┘   └──────────────────┘   └──────────────┘   └──────────────────────┘
   classify          materialize         opt-in / opt-out        human review        NEVER RUNS in
   by lifecycle      candidate msgs       frequency cap           of offers           foundation
                                          offer gating
```

### 3.1 Segmenter

- **Input:** migrated customers + their latest active plan / order / payment state.
- **Output:** each eligible customer assigned exactly one **lifecycle segment** (§5).
- **Rules:** deterministic, date-driven against the run's reference date. Customers in the
  excluded segments (§5.3) are dropped here. Customers flagged in `migration_exception_review`
  for phone quality never reach the segmenter output.

### 3.2 Queue-builder

- **Input:** segmented eligible customers.
- **Output:** one **candidate message** per customer = (`customer_id`, `segment`,
  `template_id`, `rendered_locale`, `requires_human_approval` flag).
- **Rules:** selects the per-segment template (§4), resolves locale (EN/AR), and marks
  offer-bearing segments as `requires_human_approval = true`. Queue-builder **does not** send;
  it materializes intent into `whatsapp_message_queue` rows with status `preview` (dry-run) or
  `queued` (would only ever be set in a future enabled mode).

### 3.3 Compliance-guard

- **Input:** candidate messages.
- **Output:** each candidate either **passes** or is **suppressed with a reason code**.
- **Rules:** the guard chain (§7) — opt-in required, opt-out honored, frequency cap, offer
  gating, quiet-hours check. This agent is authoritative: a candidate that fails any guard is
  removed from the sendable set even in a hypothetical enabled mode.

### 3.4 Approval

- **Input:** candidates flagged `requires_human_approval` (all offer/discount segments).
- **Output:** an approval task per candidate; nothing proceeds without an explicit human
  decision (`approved` / `rejected`) recorded with actor + timestamp.
- **Rules:** offers and discounts **never** auto-send. In the foundation every offer-bearing
  candidate terminates here pending human action (§8).

### 3.5 Sender — **[DISABLED]**

- **State:** present as a typed interface and a guarded no-op. The send method short-circuits
  on a compile-time/boot-time `HERMES_SENDING_ENABLED === false` constant and throws/returns
  before any network call.
- **Guarantee:** there is no WhatsApp API client constructed, no credential read, and no HTTP
  request issued from this agent in the current build. Enabling it is a future, separately
  gated work package — not part of this foundation.

---

## 4. Message templates per segment

Templates are bilingual (EN/AR), rendered per customer's stored locale, and reference
workshop-owned copy (kept in config, never hard-coded business values). Offer-bearing
templates are placeholders pending human-authored, policy-approved copy.

| Segment | Template id | Intent | Offer? | Approval |
| --- | --- | --- | --- | --- |
| `EXPIRES_TODAY` | `tpl_expires_today` | "Your plan ends today — renew to avoid a gap." | No | Auto-eligible* |
| `RENEWAL_3D` | `tpl_renewal_3d` | "Your plan ends in 3 days — renew now." | No | Auto-eligible* |
| `RENEWAL_7D` | `tpl_renewal_7d` | "Your plan ends in a week — plan your renewal." | No | Auto-eligible* |
| `EXPIRED_1_7` | `tpl_winback_1_7` | "We missed you — come back this week." + offer | **Yes** | **Human approval** |
| `EXPIRED_8_30` | `tpl_winback_8_30` | "It's been a few weeks — here's an offer." | **Yes** | **Human approval** |
| `EXPIRED_31_90` | `tpl_winback_31_90` | "Long time — a returning-customer offer." | **Yes** | **Human approval** |

\* **Auto-eligible** means *"contains no offer, so not blocked by the offer gate."* It does
**not** mean it sends — sending is globally disabled, and all guards still apply.

Template rendering rules:

- **Money in minor units** internally; formatted to display units only at render time.
- **Bilingual:** EN and AR variants required for every template; the missing-variant case is a
  guard failure, not a silent fallback.
- **No PII in template ids or logs** — the rendered body lives only in the staging DB row.

---

## 5. Segmentation model

### 5.1 Reference date

All windows are computed relative to the **run reference date** (the day the preview is
invoked). The dry-run documented below used the current staging reference date.

### 5.2 Messageable segments (in scope)

| Segment | Definition | Offer | Preview count |
| --- | --- | --- | --- |
| `EXPIRES_TODAY` | plan end date == today | No | **33** |
| `RENEWAL_3D` | plan ends in 1–3 days | No | **46** |
| `RENEWAL_7D` | plan ends in 4–7 days | No | **122** |
| `EXPIRED_1_7` | expired 1–7 days ago | Yes → approval | **140** |
| `EXPIRED_8_30` | expired 8–30 days ago | Yes → approval | **438** |
| `EXPIRED_31_90` | expired 31–90 days ago | Yes → approval | **658** |
| | **Total queued (preview)** | | **1,437** |

- Non-offer (renewal-reminder) segments: **201** candidates.
- Offer (win-back) segments → **1,236** candidates **require human approval**.

### 5.3 Excluded segments (out of scope by policy)

| Segment | Reason for exclusion |
| --- | --- |
| `EXPIRED_90_PLUS` | Too stale; re-engagement value low, re-consent risk high |
| `PENDING_PAYMENT` | Payment-state ambiguity; messaging could conflict with billing flow |
| `CANCELLED` | Explicit customer cancellation — do not re-engage |
| `ACTIVE_FUTURE` | Plan still active / future-dated — no reminder warranted |

Customers in these segments are dropped by the **Segmenter**, before queue-building, and never
appear in `whatsapp_message_queue`.

---

## 6. Eligibility and phone validation

A customer is **messageable** only if **all** of the following hold:

1. Falls into a messageable segment (§5.2).
2. Has a phone number that is **not** flagged in `migration_exception_review` for
   placeholder/invalid/malformed phone (the 1,272-row exception set).
3. Passes a structural phone check (E.164-shaped, country-code present, non-placeholder
   pattern — e.g. not all-zeros, not a known dummy sequence).
4. Has **not opted out** (`whatsapp_opt_out`, §9).
5. Is **opted in** under WhatsApp Business policy (§7.1).
6. Is **under the frequency cap** (§7.3).

Phone-quality exclusion is intentionally conservative: when in doubt, **suppress**. A
suppressed customer is recorded with a reason code, never silently dropped, so the suppression
is auditable.

---

## 7. Compliance guard chain

Every candidate passes through the guard chain **in order**. The first failing guard suppresses
the candidate and records a reason. Guards are evaluated even in dry-run so the preview reflects
the true sendable set.

```
candidate
   │
   ├─[G1] opt-in present?  ───────────────── no ─▶ SUPPRESS: not_opted_in
   ├─[G2] opt-out absent?  ───────────────── no ─▶ SUPPRESS: opted_out
   ├─[G3] phone eligible?  ───────────────── no ─▶ SUPPRESS: phone_excluded
   ├─[G4] frequency cap (≤1 / 7d)? ───────── no ─▶ SUPPRESS: frequency_capped
   ├─[G5] quiet hours OK?  ───────────────── no ─▶ DEFER:    quiet_hours
   ├─[G6] offer? requires approval ───────── yes ─▶ HOLD:    requires_human_approval
   └─ PASS (would be sendable iff sending were enabled — it is NOT)
```

### 7.1 G1 — Opt-in required

No message is queued as sendable unless the customer has a recorded WhatsApp opt-in. Migrated
customers without an explicit opt-in are treated as **not opted in**; re-consent is a separate,
out-of-scope concern. In the foundation this guard is informational (since nothing sends) but
is computed so the preview is honest about how many candidates lack consent.

### 7.2 G2 — Opt-out honored

Any customer present in `whatsapp_opt_out` is suppressed unconditionally, in every segment,
forever, regardless of opt-in state. Opt-out always wins.

### 7.3 G4 — Frequency cap

**Cap = 1 message per customer per rolling 7 days.** Computed against `whatsapp_send_log`
(which, in the foundation, contains only preview rows and therefore caps nothing yet — but the
guard is wired so that the moment any real send is logged, the cap enforces). A customer who
would receive two candidates in one run is collapsed to one (highest-priority segment wins).

### 7.4 G5 — Quiet hours

Sends are only ever permitted within configured local quiet-hours windows (workshop-owned
config). Candidates computed outside the window are **deferred**, not dropped. In dry-run this
is reported but, since nothing sends, has no live effect.

### 7.5 G6 — Offer gating

Any candidate whose template contains an offer or discount is flagged
`requires_human_approval` and routed to the Approval agent. **Offers and discounts can never
auto-send** — this is a hard policy gate, independent of the global send-disable.

---

## 8. Human-approval workflow

Offer/discount segments (`EXPIRED_1_7`, `EXPIRED_8_30`, `EXPIRED_31_90`) produce candidates
that **stop** at the approval gate. In the documented dry-run this is **1,236 candidates
requiring human approval**.

Workflow:

1. Queue-builder marks the candidate `requires_human_approval = true` and sets queue status to
   `pending_approval`.
2. An approval task is created carrying: `customer_id` (no raw PII in logs), `segment`,
   `template_id`, rendered preview reference, and the computed offer.
3. A human reviewer (authorized staff) **approves** or **rejects**. The decision is recorded
   with actor identity and timestamp in the same transaction as the status change
   (same-transaction audit discipline).
4. **Approved** candidates move to status `approved` — and would only become sendable in a
   future, separately gated *enabled* mode. **Rejected** candidates move to `rejected` and are
   excluded.
5. No bulk auto-approve exists. Each offer candidate requires an explicit human decision.

In the foundation, approval produces no send regardless of decision — it only advances queue
state and writes audit rows.

---

## 9. Proposed data model (additive, nullable, staging)

All three tables are **proposed** for the staging schema. They are **additive and nullable** —
they create no foreign-key constraints that could block existing writes, alter no existing
table, and carry no destructive migration. They would be introduced via a normal forward-only
SQL migration in `app/db/migrations/`, owned by the WhatsApp/notifications module.

> These are design proposals documented here for review. The preview script can operate
> against them in staging once migrated; nothing in production is affected.

### 9.1 `whatsapp_opt_out`

Tracks customers who have opted out (incl. STOP handling). Opt-out is permanent until an
explicit re-opt-in.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `customer_id` | `uuid` | references customer (logical) |
| `source` | `text` | `'stop_keyword' \| 'manual' \| 'import'` |
| `opted_out_at` | `timestamptz` | |
| `raw_keyword` | `text` NULL | masked at serialization |
| `created_at` | `timestamptz` default now() | |

### 9.2 `whatsapp_send_log`

Append-only ledger of message activity. Drives the frequency cap. In the foundation it holds
**only `preview` rows** (no `sent` rows are ever written, because nothing is sent).

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `customer_id` | `uuid` | |
| `segment` | `text` | |
| `template_id` | `text` | |
| `status` | `text` | `'preview'` only in foundation; `'sent' \| 'failed'` reserved |
| `dry_run` | `boolean` default true | always `true` in foundation |
| `created_at` | `timestamptz` default now() | feeds the 7-day cap window |

### 9.3 `whatsapp_message_queue`

The materialized candidate queue produced per run.

| Column | Type | Notes |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `run_id` | `uuid` | groups one preview run |
| `customer_id` | `uuid` | |
| `segment` | `text` | |
| `template_id` | `text` | |
| `locale` | `text` | `'en' \| 'ar'` |
| `requires_human_approval` | `boolean` | true for all offer segments |
| `status` | `text` | `'preview' \| 'pending_approval' \| 'approved' \| 'rejected' \| 'suppressed'` |
| `suppression_reason` | `text` NULL | guard reason code when suppressed |
| `created_at` | `timestamptz` default now() | |

**PII handling:** no phone number is stored in these tables in plaintext beyond what the
customer record already holds; rendered bodies and any keyword text are masked at serialization.
Preview *output artifacts* (committed or shared) contain **aggregate counts only**.

---

## 10. The dry-run preview tool

**File:** `tools/legacy-full-migration/hermes-queue-preview.mjs`

### 10.1 What it does

1. Connects to the **staging** database (read-only for migration tables).
2. Runs the Segmenter → Queue-builder → Compliance-guard → Approval pipeline.
3. Writes `preview`/`pending_approval` rows into the proposed staging tables (additive only).
4. Emits an **aggregate, PII-free** summary to stdout.
5. **Sends nothing.** The Sender agent is not invoked; `HERMES_SENDING_ENABLED` is `false`.

### 10.2 Documented dry-run result

```
queued_preview ............ 1,437   (across messageable segments)

  no-offer (renewal reminders):
    EXPIRES_TODAY .......... 33
    RENEWAL_3D ............. 46
    RENEWAL_7D ............ 122
                          -----
                            201

  offer (win-back, -> requires_human_approval):
    EXPIRED_1_7 ........... 140
    EXPIRED_8_30 .......... 438
    EXPIRED_31_90 ......... 658
                          -----
                          1,236

require_human_approval .... 1,236
messages_sent .................. 0   (sending DISABLED)

excluded by policy:
    EXPIRED_90_PLUS, PENDING_PAYMENT, CANCELLED, ACTIVE_FUTURE
```

### 10.3 Overlap prevention

The preview must **never run concurrently with itself**. Overlapping runs are prevented by a
process-level lock:

- A PostgreSQL **advisory lock** (`pg_try_advisory_lock(<hermes_run_key>)`) is acquired at
  start; if it is already held, the run **exits immediately** with a clear "another Hermes run
  is in progress" message and does nothing.
- The lock is released on exit (success or failure).
- Each run carries a unique `run_id` so its queue rows are isolated and idempotently
  re-checkable.

This guarantees that even if a human invokes the script twice, only one pipeline mutates the
queue at a time.

### 10.4 Invocation (manual only)

The tool is invoked by hand by an operator. **No cron, no timer, no scheduler** triggers it.
Connection parameters come from the environment / MCP session — **never committed**.

---

## 11. Operational guardrails (hard rules honored)

| Rule | How Hermes honors it |
| --- | --- |
| **Staging only, never production** | Targets the staging DB / `nutrezee-vps` MCP only; no production credentials exist in any path |
| **No destructive SQL** | `SELECT` + additive `INSERT` into nullable proposed tables; no `DROP`/`TRUNCATE`/`DELETE`/altering `UPDATE` |
| **No raw PII committed** | Output artifacts are aggregate counts; row detail stays in staging DB; bodies/keywords masked at serialization |
| **No secrets committed** | DB creds, cookies, API tokens come from env/MCP; `gitleaks` pre-commit guards the repo |
| **No WhatsApp messages sent** | Sender agent is `[DISABLED]`; no API client constructed; `messages_sent = 0` |
| **Cron/timer not enabled** | Built disabled — no scheduler, no `setInterval`; runs only on manual invocation |
| **Prevent overlapping runs** | PG advisory lock; second concurrent run exits as a no-op |
| **Offers require human approval** | Hard offer gate (G6) → Approval agent; no bulk auto-approve |
| **Opt-out always wins** | G2 suppresses opted-out customers unconditionally |
| **Frequency cap** | G4 enforces ≤ 1 message / customer / 7 days against `whatsapp_send_log` |

### 11.1 Temporary super-admins

Where a privileged operation is needed for staging setup, **temporary super-admins** are
bootstrapped with **in-process passwords** (never committed, never logged) and **deleted
immediately after use**. No standing privileged credential is created for Hermes.

---

## 12. Compliance posture (WhatsApp Business policy)

- **Opt-in required (§7.1).** Hermes will not treat a customer as sendable without recorded
  consent. Migrated customers without explicit opt-in are flagged, not assumed-in.
- **Opt-out / STOP handling (§7.2, §9.1).** A `STOP`-class keyword (or manual opt-out) writes a
  permanent `whatsapp_opt_out` row; that customer is suppressed in every future run. STOP is
  honored unconditionally and immediately.
- **Frequency cap (§7.3).** ≤ 1 message per customer per rolling 7 days, to avoid spam-pattern
  behavior that violates platform policy.
- **Quiet hours (§7.4).** Sends are confined to configured local windows; out-of-window
  candidates defer.
- **Template discipline (§4).** Bilingual, workshop-owned, offer copy human-approved before any
  hypothetical send. Offer/discount content never auto-sends.
- **Auditability.** Every suppression carries a reason code; every approval decision is recorded
  with actor + timestamp in the same transaction as the state change.

---

## 13. What enabling sending would require (future, out of scope)

For completeness — **none of this is done or enabled in this foundation**:

1. A separately gated work package to flip `HERMES_SENDING_ENABLED`.
2. A real WhatsApp Business API client + approved message templates registered with the provider.
3. A confirmed, re-validated opt-in basis for the target population (not assumed from migration).
4. Promotion of the proposed staging tables (§9) through review and migration.
5. An enabled, locked, non-overlapping scheduler — explicitly **not** the manual preview tool.
6. Human sign-off on all offer copy and on the send go/no-go.

Until every one of those is satisfied, Hermes remains a **dry-run preview** that produces a
queue and a breakdown and **sends nothing**.

---

> **Final restatement: NO messages are sent. Live sending is DISABLED. Staging only.
> Production is untouched.**
