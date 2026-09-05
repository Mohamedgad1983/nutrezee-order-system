#!/bin/bash
# A60 — rebuild /opt/fleetbase/patches/a60 from the stock image + a60.diff and verify checksums.
# Usage: install.sh [image]   (default fleetbase/fleetbase-api:v0.7.48). Does NOT touch compose or containers.
set -euo pipefail
IMG=${1:-fleetbase/fleetbase-api:v0.7.48}
HERE=$(cd "$(dirname "$0")" && pwd)
OUT=/opt/fleetbase/patches/a60
TMP=$(mktemp -d)
C=$(docker create "$IMG")
trap 'docker rm -f "$C" >/dev/null 2>&1; rm -rf "$TMP"' EXIT
while read -r orig patched path; do
  case "$orig" in \#*|"") continue;; esac
  mkdir -p "$TMP/$(dirname "$path")"
  docker cp "$C:/fleetbase/api/vendor/fleetbase/$path" "$TMP/$path"
  echo "$orig  $TMP/$path" | md5sum -c --quiet
done < "$HERE/checksums.md5"
patch -p1 -d "$TMP" < "$HERE/a60.diff"
while read -r orig patched path; do
  case "$orig" in \#*|"") continue;; esac
  echo "$patched  $TMP/$path" | md5sum -c --quiet
done < "$HERE/checksums.md5"
mkdir -p "$OUT" && cp -a "$TMP/." "$OUT/"
echo "A60 patch files verified and installed under $OUT"
