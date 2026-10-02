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

Native Chrome proof after owner setup: authenticated `nutreeze.com/dashboard`
showed Login successful. Read-only `/summary` for 2026-10-02 showed Off Day 875,
other current-day cohort counters zero. Its empty default table triggered an
existing DataTables unknown-parameter warning; warning dismissed without writes.
The observed Off Day link `/summary/off_day/2026-10-02` loaded successfully,
with `Showing 1 to 10 of 875 entries` and Previous/Next navigation. Browser
session/cookies/credentials were not copied to the server. This establishes
browser access and initial pagination only; complete row coverage, calendar,
payment and unattended server login remain unverified. Owner asked to distinguish
Nutreeze Admin credentials from separate WAHA Dashboard credentials.
Verified final page 88 through observed navigation: `Showing 871 to 875 of 875
entries`. First/last-page consistency is not full 88-page extraction proof.

Predeclared Admin acquisition implementation: admin_source.py,
test_admin_source.py, README and this plan. Strict source-only HTTPS transport,
origin/path allowlist, one ephemeral login, no cookie persistence, GET-only reads,
complete stable pagination checks, and HTML parsing based on observed screens.
No send transport or campaign writes. Unsupported calendar/payment markup must
block source certification rather than infer service days from Days Left.

## Admin acquisition recovery and implementation — 2026-10-02

Owner explicitly authorized using Desktop credential file. After exact labeled
RTF parsing, ephemeral server login succeeded at `/dashboard`; the existing
canonical credential keys were updated in place, with no credential output,
git content, copied cookies, accounts or permission changes. Earlier raw-line
and partial-label submissions were rejected; no invalid-password conclusion
applies to the correctly parsed Desktop values.

Implemented separate `admin_source.py`: same-origin HTTPS/path/query allowlist,
one CSRF/cookie-memory login per process, no relogin retries, GET-only acquisition,
exact/stable Active and pending pagination, all five current-day summary cohorts,
summary-to-Active order-number membership, authoritative detail/list date checks,
explicit full-range Off Day/Freeze Day controls, Order Meals read, later renewal
payment details and stable final re-reads. Unknown/partial/conflicting schema,
identity/date ambiguity, count changes and 25-minute collection budget fail closed.
No sender, campaign writer, automatic source timer, snapshot export or evaluator
activation has been added. Source CLI sampling never certifies completeness.

Verified live enumeration: two complete Active reads stable at 1122 records;
all five Summary cohorts re-read stable, Off Day 875 and others zero. Source
acquisition currently running supervised full validation. Full payment/calendar/
renewal join completeness is not yet proven; no eligible delivery cohort enabled.
47 scoped tests pass locally, including calendar gaps/duplicates, explicit off/
pause controls, relogin, partial/duplicate/changing pages, pending renewals,
detail-date conflicts and summary membership failure. Existing manual campaign
remains complete with 40 accepted sends. Renewal sending remains disabled.

Owner reaffirmed 2026-10-02: future operation and automatic sending must run on
server, not Mac. Desktop was only the specifically authorized one-time credential
input source; canonical server config now authenticates. Source-to-shared-Bulk
activation still requires real completeness and per-recipient recheck proof;
no unsafe delivery is activated while acquisition validation is blocked.

Live pending enumeration uncovered a metadata discrepancy: reported count 7987,
actual bounded physical scan 7994 distinct IDs, zero duplicate/conflicting rows,
empty terminal page. Initial strict reported-count stopping rejected this;
ASM-060 records the conservative replacement: empty-terminated physical reads,
no missing offset gap, reject below-reported coverage, duplicates, count changes,
rows beyond technical cap, and require stable second complete reads. No row is
silently dropped to match the lower counter. Batches of 1000 reduce source load.
Full calendar is read for every summary order; payment/Order Meals/history detail
are then required for the exactly-two-future-service-day candidate subset.
Non-candidates are excluded only through explicit calendar service/off/freeze
rows, never Days Left or guessed package weekdays. Source samples remain incomplete.

Additional source checks: three Active orders have invalid contact values, and
none of their order numbers is in today's Summary membership. A record with an
invalid contact/date is excluded as irrelevant only after its detail page's
observed immutable `var user_id` reference is unique and absent from ALL current
Summary customer IDs. No customer-name matching is used. Missing/ambiguous
references or defects belonging to a current Summary customer still block.
This is explicit membership proof, not dropping a malformed relevant record.
ISO and day-first hyphenated UI date presentations are parsed unambiguously.
Calendar/detail reads use at most four concurrent GETs, with memory-only cookies,
bounded freshness and cancellation after any failure. Source write/send features
remain absent. Final real-data validation continues; automatic delivery is NOT
operational yet, despite owner requirement for future server-only automation.

Real collection identified the oversized response as all-history Order Meals
for internal order 19479, not a missing future schedule. Use the observed UI
`getMealsDateWiseFilter/<exact-date>/<internal-id>` route for each of the two
verified future service dates instead. The future schedule remains fully checked
through explicit Off Day/Freeze Day controls. Historical flags are neither
fabricated nor required for today's future-date decision. Bounded transport
accepts up to 64 MiB for legitimate detail pages; no historical grids are exported.
Every transport request now enforces origin, method, path and query guards,
including rejecting arbitrary POSTs and cross-origin requests. A Kuwait date
rollover aborts acquisition rather than changing eligibility mid-snapshot.

Read-only collection repair: date-filtered meal grids contain nested layout tables.
Their authenticated GET uses the existing input-only login guard; payment and
complete future calendar parsing retain strict table validation. Pending rows with
unknown dates for matching cohort contacts explicitly hold renewal completeness.
Unrelated pending contacts remain enumerated for snapshot stability but are not
interpreted as this customer's renewal history. No sending is enabled by this repair.

Predeclared dry-run source wiring: `admin_source.py`, `test_admin_source.py`,
`waha-renewal-source.service`, `waha-renewal.service`, README and append-only
register evidence. Root-only snapshot publication after full stability validation;
separate bounded network-enabled acquisition unit required by the networkless
existing evaluator, retaining daily 13:00 Kuwait. This has no send capability.
Verified diagnostic: Active 1122 has no duplicate display numbers. Pending 7994
contains two rows with one repeated display number, internal IDs 3034 and 3035.
Pending must retain both by unique internal ID; Active Summary joins stay strict.

Additional predeclared regression file: `test_admin_snapshot.py` for protected snapshot publication, failure invalidation, locks and evaluator integration.

A subsequent real run saw Pending grow to 7995; the preceding scan correctly
blocked when its short-page membership changed. Another complete index read
reached 25 calendars before a same-contact/same-start distinct subscription.
This is an individual chronology hold, not malformed global membership: retain
it with renewals_complete=false and exclude from eligibility without inventing
which order is the renewal. Pending/unknown chronology remains review-only.

Latest protected writer validation (PID 1458951) reached Active 1123 then
terminated blocked `active_count_changed` during complete pagination. Prior
Pending was 7995 after the original 7994; no stable complete snapshot was
published, and no outgoing messages occurred. Source certification is blocked
by live membership changing during read, rather than credentials.

Deployable DRY-RUN wiring is a fail-closed build/test extension: the acquisition
dependency may publish only after a complete stable fresh read. Its failure
prevents the networkless evaluator running and leaves no export. The unchanged
13:00 Kuwait timer may attempt this read independently of the Mac. This is not
source acceptance or live activation; full real-data acceptance remains blocked
until one complete coherent read is proven. A previously stored evaluator result
must not be reported as today's success when source dependency has failed.

## Fail-closed server wiring proof — 2026-10-02

Installed the predeclared acquisition unit and evaluator dependency/configuration.
`systemd-analyze verify` passed; daemon reload only, timer schedule untouched.
53 source/snapshot/evaluator/setup tests pass on VPS, 68 including Bulk locally.
A supervised held-source-lock test caused the source to exit before login,
prevented evaluator execution, and left its ledger unchanged. No snapshot exists;
renewal delivery table count remains 0. All 67 existing container start/restart
records compared before/after unchanged; manual campaign 1 complete, sent 40,
pending 0, unchanged. The existing timer is active with next 2026-10-03 10:00 UTC
= 13:00 Kuwait, Persistent=false. Synthetic failed states reset after proof.

Real source outcome is terminal, not a still-running background job: PID1458951
blocked `active_count_changed` after reading Active 1123. Earlier Pending actual
7994 versus label7987 was proven by complete physical enumeration; later actual
7995 reflects live change. Complete stable re-read is required; no raw snapshot
was accepted, and no eligible cohort count can be claimed. Source is now wired
to the DRY-RUN evaluator through a separate network-enabled dependency, while the
evaluator remains AF_UNIX-only and cannot send. Source acceptance/live queue
integration/owner test acceptance remain BLOCKED. ASM-061 records overlap holds.

Final functional code `fd2402a`, pushed on build/ops-waha-renewal-dryrun,
Draft PR #91 OPEN/unmerged. Push CI37017726852 and PR CI37017735640 both pass
15/15 jobs on this exact head. 68 local and 53 server tests pass. All real source
jobs are terminal; latest `active_count_changed`, no running job/no snapshot.
The real source acceptance blocker remains; no renewal messages sent.

Final transport regression: redirect guards validate the complete path/query/
fragment, not just the pathname; an allowed read cannot redirect to a GET with
an unapproved query. Same-origin HTTPS and the original allowlist remain strict.

## Approved continuation — coherent acquisition and disabled queue integration

Predeclared: admin_source.py, test_admin_source.py, test_admin_snapshot.py,
renewal.py/test_renewal.py only if the verified source contract needs extensions;
new renewal_bulk.py/test_renewal_bulk.py and minimum bulk_server.py changes for
shared transactional creation/claim guards. Companion renewal metadata tables
must preserve the existing manual schema/data. Both renewal start and worker tick
remain hard-locked before any send transport; no HTTP or environment live switch,
no real renewal campaign or customer sends. Synthetic temporary-DB tests only for
queue integration; deployment cannot enable or modify manual campaigns.

Source refinement must prove complete candidate membership and relevant renewal/
payment/calendar state despite unrelated live count drift; no partial global
scan can be silently certified. Source UI filters/large-page export semantics
must be observed before expanding the allowlist. Bounded retries/checkpoints and
same-ID revalidation are allowed; ambiguous relevant changes hold or block.

Predeclared acquisition helper files: `admin_enumeration.py` and
`test_admin_enumeration.py`. Observed Active UI export explicitly requests
start=0,length=2147483647; use a stricter 10000-row cap and verify complete
single-response physical membership plus an empty terminal read. Retries are
bounded; no changed offset pages are stitched. Initial/final global exports may
differ only when the complete current-Summary/contact-relevant projections and
per-order authoritative reads establish the stated bounded consistency proof.

Predeclared collection coordinator: `admin_collection.py` and `test_admin_collection.py`, using complete exports, stable Summary identity and two independent relevant authoritative observations; per-customer review holds and bounded relevant-drift retries.

## Bounded source and disabled bridge build proof — 2026-10-02

ASM-062 refines unrelated-global-drift handling without accepting partial scans.
Observed both Active and Pending UI export actions request all rows. The bounded
real probe completed with Active1131/1131 and Pending7999/7992, unique internal IDs
and empty terminal reads, first attempt; the seven-row metadata undercount is
retained in evidence. Three complete exports and two per-order observations now
replace the previous global-membership freeze. Unknown/changed relevant evidence
produces explicit holds, and Summary identity drift has a single bounded restart.
No transaction-snapshot guarantee is claimed.

117 local and 117 VPS tests pass, including synthetic protected snapshots and
17 disabled shared Bulk bridge cases. The first VPS test invocation lacked
unchanged static assets in the isolated test directory; after SHA-verified copies
of those assets, all117 passed. Active Bulk source/database/services were not
changed. Isolated bridge tests verify atomic draft/reservation/audit, fresh review,
manual-history suppression, opt-out, duplicate/concurrent reservation, no automatic
held-recipient restoration and hard locks before start/transport. No live bridge
caller or runtime activation switch exists. A future caller must reuse the active
Store instance and implement verified live source recheck/claim before sends.

The supervised source/evaluator dependency job has started; aggregate terminal
real-data acceptance results are recorded below when available. Delivery remains
disabled throughout this build/test proof. No renewal campaign has been created.
