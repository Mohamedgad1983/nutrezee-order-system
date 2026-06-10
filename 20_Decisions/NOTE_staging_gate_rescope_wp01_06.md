# Sponsor Decision DEC-014 — Staging Gate Re-scope for WP-01–06
Status: **SIGNED — 2026-06-10** · Owner/Sponsor: Project Sponsor (recorded via sponsor instruction) · Registered as DEC-014 in `decision_register.md`

**This is a gate re-scope, NOT a completion claim. Staging is NOT provisioned and is NOT marked done by this decision.**

Decision:
1. For **WP-01 through WP-06 only**, the "staging live" half of global gate ④
   (`19_Roadmap/phase_5_master_prompt.md` STEP 0) is re-scoped from a build entry gate
   to a **hard pre-pilot / WP-14 entry gate**.
2. WP-01–06 may proceed using **local Docker/compose verification plus GitHub CI**.
3. **CI remains mandatory and unweakened**: every WP merges only when its DoD suites
   are green in CI on the WP branch (master prompt STEP 4 unchanged).
4. Staging must **not** be recorded as provisioned/live/DONE until it is actually
   provisioned and smoke-tested per `16_Deployment/environment_plan.md` §3.
5. The interim staging region remains **AWS me-south-1**
   (`NOTE_pg_staging_region_interim.md`); final production region revisited pre-launch.
6. **Missing cloud credentials remain a blocker for staging provisioning** — but no
   longer for WP-01–06 build execution.
7. **WP-07+ are NOT unblocked by this note** — their workshop/product-decision
   blockers (mandatory intake-field set, DEC-005 finals, DEC-006 sections) stand,
   and WP-14 entry now explicitly includes staging live + smoke-tested.

Consequence for the master prompt: gate ④'s text carries a dated status note referencing
this decision; all other gate semantics unchanged.
