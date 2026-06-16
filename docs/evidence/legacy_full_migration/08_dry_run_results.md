# Dry-Run Results

Date: 2026-06-16

Status: `BLOCKED`

## Dry-Run Inputs

| Input | Status |
| --- | --- |
| Legacy raw files | missing |
| Normalized files | missing |
| Legacy DB/API/export/browser access | missing |
| New DB connection | missing |

## Validation Result

No migration dry-run against real legacy data was possible.

The normalized-file validator is available at:

```bash
node tools/legacy-full-migration/validate-normalized.mjs --input docs/evidence/legacy_full_migration/exports/normalized
```

Current validator result:
- 7 P0 issues.
- All seven required normalized files are missing.
- Import must not proceed.

## Data Quality Findings

| Severity | Count | Notes |
| --- | ---: | --- |
| P0 | 7 | Missing normalized files: customers, customer_addresses, orders, order_details, payments, deliveries, master_data |
| P1 | 0 | No records available to inspect |
| P2 | 0 | No records available to inspect |

## Decision

Import gate: `RED`

Reason:
- Missing source access and normalized files.
