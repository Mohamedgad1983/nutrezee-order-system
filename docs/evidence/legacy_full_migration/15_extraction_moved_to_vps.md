# Legacy Detail Extraction — Moved from Local Mac to VPS

Date: 2026-06-16

Per sponsor instruction: the long-running legacy detail extraction must run on the **VPS/server**, not the local Mac. The Mac is for smoke tests only.

## What was running locally

- Process: `node tools/legacy-full-migration/legacy-detail-extract.mjs all` (PID 75189), backgrounded on the Mac.
- Output dir (outside the repo, PII): `/Users/it/nutrezee-legacy-detail-2026/out`.

## Local progress at handoff

- `order_detail.jsonl`: **1,818 orders** completed, **0 errors**.
- Last completed internal_id: **21311**.
- Resumability: **confirmed** — `doOrdersDetail()` calls `loadDoneSet()` and `if (done.has(id)) continue`, keyed on `order_detail.jsonl`, so re-running skips completed orders.

## Local job disposition

- **LOCAL_JOB_STOPPED** — stopped only after resume state + last completed id were confirmed. The local `out/` dir is retained as a backup (outside the repo).

## Migration to VPS

1. Tarred the resume snapshot (`order_detail.jsonl`, `orders_index.jsonl`, `products.jsonl`, `extract.log`, `raw/`) — 21 MB, no credentials.
2. Uploaded the **script** and the snapshot via scp; created `/opt/nutrezee/legacy-detail-2026/out/`.
3. Extracted the snapshot on the VPS. Verified: done=1,818, index=26,071, products=1,296, raw=1,849, last id=21,311 (matches local).

## VPS run command (credentials masked)

```bash
cd /opt/nutrezee/legacy-detail-2026
export LEGACY_EMAIL='***'; export LEGACY_PASS='***'      # this shell only
docker run -d --name legacy-detail --restart no \
  -v /opt/nutrezee/legacy-detail-2026:/work -w /work \
  -e LEGACY_BASE=https://nutreeze.com \
  -e LEGACY_EMAIL -e LEGACY_PASS \              # value PASSED THROUGH, not in the command
  -e OUT=/work/out -e THROTTLE_MS=1200 -e PAGE_LEN=500 -e FETCH_MEALS=0 -e MEALS_SAMPLE=30 \
  node:22-alpine node legacy-detail-extract.mjs orders-detail
unset LEGACY_EMAIL LEGACY_PASS
```

- **node:22-alpine** container, detached (`-d`) → survives SSH disconnect (managed by the Docker daemon; `docker logs legacy-detail` for output). This is the Docker-native equivalent of tmux/screen.
- Credentials passed as **process environment variables** (`-e NAME` passthrough), **never written to a plaintext config file**, never committed, never logged (the extractor logs only `{"login":true,"ok":true}`).
- Mode `orders-detail` → resumes from order_detail.jsonl, skipping the 1,818 already done.

## Output path (on VPS)

- `/opt/nutrezee/legacy-detail-2026/out/order_detail.jsonl` (+ `raw/`, PII — stays on the VPS, never committed).

## Current state

- **VPS_JOB_RUNNING** — container `Up`, `{"login":true,"ok":true}`, order_detail advancing past 1,818.
- Remaining: ~18,800 of 20,637 distinct orders × 1.2s ≈ ~6.3 h.

## Security notes

- Credentials are in the container's process env (visible via `docker inspect` to anyone with Docker access on the VPS, for the container's lifetime — inherent to env vars). Recommend `docker rm -f legacy-detail` after completion to clear it, and rotating the legacy admin password.
- No credentials committed to the repo or written to any tracked/plaintext config file.

## Verify / monitor

```bash
docker ps --filter name=legacy-detail
docker logs --tail 20 legacy-detail
wc -l /opt/nutrezee/legacy-detail-2026/out/order_detail.jsonl
```
