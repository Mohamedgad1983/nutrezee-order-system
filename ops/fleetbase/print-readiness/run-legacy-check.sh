#!/bin/sh
# A69: legacy admin "Orders Driver Wise" screen check, run on the VPS inside the official Playwright
# image. Credentials: /root/a68/legacy-admin.cred (line 1 username, line 2 password), root 0600,
# written by the owner from his Mac Keychain — never by the assistant. Output: /root/a68/legacy-ui-<day>.json
# Usage: run-legacy-check.sh [YYYY-MM-DD]   (default: tomorrow, Kuwait)
set -eu
CRED=/root/a68/legacy-admin.cred
[ -f "$CRED" ] || { echo "missing $CRED (owner step)" >&2; exit 3; }
chmod 600 "$CRED"
exec docker run --rm --ipc=host \
  -v /root/a68/legacy-app:/app:ro \
  -v /root/a68:/out \
  -e LEGACY_OUT_DIR=/out -e LEGACY_CRED_FILE=/out/legacy-admin.cred -e HOME=/tmp \
  -w /app mcr.microsoft.com/playwright:v1.60.0-noble \
  node legacy-driver-orders.mjs "$@" --no-upload
