# 30 — Admin UI Operational Plan

> Operational screens for the Nutrezee admin SPA (`app/apps/admin`). Tracks which are **live now**
> vs **planned**, the route, the API it consumes, and the RBAC/masking posture. The SPA owns
> `/app/*`; the API owns its root prefixes (`docker/nginx.admin.conf`).

## Status legend
✅ live · 🟨 partial (data exists, dedicated screen planned) · ⬜ planned

| Screen | Route | Status | API consumed | Notes |
|---|---|---|---|---|
| **Incremental Sync Monitor** | `/app/sync` | ⬜ planned | `run-history.jsonl` via a read endpoint (TBD) | The schedule + counts-only run-history exist on the VPS (doc 25). A monitor reads the last N summaries (records_seen, would_create/update/skip/fail, watermark, errors). Until then: VPS log/tail. |
| **Manual Exception Review** | `/app/exceptions` | ✅ live | `GET /orders/exceptions`, `POST …/resolve` | Existing page (doc 20). PII-masked notes; resolve with escalation reason code. |
| **Packing Dashboard** | `/app/packing` | ✅ live | `GET/POST /packing/batches` | Filter by date; create batch by date/time/area; batch list with packed counts. |
| **Packing Batch Detail** | `/app/packing` (panel) | ✅ live | `GET /packing/batches/:id`, `mark-packed`, `issue`, `handoff` | Orders table; Pack / Issue / Label per row; Hand-off button (guarded). Customer name masked (🔒). |
| **Label Preview** | `/app/packing` (modal) | ✅ live | `POST /packing/labels/:orderId/preview` + `mark-printed` | Code, customer (masked), package, time, area, allergy warning; Mark-printed. |
| **Packing Issue View** | `/app/packing` (panel) | ✅ live | `POST …/issue` | Flag missing_item / issue + reason/notes. (A dedicated cross-batch issue queue is ⬜.) |
| **Driver List / Dashboard** | `/app/delivery` → Drivers | ✅ live | `GET/POST /drivers` | List with served areas + capacity; add driver. Phone masked. |
| **Area Assignment** | `/app/delivery` → Drivers (areas field) | 🟨 partial | `POST /drivers` (areas) | Areas+priority set at create. Dedicated per-area driver matrix editor is ⬜. |
| **Unassigned Orders / Driver Assignment** | `/app/delivery` → Unassigned | ✅ live | `GET /delivery/unassigned`, `POST /delivery/assign` + `/bulk-assign` | Pick driver, assign per-row or bulk; shows packing status. |
| **Route Builder** | `/app/delivery` (assign creates/extends route) | 🟨 partial | `POST /delivery/routes`, `assign` | Routes are auto-built on assign; explicit empty-route builder + drag-sequence is ⬜. |
| **Driver Route Detail** | `/app/delivery` → Routes (panel) | ✅ live | `GET /delivery/routes/:id`, `status`, `stops/:orderId/status` | Route status + per-stop status transitions. Driver phone + customer masked. |
| **Delivery Status Monitor** | `/app/delivery` → Routes | ✅ live | `GET /delivery/routes?date=` | Routes with delivered/total counts + status. A map view is ⬜. |
| **WhatsApp Queue Preview** | `/app/whatsapp` | ⬜ planned | Hermes preview (doc 23) | **Preview only — no sending.** Queue exists as a dry-run preview script; a read-only screen is planned. Sending stays disabled. |

## Conventions (all operational screens follow these)
- **Tiny fetch wrapper** (`api.ts`, `credentials:'include'`) + the ~50-line `history.pushState`
  router; no router/data libs.
- **RBAC at the API**, never the client: every action requires its permission (packing.* /
  delivery.*); a 403 surfaces a friendly message.
- **Masking server-side**: PII (customer name, driver phone, label display name) renders as `***`
  with a 🔒 marker for callers lacking the `pii` grant.
- **Optimistic-free reloads**: actions re-fetch (sequence-guarded) so the UI reflects the server's
  guard outcomes (capacity, duplicate, handoff).

## Build priority (next)
1. **Incremental Sync Monitor** (`/app/sync`) — read-only run-history view; closes the loop on doc 25
   so enabling the timer has an in-app health surface.
2. **WhatsApp Queue Preview** (`/app/whatsapp`) — read-only, sending stays disabled.
3. Route Builder drag-sequencing + per-area driver matrix (polish).
