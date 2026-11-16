#!/usr/bin/env bash
# Shared password gate for a test install (HTTP basic auth in Nginx).
# Usage:
#   ./deploy/testing/gate.sh set <user> [password]   add or change a login (random password if omitted)
#   ./deploy/testing/gate.sh remove <user>
#   ./deploy/testing/gate.sh list
set -euo pipefail
cd "$(dirname "$0")"
FILE=nginx/htpasswd
touch "$FILE"; chmod 644 "$FILE" # read by the nginx worker; holds hashes only
cmd="${1:-}"; user="${2:-}"
valid() { [[ "$user" =~ ^[A-Za-z0-9._-]{1,32}$ ]] || { echo "User names: letters, digits, . _ - (max 32)." >&2; exit 1; }; }
reload() { ../compose.sh exec -T web nginx -s reload >/dev/null 2>&1 || true; }
case "$cmd" in
  set)
    valid
    pass="${3:-$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-16)}"
    hash=$(openssl passwd -apr1 -stdin <<<"$pass")
    grep -v "^${user}:" "$FILE" > "$FILE.tmp" || true
    echo "${user}:${hash}" >> "$FILE.tmp" && mv "$FILE.tmp" "$FILE" && chmod 644 "$FILE"
    reload
    echo "Gate login  user: $user  password: $pass"
    ;;
  remove)
    valid
    grep -v "^${user}:" "$FILE" > "$FILE.tmp" || true
    mv "$FILE.tmp" "$FILE" && chmod 644 "$FILE"; reload; echo "removed $user"
    ;;
  list) cut -d: -f1 "$FILE" ;;
  *) sed -n '3,6p' "$0" | sed 's/^# \{0,1\}//' >&2; exit 2 ;;
esac
