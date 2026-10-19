#!/usr/bin/env bash
# Builds the Arabic Kitchen Stickers guide (PDF) for the drivers' manager:
#   1) a screen picture drawn from the real page markup and styles, with sample data only
#   2) guide.html printed to PDF by headless Chrome (proper Arabic shaping)
# Usage: docs/guides/kitchen-stickers/build.sh <output.pdf>
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
OUT="${1:?output pdf path}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
cp "$ROOT/ops/fleetbase/extensions/nutrezee-labels-engine/addon/styles/addon.css" "$WORK/addon.css"
python3 -I "$HERE/mock.py" "$ROOT/ops/fleetbase/extensions/nutrezee-labels-engine/addon/components/kitchen-stickers.hbs" "$WORK/mock.html"
"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=2 --window-size=1560,915 \
  --screenshot="$WORK/screen.png" "file://$WORK/mock.html" >/dev/null 2>&1
cp "$HERE/guide.html" "$WORK/guide.html"
"$CHROME" --headless=new --disable-gpu --no-pdf-header-footer --print-to-pdf="$OUT" "file://$WORK/guide.html" >/dev/null 2>&1
[[ -s "$OUT" ]] || { echo "PDF was not written" >&2; exit 1; }
echo "written: $OUT"
