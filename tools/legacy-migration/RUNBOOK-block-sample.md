# Runbook — block-capture test pull (≤20 pages, gated on legacy login)

**Status:** prepared & smoke-tested; the actual run is GATED (legacy login = owner-run).
This pull is READ-ONLY against legacy and **never writes the `address` table** — output goes to
`./block-sample/` only. Run from `/opt/nutrezee/pr38-legacy-migration/tools/legacy-migration/`.

## Prereqs (contained, no legacy access)
1. `tsx` is already installed (`node_modules/.bin/tsx`). Parser self-test (optional):
   `node legacy-address-parser.test.mjs`  → expect `4 passed, 0 failed`.
2. Chromium for Playwright: cached at `/home/hermes/.cache/ms-playwright/chromium-1228`.
   If the running user can't see it, install once: `npx playwright install chromium`
   (or `export PLAYWRIGHT_BROWSERS_PATH=/home/hermes/.cache/ms-playwright`).
3. Legacy credentials in env (owner-provided; the assistant does NOT read/use them):
   `export LEGACY_BASE_URL=… LEGACY_ADMIN_EMAIL=… LEGACY_ADMIN_PASSWORD=…`
   (these match `config.json`'s `*Env` names; a copy lives in `/opt/nutrezee/legacy-migration.env`).

## Run (≤20 pages, gentle 1.5s throttle, read-only)
```bash
cd /opt/nutrezee/pr38-legacy-migration/tools/legacy-migration
SAMPLE_LIMIT=20 npx tsx extract-block-sample.ts          # newest 20 customers
# or target specific ids:  SAMPLE_IDS="20191,20186,20177" npx tsx extract-block-sample.ts
```
Outputs: `block-sample/raw/cust_<id>.html.gz` (raw pages, kept) + `block-sample/block_sample.jsonl`
(parsed granular fields incl. a dedicated `block`). Hard caps: ≤25 ids; GET-only after login
(`enableStrictReadOnly()` blocks any POST/write).

## Build the side-by-side + correctness rate
```bash
node compare-block-sample.mjs
```
Prints a per-id table (parsed.block / street / area vs the RAW page address lines) and a
block-capture correctness rate. If no page shows a literal `Block :` label, the raw evidence tells us
how legacy actually encodes block (the `Building Name : a, b` pair) so we can lock the derivation rule.

## Guardrails
- Stops at ≤20–25 pages — no full re-scrape, no schedule change, no scope increase.
- Read-only vs legacy; **no DB writes**; live `address` table untouched.
- Do NOT proceed to a full re-scrape or any `address`-table update until the side-by-side is reviewed
  and approved. Geocoding stays HELD until block is recovered + verified.
