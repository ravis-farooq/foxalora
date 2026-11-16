#!/usr/bin/env bash
# docker compose with the right files for this install. Use it for every manual command:
#   ./deploy/compose.sh ps | logs -f api | down | ...
# Add-ons, switched on by flags in deploy/.env:
#   FOXALORA_GATE=1     password gate (testing/gate.sh enable)
#   FOXALORA_TESTING=1  test mail server + Mailpit, always with the gate (testing/enable.sh)
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo "deploy/.env not found: run deploy/install.sh first." >&2; exit 1; }
FILES=(-f docker-compose.prod.yml)
if grep -qxE 'FOXALORA_(GATE|TESTING)=1' .env; then FILES+=(-f testing/docker-compose.gate.yml); fi
if grep -qx 'FOXALORA_TESTING=1' .env; then FILES+=(-f testing/docker-compose.testing.yml); fi
exec docker compose "${FILES[@]}" --env-file .env "$@"
