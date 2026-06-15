# Admin Gap Rebuild Evidence - Repo State

Date: 2026-06-15
Mode: legacy-first admin gap rebuild

## Verified

| Item | State |
|---|---|
| Repository | `/Users/it/Documents/NutrezeeOrderSystem` |
| Branch at discovery | `build/wp-ui-customers-list` |
| Mainline baseline | `main` / `origin/main` at `8ed4bce` (`Merge pull request #37 from Mohamedgad1983/build/wp-14-restore-drill`) |
| Current branch delta | 5 commits ahead of `main` and `origin/main` at discovery |
| Untracked pre-existing files | `CLAUDE.md`, `tools/legacy-migration/` |
| Root README | None at repository root |
| App README | `app/README.md` exists but is stale WP-00 scaffold wording; live code is far beyond it |
| Main app package | `app/package.json` npm workspaces: `apps/*`, `packages/*` |
| Admin app | React/Vite in `app/apps/admin/src` |
| API app | NestJS modular monolith in `app/apps/api/src` |
| Database migrations | SQL-first migrations `app/db/migrations/0001` through `0013` |
| Browser tests | Staging Playwright suite in `tools/e2e-staging/tests` |
| Staging URL in repo docs | `https://13-140-159-201.sslip.io` |
| E2E credentials in shell | Missing (`E2E_EMAIL`, `E2E_PASSWORD` not set) |
| Legacy credentials in shell | Missing (`LEGACY_ADMIN_EMAIL`, `LEGACY_ADMIN_PASSWORD` not set) |

## Latest Local Commits On Current Branch

| Commit | Purpose |
|---|---|
| `0b1e76c` | Order detail opens as a modal |
| `d849368` | Per-row operation icons on Orders |
| `f2c39e0` | Feature-rich Orders screen |
| `36c5bc8` | Professional admin redesign + live dashboard |
| `857ffb6` | List all customers on Customers page |

## Source Documents Read

| Area | Evidence |
|---|---|
| Agent operating rules | `AGENTS.md`, `19_Roadmap/NEXT_ACTION_QUEUE.md`, `19_Roadmap/build_progress_register.md`, `ASSUMPTION_REGISTER.md` |
| Legacy route inventory | `nutrezee-step-1-discovery/docs/01_discovery/admin_route_screen_inventory.md` |
| Legacy module analysis | `nutrezee-step-1-discovery/docs/modules/*.md` |
| Cutover/gap state | `19_Roadmap/Legacy_Core_Gap_To_Cutover.md`, `19_Roadmap/Legacy_Core_Coverage_Matrix.md` |
| API and data model | `11_API_Design/*.md`, `10_Data_Model/*.md`, `app/db/migrations/*.sql` |
| Current admin implementation | `app/apps/admin/src/*`, `app/apps/api/src/*` |

## Notes

- Verified: the live queue says the engineering frontier on `main` is exhausted and the remaining project-level gates are sponsor/workshop/legacy-data inputs.
- Verified: this branch contains unmerged admin parity work beyond `main`; this session continued on that branch.
- Needs confirmation: legacy production admin/database access was not available in this environment, so legacy discovery is repository-evidence-only.
