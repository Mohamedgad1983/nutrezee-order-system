# WAHA replacement gateway — OPS-WAHA

Deployment: `/opt/waha` on the existing VPS. HTTPS:
`https://wa.13-140-159-201.sslip.io/dashboard/`.
Image is pinned by immutable registry digest in `docker-compose.yml`.
No host ports, persistent `sessions/` and `media/`, 2 GB memory and 2 CPU limits,
bounded Docker logs, authenticated readiness check and automatic restart.

Login username: `admin`. Password and API key are the existing Evolution
`AUTHENTICATION_API_KEY`, reused server-side without generating new secrets.
Read credentials privately from `/opt/waha/.env` as root; never paste into logs,
issues, this repository, or URLs. API uses the `X-Api-Key` header.

The server deployment does not create/pair WhatsApp sessions or send messages.
The owner must create a session in the dashboard and scan its QR using the chosen
WhatsApp phone. Evolution session files cannot be reused as WAHA credentials.
Sending and receiving remain unverified until owner pairing and an explicitly
requested message test. WAHA endpoints/webhook payloads differ from Evolution;
this deployment does not claim transparent compatibility with old clients.

## Operate

```sh
cd /opt/waha
docker compose ps
python3 verify.py  # initial deployment only: expects zero sessions
```

Before an image upgrade, choose and verify a new digest explicitly. Do not switch
the installed compose to `latest`. Never print `docker compose config` or full
container environment: both expose credentials.

## Backup and restore

For paired sessions, stop only `waha-api` before running `sh backup.sh`, then
start it again. The root-only archive includes credentials, compose, sessions and
media. No automatic retention/deletion is configured; set an owner-approved
schedule and retention before relying on unattended operation. Initial empty
session/config backup is verified during deployment.

Restore into a stopped WAHA stack using the same image digest. Extract the
chosen archive into `/opt/waha` as root, preserve `.env` mode 0600 and directory
permissions 0700, then `docker compose up -d`. Do not merge mismatched session
snapshots. Initial backup validation proves archive readability, not a paired
WhatsApp restore drill.

## Rollback

Evolution stack and its existing backups are preserved at `/opt/evolution`.
The pre-cutover Caddy file is protected under `/opt/waha/`. To roll back, change
only the `wa.13-140-159-201.sslip.io` block in the current active Caddyfile back to
`reverse_proxy evolution-api:8080`, validate and gracefully reload Caddy. Do not
restore the entire saved Caddyfile over subsequent unrelated route changes.
No unrelated container restart is required. `/manager` redirects to WAHA's
`/dashboard/` on the replacement route.

## Existing Caddy mount caveat

The pre-existing read-only bind mount is stale relative to its host pathname.
The running proxy was gracefully reloaded from `/tmp/Caddyfile.waha` inside the
container (protected copy `/opt/waha/Caddyfile.runtime.waha`). Until a separately
planned Caddy recreation remounts the current host file, use this runtime file
for validation/reload and change only the required route. The host
`/opt/nutrezee/repo/docker/Caddyfile.active` already has the WAHA route for future
container recreation. Do not reload `/etc/caddy/Caddyfile`; it still points to
Evolution. For rollback, patch the WhatsApp block in both current host and
runtime copies, validate and reload the runtime copy. Preserve unrelated routes.

## Paced bulk campaigns — OPS-WAHA-BULK

URL: `https://wa.13-140-159-201.sslip.io/bulk/`. Uses the CURRENT dashboard
username/password from `/opt/waha/.env`, not the API key as the login password.
Owner simplified the dashboard password on 2026-10-02; no credential values are
stored in this repository. The API key remains server-held and separate.

Paste one phone per line or load UTF-8 CSV/TXT with one number column. Local
8-digit numbers explicitly mean Kuwait; international numbers accept `+` or
`00`. Duplicate normalized numbers are removed. Supported output is plain text
with identical content for each recipient. Maximum: 10000 rows and 4000 message
characters. A saved campaign is a draft and NEVER starts sending on its own.
Review the message, recipients and unique count, then explicitly start.

A single worker sends on the fixed existing `nutreeze` session. The global
SQLite throttle enforces at least 60 seconds after every completed send attempt,
across campaign switches and process restarts. Pause is serialized with sending:
a request already in progress can finish before pause is acknowledged; it cannot
be recalled. Accepted messages are not proof of recipient delivery/read status.

Successful requests record message ids. Definite validation/auth/rate-limit
rejections are failed and pause the campaign; they are not automatically retried.
Timeouts, server errors and responses without message ids are uncertain and stop
all further messages in that campaign. Confirm in WhatsApp then mark that row
sent, or skip it without resending, before explicitly resuming remaining pending
rows. Startup always pauses active work and treats interrupted in-flight requests
as uncertain. No schedule, unattended start, auto-resume or hidden retry.

Operates as a separate `waha-bulk` container with no published host ports, only
Caddy ingress, numeric unprivileged user, read-only root filesystem, restricted
capabilities, SQLite volume and resource/log bounds. Authenticated endpoints use
Basic auth over HTTPS. All mutation endpoints additionally require an exact
same-origin header and JSON content type. Client/recipient content renders with
textContent; source files are fixed allowlisted paths. No body/phone/key logging.

Runtime files: `/opt/waha/bulk/` (source, read-only in container),
`/opt/waha/bulk-data/` (0700, owned by uid 10001; SQLite 0600).
Run as root on the VPS:

```sh
cd /opt/waha
docker compose -f bulk-compose.yml config -q
docker compose -f bulk-compose.yml ps
python3 bulk-backup.py
```

Backup uses SQLite's online backup API plus integrity_check and creates root-only
artifacts under the existing backups directory. No automatic schedule or deletion
policy has been added. Restore requires stopping ONLY `waha-bulk`, restoring a
verified complete database snapshot to bulk-data (owner 10001:10001, mode 0600),
then starting it again; startup never resumes sending. Do not merge old WAL/SHM
files into a restored snapshot. Preserve the existing `.env`, compose and pinned
source release. The original WAHA session/media backup remains separate.

Changing dashboard credentials requires recreating only the bulk container to
load the new login password. It does not recreate WAHA or send a campaign.
See `BULK_PLAN.md` for deployment evidence and scope.

The bulk deployment supersedes the earlier runtime reload path: current running
Caddy JSON is `/tmp/Caddy.runtime.bulk.json` in the Caddy container, protected
host copy `/opt/waha/Caddy.runtime.bulk.json`. The exact live configuration was
read from Caddy's private admin API and only two bulk-path routes were inserted
inside the WhatsApp hostname. All other current live routes stayed identical.
Persistent Caddyfile.active also has the new `/bulk/*` handle. Never reload the
old `/etc/caddy/Caddyfile` or `/tmp/Caddyfile.waha`; those omit the bulk route.
For future changes, read the live config first and preserve unrelated routes.

### Dashboard Bulk extension
Bulk opens within the original WAHA shell at `/dashboard/#bulk`. `/bulk/` redirects users to that panel; only `#embedded` renders the inner form. It uses WAHA's theme/font resources. The installer `/opt/waha/bulk/install-dashboard-extension.py` injects the separately identifiable extension into stock HTML entry points, retaining originals under `/opt/waha/dashboard-extension/original`. Run it before first use of the new compose HTML mounts. No WAHA bundle files are edited. For an image upgrade, verify new HTML/DOM entry points and regenerate from that image; never carry stale HTML across image versions. Rollback: restore original HTML and remove the seven extension mounts. No campaign data or sending logic is changed.

### Renewal assessment — DRY-RUN only (A74)

`waha-renewal.timer` runs at 13:00 Asia/Kuwait (10:00 UTC), no boot catch-up,
`Restart=no`. The evaluator has no WAHA transport, campaign writer or live CLI
flag. Its systemd sandbox prohibits Internet sockets. Existing Basic Auth,
manual campaigns, credentials and all other services stay unchanged.

Missing, partial or stale source data returns `blocked`. The installed source
dependency reads the existing Admin screens; supported Partner integration lacks
the necessary authoritative payment details. Neither aggregate BI nor archived
imports can substitute. Capture and row observations must be within 30 minutes;
list/detail conflicts and unpaid renewals hold.

A reviewed export adapter may be configured by operations with
`RENEWAL_SOURCE_PATH`, `RENEWAL_SOURCE_ID`, `RENEWAL_SOURCE_VERIFIED=yes`.
The installed evaluator unit names only the protected Admin producer output;
these flags alone do not establish source completeness. The example JSON is
fixture-only, never an approved source. Required subscription fields are
`subscription_id`, `phone`, `state=active`, `updated_at`, `schedule_complete`,
`renewals_complete`, `payment_detail`, `payment_list`, `schedule` (unique dates
and states), and `later_renewals` (state/detail/list payment). Source metadata
requires `schema_version=1`, `source_id`, `captured_at`, `complete=true` and
`payment_authority=order_detail`. Pending/conflicting/missing payment blocks.

Today is excluded: exactly two FUTURE service dates qualify. Friday-off
ending Oct 4 has Oct 3/4 = two; weekend-off has Oct 4 = one; pauses Oct 3/5
through Oct 7 leave Oct 4/6/7 = three. Expiry date/Days Left presentation is
not used. No actual eligibility claims are made while the source is blocked.

Protected state is `/opt/waha/renewal-data/renewal.sqlite3` (0600 in 0700).
Run/decision/audit records persist across restarts. A completed Kuwait-day run
cannot repeat; source failures can be assessed again. The recheck API reads
source again and consults suppression, previous subscription/phone deliveries,
and the same-message manual Bulk send/uncertain ledger read-only. This is
evaluation infrastructure, **not a completed shared live sender integration**.
Live acceptance must add a tested transactionally shared Bulk queue/throttle,
claim/recheck lifecycle and ambiguous-send reconciliation before enabling delivery.
The existing bulk interval and active campaigns are not touched by assessment.

The installed unit sets `RENEWAL_BULK_READER=container`. Its fixed read-only query
runs through the existing local Docker socket in `waha-bulk` as UID10001 against
`/data/campaigns.sqlite3`, with SQLite `mode=ro` and `query_only=ON`. This lets
SQLite use its ordinary owner-held WAL sidecars while keeping the evaluator's
host Bulk directory read-only. No Store constructor, application write, send or
service restart is invoked. Phone/message parameters travel on stdin; only a
boolean result returns. Timeouts, malformed output or unavailable history block
the complete assessment, clearing partial decisions. A narrowly recognized older
dry-run outcome that incorrectly marked unavailable history complete may retry,
preserving its previous aggregate in audit; valid completed runs stay deduplicated.

Operator opt-out (root SSH only, no browser permission changes):
`python3 /opt/waha/renewal/renewal.py --opt-out --reason 'Customer requested stop'`
then enter the phone on stdin. It is normalized, persisted and audited; never
printed. Suppression applies to the new renewal assessment, not existing manual
campaigns. Read summary with `journalctl -u waha-renewal.service --no-pager`;
stdout contains counts/error codes only. No new credentials are created.

To install: create `/opt/waha/renewal` and root-only `renewal-data`; copy evaluator,
Admin source/coordinator/enumeration modules and the three source/evaluator/timer
units; `systemd-analyze verify` all units, reload systemd and
enable only this timer. A supervised `systemctl start waha-renewal.service`
reads Admin and runs a dry assessment without sending or writing to Admin. Disable
only `waha-renewal.timer` for rollback; protected audit/history stays retained.

### Admin read-only acquisition (PR91; delivery stays disabled)

`admin_source.py` reads only observed Admin screens over verified same-origin
HTTPS. Authentication uses the existing root-owned canonical legacy migration
configuration; cookies and CSRF are memory-only. Only login POST is allowed.
Summary cohorts are full server-rendered tables. Active and pending lists use the
observed all-export mechanism with a stricter 10000-row cap: one complete response,
unique internal IDs, no reported undercoverage, and an empty terminal request.
Each export retries a changed terminal proof at most three times; it never joins
pages from changing enumerations. Actual rows may exceed the known undercounting
metadata, but every physical row remains available for reconciliation.

Collection joins Summary order numbers to Active internal IDs and verifies their
contacts. Every Summary calendar is read twice using explicit Off Day/Freeze Day
controls over the full future date range. Exactly-two-day candidates receive two
independent authoritative payment/customer-ID/status checks, including relevant
later Active/pending orders. Same-phone different-customer identity, equal starts,
unknown chronology, payment conflicts and unknown lifecycle states hold for review.

The main detail workflow status is a select, whose unselected labels must not be
treated as its current state. Require one explicit selected option with matching
value/label. Observed selected `success`/Success supports Active membership;
selected `pending`/Pending supports Pending. Other workflow options remain held
until verified, and unrelated page controls never establish order status.

Root-only supervised commands:

```
python3 /opt/waha/renewal/admin_source.py
python3 /opt/waha/renewal/admin_source.py --sample 1
python3 /opt/waha/renewal/admin_source.py --collect
```

The first command is the older strict pagination diagnostic; `--collect` uses the
bounded coordinator. Sampling runs the same complete checks but never marks its
output complete. Three complete exports surround two calendar/payment observations.
Unrelated global list changes are allowed; relevant order/calendar/payment changes
hold the affected decision. Summary identity changes restart the whole acquisition
once within the original 25-minute budget. Category movement alone is harmless.
This proves bounded observed consistency, not a transactional database snapshot.
Commands emit aggregate progress/counts/error codes,
never rows or credentials. `--write-snapshot` additionally publishes a root-only
`admin-source.json` after complete stable collection, protected by a retained
exclusive lock. It removes the previous export before acquisition and never
publishes incomplete, stale or failed results. It does not send messages.

The separately predeclared `waha-renewal-source.service` can be required by the
networkless dry-run evaluator. The existing daily 13:00 Asia/Kuwait timer starts
the source dependency first; a failed source blocks evaluation. Root credentials
remain in their existing canonical configuration, not copied into unit files.
Certification scope is today's five Summary cohorts, joined to all Active and
Pending rows, not all Active subscriptions. Explicit future calendars determine
exactly two service dates; authoritative detail payment and later renewal status
control individual eligibility/holds. Source metadata counters are advisory;
every export must independently prove complete physical unique-ID enumeration.
A matching
pending order with unknown dates, or another subscription sharing the same start,
holds that customer's decision without silently discarding the record.

The fail-closed dry-run wiring can attempt a protected source read daily; source
acceptance remains blocked until full real-data validation succeeds. A failed
source dependency prevents evaluator execution, so inspect its service status
as well as the ledger; an older ledger row is not today's completed evaluation.
Actual renewal sending remains disabled pending owner acceptance and verified live
claim/recheck integration; existing manual campaigns are untouched.

### Disabled shared Bulk bridge (synthetic acceptance only)

`renewal_bulk.py` reuses the Bulk draft transaction with separate renewal metadata,
durable subscription/phone reservations and same-transaction review audit. Each
prospective recipient gets a fresh source/opt-out/manual-history check. Relevant
changes hold recipients; held recipients are never automatically restored. Both
campaign start and worker tick hard-stop renewal campaigns before readiness,
claim or any send call. There is no CLI, HTTP route or configuration unlock.

The bridge currently has no scheduler/service caller. Tests use temporary databases;
the deployed manual Bulk code/database is unchanged. Future wiring must reuse the
running worker's Store instance: constructing another Store on its live database
would run the existing startup recovery. File rechecks at draft/review time do not
substitute for a future live Admin recheck before an actual send.
