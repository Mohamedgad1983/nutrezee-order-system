# Phase 3F — Migration & Import Mapping (DEC-012 scope)

**Date:** 2026-06-11 · **Status:** Proposed — field-level legacy mapping limited to screen-evidenced fields [V]; everything else **TBD-pending-access** (we never invent legacy schema). Scope per ADR-010: **customers + catalog + active plans only**. History (closed orders, old payments) stays in legacy, read-only, until decommission decision.

## Ground rules

1. Every import runs **dry-run first** (ImportBatch.state machine, M19); apply requires reviewed dry-run. Idempotent: re-running an applied batch is a no-op per legacy_key (SyncRecord).
2. Every created row: `origin=legacy`, `import_batch`, legacy key in SyncRecord (ADR-010).
3. Unmapped/unreadable legacy fields land in a per-row `import_notes` json — nothing silently dropped.
4. Evidence base: admin screen inventories (Step 1/2C [V]) — field labels seen on screens; underlying types/nullability unknown [NC] until access items 3–4 (schema/API) arrive. If P2/P3 bridge access arrives, this mapping upgrades from screen-level to schema-level in a revision.

## 1. Customer import (legacy Users list → M04)

| Legacy field (screen-evidenced [V]) | Target | Transform | Notes |
|---|---|---|---|
| Name | Customer.full_name.en | trim | Arabic name presence on screens [NC] → full_name.ar TBD |
| Email | Customer (no email field modeled!) → **gap: add `email` PII field to Customer** — recorded as model amendment A1 | — | Legacy shows email [V]; logical model amended in Phase 4 dictionary rev |
| DOB | Customer.dob | date parse; invalid → import_notes | [V on screens] |
| Phone | CustomerPhone(phone_normalized, is_primary=true) | normalize E.164-style; fail → merge_review | Presence on user screens [I — assumed present; confirm at access] |
| Diet status (if linked) | Customer.diet_status_ref | match by name against imported DietStatus master | [I] |
| Everything else on user screens | import_notes | — | TBD-pending-access |

**Dedup pipeline (GAP-DQ-01):**
1. Normalize phone → exact match against existing CustomerPhone → action=`matched` (link, no new row).
2. No phone / unparseable → name+dob fuzzy → action=`merge_review` (queue for OM — never auto-merge).
3. Clean novel → `created`.
4. Legacy duplicates *within* the import (same phone twice) → first wins, rest → merge_review.
Outputs: ImportRowResult per row; validation report = counts + merge_review queue size + error list.

## 2. Catalog import (legacy masters → M05)

| Legacy module [V] | Target | Notes |
|---|---|---|
| Products | Product (+ProductIngredient/ProductAllergen where legacy links visible [NC]) | EN/AR names [V bilingual masters]; price mapping [V amounts on screens]; macros NOT imported (unverified [V-gap GAP-DQ-02]) — content work post-import |
| Packages (+package-for) | Package, PackageForType | "Sub-package" → parent_package_ref (C7 [I]) — verify at workshop S1 |
| Ingredients / Allergies / Meal Types / Diet Status / Tags | corresponding masters | name-keyed; duplicates by exact name → matched |
| Delivery Time / Delivery Methods | DeliverySlot / DeliveryMethod (M16) | [V] |
| NOT imported | Coupons, cashback, ads, gallery, videos, static pages, subscribers, social | Stay legacy until their Phase-5 mini-cutovers (legacy_transition §2) |

Catalog remains **legacy-SoT mirror** until catalog cutover; weekly re-import = refresh (SyncRecord.snapshot_hash detects drift → reconciliation WARN).

## 3. Active-plan import (legacy orders → M03/M07)

**Scope filter:** legacy status ∈ {active, pause} only. Pending legacy orders at cutover are handled manually by agents (re-keyed as drafts through the new intake — they need review anyway). Expired/cancelled/closed: NOT migrated (history stays legacy).

| Legacy field ([V] project_context order concepts) | Target | Transform |
|---|---|---|
| Order number | Order.order_number | preserved verbatim; new orders use prefixed sequence (dictionary §3 collision rule) |
| Customer name → resolved customer | Order.customer_ref | via customer import match; unresolved → row error (plan import depends on customer batch) |
| Package / Sub-package | package_ref (+parent) + package_name_frozen | name-match against imported catalog; miss → error |
| Start date / End date | start_date / end_date | — |
| Order status | status | mapping table below |
| Payment status / Transaction ID / Transaction date | PaymentRecord(status mapped, transaction_ref, evidence_note=transaction date) | payment mapping below |
| Coupon code | coupon_code_frozen | text only — legacy coupon rules not re-validated [NC] |
| Package amount / Paid amount | package_amount / total + PaymentRecord.amount | money parse |
| Order type | import_notes [NC semantics unknown] | TBD |

**Status mapping (status model §transition rules, legacy basis [V]):**

| Legacy | New plan status | FulfillmentDay generation |
|---|---|---|
| active | ACTIVE | Generate remaining days from import_date→end_date (off_days [NC — TBD-pending-access; default none + flag]) as SCHEDULED; past days NOT generated (no fake history) |
| pause | PAUSED | Future days SKIPPED until resume |
| pending / expired / cancel | **not imported** | — |

**Payment status mapping [NC legacy vocabulary — screen shows "payment status" column [V], values unknown]:** placeholder map `paid→paid, unpaid/pending→link_sent-or-unpaid (decide per evidence), else→import_notes + manual finance review`. Finalize when access or workshop S7 clarifies values.

## 4. Import sequencing & rollback

```
Batch 1: catalog masters → Batch 2: customers (depends: diet status) → Batch 3: active plans (depends: 1+2)
```
Rollback: ImportBatch.state→rolled_back removes created rows (matched/merged rows untouched — merge undo via MergeRecord window); only valid while no post-import business writes touch the rows (checked; otherwise manual review list). Dry-run reports retained as evidence (bridge.import_run audit).

## 5. Cutover-day checklist hook

Active-plan import runs at intake-cutover weekend [NC — lowest-volume day, workshop]; reconciliation P1 daily counts compare legacy vs new active plans for 30 days (legacy_transition §8 criterion 1).

## Model amendments raised by this mapping

| ID | Amendment | Action |
|---|---|---|
| A1 | `Customer.email` (PII) missing from logical model but evidenced in legacy [V] | Add in Phase 4 dictionary revision; flagged in 3I final response |
| A2 | `Order.off_days` semantics unverifiable pre-access | Import default: none + `off_days_unverified` flag in import_notes |
