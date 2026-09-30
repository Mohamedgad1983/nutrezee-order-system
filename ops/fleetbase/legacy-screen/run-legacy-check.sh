#!/bin/sh
# A69/A70: legacy admin "Orders Driver Wise" screen reading, run on the VPS inside the official Playwright
# image. Credentials: /root/a68/legacy-admin.cred (line 1 username, line 2 password), root 0600,
# written by the owner from his Mac Keychain — never by the assistant. Output: /root/a68/legacy-ui-<day>.json
# Usage: run-legacy-check.sh [YYYY-MM-DD]   (default: tomorrow, Kuwait)
# A70.7: runs inside the sync services, where /root is read-only (ProtectHome=read-only): check the
# credential file's mode instead of changing it.
set -eu
CRED=/root/a68/legacy-admin.cred
[ -f "$CRED" ] || { echo "missing $CRED (owner step)" >&2; exit 3; }
[ "$(stat -c '%a %u' "$CRED")" = "600 0" ] || { echo "$CRED must be root 0600" >&2; exit 4; }
exec docker run --rm --ipc=host \
  -v /root/a68/legacy-app:/app:ro \
  -v /root/a68:/out \
  -e LEGACY_OUT_DIR=/out -e LEGACY_CRED_FILE=/out/legacy-admin.cred -e HOME=/tmp \
  -w /app mcr.microsoft.com/playwright:v1.60.0-noble \
  node legacy-driver-orders.mjs "$@" --no-upload
