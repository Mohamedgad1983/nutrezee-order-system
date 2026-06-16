# Legacy Full Migration - Repo State

Date: 2026-06-16 (session 2 — reconciliation/verification)
Branch: `migration/legacy-full-clone-reconciliation`
Resumed from commit: `292ae52` (`docs(migration): document legacy full clone reconciliation plan`)

## Session 2 commands (this run)

| Command | Result |
| --- | --- |
| `git status` / `git branch --show-current` / `git log --oneline -n 10` | On `migration/legacy-full-clone-reconciliation`, up to date with origin; `292ae52` present (verified `git cat-file -t`). |
| env presence checks (`test -n "$VAR"`) | All `LEGACY_*` / `NEW_DATABASE_URL` / `E2E_*` unset in the local shell (values not printed). |
| `nutrezee-vps` MCP `vps_health` + read-only `vps_exec` | Staging stack healthy; **discovered the prior on-VPS migration** under `/opt/nutrezee/`. |
| read-only staging DB SELECTs (counts, FK checks, validation) | Reconciliation completed — see `10_reconciliation_results.md`. |
| Workflow `legacy-migration-reconciliation-verify` | Adversarial re-verification of the decisive findings (independent skeptics + completeness critic). |

## Key discovery

The earlier-session conclusion `BLOCKED_BY_MISSING_ACCESS` was based on the **local shell** only. The real migration was already executed **on the staging VPS** (scripts under `/opt/nutrezee/`, driving the M19 `/imports/active_plans/apply` endpoint on 2026-06-14/15). Both the legacy extraction (read-only files) and the staging target DB are reachable via the `nutrezee-vps` MCP. Access re-classified: source `FULL_EXPORT_AVAILABLE`, target `NEW_STAGING_DB_AVAILABLE`. See `01_source_access_check.md`.

## Safety state (this session)

Verified:
- No destructive SQL run — all staging queries were read-only SELECTs.
- No write to the legacy system; no live legacy re-pull (not configured this session).
- No import/apply performed (`MIGRATION_APPLY` unset → dry-run/reconcile only).
- No production access. Target was **staging** only.
- No secret values printed; `.env` / `*.env` files on the VPS were **not** read.
- No raw PII committed — only counts, checksummable aggregates, masked samples, and non-PII order numbers.

## Migration-relevant surface (confirmed live)

- Staging Postgres `nutrezee-postgres-1` / DB `nutrezee` holds the full app schema incl. M18 `sync_record`/`reconciliation_run` and M19 `import_batch`/`import_row_result`.
- Legacy↔new identity is mapped centrally in `sync_record(object_type, legacy_key, new_ref)` — not per-table `legacy_*_id` columns.
- Prior extraction + import artifacts live on the VPS at `/opt/nutrezee/` and `/opt/nutrezee/pr38-legacy-migration/tools/legacy-migration/migration-output/`.
