# 00 — Gate 0 Recovery Point (WP-LBL-A27)

> **Status:** ✅ VERIFIED. Baseline green, recovery point created, rollback proven by restore test.
> Created 2026-07-27 before any WP-LBL-A27 modification.

## 1. Baseline verified before any change

Run on `build/partner-daily-fleetbase` @ `ff239a9a20b6774760a89bf12be0dcadd28915b4`.

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run typecheck` (3 workspaces) | ✅ clean |
| Lint | `npm run lint` (ESLint 9 flat) | ✅ clean |
| Build | `npm run build` (tsc api + vite admin) | ✅ clean — admin 340.28 kB js / 21.68 kB css |
| Tests | `npx vitest run` vs local PostgreSQL 16.14 | ✅ **62 files / 313 tests passed**, 28.91s |

Test database: `postgres://localhost:5432/nutrezee_test` (`DATABASE_URL_TEST`), `OUTBOX_DISPATCHER=off`.

## 2. Recovery artifacts

| Artifact | Location | Purpose |
|---|---|---|
| Annotated tag | `recovery/pre-wp-lbl-a27` → `ff239a9` | In-repo restore point |
| Full bundle (all refs) | `~/Documents/NutrezeeOrderSystem-recovery/wp-lbl-a27/nutrezee-pre-wp-lbl-a27.bundle` | Out-of-repo complete history (69 MB, `git bundle verify` ✅ "records a complete history") |
| Uncommitted patch | `~/Documents/NutrezeeOrderSystem-recovery/wp-lbl-a27/uncommitted-working-tree.patch` | Pre-existing A25/A26 doc edits present in the working tree at recovery time |
| Status snapshot | `~/Documents/NutrezeeOrderSystem-recovery/wp-lbl-a27/status-at-recovery-point.txt` | Exact dirty-file list at recovery time |

Working tree at recovery time (pre-existing, not created by this WP):
`M 19_Roadmap/build_progress_register.md`, `M AGENTS.md` (A25/A26 amendments),
`?? output/`, `?? tmp/` (local scratch from the driver-app work).

## 3. Isolation

All WP-LBL-A27 work happens on branch **`build/wp-lbl-a27-legacy-label-barcode`**, branched from
`build/partner-daily-fleetbase` @ `ff239a9`.

Base is the **build branch, not `main`** — deliberately: `m20-packing`, `m21-delivery`,
`m24-fleetbase` and migrations `0016`–`0026` exist only on the build branch (`origin/main` has
none of them). The label and collection features depend on packing + delivery, so `main` is not a
viable base.

## 4. Rollback verification (actually executed, not assumed)

A throwaway clone was created from the bundle and compared against the tag:

```
restored HEAD: ff239a9a20b6774760a89bf12be0dcadd28915b4   (= expected)
tree:          ab26e0aa0d707d11ac4867d317141c3e3725f58e   (= recovery/pre-wp-lbl-a27^{tree})
recovery tag present in bundle: recovery/pre-wp-lbl-a27
m20-packing present in restore: yes
```

## 5. Rollback instructions

**A — discard WP-LBL-A27 entirely, keep the repo (normal case):**

```bash
git checkout build/partner-daily-fleetbase
git branch -D build/wp-lbl-a27-legacy-label-barcode
git apply ~/Documents/NutrezeeOrderSystem-recovery/wp-lbl-a27/uncommitted-working-tree.patch
```

**B — reset a branch back to the pre-change commit:**

```bash
git checkout build/wp-lbl-a27-legacy-label-barcode
git reset --hard recovery/pre-wp-lbl-a27
```

**C — full restore from the out-of-repo bundle (repo damaged/lost):**

```bash
git clone ~/Documents/NutrezeeOrderSystem-recovery/wp-lbl-a27/nutrezee-pre-wp-lbl-a27.bundle \
  NutrezeeOrderSystem-restored -b build/partner-daily-fleetbase
```

**D — database.** No migration in this WP is destructive; all are additive forward-only `CREATE`
statements. To roll the local test DB back, drop and re-run migrations:

```bash
psql postgres://localhost:5432/postgres -c 'drop database nutrezee_test' -c 'create database nutrezee_test'
DATABASE_URL=postgres://localhost:5432/nutrezee_test node app/db/migrate.mjs
```

Staging DB is **not** touched by this WP (no apply step is authorized here).
