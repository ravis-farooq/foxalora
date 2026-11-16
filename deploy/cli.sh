#!/usr/bin/env bash
# Runs the Foxalora operator CLI against the installed stack.
# Usage: ./deploy/cli.sh <command> [args]     (./deploy/cli.sh help lists the commands)
set -euo pipefail
cd "$(dirname "$0")"
[ -f .env ] || { echo "deploy/.env not found: run deploy/install.sh first." >&2; exit 1; }
exec docker compose -f docker-compose.prod.yml --env-file .env --profile tools run --rm cli "$@"
