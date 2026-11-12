#!/usr/bin/env bash
# Stops the Foxalora dev containers. Data (database, mailboxes) is kept.
# Usage: dev/down.sh [--purge]
#   --purge  also delete the containers and the dev database and mailbox volumes
set -euo pipefail
NAMES=(foxalora-mailserver foxalora-postgres foxalora-valkey foxalora-greenmail foxalora-exim)
for n in "${NAMES[@]}"; do
  docker inspect "$n" >/dev/null 2>&1 || continue
  if [ "${1:-}" = "--purge" ]; then docker rm -f "$n" >/dev/null && echo "removed $n"
  else docker stop "$n" >/dev/null && echo "stopped $n"; fi
done
if [ "${1:-}" = "--purge" ]; then
  for v in foxalora-pgdata-dev foxalora-maildata-dev; do
    docker volume rm "$v" >/dev/null 2>&1 && echo "deleted volume $v" || true
  done
fi
