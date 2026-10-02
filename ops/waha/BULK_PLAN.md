# OPS-WAHA-BULK — prepare paced batch messaging

Owner directive 2026-10-02: prepare the server now; recipients and message text
will follow later. Only prepare tools; do not send any campaign or test message.

Scope: isolated standard-library Python/SQLite batch UI and worker at `/bulk/`
on the existing WhatsApp hostname. Same dashboard credentials, server-held WAHA
API key, fixed existing `nutreeze` session. Explicit draft → review → start;
60-second global minimum gap, one campaign at a time, pause/resume, durable send
ledger, no automatic retry on ambiguous responses. Startup pauses active work
and marks interrupted sends uncertain. No auto-start, schedules, integrations,
customer-source reads, Partner/legacy/Fleetbase changes or other restarts.

Predeclared files: `BULK_PLAN.md`, `bulk_server.py`, `bulk.html`, `bulk.js`,
`bulk.css`, `test_bulk.py`, `bulk-compose.yml`, `bulk-backup.py`, `README.md`, a scoped new test job
in `.github/workflows/ci.yml`, plus append-only
amendment/run evidence in `19_Roadmap/build_progress_register.md`.

Validation: fake transport tests for interval persistence, concurrent claiming,
normalization/deduplication, pause/start, failed/ambiguous HTTP results, crash
recovery and CSRF/auth restrictions; isolated HTTP smoke; no outbound WhatsApp
calls in tests. Deploy with a pinned official Python image, private ingress,
persistent 0700 SQLite directory, bounded logs/resources. Caddy patches only
this hostname, preserving all existing runtime and persistent routes. Verify
HTTPS/auth, zero campaigns/sends, running WAHA status and neighbouring start times.

## Deployment evidence — 2026-10-02

Verified official Python image digest
`sha256:2dd78ad5cf13a0b68f5134dc49aa9950203a8cf4b7463431b9f3b398287c5059`.
Isolated `waha-bulk` is healthy, uid 10001, no host ports, read-only root,
persistent protected SQLite. No new dependencies, credentials or messages.

Live HTTPS: unauthenticated UI 401; authenticated UI/JS/CSS/campaign API 200;
cross-origin JSON mutation 403; zero campaigns, interval 60. Existing nutreeze
WAHA session WORKING; all existing container start/restart metadata unchanged;
Fleet-Ops and app health still HTTP 200. Root-only SQLite backup integrity passed
(`/opt/waha/backups/bulk-20261002T060321Z.sqlite3`). Native Chrome login and visible
Arabic page verified; page explicitly shows no campaigns / sending stopped.

Runtime Caddy read from its private admin API; two paths added ONLY to WhatsApp
site. Protected runtime JSON copy is `/opt/waha/Caddy.runtime.bulk.json`, used
inside Caddy at `/tmp/Caddy.runtime.bulk.json`. Persistent Caddyfile.active route
updated separately. Other current runtime routes preserved exactly.

Final source includes Arabic/English interface and localized error messages.
15 fake-transport/HTTP tests pass, including slow-send spacing and absent message
id handling. JavaScript syntax and diff whitespace checks pass. No real phones
or message contents from this conversation are committed as campaign fixtures.

Release complete: PR #88 merged as `4feb72d`, final implementation `09ddf4e`.
Push CI `36972091057` and PR CI `36972131766` both passed all 15 jobs, including
the dedicated 15-case WAHA bulk regression suite. Final server store is empty;
WAHA session WORKING; SQLite mode 0600; final online backup
`bulk-20261002T060905Z.sqlite3` passed integrity_check. No campaigns or messages
created by this preparation. Future owner input/start is a separate action.
