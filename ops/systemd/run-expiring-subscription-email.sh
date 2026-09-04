#!/usr/bin/env bash
# Wrapper for the daily internal "expiring subscription" email job (driven by the
# .timer). Stages the script into the api container (which has node + pg +
# DATABASE_URL), ensures the optional `nodemailer` transport is present, then runs
# the job with the host env-file.
#
# Safety: emails ONE internal recipient (NUTRITION_DOCTOR_EMAIL). Never customers.
# A real send requires the env-file to set EXPIRING_SUBSCRIPTION_EMAIL_ENABLED=true
# AND EXPIRING_SUBSCRIPTION_DRY_RUN=false. EXPIRING_SUBSCRIPTION_INCLUDE_CONTACT=true
# adds the customer Name + Phone call-list (internal PII) — owner-authorized.
set -euo pipefail
C="${EXPIRING_SUBSCRIPTION_CONTAINER:-nutrezee-api-1}"
ENVF="${EXPIRING_SUBSCRIPTION_ENV_FILE:-/opt/nutrezee/expiring-subscription.env}"
SCRIPT="${EXPIRING_SUBSCRIPTION_SCRIPT:-/opt/nutrezee/expiring-subscription-email.mjs}"

docker exec "$C" mkdir -p /srv/scripts
docker cp "$SCRIPT" "$C:/srv/scripts/expiring-subscription-email.mjs"
# nodemailer is an optional transport, not baked into the image — ensure it once.
docker exec "$C" sh -c 'cd /srv && (node -e "require.resolve(\"nodemailer\")" 2>/dev/null || npm i nodemailer --no-save --no-audit --no-fund >/dev/null 2>&1)'
exec docker exec --env-file "$ENVF" "$C" node /srv/scripts/expiring-subscription-email.mjs
