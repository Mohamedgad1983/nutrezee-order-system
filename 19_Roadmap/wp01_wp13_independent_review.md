# WP-01…WP-13 Independent Review (Claude, 2026-06-11)

**Branch:** `review/claude-wp01-wp13-audit` · **Baseline:** `30de449` (main) · **Verdict:** **PASS_WITH_FIXES**
**Reviewed against:** phase_5_master_prompt, codex_implementation_sequence, physical_schema_design, backend_foundation_blueprint, backend_module_specs, api_standards, test_strategy, ASSUMPTION_REGISTER, build_progress_register (all read in full).
**Gates at baseline:** typecheck ✅ lint ✅ vitest 147/147 ✅ boundary-scan ✅ no-GET-mutation-scan ✅ (re-verified locally).
**Gates after fixes:** typecheck ✅ lint ✅ vitest **163/163** ✅ both scans ✅ build ✅.

## 1. Review matrix

| WP | Expected (sequence row) | Implemented | Tests | Status | Findings |
|---|---|---|---|---|---|
| 00 | Env standup | scaffold, CI, compose | placeholders by design | OK | — |
| 01 | Wave-1 DDL+seeds, authn/RBAC/masking/audit/outbox/idempotency, CI guards | all present; platform core sound | TS-I/TS-A#2#3/TS-R real | OK | masking *infrastructure* built but unused by business read paths (→F2); runtime GET probe absent (→F12) |
| 02 | RBAC & staff admin | role admin C4-only, level cap, dormant alert via HIGH audit, argon2id pinned | TS-R matrix-generated, staged modes | OK | dormant alert is audit-only — WP-12 seed promised an impossible notification (→F8) |
| 03 | Settings & transition engine | config-seeded engine, fail-closed validators | TS-U generated from config | OK | several M03-registered validators are no-ops (→F10, logged) |
| 04 | Customers | dedup, merge+undo, read-logging | TS-U dedup, TS-S#6 | OK | — |
| 05 | Catalog | mirror-mode, cycle guard, allergen resolver | TS-U resolver | OK | — |
| 06 | Import tooling | batch runner, gates, rollback | TS-M real | **FIXED** | rollback wrote other modules' tables raw, evading the write-scan via interpolated table names (F5); dry-run report "transaction" spanned pool connections (F6); no outbox event on apply (F7) |
| 07 | Intake & WhatsApp | drafts, completeness (config-driven), refs immutable | TS-U/TS-C/TS-I | **FIXED** | date serialization off-by-one east of UTC (F1 — critical); backdate override marker not role-checked (F3); PII/HEALTH/PAYMENT unmasked on reads (F2) |
| 08 | Review queue | SLA queue, claim, decisions, A9 port | TS-U/TS-C/TS-I/TS-S | **FIXED** | `review.sla_alert` had no emitter though the WP-12 trigger map routes it (F9); HEALTH detail unmasked in queue reads (F2) |
| 09 | Order core | factory, freeze, days, transitions, change requests | TS-U/TS-S#4 | **FIXED** | end-date reduction silently left in-production days beyond the new end (F4); M03 joined `draft_order` directly (F5); TS-S#3 was in WP-09's DoD but never written (F11) |
| 10 | Kitchen | tickets, board, rollups, escalations | TS-U/TS-S#2 | **FIXED** | day rollup read state outside the transaction; all-tickets-prepared check write-skew prone (F4) |
| 11 | Payments-lite | FI-only machine, HIGH audit, refunds dormant | TS-U/TS-S#5 | **FIXED** | masked reads omitted fields instead of sentinel-rendering (F2); `payment_record(order_id)` index missing vs schema doc (F13) |
| 12 | Notifications & reports | trigger map, dedupe, projections, replay | TS-E real equality | **FIXED** | `dormant_role_granted` trigger structurally dead — security events never reach the outbox (F8) |
| 13 | Bridge & cutover | reconciliation, cutover flags, batch-3 | TS-M batch-3 | **FIXED** | phone-fallback resolution untested + rejection escaped local catch (F14); TS-S#7 absent (F11) |

## 2. Findings and dispositions

### Fixed on this branch (each with a test)
| # | Sev | Finding | Fix |
|---|---|---|---|
| F1 | **Critical** | M01 serialized pg `date` values via `toISOString()` → calendar day −1 on hosts east of UTC (verified empirically in Asia/Kuwait). Propagated through `OrderFactory` → wrong order start/end and all fulfillment-day dates. M03 was fixed under A10; M01 was not. CI (UTC) cannot catch it; no test asserted a round-trip. | local-getter serialization (same as A10), local `today()`; round-trip regression test |
| F2 | **High** | api_standards rule 4 masking absent on M01/M02/M03 read paths and payments masked-read used silent omission + a hard-coded role list. With RBAC seeded `log` for all roles, ANY authenticated role received PII/HEALTH/PAYMENT unmasked. | grant-based `maskFields` on draft get/list/incomplete (incl. allergy warning detail), review queue warnings, order money fields; payment masked read now sentinel-rendered. TS-R masking suite added |
| F3 | High | `OM_BACKDATE_OVERRIDE` marker bypassed the no-backdate rule for ANY role (ASM-015 says OM override) | role check (ops_manager/super_admin) + tests |
| F4 | High | M08 rollup read day state via pool (outside tx); two concurrent `prepared` transitions could both skip the rollup (write-skew) stranding a prepared day; M03 end-date reduction silently left kitchen-active days beyond the new end | per-day `FOR UPDATE` lock + in-tx day read (new M03 port `dayForKitchenInTx`); reduction now rejected (`kitchen_activity_beyond_new_end`) while non-scheduled days exist past the new end; concurrency + reduction tests |
| F5 | High | ADR-010: M19 rollback issued raw cross-module DELETEs (customer/catalog tables) with interpolated table names the write-scan cannot see; M03 joined `draft_order`; M19 importer read `package` raw; M01 read `whatsapp_message_ref` raw; M07 read `transition_config` raw | owner rollback ports added to M04/M05 (mirroring M03/M07); batch-runner routes all rollbacks through ports; M03 uses the M01 draft API; importer uses `packageByNameInTx`; M01 uses the M17 read API; M07 uses `engine.rulesFor` |
| F6 | High | batch-runner dry-run report used `pool.query('BEGIN'/'COMMIT')` — statements land on different pool connections, so the report write was never transactional | real client transaction via `withTransaction` + dry-run audit (info, `dry_run:true`) |
| F7 | Medium | module spec M19 lists events-out `bridge.import_run`; apply/rollback wrote audit but never the outbox | outbox event on apply and rollback + assertions |
| F8 | Medium | WP-12 seeded a `dormant_role_granted` notification trigger on `rbac.dormant_role_granted` — security families are audit-only, never on the bus (event_catalog), so it could never fire | migration `0013` removes the trigger-map entry and deactivates the template; alert remains the HIGH audit event (WP-02); guard test asserts no security-family triggers |
| F9 | Medium | trigger map routes `review.sla_alert` (ASM-034 "queue SLA") but nothing ever emitted it | `ReviewService.fireSlaAlerts` + `POST /review-queue/sla-alerts` (outbox-deduped, audit warn), mirroring M01 aging alerts; tests |
| F11 | Medium | TS-S #3 (same-day cancel after kitchen_queued — in WP-09's DoD) and #7 (reconciliation divergence→alert) had no tests | scenario tests added (`ts-s-cancel-and-reconcile`); #3 covers role/reason enforcement + the kitchen-alertable event; #7 covers divergence→WARN→configured M11 alert |
| F12 | Medium | test_strategy TS-C requires a runtime no-GET-mutation probe; only the static scan existed | DB-backed probe across all read surfaces asserting business tables + outbox byte-stable |
| F13 | Medium | physical_schema §2: `payment_record` "Index (order_id); (status)" — order_id index missing | added in migration `0013` |
| F14 | Low | M19 phone-fallback `return promise` inside try/catch let async rejections escape the local catch; path untested | `return await`; fallback hit/miss tests |
| F15 | Low | change-request rejection audit lacked `before` state | added |

### Logged only (NOT fixed — needs sponsor/workshop or is pre-pilot scope)
| # | Sev | Finding | Why not fixed here |
|---|---|---|---|
| L1 | High | Transition validators `same_day_ack`, `pause_window`, `plan_still_active`, `routing_rules_present` are registered as **no-ops** (order.service.ts ctor) — the config names gates the code does not enforce. The engine's fail-closed rule only covers *unregistered* names. | Validator semantics are workshop-owned content (DEC-005/BR). Implementing them now would invent business rules. **Must be resolved before WP-14 DoD scenario runs.** |
| L2 | High | Order-cancel cascade (`cancelOpenDaysInTx`) hard-codes day cancellations outside the transition engine, including `ready_to_pack → cancelled_day` which has **no transition_config row at all**. | Routing the cascade through the engine changes behavior (some states would be refused) — needs a DEC-005 content decision on which day states an order-cancel may cascade through. |
| L3 | Medium | Payment visibility is a hard-coded role list (`finance/ops_manager/super_admin`) rather than M13 grants. Switching to grants today would WIDEN exposure (order_agent/support_agent hold `payment.read` which carries the `payment` grant). | Grant *content* needs the S8 matrix sign-off; the current hard-code is the more restrictive posture. |
| L4 | Medium | Cross-module **read** drift: M08 board joins `fulfillment_day`; M01 reads `delivery_slot` capacity; M02/M03/M08 read `reason_code` directly. The CI scan covers writes only (per backend_foundation §1) and is blind to interpolated table names. | Pervasive but read-only; needs either a spec amendment blessing config-master reads or a read-scan with an allowlist — an architecture decision, not a patch. |
| L5 | Medium | Blocked rollback throws `rollback_blocked` instead of producing the manual-review list migration_execution_plan §5 calls for. | New surface area; pre-pilot. |
| L6 | Medium | TS-A acceptance #1 (reconstruct order from audit alone), #4 (masked rendering per reader), #5 (HIGH weekly review completeness) still pending; pre-pilot gate says "TS-A full". TS-S #1 allergy chain is only partially covered (steps 1–6 implicit; no single 7-step test). #7 "resolution note" surface does not exist. | WP-14 entry work; listed as pre-pilot blockers below. |
| L7 | Low | Migration filenames `0009_wave5_kitchen` < `0010_wave4_payments` invert wave order (harmless — no FK crosses the pair; renaming applied migrations is riskier than the deviation). `payment_review_item` carries two unlisted-but-reasonable indexes. Active-plan import does not enforce "customer batch applied first" (procedural per migration plan §2.3). Login timing differs for unknown vs known users (minor enumeration signal). Session sliding-expiry UPDATE rides GET requests (accepted platform bookkeeping; excluded from the runtime probe). | Documented; no action required for WP-01–13 scope. |

### Verified sound (claims double-checked, no action)
Same-transaction audit+outbox discipline across all modules; append-only triggers on all 9 tables + frozen `order_item`; transition engine fail-closed on unknown validators; argon2id params; lockout; server-side sessions; security events off-bus; idempotency claim/replay; TS-U/TS-R suites genuinely generated from config; TS-E replay equality is a real deep-equal; refunds/dormant channels behind `not_enabled`; importable origin/batch stamping; ASM-043/044/047/048/049/050 honored. Three agent-reported "criticals" were **refuted** during verification (async-return "missing await" nested-promise claim; M03 dateString "should use UTC getters" — UTC getters would *reintroduce* the bug; WhatsApp-attach "loads outside transaction" — the row is locked in-tx).

## 3. Remaining blockers before WP-14
1. **Staging provisioned, live, smoke-tested** (DEC-014 hard gate) — unchanged, still the single next action.
2. Workshop items L1/L2 (validator semantics, cancel-cascade states) — must land before TS-S full-pass on staging.
3. TS-A #1/#4/#5, TS-S #1 explicit 7-step chain, #7 resolution-note surface (L6).
4. Sponsor review of the ASM register remains open (unchanged).
