# Phase 2J — Integration Boundaries

**Date:** 2026-06-11 · **Status:** Baselined v1.0 (boundaries) / Proposed (anything gated on access or DEC-002/009)
Scope rule: **Order System only.** Odoo/ERP/HR/accounting are out of scope — nothing in discovery evidences them touching order flow [V-absence]; if the workshop surfaces one, it enters here with its own boundary spec. All integrations live in the Integration Layer behind adapters (target_architecture layer 9); no business logic in adapters; secrets via the secrets standard (GAP-SEC-05).

## INT-01 — Legacy Order System (the existing dashboard)

| Aspect | Definition |
|---|---|
| Purpose | Coexistence: customer/catalog import, order reconciliation, payment-status reference (ADR-008, M18) |
| Direction | Legacy → New only. **Never write to legacy.** |
| Data | Customers, catalog, legacy-created orders (reference), payment statuses |
| Mode | Pattern P1: manual/daily · P2: batch export/import · P3: read-replica near-real-time — per access disposition [NC, Phase 0] |
| Failure handling | P1: missed checklist → Ops alert next day · P2/P3: import failure → retry, stale-data banner on mirrored views after threshold |
| Retry | P2/P3: 3 attempts, exponential backoff, then dead-letter + alert |
| Audit | bridge.import_run, bridge.reconciliation_run with diff counts (WARN on divergence) |
| MVP? | **MVP** (pattern P1 minimum) |

## INT-02 — WhatsApp

| Aspect | Definition |
|---|---|
| Purpose | Primary order channel [A]. MVP: zero technical integration — manual-assisted capture with message reference (M17). Future (DEC-002): Business API inbound capture + templated outbound (confirmations, delivery status — BR-035) |
| Direction | Future: bidirectional (inbound messages; outbound templates) |
| Data | Inbound: sender phone, timestamp, message ref; content only with consent [NC legal review]. Outbound: approved template messages only (WhatsApp policy constraint) |
| Mode | Real-time webhooks (future); MVP: human |
| Failure handling | Future: webhook miss → poll reconciliation; outbound failure → retry then fall back to agent-manual send with alert |
| Retry | Outbound: 3 attempts; inbound webhook: provider redelivery + daily poll sweep |
| Audit | notification.sent (outbound); message refs on order.draft_created (inbound) |
| MVP? | MVP = manual mode (no API). API = migration Phase 3+ pending DEC-002, account approval (R7) |

## INT-03 — Payment

| Aspect | Definition |
|---|---|
| Purpose | Payment links exist in legacy [V — `/orders/create` generates them]; gateway identity/internals unknown [NC]. MVP: record-only (link refs + finance-confirmed statuses via M07 queue). Future: gateway webhooks for status, link generation, refunds (BR-029/030, DEC-009) |
| Direction | MVP: none (manual recording). Future: Gateway → New (webhooks); New → Gateway (link create, refund execute) |
| Data | Transaction ref, amount, status, method; refund instructions (future) |
| Mode | Future: real-time webhook + daily reconciliation batch |
| Failure handling | Webhook gap → daily reconciliation catches; mismatch → finance exception queue (never auto-correct) |
| Retry | Link-create: user-visible retry; webhooks: provider redelivery + reconciliation sweep |
| Audit | payment.* (all HIGH); reconciliation diffs WARN |
| MVP? | MVP = record-only. Gateway integration = post-access (access item 8: sandbox + docs) |

## INT-04 — Notifications (push / SMS / email providers)

| Aspect | Definition |
|---|---|
| Purpose | MVP: internal alerts (in-app; email if trivially available). Future: customer notifications via WhatsApp templates (INT-02), push (legacy has a push provider [V — module exists; provider unknown NC]), SMS/email |
| Direction | New → Provider |
| Data | Rendered template + recipient handle; no PII beyond delivery necessity |
| Mode | Near-real-time queue |
| Failure handling | Provider failure → queue retry → mark NotificationLog failed → internal alert; customer-critical sends surface failure to agent for manual follow-up |
| Retry | 3 attempts per channel, then failed status (no silent drop — GAP-NOT-01 history requirement) |
| Audit | notification.sent / notification.failed |
| MVP? | MVP-lite (internal only); customer channels future |

## INT-05 — Maps / Delivery Tracking

| Aspect | Definition |
|---|---|
| Purpose | Future (Phase 4): address geocoding for area assignment, optional live tracking. MVP and Phase ≤3: areas are configured zones (M16) chosen by agents — no maps dependency [keeps DEC-008 open] |
| Direction | New → Provider (geocode lookups); Provider → New (none, unless tracking added) |
| Data | Addresses (PII — minimize: send address line only, no customer name) |
| Mode | On-demand lookups, cached |
| Failure handling | Geocode fail → manual area selection (always available as fallback) |
| Retry | 2 attempts then manual path |
| Audit | None per-lookup (volume); provider config changes audited via settings.changed |
| MVP? | **Future** (Phase 4+, only if DEC-008 dispatch design needs it) |

## INT-06 — Reporting Exports

| Aspect | Definition |
|---|---|
| Purpose | Role-gated exports (BR-031): CSV/sheet outputs of reports for management/finance; reconciliation outputs during legacy overlap |
| Direction | New → file/recipient |
| Data | Aggregates by default; row-level exports of PII/PAYMENT restricted per RBAC export rights |
| Mode | On-demand + scheduled (daily ops sheet replacing ENH-QW-06 manual sheet) |
| Failure handling | Generation failure → user-visible error, no partial files |
| Retry | User-initiated |
| Audit | data.exported (what, filter, rows, recipient) — GAP-AUD-03 |
| MVP? | MVP-lite (3 MVP reports exportable) |

## Boundary summary

```
                       ┌────────────── NEW NUTREZEE ORDER SYSTEM ──────────────┐
 Legacy dashboard ───► │ INT-01 Bridge (read-only)                              │
 WhatsApp (human MVP)─►│ INT-02 WhatsApp adapter [future API]                   │ ─► INT-04 Notification providers
 Gateway [future] ───► │ INT-03 Payment adapter [MVP: record-only]              │ ─► INT-06 Exports (audited)
 Maps [future] ──────► │ INT-05 Geo adapter [Phase 4+]                          │
                       └────────────────────────────────────────────────────────┘
 Out of scope: Odoo / ERP / HR / accounting (no order-flow evidence [V-absence])
```
