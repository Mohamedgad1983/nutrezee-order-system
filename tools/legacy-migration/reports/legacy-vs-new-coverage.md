# Legacy ↔ New Coverage / Reconciliation (template)

> Committed **template/spec**. The live version generates into
> `migration-output/<timestamp>/reports/legacy-vs-new-coverage.md`.

Per entity:

| Entity | Legacy | New | Matched | Only legacy | Only new | New requires (legacy lacks) |
|---|--:|--:|--:|--:|--:|---|
| customers | … | … | … | … | … | … |
| orders | … | … | … | … | … | … |
| products | … | … | … | … | … | … |
| packages | … | … | … | … | … | … |

- **Only-in-legacy** = candidates to import.
- **Only-in-new** = rows already created in the new system / drift to investigate.
- **New requires (legacy lacks)** = required new-schema fields the legacy screens don't expose (must be sourced/defaulted before import).
- A **Blockers & notes** section lists per-entity issues (uncalibrated selectors, `NEEDS_MANUAL_REVIEW` counts, sampling caveats, sync_record dependency for order-level matching).
