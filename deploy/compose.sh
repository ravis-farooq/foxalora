#!/usr/bin/env bash
# docker compose with the right files for this install. Use it for every manual command:
#   ./deploy/compose.sh ps | logs -f api | down | ...
# With FOXALORA_TESTING=1 in deploy/.env (set by testing/enable.sh), the testing add-on is included.
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo "deploy/.env not found: run deploy/install.sh first." >&2; exit 1; }
FILES=(-f docker-compose.prod.yml)
grep -qx 'FOXALORA_TESTING=1' .env && FILES+=(-f testing/docker-compose.testing.yml)
exec docker compose "${FILES[@]}" --env-file .env "$@"
