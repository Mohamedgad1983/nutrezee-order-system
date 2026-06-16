# Legacy Full Migration Normalized Validation

Command:

```bash
node tools/legacy-full-migration/validate-normalized.mjs --input docs/evidence/legacy_full_migration/exports/normalized
```

Result:
- P0: 7
- P1: 0
- P2: 0
- Exit code from the raw command would be `2`; the session used `|| true` to continue documenting the blocker.

| Entity | Rows | Aggregate checksum |
| --- | ---: | --- |
| customers | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| customer_addresses | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| orders | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| order_details | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| payments | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| deliveries | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |
| master_data | 0 | `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855` |

| Severity | Entity | Code |
| --- | --- | --- |
| P0 | customers | missing_file |
| P0 | customer_addresses | missing_file |
| P0 | orders | missing_file |
| P0 | order_details | missing_file |
| P0 | payments | missing_file |
| P0 | deliveries | missing_file |
| P0 | master_data | missing_file |
