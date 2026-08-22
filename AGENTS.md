# AGENTS.md — Nutrezee Order System

Main instruction file for AI agents (Claude Code / Codex) working in this repository. **Read this first, every session.** Companion docs: `00_AGENT_OPERATING_SYSTEM.md` (how agents operate), `19_Roadmap/AUTO_EXECUTION_RULES.md` (the autonomous rulebook), `19_Roadmap/SPRINT_MODE.md` (the six modes + sprint loop), `19_Roadmap/NEXT_ACTION_QUEUE.md` (the live next-work cursor), `03_EXECUTION_MODES.md` (original modes), `05_TEST_COMMANDS.md` (commands), `07_BLOCKERS_AND_DECISIONS.md` (live blockers).

## Driver-authentication source amendment

AMENDMENT 2026-07-18 — Mohamed authorized modifying Navigator app source (/src) for the
driver-authentication feature ONLY. Scope: login screen(s), auth service calls, secure
credential storage, biometric unlock. AGPL-3.0 compliance: modified source provided to app
users (Nutreeze staff) on request; fork lives in the private repo. Everything else in /src
and all of /legacy remains OFF-LIMITS. Config-only rule still applies outside this scope.

## Driver production-readiness source amendment

AMENDMENT A25 2026-07-26 — Mohamed explicitly instructed Codex to proceed without waiting
and complete the Nutreeze driver app for distribution. This authorizes the smallest
necessary Navigator `/src` changes for the verified A-to-Z defects: KWD-only fuel reports
and correct amount/status persistence; null-safe order documents; post-completion Orders
state/navigation; chat participant/channel persistence; customer call/navigation behavior;
Arabic language availability; and background-tracking integration fixes that do not require
a commercial license. Each source file must be predeclared in the driver repo `PLAN.md` and
regression-tested. AGPL-3.0 source-availability obligations remain in force. `/legacy`,
Fleetbase vendor/backend source, production/Partner writes, secret generation, and any
paid-license purchase remain OFF-LIMITS.

## Driver full reachable-screen release-hardening amendment

AMENDMENT A26 2026-07-26 — Mohamed reaffirmed that the driver app must be complete end to end
and that every reachable screen and visible action must be tested. This extends A25 to the
minimum Navigator `/src` repairs for defects confirmed by the exhaustive reachable-screen,
button, null-fixture, and route-contract audit recorded in the driver repo `PLAN.md`. Every
edited source file must still be predeclared before editing and regression-tested.
`/legacy`, Fleetbase vendor/backend source, production/Partner writes, secret generation,
and paid-license purchase remain prohibited.

## Exact legacy label + permanent customer barcode amendment

AMENDMENT A27 2026-07-27 — Mohamed authorized reproduction of the existing legacy daily-meal
label with the same structure, fields, field order and printing layout, plus ONE permanent
`Code 128` barcode per customer. In scope: authoritative meal and nutrition sourcing (no
fabricated, inferred or placeholder nutrition values — an absent dish source must render as an
explicit empty state); governed `customer_barcode` records with idempotent issuance, merge-alias
preservation and audited administrative replacement; individual and batch label printing;
audit-controlled reprints with a required reason; current-day driver-manifest validation;
collection scanning with same-transaction audit and same-day duplicate prevention; and the
minimum **predeclared** Navigator `/src` changes required for the collection screen and `Code 128`
scanning. The barcode value carries no PII and is not derived from any customer attribute.
Partner and legacy systems remain read-only. Fleetbase vendor source, Navigator `/legacy`,
secret generation, commercial licence purchase and unattended dispatch activation remain
OFF-LIMITS. AGPL-3.0 source-availability obligations remain in force.

## Fleet-Ops label correction amendment

AMENDMENT A28 2026-07-28 — After reviewing the deployed A27 result, Mohamed explicitly
authorized the corrective implementation. `https://ops.nutreeze.com/` must remain the single
Fleetbase/Fleet-Ops operations admin. Scope: remove the mistakenly deployed `/nz-admin` SPA
mount and `/labels` redirect from the live staging host while preserving the `/nz/*` Nutrezee
API gateway and every existing Fleet-Ops route; remove the corresponding dual-admin source
and image changes; add Nutrezee label/barcode/collection operations through a supported custom
Fleetbase Console extension; and rebuild the self-hosted console with only the documented
extension dependency/registration wiring. Fleetbase application/vendor source files otherwise
remain OFF-LIMITS. The extension source must remain separately identifiable and available
under the applicable AGPL-3.0 obligations.

For collection, the existing Fleetbase identity and the driver's Fleetbase-assigned orders are
the only driver/assignment authority; a second Nutrezee driver login and the synthetic
Nutrezee `driver`/`delivery_route` authorization path must be retired. A driver may receive
customer name, area and phone only for their own currently assigned work. The permanent
customer Code 128 barcode, audited print/reprint governance, append-only collection ledger,
same-day duplicate protection and authoritative-or-explicitly-empty nutrition rule remain in
force. Meal/nutrition values may be read from an already-authorized read-only source or entered
by authorized operations staff, but must never be inferred or fabricated. Partner and legacy
remain read-only; production writes, Navigator `/legacy`, secret generation, paid-license
purchase and unattended dispatch activation remain prohibited.

## Partner v2 label-source amendment

AMENDMENT A29 2026-08-08 — Mohamed instructed Codex to close the verified label-data gap
immediately after the production Partner key and Kitchen & Labels v2 documentation were
provided. The label service may perform server-side, read-only GET requests to
`/integration/order-items` and `/integration/meal-catalog-v2`, join only by the documented
`meal_id`, and select an order only by its exact delivery date and order number. The API key
must remain server-held and must never be returned, logged, or committed. Partner data must
not be inferred, name-matched, fabricated, or written back; a missing or incomplete upstream
nutrition row must block printing with an explicit error. Existing authoritative local
dish-day records remain valid for historical/manual-entry operation. Fleetbase remains the
current-day order/assignment authority, and production/Partner writes, secret generation,
unattended dispatch activation, Fleetbase vendor-source edits, and Navigator `/legacy` remain
prohibited.

## Assigned-driver missing-location recovery amendment

AMENDMENT A30 2026-08-08 — Mohamed authorized completing the recurring missing-customer-
location workflow for the Nutreeze Driver App and the existing Fleet-Ops admin. For a currently
assigned Fleetbase order whose authoritative Partner location is missing or invalid, Navigator may
route the assigned driver to the nearest safe known operational anchor in the same routing area,
clearly labeled as a fallback rather than the customer's pin. The driver then calls the customer,
captures the exact location from current GPS or a customer-shared coordinates/maps link, and submits
it to the Nutrezee API. Fleetbase identity and current assignment remain the sole driver authority.

Accepted locations are stored in an append-only audited ledger keyed by the stable Partner customer
reference and may be reused on later Partner rows only when their authoritative pin is still missing
or invalid. A valid Partner pin always wins and is never overwritten; corrections to an accepted
capture require an audited Fleet-Ops review action. The driver may see customer name, area and phone
only for their own current work. Anchor-customer identity must never be exposed. Partner and legacy
remain read-only; no location is written back to either source. Implementation and staging proof are
authorized, but production activation, unattended dispatch, Fleetbase vendor-source edits,
Navigator `/legacy`, secret generation and paid-license purchase remain prohibited until explicit
release approval.

## Partner daily dispatch amendment

AMENDMENT 2026-07-19 — Mohamed authorized an operational, read-only Partner API →
Fleetbase → Navigator daily-delivery bridge for the 11 existing drivers. Scope is limited
to `ops/fleetbase/` integration scripts/configuration, date-scoped integration-owned
Fleetbase records, assignment verification, and Navigator evidence. Partner and legacy
systems remain read-only; `/legacy`, Fleetbase vendor source, driver phone numbers, and
the deferred unit/SIM redesign remain OFF-LIMITS. Source rows without a real location pin
must stay visibly held and unassigned.

## July 20 address-and-call dispatch amendment

AMENDMENT 2026-07-20 — Mohamed authorized a one-day exception for delivery date
2026-07-20 only: otherwise-approved Partner rows without a valid customer pin may be
assigned by their known routing area when the source address and customer phone are
present, with a visible warning that the driver must call the customer for the exact
location. The area centroid must remain labeled as a fallback, never as a customer pin.
The exception requires an exact manual runtime confirmation, must reject unknown-area
country fallbacks, and must not be added to the unattended timer or reused for any other
date. All other A18 boundaries remain in force.

## Daily read-only snapshot amendment

AMENDMENT 2026-07-23 — Mohamed authorized an unattended daily read-only
Partner API snapshot after the documented 06:00 source publication. The job may
perform two complete date-scoped API reads and retain only a root-protected,
PII-free aggregate manifest containing counts, digest, hold/location totals,
capture time, and an explicit non-authoritative completeness label. It must not
write to Partner/legacy or Fleetbase, retain raw source rows, enable the dispatch
timer, or reuse the one-day A19 address-call exception. Sanitized retention is
governed by ASM-054 pending an operations-owned retention policy.

## Daily snapshot 01:00 schedule amendment

AMENDMENT 2026-07-23 — Mohamed changed the unattended read-only Partner snapshot
schedule from 06:30 to **01:00 Kuwait** (`22:00 UTC` on the preceding calendar
day). This explicitly supersedes A23's after-06:00 schedule even though 01:00 is
earlier than the previously documented 06:00 source publication. The resulting
manifest must remain labeled non-authoritative and must not enable or feed the
dispatch timer. All A23 storage, PII, write-prohibition, and A19 boundaries remain
in force.

## Rolling Fleetbase synchronization 01:00 schedule amendment

AMENDMENT A38 2026-08-12 — Mohamed corrected the production rolling Fleetbase
synchronization schedule to **01:00 Kuwait** (`22:00 UTC` on the preceding
calendar day), superseding only A37's 07:00 timing. The job continues to refresh
the +1/+2-day horizon with independent per-date reconciliation and `Restart=no`;
its executable wrapper must reject starts outside 00:45–01:45 Kuwait. Applying
this schedule correction must restart only the timer and must not trigger an
additional dispatch run. Partner and legacy remain read-only, and the A30
production-activation gate remains separate.

## Nullable Partner time-slot amendment

AMENDMENT A39 2026-08-16 — Mohamed directed immediate repair of the live rolling
Fleetbase synchronization after Partner returned a legitimate daily-delivery row
whose legacy `time_slot` object contained null `id`, `title`, `start`, and `end`
values. These presentation fields are optional; their absence must not block an
otherwise valid delivery. Non-null values remain strictly type/length validated,
and Fleetbase scheduling continues to use only the protected pickup
`dispatch_time`. All count/digest, exact membership, location-hold, idempotency,
read-only Partner/legacy, `Restart=no`, and separate A30 activation controls remain
unchanged.

## Driver box color + vehicle/phone label amendment

AMENDMENT A40 2026-08-16 — Mohamed requires every current Fleetbase-assigned
driver's meal boxes to carry a visually distinct driver color plus the driver's
current vehicle number and phone number, because a driver's display name may
change. The color identity must be derived from the immutable Fleetbase driver
public id across the complete current company driver directory, never from the
name, customer, area, or order. The permanent customer Code 128/QR payload and
bars remain black and unchanged for scanner reliability; color is restricted to
a prominent label band/border. Fleet-Ops must read the phone and vehicle plate
server-side from the current Fleetbase driver/vehicle assignment and fail closed
before printing if an assigned driver's public id, unique color, phone, or
vehicle plate is missing. Reassignment must produce the newly assigned driver's
identity on a fresh preview. This supersedes the earlier driver-phone prohibition
only for authenticated internal box-label rendering; it does not authorize phone
storage, logging, Partner exposure, public APIs, or any Fleetbase/Partner write.

## Unstarted rolling-sync reconciliation amendment

AMENDMENT A42 2026-08-21 — Mohamed authorized immediate repair of the production rolling
Fleetbase synchronization after the current +1-day Partner snapshot legitimately changed from
684 to 674 distinct orders: 123 existing rows advanced from `ordered` to `driver_assigned`, three
received timestamp-only updates, and ten unstarted source rows disappeared. Both lifecycle states
are already dispatch-approved. An integration-owned Fleetbase job may therefore be atomically
refreshed, reassigned, held, canceled or tombstoned from a stable count/digest-locked Partner
snapshot until Navigator records `started` or `started_at`; a started job remains immutable and
must fail closed on any source, routability or driver change. Raw hashes remain audit provenance
but must not freeze an unstarted pre-dispatched job. Partner and legacy remain read-only; Fleetbase
vendor source, Navigator `/legacy`, secret generation, paid-license purchase, retry behavior and
the separate A30 production-activation gate remain unchanged.

## Nutreeze Fleet-Ops visual-system amendment

AMENDMENT A43 2026-08-22 — Mohamed supplied the official Nutreeze logo PDF and directed the
existing Fleet-Ops administration interface to use a beautiful Nutreeze front-end design. Scope
is presentation-only through the separately identifiable Nutrezee Console extension: exact logo
geometry/color, accessible header identity/favicon, responsive light/dark shell styling, navigation,
tables, forms and existing Nutrezee extension screens. Fleetbase legal/version attribution must
remain visible, existing routes/auth/permissions/data workflows must remain unchanged, and the
legacy 100 x 70 mm print contract must remain isolated. Fleetbase application/vendor source,
Navigator `/legacy`, Partner/legacy writes, secrets and production data mutation remain prohibited.

## Nutreeze Fleet-Ops approved light-theme parity amendment

AMENDMENT A44 2026-08-22 — After comparing the deployed Fleet-Ops screen with the approved
local design, Mohamed selected the warm light Nutreeze presentation as the production target.
The separately identifiable Console extension must normalize Fleet-Ops to that light visual
system even when Fleetbase or the browser has persisted a dark-theme preference, and it must
style the real Fleetbase sticky table cells and button variants that were absent from the
simplified preview fixture. This is presentation-only and may not mutate Fleetbase settings or
application/vendor source. Fleetbase attribution, routes, auth, permissions, data workflows,
the 100 x 70 mm print contract and all A43 prohibitions remain unchanged.

## ⭐ Standing command — "Continue Nutrezee OS Agent"

When the user says **"Continue Nutrezee OS Agent"** (or starts any Build/Sprint session), do **not** wait for a detailed prompt. Run the OS:

1. **Session start** (`AUTO_EXECUTION_RULES.md` §A): `git status` → `git pull --ff-only` → read `build_progress_register.md`, `07_BLOCKERS_AND_DECISIONS.md`, `ASSUMPTION_REGISTER.md`, `19_Roadmap/NEXT_ACTION_QUEUE.md` — live, from disk.
2. **Detect the frontier automatically** — the first unblocked item in the Engineering Queue, cross-checked against the register's WP status.
3. **Choose + execute** the next unit per the `AUTO_EXECUTION_RULES.md` §B decision tree, in the right mode (`SPRINT_MODE.md`). Default = Sprint Mode.
4. **Commit, push, update the registers** after each completed unit; loop to the next eligible unit without asking.
5. **Close** with the mandatory SESSION REPORT (`AUTO_EXECUTION_RULES.md` §F).

The agent never re-asks a question whose answer is already in the repo, never restarts discovery, and stops only for a genuine blocker (`AUTO_EXECUTION_RULES.md` §E).

## Project goal

Build the Nutrezee Order System — a healthy-food meal-plan order platform — **incrementally beside the live legacy dashboard** (strangler-fig, ADR-001/002), via gated work packages. **The objective is to replace the legacy daily order operation** (Orders, Subscribers/intake, Customers, Packages, Products, Reports, Settings) — not to satisfy MVP theory. Shortest-path plan: `19_Roadmap/Legacy_Core_Gap_To_Cutover.md`; coverage state: `19_Roadmap/Legacy_Core_Coverage_Matrix.md`. Stack per signed DEC-011: NestJS/TS modular monolith · managed PostgreSQL 16 · React/Vite admin SPA + kitchen PWA · SQL-first migrations · GitHub Actions CI.

## Current state (verify live each session; this is a dated snapshot — 2026-06-13)

- **Phases 1–5 complete. WP-00 … WP-13 DONE & merged** (all CI-green).
- **WP-UI-01 DONE & merged** (PR #3, `b06d646`): login + app shell + sidebar nav + kitchen board + read-only drafts/review-queue/orders lists.
- **Staging LIVE** at `https://13-140-159-201.sslip.io` (VPS + Caddy TLS); gate ④ both halves ✅; 10/10 smoke; **D1–D7 fixed**. Operated via the `nutrezee-vps` MCP server (`tools/vps-mcp/`).
- **Frontier:** WP-API-01 → WP-UI-02 → WP-UI-03 → WP-UI-04 (`NEXT_ACTION_QUEUE.md`). No legacy core module is browser-operable end-to-end yet.
- Sponsor-owned parallel track gates WP-14: legacy export access + workshop pack.

## Source-of-truth documents (never edit; amend via register)

| Topic | File |
|---|---|
| Autonomous rulebook (how to continue without a prompt) | `19_Roadmap/AUTO_EXECUTION_RULES.md` |
| Execution modes + sprint loop | `19_Roadmap/SPRINT_MODE.md` |
| Live next-work cursor | `19_Roadmap/NEXT_ACTION_QUEUE.md` |
| Cutover gap + prioritized build list | `19_Roadmap/Legacy_Core_Gap_To_Cutover.md` |
| Legacy coverage matrix | `19_Roadmap/Legacy_Core_Coverage_Matrix.md` |
| Build session protocol (BINDING) | `19_Roadmap/phase_5_master_prompt.md` |
| WP scopes, DoD, dependency diagram | `19_Roadmap/codex_implementation_sequence.md` |
| Live status, run log, amendment counter | `19_Roadmap/build_progress_register.md` |
| Backend patterns (layering, audit, outbox, transitions, RBAC) | `13_Architecture/backend_foundation_blueprint.md` |
| Module specs + only-allowed cross-module calls | `11_API_Design/backend_module_specs.md` |
| Physical schema, wave order | `10_Data_Model/physical_schema_design.md` |
| API/event contracts | `11_API_Design/` (api_standards, module_api_contracts, event_catalog) |
| Test suites + gates | `15_Testing/test_strategy.md` |
| Validation rules + settings slots | `08_Business_Rules/validation_rules_binding.md` |
| Decisions (signed vs OPEN) | `20_Decisions/decision_register.md` (+ `DEC-011_stack_hosting.md`) |
| Status model (the spine) | `13_Architecture/order_lifecycle_status_model.md` |
| Assumptions in force | `ASSUMPTION_REGISTER.md` |
| Staging operations (VPS/MCP) | `20_Decisions/NOTE_vps_staging_host.md`, `tools/vps-mcp/README.md` |

## Execution rules

1. **Gate check first, live** — STEP 0 of the master prompt; never trust cached/snapshot statuses; read the registers from disk.
2. **One unit at a time, atomic** — scope-only implementation per the WP/queue row; modes (`SPRINT_MODE.md`) decide whether you continue to the next unit (Sprint Mode) or stop (Build Mode).
3. **Evidence labels everywhere:** Verified / Inferred / Assumed / Needs Confirmation. Never silently convert an [NC] into a rule — workshop-owned values are config (settings/reason codes/transition_config), not code.
4. **Amendments, not edits:** contradictions or gaps in Phase 1–4 docs are logged as A-ids in `build_progress_register.md` §Amendments (next free id lives there).
5. **Assumptions are expected, not deviations** — when a business answer is missing, apply the conservative interpretation, log a new ASM-id, build to it, flag `[NC]` (`AUTO_EXECUTION_RULES.md` §D). Stop only if no defensible assumption exists.
6. **Binding technical constraints** (full list = master prompt): no GET mutations · same-transaction audit · single write path per owning module · masking at serialization · transitions only via the config-seeded engine · bilingual EN/AR · money in minor units · server-side sessions, no JWTs · no new npm deps without a recorded reason.

## Forbidden actions

- Bypassing or weakening a gate; assuming an OPEN decision is signed; inventing sponsor/stakeholder decisions.
- **Restarting discovery or re-architecting** without a genuine code-vs-frozen-doc contradiction (which is logged as an amendment; structural ones STOP for review).
- Building dormant modules (dispatch M09, drivers M10, cart/checkout M06, refunds, WhatsApp webhook, customer notifications) beyond `not_enabled` stubs, or any **deferred** legacy module (`NEXT_ACTION_QUEUE.md` Deferred list) — no tables, no UI — without a new amendment.
- Editing Phase 1–4 source-of-truth docs (status notes/amendments/register updates are the only exceptions).
- Skipping tests, marking suites pending to get green, or proceeding past a red suite.
- Committing secrets; touching production; writing to the legacy system (bridge is read-only).
- Scope creep past the invoked unit's row — "while I'm here" is forbidden.

## Git discipline

- Feature work: branch `build/<wp-id>-<slug>` → merge to `main` only when the unit's DoD suites are green → push same session (R1 residual duty). If a direct `main` push is gated by the runtime, open a PR instead — do not abandon the push.
- Doc-only changes (register, run log, amendments, status notes, OS files): commit directly to `main`.
- Commit messages reference the WP/queue id; never rewrite pushed history; never force-push.
- Before starting: working tree clean, `main` in sync with `origin/main`. If files are unexpectedly missing/modified (it has happened to master-prompt files), restore from git history and report — never silently absorb.

## Test discipline

- Suites TS-U/I/M/R/A/C/E/S per `15_Testing/test_strategy.md`; commands in `05_TEST_COMMANDS.md`; CI = 14 jobs.
- A unit is DONE only when its DoD suites pass in CI. Placeholder tests mean "not yet implemented", never "verified".
- Generated suites stay generated (TS-R from the M13 matrix; TS-U transitions from `transition_config`) — hand-enumerating them is a defect.
- Audit acceptance tests (TS-A) are cumulative: once green, they remain CI gates forever.
- UI units additionally ship a visible Playwright e2e (`tools/e2e-staging`) proving the flow on staging.

## Blocker rules

Stop ONLY for a real blocker (`AUTO_EXECUTION_RULES.md` §E): failed gate · NC/blocker affecting the active unit's DoD with no defensible assumption · test failure not safely fixable within scope · missing secret/credential · product/sponsor decision required with no conservative default · forbidden scope reached · no eligible units remain. When blocked: record it (register row BLOCKED + run log + exact blocker), commit, push, report — never improvise around it, never ask permission to continue between *eligible* units in Sprint Mode.

## Final response format (every session)

Emit the mandatory **SESSION REPORT** from `AUTO_EXECUTION_RULES.md` §F: Mode + gate result · Done (merge commits + CI) · Tests · Commits pushed · Assumptions logged · Current blocker · Next task · the exact command to continue (`Continue Nutrezee OS Agent`).
