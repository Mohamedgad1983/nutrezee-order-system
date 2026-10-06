#!/usr/bin/env bash
# WP-OPS-A71 — WhatsApp-system subscribers on Batch Labels, for one delivery day.
#   wa-labels-sync.sh YYYY-MM-DD            dry-run (nothing written)
#   wa-labels-sync.sh YYYY-MM-DD apply      write Fleetbase orders + label database rows
# 1) read the day's active subscribers from ERPNext (read-only)
# 2) Fleetbase orders under the NUTREEZE-WA prefix, driver = the area's driver that day
# 3) label database rows through the governed M19 import
# The customer list stays in a root-only file; logs carry counts only.
set -euo pipefail
umask 077
DAY="${1:?delivery date YYYY-MM-DD}"
MODE="${2:-dry-run}"
[[ "$DAY" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || { echo 'invalid date' >&2; exit 2; }
[[ "$MODE" == dry-run || "$MODE" == apply ]] || { echo 'mode must be dry-run or apply' >&2; exit 2; }

HERE="$(cd "$(dirname "$0")" && pwd)"
BENCH="${BENCH:-/home/frappe/nutreeze-rescue-20260908-001}"
SITE="${SITE:-nutreeze-rescue-20260908.local}"
FB="${FB_CONTAINER:-fleetbase-application-1}"
API_CONTAINER="${API_CONTAINER:-nutrezee-api-1}"
WORK="${WORK:-/root/a71}"
LOG="$WORK/wa-labels-sync.log"
mkdir -p "$WORK"
exec 9>"$WORK/.lock"; flock -n 9 || { echo 'another run is active' >&2; exit 3; }
say() { echo "$(date -u +%FT%TZ) $*" | tee -a "$LOG"; }
say "START day=$DAY mode=$MODE"

INPUT="$WORK/wa-${DAY//-/}.json"
TMP="$(sudo -u frappe mktemp /tmp/wa-export.XXXXXX)"
trap 'rm -f "$TMP"' EXIT
install -m 644 "$HERE/wa_subscribers_export.py" /tmp/wa_subscribers_export.py
(cd "$BENCH/sites" && sudo -u frappe "$BENCH/env/bin/python" /tmp/wa_subscribers_export.py "$SITE" "$DAY" "$TMP" </dev/null 2>/dev/null) | tee -a "$LOG"
install -m 600 -o root -g root "$TMP" "$INPUT"

FB_DIR=/fleetbase/api/storage/app/integrations
docker cp "$HERE/nutreeze-wa-orders.php" "$FB:$FB_DIR/nutreeze-wa-orders.php" >/dev/null
docker cp "$INPUT" "$FB:$FB_DIR/config/wa-input.json" >/dev/null
docker exec "$FB" sh -c "chown 0:0 $FB_DIR/config/wa-input.json && chmod 600 $FB_DIR/config/wa-input.json"
[[ -f "$HERE/nutreeze-wa-area-aliases.json" ]] && docker cp "$HERE/nutreeze-wa-area-aliases.json" "$FB:$FB_DIR/config/nutreeze-wa-area-aliases.json" >/dev/null
FLAG=(); [[ "$MODE" == dry-run ]] && FLAG=(--dry-run)
rc=0
docker exec "$FB" php "$FB_DIR/nutreeze-wa-orders.php" "--delivery-date=$DAY" "--input=$FB_DIR/config/wa-input.json" "${FLAG[@]}" </dev/null | tee -a "$LOG" || rc=1
[[ "${PIPESTATUS[0]}" == 0 ]] || rc=1
docker exec "$FB" rm -f "$FB_DIR/config/wa-input.json"

docker cp "$HERE/wa-label-feed.mjs" "$API_CONTAINER:/srv/wa-label-feed.mjs" >/dev/null
docker cp "$INPUT" "$API_CONTAINER:/tmp/wa-input.json" >/dev/null
ALLOW=no; [[ "$MODE" == apply ]] && ALLOW=yes
docker exec -u 0 "$API_CONTAINER" chmod 644 /tmp/wa-input.json 2>/dev/null || true
docker exec -e FEED_MODE="$MODE" -e ALLOW_APPLY="$ALLOW" -e WA_INPUT=/tmp/wa-input.json "$API_CONTAINER" node /srv/wa-label-feed.mjs </dev/null | tee -a "$LOG" || rc=1
[[ "${PIPESTATUS[0]}" == 0 ]] || rc=1
docker exec -u 0 "$API_CONTAINER" rm -f /tmp/wa-input.json 2>/dev/null || true
say "END rc=$rc"
exit "$rc"
