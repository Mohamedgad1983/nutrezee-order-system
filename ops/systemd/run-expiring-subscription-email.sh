#!/usr/bin/env bash
# ----------------------------------------------------------------------------
# Wrapper for the daily internal "expiring subscription" email job.
# DISABLED template — staging/ops only. Defaults to DRY-RUN. There is NO timer
# installed; this is invoked manually (or by an operator-created timer) only.
#
# Safety: emails ONE internal recipient (NUTRITION_DOCTOR_EMAIL). Never customers.
# A real send requires EXPIRING_SUBSCRIPTION_EMAIL_ENABLED=true AND
# EXPIRING_SUBSCRIPTION_DRY_RUN=false in the env-file AND an SMTP transport.
#
# Prerequisite: the script app/scripts/expiring-subscription-email.mjs must be
# available to a node runtime that has `pg` + DATABASE_URL. The reference run
# uses the api container (node + pg + DATABASE_URL already present). Adjust the
# CONTAINER / paths for your deployment, or ship scripts/ in the api image.
# ----------------------------------------------------------------------------
set -euo pipefail

CONTAINER="${EXPIRING_SUBSCRIPTION_CONTAINER:-nutrezee-api-1}"
ENV_FILE="${EXPIRING_SUBSCRIPTION_ENV_FILE:-/opt/nutrezee/expiring-subscription.env}"
SCRIPT_LOCAL="${EXPIRING_SUBSCRIPTION_SCRIPT:-/opt/nutrezee/app/scripts/expiring-subscription-email.mjs}"
SCRIPT_IN_CONTAINER="/srv/scripts/expiring-subscription-email.mjs"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "env-file $ENV_FILE not found — create it (see docs/evidence/expiring_subscription_email/02_env_and_config.md). Refusing to run." >&2
  exit 1
fi

# Make the script available inside the container (no image rebuild required).
if [[ -f "$SCRIPT_LOCAL" ]]; then
  docker exec "$CONTAINER" mkdir -p /srv/scripts
  docker cp "$SCRIPT_LOCAL" "$CONTAINER:$SCRIPT_IN_CONTAINER"
fi

# DATABASE_URL is taken from the container env; report/flags from the env-file.
docker exec --env-file "$ENV_FILE" "$CONTAINER" node "$SCRIPT_IN_CONTAINER"
