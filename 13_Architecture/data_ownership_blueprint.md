# Phase 2I — Data Ownership Blueprint

**Date:** 2026-06-11 · **Status:** Baselined v1.0 (ownership) — NOT a database schema; logical ownership only (schema work = Phase 3, `10_Data_Model/`, after DEC-011/012)
Principles (ADR-010): one owning module per entity = single write path; everyone else reads via module API/events; legacy mirrors are explicitly second-class and dated; visibility classes (PII/HEALTH/PAYMENT) attach to fields, not tables.

| Entity | Source of truth | Created by | Updated by | Read by | Critical fields | Data-quality risks | Audit requirement |
|---|---|---|---|---|---|---|---|
| User (staff) | M12 | Admin/Super Admin | M12 (self-service: password only) | All modules (authn context) | active flag, role links | Orphan accounts (legacy pattern [V]) — joiner/leaver process | staff.created/deactivated (HIGH) |
| Role | M13 | Super Admin | Super Admin | M13 enforcement | permission set | Role sprawl — quarterly review | rbac.* (HIGH) |
| Permission | M13 (code-defined vocabulary, data-assigned) | System (catalog), Super Admin (grants) | Super Admin | M13 | module+action+visibility class | Drift between matrix doc and live grants — export-compare report | rbac.permission_changed (HIGH) |
| Customer | **M04** (new system from import day; legacy mirror until then [NC DEC-012]) | Order Agent (guided), M19 import | Order Agent/Ops; merge by Ops only | Intake, review, kitchen (allergy marker only), delivery (address), reports (aggregates) | phone (match key [A DEC-004]), allergies (HEALTH), addresses+area | Duplicates from legacy import (GAP-DQ-01); phone format variance; stale addresses | customer.* incl. pii_viewed; merge HIGH |
| Product | M05 mirror until catalog cutover (legacy SoT), then **M05** | Admin/catalog owner [NC] | Same | Intake, review, kitchen routing, reports | bilingual names, price, active, allergens, routing metadata | Macros embedded in names [I]; legacy drift during mirror period — weekly reconciliation | product changes WARN |
| Menu Item (component) | **M05** | Catalog owner | Catalog owner | Routing (M08), nutrition surfaces | component→section mapping (BR-010) | Unrouted components → WF-07-E queue | kitchen.routing_changed |
| Order | **M03** | Via M02 approval (from DraftOrder) | M03 transitions only — no direct edits (WF-15 path) | All ops modules, reports | status, plan dates, customer ref, amounts (PAYMENT class) | Legacy-imported plans flagged `origin=legacy` — never retro-transitioned | order.* full lifecycle |
| Order Item | **M03** (frozen copy of catalog refs at approval) | M02 approval | WF-15 change requests only | Kitchen, reports | item ref + frozen name/price/allergens | Catalog drift vs frozen copy — by design (frozen), label clearly | order.edited diffs |
| Order Status History | **M03** (append-only) | System on every transition | Never | Reports, audit queries, support | from/to, actor, timestamp | None if append-only enforced | Is itself audit-adjacent; mirrored by order.status_changed |
| Draft Order | **M01** | Order/WhatsApp Agent | Creating agent until submit; Ops on return | M02 | completeness flags, channel, message ref | Abandoned drafts — retention policy [NC status-model open item 5] | order.draft_created/edited |
| Review Decision | **M02** (append-only) | Ops Manager | Never | Reports, audit | decision, reason code, overridden warnings | Reason-code taxonomy quality — controlled list in M16 | order.approved/rejected (HIGH on override) |
| Kitchen Ticket | **M08** (derived — regenerable from Order+RoutingRules) | System (WF-07) | Kitchen User statuses | Kitchen board, reports | section, status, allergy marker | Derived data — regeneration must be idempotent | kitchen.ticket_generated, fulfillment.status_changed |
| Driver Assignment⁴ | **M09** | Fleet Supervisor (rule-suggested) | Fleet Supervisor; Driver (status only) | Delivery, reports | driver, manifest, capacity snapshot | Suggested-vs-final divergence — record both (feeds ENH-F-08) | dispatch.* (override HIGH) |
| Driver⁴ | **M10** (import from legacy records [V]) | Admin | Fleet Supervisor (availability), Admin (profile) | Dispatch, reports | availability, capacity attrs, contact (PII) | Legacy driver data staleness at import | staff-equivalent events |
| Delivery Event⁴ | **M10/M09** (append-only) | Driver app | Never | Order Mgmt (terminal statuses), reports, support | status, timestamp, failure reason, proof [NC] | Offline app sync conflicts — last-write with full event log | fulfillment.status_changed |
| Notification | **M11** (log append-only; templates versioned) | System (render) / Admin (templates) | Templates: Admin; log: never | Support (what was customer told), reports | template version, recipient class, channel | Template changes mid-flight — version pinning per send | notification.sent; template change WARN |
| WhatsApp Message (MVP: reference; future: content) | **M17** | Agent (MVP) / API adapter (future) | Never (immutable ref) | Intake, support, (future AI with consent — GAP-AI-02) | sender phone, timestamp, ref id; content only with consent flag [NC legal] | Wrong-ref attachment; future: consent tracking | order.draft_created linkage |
| Audit Event | **M14** (immutable) | All modules via audit API | **Never — no update/delete path exists** | Authorized query UI per RBAC | full schema (`audit_architecture.md`) | Volume — retention tiers; clock skew — server-side UTC only | Self-auditing (export of audit is audited) |
| System Setting | **M16** (versioned, effective-dated) | Super Admin/Admin/Ops per matrix | Same | All modules | cutoffs, payment gate, sections, areas, slots, flags | Mis-set cutoff disrupts kitchen — preview + effective-date + WARN audit | settings.changed (HIGH for gates) |

⁴ Phase 4 entities — defined now so the event/ownership contract is stable, instantiated later.

## Cross-cutting rules

1. **Frozen-at-approval copies:** Order Items snapshot catalog data; reports about "what the customer was promised" read the snapshot, not the live catalog.
2. **Derived data is regenerable:** Kitchen Tickets and report projections can always be rebuilt from owned entities + events — they are never themselves a source of truth.
3. **Append-only families:** StatusHistory, ReviewDecision, DeliveryEvent, NotificationLog, AuditEvent — no updates, corrections are new records.
4. **Legacy-origin marking:** every imported row carries `origin=legacy, import_batch` (M19) so quality issues are attributable and migrations reversible.
5. **PII/HEALTH/PAYMENT fields** masked at render per RBAC visibility classes; storage is never the masking layer.
6. **Retention:** operational entities follow audit retention tiers where they embed sensitive data; formal retention schedule is a Phase 3 task with legal input [NC].
