# Sponsor Note — NC-Carry Acceptance for WP-01–06
Date: 2026-06-10 · Author: Project Sponsor (recorded via sponsor instruction; **this is not workshop minutes** — the verification workshop remains outstanding)

The sponsor accepts carrying the known, non-critical open confirmations ([NC] items
inventoried in `19_Roadmap/phase_4_to_build_handoff.md` §3 and `07_BLOCKERS_AND_DECISIONS.md`)
through work packages **WP-01 to WP-06 only**, so Phase 5 build execution can proceed.
This satisfies gate ⑤ of `19_Roadmap/phase_5_master_prompt.md` STEP 0 for WP-01–06,
per that gate's explicit NC-carry option.

Bounds of this acceptance:
1. It does NOT authorize building dormant modules beyond `not_enabled` stubs.
2. It does NOT convert any [NC] into a final rule — workshop-owned values remain
   configuration (settings / reason codes / transition_config), shipped as [Proposed].
3. Execution must still STOP for: hard product decisions, mandatory-field conflicts,
   workflow contradictions, security issues, or unclear business rules discovered
   during build (the master prompt's stop conditions are unchanged).
4. **WP-07 and beyond remain blocked** by their hard workshop dependencies (mandatory
   intake-field set, DEC-005 finals, DEC-006 sections) unless resolved separately —
   this note does not touch them.
5. Risk acknowledged: foundation/data work built under carried NCs may need rework
   when the workshop lands; the config-over-code design bounds that rework.
