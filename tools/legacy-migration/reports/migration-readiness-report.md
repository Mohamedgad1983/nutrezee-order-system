# Migration Readiness Report (template)

> Committed **template/spec**. The live version generates into
> `migration-output/<timestamp>/reports/migration-readiness-report.md`.

Contents:
- **Verdict** — 🟢 dry-run clean (ready to prepare import files for review) / 🟡 not ready.
- **Access** — legacy connected? new-system connected? (env-var presence).
- **Counts** — rows extracted, rows needing manual review.
- **What is ready** vs **what still needs manual access / decisions**:
  - Legacy credentials + URL (the **S1** blocker).
  - Selector calibration per entity (`config.json` → `calibrated:true`).
  - Resolution of every `NEEDS_MANUAL_REVIEW` row.
- **Blockers** — aggregated across entities.
- **Next step** — feed the reviewed normalized files into the new system's M19
  `/imports/<batch>/dry-run` → human review → `/apply`. **Never** apply from this toolkit.
