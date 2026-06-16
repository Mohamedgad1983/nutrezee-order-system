# Legacy Full Migration - Repo State

Date: 2026-06-16
Branch: `migration/legacy-full-clone-reconciliation`
Base commit: `bbfc449` (`docs(admin): record authenticated readiness evidence commit`)

## Commands Run

| Command | Result |
| --- | --- |
| `git fetch origin --prune` | Completed. Several old remote build branches were pruned. |
| `git pull --ff-only origin main` | Completed: `Already up to date.` |
| `git status --short --branch` | Current branch is `migration/legacy-full-clone-reconciliation`. Pre-existing untracked files remain: `CLAUDE.md`, `tools/legacy-migration/`. |
| `git branch --show-current` | `migration/legacy-full-clone-reconciliation` |
| `git log --oneline -n 20 --decorate` | HEAD includes the admin dashboard/customer readiness commits on top of `origin/main` `8ed4bce`. |
| `find . -maxdepth 3 -type f` | 167 files found at max depth 3. Key roots: `app/`, `app/db/migrations/`, `tools/e2e-staging/`, `tools/vps-mcp/`, `10_Data_Model/`, `13_Architecture/`, `19_Roadmap/`. |

## Safety State

Verified:
- No destructive SQL was run.
- No legacy website write action was attempted.
- No import into production was attempted.
- No secret values were printed into these evidence files.
- The migration branch was created for this workflow.

Needs Confirmation:
- Whether the pre-existing untracked `tools/legacy-migration/` directory should be promoted into tracked source later. It currently contains local config/output metadata and dependency folders; raw legacy access was not available in this session.

## Existing Migration-Relevant Project Surface

Verified from repo:
- SQL-first migrations live under `app/db/migrations/`.
- M18 bridge tables/services exist: `sync_record`, `reconciliation_run`, cutover flags.
- M19 import tables/services exist: `import_batch`, `import_row_result`, dry-run/apply/rollback API.
- Admin staging Playwright suite lives under `tools/e2e-staging/`.
- The current repo convention preserves legacy source IDs centrally with `sync_record(object_type, legacy_key)`, not per-table `legacy_*_id` columns.
