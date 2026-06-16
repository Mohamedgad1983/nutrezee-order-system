# Legacy Full Migration Helpers

Small, dependency-free helpers for the evidence workflow in
`docs/evidence/legacy_full_migration/`.

## Validate Normalized JSONL

```bash
node tools/legacy-full-migration/validate-normalized.mjs \
  --input docs/evidence/legacy_full_migration/exports/normalized
```

The validator reads normalized JSONL files only. It does not connect to legacy or
new databases, does not import data, and prints no secrets.

Expected files:
- `customers.normalized.jsonl`
- `customer_addresses.normalized.jsonl`
- `orders.normalized.jsonl`
- `order_details.normalized.jsonl`
- `payments.normalized.jsonl`
- `deliveries.normalized.jsonl`
- `master_data.normalized.jsonl`

Exit code:
- `0` when no P0/P1/P2 issues are found.
- `1` when P1/P2 issues are found.
- `2` when P0 issues are found. P0 means import must not proceed.
