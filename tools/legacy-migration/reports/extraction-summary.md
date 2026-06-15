# Extraction Summary (template)

> This is the committed **template/spec**. The live version is generated on every run into
> `migration-output/<timestamp>/reports/extraction-summary.md` (this file is not overwritten).

Contents:

| Entity | Legacy source | Rows | Pages | VERIFIED | INFERRED | NEEDS_MANUAL_REVIEW | Status |
|---|---|--:|--:|--:|--:|--:|---|
| customers | `/users/list/3` | … | … | … | … | … | ok / skipped |
| … | … | | | | | | |

- **Total rows extracted** across all entities.
- Per-entity confidence breakdown (VERIFIED / INFERRED / NEEDS_MANUAL_REVIEW).
- Pointers to `../raw`, `../normalized`, `../csv`, `../screenshots`.

No legacy data is committed to git — only this template lives in the repo.
