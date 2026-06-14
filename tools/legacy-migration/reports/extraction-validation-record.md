# Extraction Validation Record

**Date:** 2026-06-14 · **Status:** Pipeline validated against fixtures + safety suite; real-data validation pending MG-A1 (legacy access) · **Owner:** Migration Operator
**Scope:** proves the read-only extraction → normalization → comparison → reporting pipeline is correct and safe *before* it ever touches the real legacy system. Real-data validation (row-count parity, NEEDS_MANUAL_REVIEW triage) happens during calibration (`10_Data_Model/migration_entity_calibration_playbook.md`) once credentials land.

---

## 1. Test-suite result (run 2026-06-14)

```
cd tools/legacy-migration && npm test   →   vitest run
 ✓ tests/comparators.test.ts        (4 tests)
 ✓ tests/extraction-safety.test.ts  (1 test)
 ✓ tests/safety.test.ts             (6 tests)
 ✓ tests/normalizers.test.ts        (10 tests)
 ✓ tests/output-safety.test.ts      (2 tests)
 Test Files  5 passed (5)
      Tests  23 passed (23)
```

| Suite | Validates | Why it matters for cutover |
|---|---|---|
| `normalizers.test.ts` (10) | legacy row → new-schema shape: phone normalization, price→minor units, date parsing, EN/AR name handling, confidence assignment (VERIFIED/INFERRED/NEEDS_MANUAL_REVIEW), unmapped fields → import_notes | The mapping in `migration_mapping.md` is executed correctly; nothing silently dropped |
| `comparators.test.ts` (4) | legacy-vs-new matching: matched / only-legacy / only-new buckets; "new requires (legacy lacks)" detection | The reconciliation report (the basis for import decisions) is correct |
| `safety.test.ts` (6) | read-only guard: auth-only POST allowlist, strict read-only after login, blocked mutation-word GETs, DOM click guard | The toolkit **cannot** mutate legacy — the core safety promise |
| `extraction-safety.test.ts` (1) | uncalibrated entities are skipped before navigation (NEEDS_CALIBRATION, 0 rows, no route visited) | No accidental scrape of an un-vetted page |
| `output-safety.test.ts` (2) | secrets + PII redacted in logs; extracted data written only to gitignored `migration-output/` | Extracted customer/order data never leaks into the repo or logs |

## 2. Dry-run scaffold validation (no credentials)

`npm run legacy:migration:dry-run` was exercised without legacy credentials. Confirmed behavior (`migration-output/2026-06-14T09-10-02-934Z/`):
- Pipeline runs **end-to-end** and degrades safely: verdict 🟡 NOT READY, rows extracted 0, every entity reported as access-gated/uncalibrated.
- The readiness report names the exact missing inputs (the S1 env vars) — the toolkit tells the operator what to provide rather than failing opaquely.
- No legacy route was visited; no file outside `migration-output/` was written.

This proves the **failure mode is safe**: an operator who runs the toolkit prematurely gets a scaffold report, not a half-scrape or a crash.

## 3. What this record does NOT yet prove (pending MG-A1)

| Unproven until real access | Validated during |
|---|---|
| Selectors match the real legacy DOM (row counts ≈ screen) | calibration playbook §1–2 |
| Real `NEEDS_MANUAL_REVIEW` rate is within DQ gates (merge_review ≤10%, error ≤2%) | first Batch-2 dry-run |
| Payment-status vocabulary, off_days, item-level data actually present | first extraction (MG-C2..C4) |
| Legacy-vs-new coverage counts against real catalog/customers | first full dry-run §3 |

## 4. Verdict

**The extraction pipeline is validated to the maximum extent possible without legacy access.** Correctness (normalizers/comparators), safety (read-only guard, redaction, calibration gate), and safe-failure (scaffold report) are all proven by the 23-test suite + the credential-less dry-run. The remaining validation is **selector calibration against the real DOM**, which is mechanical and gated solely on MG-A1. No engineering work stands between this record and a real dry-run — only the sponsor's legacy credentials.

**Next action on MG-A1 landing:** run `10_Data_Model/migration_entity_calibration_playbook.md §0` pre-flight, then calibrate Batch-1 entities first.
