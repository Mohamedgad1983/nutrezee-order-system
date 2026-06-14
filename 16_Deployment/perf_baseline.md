# Performance Baseline — Staging

**Date:** 2026-06-14 · **Status:** App-tier baselined; DB-tier + authed-endpoint baseline pending explicit approval/credentials · **Owner:** Operator
**Env:** `https://13-140-159-201.sslip.io` (VPS, Ubuntu 24.04, 8c/24GB) · measured on-host via the `nutrezee-vps` MCP (loopback, no network noise)
**Closes (partially):** MG-E3 (`10_Data_Model/migration_gap_register.md`). Feeds the go-live capacity-confidence gate (`go_live_checklist.md §1`).

> **Why a baseline.** Go-live needs a "the system is fast enough" data point and a reference to detect regressions during hypercare. This is the first capture: app-tier health latency under idle load, on a healthy host. Thresholds for *business* operations (intake-create, review-approve) are partly KPI-sheet-owned `[NC]` and are captured during UAT/pilot with real values.

---

## Host snapshot at measurement

| Metric | Value |
|---|---|
| Uptime / load | 1d 23h / load avg 0.31, 0.13, 0.10 (idle) |
| Disk | 13G / 193G used (7%) |
| Memory | 970MB used / 24GB (23GB available) |
| Containers | api, admin, caddy, postgres(healthy) — all Up |

## App-tier latency — `GET /health` (loopback, on-host)

| Sample | Value |
|---|---|
| Requests | 30 sequential |
| Cold (first request) | 15.4 ms |
| Warm min | 3.1 ms |
| Warm **p50** | **4.2 ms** |
| Warm **p95** | **7.1 ms** |
| Warm max | 9.0 ms |
| Warm avg | 4.6 ms |
| HTTP / body | 200 · `{"status":"ok","service":"nutrezee-api"}` |

**Read:** the app process + Nest stack respond in single-digit ms under idle load on loopback. This is the framework/process floor — real user latency adds TLS + network + the per-endpoint query cost (not yet measured). No capacity concern at the app tier for pilot volumes.

## Not yet measured (and why)

| Layer | Why pending | Unblock |
|---|---|---|
| **DB-tier query latency** (customer/audit/order counts, representative joins) | running `docker exec … psql` on the live shared staging host is correctly gated as a production-risk read | explicit user approval naming the staging target, or run during a maintenance window |
| **Authed-endpoint latency** (intake-create, review-approve, report-read, dashboard) | needs a staging app login credential | provide a read/UAT credential (e.g. the `uat-seed@` password) to the operator |
| **Under-load p95** (concurrent requests at pilot volume) | a load profile + concurrency target is pilot-owned | set target req/s from the KPI sheet `[NC]`; run a bounded k6/autocannon pass during the pilot window |
| **TLS + network RTT** (end-user path through Caddy) | external probe | a few external timed requests during a quiet window |

## Method (repeatable)

```bash
# app-tier (benign, loopback) — via nutrezee-vps MCP vps_exec
for i in $(seq 1 30); do curl -s -o /dev/null -w '%{time_total}\n' http://127.0.0.1:3000/health; done \
  | sort -n | awk '{a[NR]=$1;s+=$1} END{n=NR;printf "p50=%.4f p95=%.4f max=%.4f avg=%.4f\n",a[int(n*0.5)+1],a[int(n*0.95)],a[n],s/n}'
# DB-tier + authed + load: see "Not yet measured" — require approval/credentials/targets
```

## Next

- During UAT/pilot: capture intake-create and review-approve latency with real data (these are the numbers staff feel).
- Before production go-live: a bounded concurrent-load pass at the pilot's peak req/s, and wire health + latency into monitoring (`operations_runbook.md §2`, MG-E7).
