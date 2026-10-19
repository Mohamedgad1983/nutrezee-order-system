#!/usr/bin/env bash
# WP-LBL-A97 — a sticker saved on the Fleet-Ops "Kitchen Stickers" page reaches Batch Labels within
# two minutes: when kitchen_sticker changed since the last run, re-run the WhatsApp sync for the next
# two delivery days (the same run as the 30-minute timer). Quiet when nothing changed.
set -euo pipefail
umask 077
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="${WORK:-/root/a71}"
STAMP="$WORK/.kitchen-stickers-stamp"
NOW="$(docker exec "${PG_CONTAINER:-nutrezee-postgres-1}" psql -U nutrezee -d nutrezee -At -c \
  "SELECT count(*) || '|' || coalesce(max(updated_at)::text, '') FROM kitchen_sticker" 2>/dev/null)" || exit 0
[[ -n "$NOW" && "$NOW" != "$(cat "$STAMP" 2>/dev/null || true)" ]] || exit 0
echo "kitchen stickers changed: syncing the next two days"
WORK="$WORK" "$HERE/wa-labels-sync.sh" auto apply >/dev/null
echo "$NOW" > "$STAMP"
