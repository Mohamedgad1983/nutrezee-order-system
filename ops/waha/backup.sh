#!/bin/sh
# Run on the VPS as root. Sensitive session/config backup; no automatic deletion.
set -eu
umask 077
cd /opt/waha
mkdir -p backups
stamp=$(date -u +%Y%m%dT%H%M%SZ)
archive="backups/waha-${stamp}.tar.gz"
# Empty before pairing. For a paired session, stop ONLY WAHA before archiving.
tar -czf "$archive" .env docker-compose.yml sessions media
tar -tzf "$archive" >/dev/null
chmod 600 "$archive"
printf 'Verified protected backup: %s\n' "$archive"
