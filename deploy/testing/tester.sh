#!/usr/bin/env bash
# Tester mailboxes on the test mail server (@foxalora.test).
# Usage:
#   ./deploy/testing/tester.sh add <name> [password]   create name@foxalora.test (random password if omitted)
#   ./deploy/testing/tester.sh password <name> [password]
#   ./deploy/testing/tester.sh remove <name>
#   ./deploy/testing/tester.sh list
set -euo pipefail
cd "$(dirname "$0")"
DOMAIN=foxalora.test
cmd="${1:-}"; name="${2:-}"
dms() { ../compose.sh exec -T testmail setup "$@"; }
valid() { [[ "$name" =~ ^[a-z0-9]([a-z0-9._-]{0,30}[a-z0-9])?$ ]] || { echo "Names: lowercase letters, digits, . _ - (max 32)." >&2; exit 1; }; }
newpass() { echo "${1:-$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-14)}"; }
case "$cmd" in
  add)      valid; pass=$(newpass "${3:-}"); dms email add "$name@$DOMAIN" "$pass" >/dev/null
            echo "Mailbox  $name@$DOMAIN  password: $pass" ;;
  password) valid; pass=$(newpass "${3:-}"); dms email update "$name@$DOMAIN" "$pass" >/dev/null
            echo "Mailbox  $name@$DOMAIN  new password: $pass" ;;
  remove)   valid; dms email del -y "$name@$DOMAIN"; echo "removed $name@$DOMAIN (and its mail)" ;;
  list)     dms email list ;;
  *) sed -n '3,7p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2 ;;
esac
