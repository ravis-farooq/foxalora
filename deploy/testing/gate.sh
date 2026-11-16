#!/usr/bin/env bash
# Shared password gate for a test install (HTTP basic auth in Nginx, over the whole site).
# Usage:
#   ./deploy/testing/gate.sh enable                  turn the gate on (creates a "tester" login if none exists)
#   ./deploy/testing/gate.sh set <user> [password]   add or change a login (random password if omitted)
#   ./deploy/testing/gate.sh remove <user>
#   ./deploy/testing/gate.sh list
set -euo pipefail
cd "$(dirname "$0")"
FILE=gate/htpasswd
mkdir -p gate; touch "$FILE"; chmod 644 "$FILE" # read by the nginx worker; holds hashes only
cmd="${1:-}"; user="${2:-}"
valid() { [[ "$user" =~ ^[A-Za-z0-9._-]{1,32}$ ]] || { echo "User names: letters, digits, . _ - (max 32)." >&2; exit 1; }; }
reload() { ../compose.sh exec -T web nginx -s reload >/dev/null 2>&1 || true; }
setpass() {
  local pass="${2:-$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)}"
  local hash; hash=$(openssl passwd -apr1 -stdin <<<"$pass")
  # Rewrite in place (same file), so the copy Nginx sees through the mount stays current.
  { grep -v "^${1}:" "$FILE" || true; echo "${1}:${hash}"; } > "$FILE.tmp"
  cat "$FILE.tmp" > "$FILE"; rm -f "$FILE.tmp"
  echo "Gate login  user: $1  password: $pass"
}
case "$cmd" in
  enable)
    [ -f ../.env ] || { echo "Run deploy/install.sh first." >&2; exit 1; }
    [ -s "$FILE" ] || setpass tester
    grep -qx 'FOXALORA_GATE=1' ../.env || echo 'FOXALORA_GATE=1' >> ../.env
    ../compose.sh up -d web >/dev/null
    echo "Password gate is on. Logins: $(cut -d: -f1 "$FILE" | paste -sd, -)"
    ;;
  set)    valid; setpass "$user" "${3:-}"; reload ;;
  remove) valid; { grep -v "^${user}:" "$FILE" || true; } > "$FILE.tmp"; cat "$FILE.tmp" > "$FILE"; rm -f "$FILE.tmp"
          reload; echo "removed $user" ;;
  list)   cut -d: -f1 "$FILE" ;;
  *) sed -n '3,7p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2 ;;
esac
