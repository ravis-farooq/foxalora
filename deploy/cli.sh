#!/usr/bin/env bash
# Runs the Foxalora operator CLI against the installed stack.
# Usage: ./deploy/cli.sh <command> [args]     (./deploy/cli.sh help lists the commands)
set -euo pipefail
exec "$(dirname "$0")/compose.sh" --profile tools run --rm -T cli "$@"
