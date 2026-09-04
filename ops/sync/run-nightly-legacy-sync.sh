#!/usr/bin/env bash
# Nightly legacy -> staging sync (STAGING ONLY). Pulls NEW legacy orders incrementally and lands
# them in the new system, reusing the pieces proven during the 2026-06 migration. Hardened after
# an adversarial safety review (docs/evidence/legacy_full_migration/35_nightly_sync.md):
#   * post-fetch validation: a partial/empty legacy fetch (legacy down) ABORTS with an alert
#     instead of silently syncing nothing;
#   * snapshot BEFORE any DB write, integrity-checked, old dumps pruned;
#   * hard caps on customers/orders created per night (anomaly guard);
#   * apply scripts fail-fast on any chunk error; the orchestrator dies on non-zero;
#   * correctness probe is FAIL-CLOSED, keyed to this run's start, and checks the created count,
#     the source phone match, AND that each order's phone maps to exactly one customer;
#   * temp files (which hold phone numbers) are trap-cleaned on every exit path.
#
# Pipeline: refresh(index+validate, detail) -> enrich(+validate) -> snapshot -> extract+cap
#   customers -> import customers -> plan+cap orders -> apply orders -> PROBE(fail-closed) -> relink.
#
# Owner-provided on the VPS: /opt/nutrezee/legacy-migration.env (legacy creds), /opt/nutrezee/.env
# (POSTGRES_PASSWORD). Deploy: /opt/nutrezee/sync/run-nightly-legacy-sync.sh (chmod 750). Driven by
# the systemd timer. NEVER production, NEVER WhatsApp, NEVER customer email. Legacy is read-only.
set -Eeuo pipefail

RUN_START="$(date -u +%Y-%m-%dT%H:%M:%S)"        # cutoff for "orders created by THIS run"
DETAIL_DIR="${DETAIL_DIR:-/opt/nutrezee/legacy-detail-2026}"
RELINK_DIR="${RELINK_DIR:-/opt/nutrezee/legacy-meal-history}"
CONTAINER="${CONTAINER:-nutrezee-api-1}"
PG="${PG:-nutrezee-postgres-1}"
BACKUP_DIR="${BACKUP_DIR:-/opt/nutrezee/backups}"
LOG_DIR="${LOG_DIR:-/opt/nutrezee/sync/logs}"
LOG="${LOG:-${LOG_DIR}/nightly-legacy-sync.log}"
HIST="${HIST:-${LOG_DIR}/nightly-legacy-sync-history.jsonl}"
ALERT="${ALERT:-${LOG_DIR}/nightly-last-alert.json}"
PIDLOCK="${PIDLOCK:-/run/nutrezee-nightly-legacy-sync.pid}"
ENRICHED="${ENRICHED:-${DETAIL_DIR}/orders_history_enriched.json}"
MISSING="${MISSING:-${DETAIL_DIR}/customers_missing.json}"
# anomaly guards (legacy glitch / partial fetch). Tune via env if a genuine surge is expected.
MIN_INDEX_ROWS="${MIN_INDEX_ROWS:-10000}"        # the real index is ~26k; below this = partial/down
MIN_INDEX_STATUSES="${MIN_INDEX_STATUSES:-4}"
MAX_NEW_CUSTOMERS="${MAX_NEW_CUSTOMERS:-500}"
MAX_NEW_ORDERS="${MAX_NEW_ORDERS:-1000}"
SNAP_RETAIN_DAYS="${SNAP_RETAIN_DAYS:-14}"
TS() { date -u +"%Y-%m-%dT%H:%M:%SZ"; }
say() { echo "$(TS) $*" >>"${LOG}"; }
die() { say "FATAL $*"; echo "{\"ok\":false,\"at\":\"$(TS)\",\"err\":$(printf '%s' "$*" | python3 -c 'import json,sys;print(json.dumps(sys.stdin.read()))')}" >"${ALERT}"; exit 1; }
mkdir -p "${LOG_DIR}" "${BACKUP_DIR}"

# ---- cleanup (PII temp files + pidlock) on EVERY exit path ----
trap 'rm -f "${PIDLOCK}" /tmp/nsync_o.txt /tmp/nsync_c.txt /tmp/nprobe.txt' EXIT

# ---- overlap guard ----
if [[ -e "${PIDLOCK}" ]] && kill -0 "$(cat "${PIDLOCK}" 2>/dev/null)" 2>/dev/null; then
  say "SKIP: previous nightly sync still running (pid $(cat "${PIDLOCK}"))"; exit 0
fi
echo $$ >"${PIDLOCK}"
say "START nightly-legacy-sync (staging only) run_start=${RUN_START}"

# ---- creds (never echoed) ----
[[ -f /opt/nutrezee/legacy-migration.env ]] || die "missing /opt/nutrezee/legacy-migration.env (legacy creds)"
[[ -f /opt/nutrezee/.env ]] || die "missing /opt/nutrezee/.env (DB creds)"
set -a; source /opt/nutrezee/legacy-migration.env; source /opt/nutrezee/.env; set +a
export LEGACY_BASE="${LEGACY_BASE_URL:?}" LEGACY_EMAIL="${LEGACY_ADMIN_EMAIL:?}" LEGACY_PASS="${LEGACY_ADMIN_PASSWORD:?}"
: "${DATABASE_URL:=postgres://nutrezee:${POSTGRES_PASSWORD:?}@127.0.0.1:5432/nutrezee}"; export DATABASE_URL

# ---- 1. LEGACY REFRESH: orders-index (full listing) ----
say "step 1: orders-index"
( cd "${DETAIL_DIR}" && OUT="${DETAIL_DIR}/out" node legacy-detail-extract.mjs orders-index >>"${LOG}" 2>&1 ) \
  || die "orders-index fetch failed (legacy down / auth / endpoint error) — no DB write"

# ---- 1b. VALIDATE the index — a partial/empty fetch (legacy down) must ABORT, not sync nothing ----
idxfile="${DETAIL_DIR}/out/orders_index.jsonl"
[[ -s "${idxfile}" ]] || die "orders_index.jsonl empty after fetch — legacy fetch incomplete; aborting"
rows="$(wc -l < "${idxfile}")"
statuses="$(python3 -c "import json;print(len({json.loads(l).get('status') for l in open('${idxfile}') if l.strip()}))" 2>/dev/null || echo 0)"
[[ "${rows}" -ge "${MIN_INDEX_ROWS}" ]] || die "orders-index only ${rows} rows (< ${MIN_INDEX_ROWS}) — partial/incomplete legacy fetch; aborting before any write"
[[ "${statuses}" -ge "${MIN_INDEX_STATUSES}" ]] || die "orders-index has only ${statuses} statuses (< ${MIN_INDEX_STATUSES}) — partial fetch; aborting"
say "index OK: ${rows} rows, ${statuses} statuses"

# ---- 1c. orders-detail (incremental: skips already-archived -> only NEW orders) ----
say "step 1c: orders-detail (only-new)"
( cd "${DETAIL_DIR}" && OUT="${DETAIL_DIR}/out" node legacy-detail-extract.mjs orders-detail >>"${LOG}" 2>&1 ) \
  || die "orders-detail fetch failed — no DB write"

# ---- 2. ENRICH (correct id chain) + validate ----
say "step 2: enrich"
( cd "${DETAIL_DIR}" && OUT="${ENRICHED}" node enrich-orders.mjs >>"${LOG}" 2>&1 ) || die "enrich failed"
[[ -s "${ENRICHED}" ]] || die "enriched file empty"
python3 -c "import json,sys; d=json.load(open('${ENRICHED}')); sys.exit(0 if isinstance(d,list) and d else 1)" \
  || die "enriched file is not a non-empty JSON array — refresh likely incomplete"

# ---- 3. SNAPSHOT (before ANY DB write) + integrity + prune ----
snap="${BACKUP_DIR}/nightly-pre-$(date -u +%Y%m%d-%H%M%S)-$$.dump"
say "step 3: snapshot ${snap}"
docker exec "${PG}" pg_dump -U nutrezee -d nutrezee -Fc 2>>"${LOG}" >"${snap}" || die "snapshot pg_dump failed"
docker exec -i "${PG}" pg_restore -l - <"${snap}" >/dev/null 2>>"${LOG}" || die "snapshot integrity check failed (corrupt dump): ${snap}"
find "${BACKUP_DIR}" -name 'nightly-pre-*.dump' -type f -mtime "+${SNAP_RETAIN_DAYS}" -delete 2>/dev/null || true

# ---- 4. MISSING CUSTOMERS (read-only extract) + cap ----
say "step 4: extract missing customers"
docker exec "${PG}" psql -U nutrezee -d nutrezee -tAc "SELECT legacy_key FROM sync_record WHERE object_type='order'"    >/tmp/nsync_o.txt 2>>"${LOG}"
docker exec "${PG}" psql -U nutrezee -d nutrezee -tAc "SELECT legacy_key FROM sync_record WHERE object_type='customer'" >/tmp/nsync_c.txt 2>>"${LOG}"
cust_out="$(cd "${DETAIL_DIR}" && SRO_FILE=/tmp/nsync_o.txt SRC_FILE=/tmp/nsync_c.txt OUT="${MISSING}" node extract-missing-customers.mjs 2>>"${LOG}")" \
  || die "extract-missing-customers failed"
clean_cust="$(echo "${cust_out}" | python3 -c "import json,sys; print(json.load(sys.stdin).get('clean_customers_to_import',0))" 2>/dev/null || echo 0)"
say "missing customers to import: ${clean_cust}"
[[ "${clean_cust}" -le "${MAX_NEW_CUSTOMERS}" ]] || die "new customers ${clean_cust} exceeds cap ${MAX_NEW_CUSTOMERS} — anomaly; aborting (review legacy data before raising MAX_NEW_CUSTOMERS)"

# ---- 5. IMPORT CUSTOMERS (governed M19, idempotent, fail-fast) ----
if [[ "${clean_cust}" -gt 0 ]]; then
  say "step 5: import ${clean_cust} customers"
  docker cp "${MISSING}" "${CONTAINER}:/srv/customers_missing.json" >/dev/null
  docker exec -e ALLOW_APPLY=yes -e SYNC_TARGET=staging "${CONTAINER}" \
    node /srv/apply-customer-import.mjs /srv/customers_missing.json >>"${LOG}" 2>&1 || die "customer import failed (fail-fast)"
else
  say "step 5: no missing customers — skip"
fi

# ---- 6. PLAN orders (after customers) + cap ----
say "step 6: dry-run plan"
docker cp "${ENRICHED}" "${CONTAINER}:/srv/orders_history_enriched.json" >/dev/null
plan="$(docker exec -e NOTIFY_DISABLE=1 -e SYNC_MODE=dry-run -e SYNC_TARGET=staging "${CONTAINER}" \
  node /srv/incremental-sync.mjs /srv/orders_history_enriched.json 2>>"${LOG}" | grep -E '^SUMMARY ' | tail -1 | sed 's/^SUMMARY //')"
wc="$(echo "${plan:-}" | grep -oE '"would_create":[0-9]+' | grep -oE '[0-9]+' || echo 0)"
wf="$(echo "${plan:-}" | grep -oE '"would_fail":[0-9]+'   | grep -oE '[0-9]+' || echo 0)"
say "plan: would_create=${wc} would_fail=${wf}"
[[ "${wc}" -le "${MAX_NEW_ORDERS}" ]] || die "would_create=${wc} exceeds cap ${MAX_NEW_ORDERS} — anomaly; aborting before order apply"
[[ "${wf}" -eq 0 ]] || die "dry-run reports would_fail=${wf} — aborting before apply"

if [[ "${wc}" -eq 0 ]]; then
  summary="{\"job\":\"nightly-legacy-sync\",\"at\":\"$(TS)\",\"new_customers\":${clean_cust},\"new_orders\":0,\"note\":\"no new orders\",\"ok\":true}"
  echo "${summary}" >>"${HIST}"; say "OK ${summary}"; echo "${summary}"; exit 0
fi

# ---- 7. APPLY ORDERS (governed, idempotent, fail-fast) ----
say "step 7: order apply (${wc} new)"
order_out="$(docker exec -e ALLOW_APPLY=yes -e SYNC_TARGET=staging "${CONTAINER}" \
  node /srv/apply-order-sync.mjs /srv/orders_history_enriched.json 2>>"${LOG}" | tee -a "${LOG}")" \
  || die "order apply failed (fail-fast) — restore ${snap} and investigate"
created="$(echo "${order_out}" | grep -E '^APPLY_SUMMARY ' | tail -1 | sed 's/^APPLY_SUMMARY //' | python3 -c "import json,sys; print(json.load(sys.stdin).get('created',0))" 2>/dev/null || echo 0)"
say "apply reported created=${created}"

# ---- 8. CORRECTNESS PROBE (FAIL-CLOSED): every order created this run must link to the right customer ----
say "step 8: correctness probe"
docker exec "${PG}" psql -U nutrezee -d nutrezee -tAc "
  SELECT sr_o.legacy_key||','||sc.legacy_key||','||(
           SELECT count(*) FROM sync_record s2 WHERE s2.object_type='customer' AND s2.legacy_key=sc.legacy_key)
  FROM customer_order co
  JOIN sync_record sr_o ON sr_o.new_ref=co.id AND sr_o.object_type='order'
  JOIN sync_record sc   ON sc.new_ref=co.customer_id AND sc.object_type='customer'
  WHERE co.created_at >= '${RUN_START}'::timestamp;" >/tmp/nprobe.txt 2>>"${LOG}"
probe="$(cd "${DETAIL_DIR}" && CREATED="${created}" python3 - <<'PY'
import json,os,gzip,re,sys
from collections import defaultdict
idx=[json.loads(l) for l in open('out/orders_index.jsonl') if l.strip()]
m=defaultdict(set)
for d in idx: m[str(d['order_number'])].add(str(d['internal_id']))
on2in={on:next(iter(s)) for on,s in m.items() if len(s)==1}
pat=re.compile(r'Contact\s*no\s*:?\s*([+0-9][0-9 \-]{6,})',re.I)
def ph(inn):
    f=f'out/raw/view_{inn}.html.gz'
    if not inn or not os.path.exists(f): return None
    mm=pat.search(gzip.open(f,'rt',errors='ignore').read())
    d=re.sub(r'\D','',mm.group(1)) if mm else ''
    return '+965'+d if len(d)==8 else None
pairs=mismatch=collision=missing_page=0
for l in open('/tmp/nprobe.txt'):
    l=l.strip()
    if l.count(',')<2: continue
    onum,stored,ncust=l.split(',',2)
    pairs+=1
    if int(ncust)>1: collision+=1                 # phone maps to >1 customer (shared/test slipped through)
    p=ph(on2in.get(onum))
    if p is None: missing_page+=1                 # cannot verify against source -> fail-closed
    elif p!=stored: mismatch+=1                    # stored customer phone != legacy page phone
created=int(os.environ.get('CREATED','0'))
print(json.dumps({'created':created,'pairs':pairs,'mismatch':mismatch,'collision':collision,'missing_page':missing_page}))
PY
)"
say "probe: ${probe}"
# fail-closed gates
echo "${probe}" | python3 -c "
import json,sys
p=json.load(sys.stdin)
errs=[]
if p['mismatch']>0:    errs.append(f\"{p['mismatch']} stored-phone != source-phone\")
if p['collision']>0:   errs.append(f\"{p['collision']} orders on a phone shared by >1 customer\")
if p['missing_page']>0:errs.append(f\"{p['missing_page']} orders unverifiable (missing source page)\")
if p['created']>0 and p['pairs']<p['created']: errs.append(f\"probe saw {p['pairs']} pairs but apply created {p['created']} (unverified orders)\")
if p['created']>0 and p['pairs']==0:           errs.append('apply created orders but probe found none (clock/window/persistence)')
sys.exit(1 if errs else 0)
" 2>>"${LOG}" || die "CORRECTNESS PROBE FAILED (${probe}) — STOPPED before relink. Restore ${snap} and investigate."
say "probe OK"

# ---- 9. RELINK meal-history (exit captured into the summary) ----
say "step 9: meal-history relink"
relink_rc=0
( cd "${RELINK_DIR}" && SYNC_TARGET=staging RELINK_MODE=apply RELINK_APPLY_CONFIRM=APPLY_RELINK_STAGING \
    node meal-history-relink.mjs >>"${LOG}" 2>&1 ) || relink_rc=$?
[[ "${relink_rc}" -eq 0 ]] || say "WARN relink exited ${relink_rc} (orders are fine; meal-history links may lag — reported in summary)"

# ---- summary ----
co_total="$(docker exec "${PG}" psql -U nutrezee -d nutrezee -tAc "SELECT count(*) FROM customer_order")"
summary="{\"job\":\"nightly-legacy-sync\",\"at\":\"$(TS)\",\"new_customers\":${clean_cust},\"new_orders\":${created},\"customer_order_total\":${co_total},\"relink_rc\":${relink_rc},\"snapshot\":\"${snap}\",\"ok\":true}"
echo "${summary}" >>"${HIST}"; say "OK ${summary}"
echo "${summary}"
