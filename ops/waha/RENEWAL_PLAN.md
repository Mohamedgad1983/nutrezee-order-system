# OPS-WAHA-RENEWAL — A74, dry-run acceptance gate

Owner approval forwarded 2026-10-02: daily 13:00 Asia/Kuwait implementation/testing,
actual renewal delivery disabled until owner reviews test evidence. Existing manual
campaigns, WAHA auth, credentials, session and running services must not change.

Predeclared: this plan, renewal.py, test_renewal.py, renewal-source.example.json,
waha-renewal.service, waha-renewal.timer, README.md, a scoped extension of the
existing waha-bulk CI job, append-only build register and assumption register.

Verified blocker: supported Partner orders/meal-history/daily-deliveries do not
provide authoritative payment detail; dashboard CI is aggregate-only, legacy
incremental archives do not refresh existing payment records. No available
complete fresh individual source contract has been verified. Never treat the
old Days Left 3 review cohort as eligibility for the two-service-day workflow.

Conservative implementation: isolated root-operated, durable dry-run evaluator
and schedule. Source adapter remains blocked unless an individually verified,
complete, fresh export is explicitly configured by operations. No HTTP credential
acquisition, guessed endpoints, source sync, campaign changes, WAHA calls or live
send path. Fixture input exists only in tests. Source agreement is deployment
configuration; cannot be inferred from workbook or aggregate data.

Eligibility: exactly two distinct future service dates (today excluded), explicitly
service/off/paused/cancelled status, complete full schedule and later renewal list,
authoritative payment detail equal to list presentation or fail closed. A later
non-cancelled unpaid renewal holds for review, paid renewal excludes. Opt-out,
per-subscription/normalized-phone dedup and same-message manual Bulk history
(sending/sent/uncertain) exclude. Recheck method uses a new read at decision time;
it is NOT a functioning send integration. Uncertain sends are never retried.

Dry-run decisions/audit/run outcomes persist in protected SQLite, no PII in stdout.
Double-run by Kuwait date is recorded and cannot repeat completed evaluation.
Source failures remain retryable the same day. root CLI opt-out via stdin with
required reason; append-only audit. Live activation needs source/access contract,
owner acceptance, and a verified shared Bulk transactional queue integration;
this release deliberately cannot send, even via CLI flags.

## Deployment proof — 2026-10-02

Verified source remains blocked: no approved payment/schedule source configured.
Installed only `/opt/waha/renewal/renewal.py` and `waha-renewal` service/timer,
with root-only 0700 data directory and SQLite 0600. `systemd-analyze verify`
passed. Timer enabled, next 2026-10-03 10:00 UTC = 13:00 Kuwait; Persistent=false.
Two supervised no-network dry runs returned blocked, live_enabled=false, sent=0.
Renewal delivery table empty. 20 renewal tests pass on the server; 35 combined
regressions pass locally. All 42 existing container start/restart records
unchanged; manual campaign complete with 40 WAHA-accepted sends (not delivery
receipts), untouched by renewal work. Root-only journal emits no phones/messages.
Existing source credentials/auth untouched; no new access or live campaign.
Live sending BLOCKED on source contract + owner acceptance + shared Bulk queue
integration. Draft PR/CI evidence follows.

Final code `56188d5`, Draft PR #91 (not merged). Push CI `37004057941`
and PR CI `37004061241` both completed successfully. Final server source and
20 renewal tests verified after recovering a transient upload timeout; the
opt-out audit retains its reason without logging the phone. Final supervised
dry-run service status success, delivery disabled, source blocked. No actual
individual source has been certified. Live shared Bulk claim/recheck/pacing
integration is NOT shipped; activating delivery remains a separate gated unit.

## Admin UI source clarification — 2026-10-02

Owner clarification: obtain current individual data through existing Admin screens,
not require an API contract. This supersedes the API-only acquisition assumption;
source completeness and authoritative payment/calendar acceptance remain mandatory.

Verified authenticated-access blocker: a supervised ephemeral read-only source
probe used the existing root-held `/opt/nutrezee/legacy-migration.env` in place,
GET `/admin`, parsed the form's `_csrf`, and POSTed only `/logincheck`.
The response returned `/admin` with the password/login form still present.
No credential value, CSRF value, cookie, customer record or raw HTML was output,
copied or persisted. No credentials/configuration or services were changed.
This proves authentication was not established; it does not establish whether
credentials are invalid, expired or require another owner-managed login step.

Required one-time secure owner setup: verify that the existing Admin account can
log in at `https://nutreeze.com/admin`; if its credentials have changed, update
only the existing root-protected canonical legacy-migration configuration through
the owner's secure server administration channel (never through chat or git).
Any additional interactive authentication must be completed through the supported
owner login flow; browser sessions must not be copied to this service.

Until authenticated access succeeds, summary cohort pagination, all Active order
pages, authoritative detail payment, subsequent renewals and full Order Meals
service/off/paused calendar coverage are UNVERIFIED. No UI extraction adapter is
certified or deployed and no complete source snapshot has been produced. The
existing evaluator/timer remains dry-run-only, network-disabled and blocked;
manual campaigns and WAHA remain unchanged. After access recovery, predeclare
adapter/parser files and validate actual markup before implementing extraction.

Predeclared follow-up: `admin_login_setup.py`, `test_admin_login_setup.py` and
this plan. Owner-run hidden terminal input updates only the two existing
site-specific credential keys in their canonical root-owned file. The helper
must preserve all other bytes/keys, owner and mode; reject unsafe paths or
ambiguous keys; never authenticate, print values or create an account.

Secure setup evidence: canonical configuration verified root UID 0, mode 0600.
No matching legacy/migration log files were present directly in `/var/log` or
`/opt/nutrezee`; the failed probe did not retain response errors or redirect
history. Cause therefore remains UNKNOWN (CSRF/validation/credentials/session
cannot be distinguished), not proven wrong password. No repeat login attempted.
No supported secure configuration UI was found in repository runbooks; they
identify this canonical env file as the existing setup path.

Owner terminal command after helper installation:
`sudo python3 /opt/waha/renewal/admin_login_setup.py`
Both email and password prompts are hidden. Use the existing account that the
owner has independently verified through normal Admin login. This helper does
not create credentials, change file permissions, authenticate or activate sends.
Synthetic tests verify literal shell quoting, preservation of other settings,
and refusal of missing/duplicate keys or multiline inputs. 37 scoped tests pass.
UI acquisition/parsing still needs authenticated markup; no speculative parser
has been certified against unseen pagination/payment/calendar screens.

Owner confirmed secure setup completed and normal browser login works. The
subsequent server probe still returned `/admin` with login form. A corrected
form submission parsed HTML attributes using HTMLParser (entity-decoded CSRF),
used the same in-memory cookie jar, and included Origin/Referer, browser-style
User-Agent and URL-encoded fields. It also returned the login form; no known
CSRF, invalid-credential, missing-field or CAPTCHA error marker was detected.
A session cookie existed, which does not establish authenticated access.
Cause remains unverified. Do not repeatedly retry credentials or infer that
browser authentication proves unattended server authentication. No source
snapshot, authenticated pagination, calendar or payment completeness proof exists.

Root-cause clarification: differential visible-text inspection of the login
response (without emitting form values/cookies/raw HTML) found the exact site
alert `Username or password is incorrect!` after HTTP 302 `/admin`. The configured
origin is canonical HTTPS nutreeze.com with empty path; both credential keys are
nonempty. Earlier error-marker matching omitted this exact phrasing and was
insufficient. Verified: the source rejects the server-held credential submission.
Owner browser login remains reported working; equality of those inputs with
server-held inputs is not established. Required action is hidden owner re-entry
of that working account using the installed helper; no credential reset needed.
