#!/bin/sh
set -eu

n=0
while [ "$n" -lt 24 ]; do
  state="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' fleetbase-application-1 2>/dev/null || true)"
  if [ "$state" = healthy ]; then
    exit 0
  fi
  n=$((n + 1))
  sleep 5
done

printf '%s\n' 'Fleetbase application container did not become healthy' >&2
exit 1
