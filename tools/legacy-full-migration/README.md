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

## Legacy detail extractor (`legacy-detail-extract.mjs`)

Read-only extractor for the data the prior migration missed: the **product/meal
catalog**, per-order **delivery** (method / time / area / driver) and **payment
detail**, captured from the live `nutreeze.com` admin.

```bash
LEGACY_BASE=https://nutreeze.com LEGACY_EMAIL=… LEGACY_PASS=… \
OUT=/path/outside/repo node tools/legacy-full-migration/legacy-detail-extract.mjs <mode>
# mode = products | orders-index | orders-detail | all
```

Safety properties (enforced in code):
- **GET-only allowlist** — only `/products`, `/orders/ajaxlist/<status>`,
  `/orders/view/<id>`, `/orders/getMealsDateWiseFilter/all/<id>`, plus the single
  login POST. Any other URL throws. It never calls the mutation endpoints
  (`deletemeal` / `editMeal` / `assignDriver` / …) exposed by those pages.
- **Credentials from env only**; never logged, never written to a file.
- **Throttled** (`THROTTLE_MS`, default 1200) and **resumable** (skips order ids
  already in `order_detail.jsonl`).
- Captures **raw HTML gzipped** (lossless re-parse) + a best-effort structured
  parse. Output contains customer PII → write it **outside the repo**; never commit.

Known limitation: per-day **meal line items** are loaded by secondary ajax (not in
the static HTML) and would require ~500k requests across all orders — infeasible and
arguably kitchen/fulfillment-domain data, not the subscription `order_item`. The
extractor captures the meals page raw for a sample (`MEALS_SAMPLE`, default 30; set
`FETCH_MEALS=1` to force all) and flags the gap rather than scraping per-date.
