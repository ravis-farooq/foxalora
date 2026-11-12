#!/usr/bin/env bash
# Starts the whole Foxalora dev stack with one command:
#   Postfix + Dovecot (real TLS), PostgreSQL, Valkey -> migrations, dev tenant, sample mail
#   -> API (http://localhost:3000/api/v1) and web app (http://localhost:5173).
# Usage: dev/up.sh [--with-greenmail] [--services-only]
#   --with-greenmail  also start GreenMail (alice@example.com), mainly for quick tests
#   --services-only   start and seed the services, but not the API and web app
# Stop everything: Ctrl+C here, then dev/down.sh for the containers.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WITH_GREENMAIL=no
SERVICES_ONLY=no
for arg in "$@"; do
  case "$arg" in
    --with-greenmail) WITH_GREENMAIL=yes ;;
    --services-only) SERVICES_ONLY=yes ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing requirement: $1" >&2; exit 1; }; }
need docker; need node; need npm; need openssl
docker info >/dev/null 2>&1 || { echo "Docker is not running. On macOS with Colima: colima start" >&2; exit 1; }

step "Test certificates"
"$ROOT/dev/mailservers/gen-test-ca.sh"
# shellcheck source=dev/env.sh
. "$ROOT/dev/env.sh"

running() { [ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" = "true" ]; }
exists() { docker inspect "$1" >/dev/null 2>&1; }

if running foxalora-exim; then
  echo "Stopping the Exim test server (it uses the same mail ports)."
  docker rm -f foxalora-exim >/dev/null
fi

SERVICES=(mailserver postgres valkey)
[ "$WITH_GREENMAIL" = yes ] && SERVICES+=(greenmail)

step "Starting services: ${SERVICES[*]}"
if docker compose version >/dev/null 2>&1; then
  # Containers started earlier with plain docker would clash with Compose: recreate them
  # (data lives in named volumes and is kept).
  for s in "${SERVICES[@]}"; do
    c="foxalora-$s"
    if exists "$c" && [ -z "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$c")" ]; then
      docker rm -f "$c" >/dev/null
    fi
  done
  profiles=()
  [ "$WITH_GREENMAIL" = yes ] && profiles=(--profile greenmail)
  docker compose -f "$ROOT/docker-compose.yml" "${profiles[@]}" up -d "${SERVICES[@]}"
else
  # No Compose plugin: the same containers with plain docker (keep in sync with docker-compose.yml).
  start() { # name, then docker run arguments
    local name="$1"; shift
    if running "$name"; then echo "$name already running"; return; fi
    if exists "$name"; then docker start "$name" >/dev/null; echo "$name started"; return; fi
    docker run -d --name "$name" "$@" >/dev/null && echo "$name created"
  }
  start foxalora-mailserver --hostname mail.dovecot.test \
    -e SSL_TYPE=manual -e SSL_CERT_PATH=/tmp/certs/fullchain.pem -e SSL_KEY_PATH=/tmp/certs/server-key.pem \
    -e ENABLE_SPAMASSASSIN=0 -e ENABLE_CLAMAV=0 -e ENABLE_AMAVIS=0 -e ENABLE_FAIL2BAN=0 -e ENABLE_POSTGREY=0 \
    -e ENABLE_OPENDKIM=0 -e ENABLE_OPENDMARC=0 -e ENABLE_POLICYD_SPF=0 -e ENABLE_RSPAMD=0 -e ENABLE_UPDATE_CHECK=0 \
    -e LOG_LEVEL=warn \
    -v "$ROOT/dev/mailservers/certs:/tmp/certs:ro" \
    -v "$ROOT/dev/mailservers/postfix-accounts.cf:/tmp/docker-mailserver/postfix-accounts.cf:ro" \
    -v foxalora-maildata-dev:/var/mail \
    -p 143:143 -p 993:993 -p 587:587 -p 465:465 mailserver/docker-mailserver:16.0.1
  start foxalora-postgres -p "127.0.0.1:${FOXALORA_PG_PORT:-55432}:5432" \
    -e POSTGRES_DB=foxalora -e POSTGRES_USER=foxalora \
    -e POSTGRES_PASSWORD="${FOXALORA_DB_PASSWORD:-foxalora-dev-owner}" \
    -e FOXALORA_APP_DB_PASSWORD="${FOXALORA_APP_DB_PASSWORD:-foxalora-dev-app}" \
    -v "$ROOT/dev/db/01-app-role.sh:/docker-entrypoint-initdb.d/01-app-role.sh:ro" \
    -v foxalora-pgdata-dev:/var/lib/postgresql postgres:18.6-alpine
  start foxalora-valkey -p "127.0.0.1:${FOXALORA_VALKEY_PORT:-6379}:6379" valkey/valkey:9.0.7-alpine \
    valkey-server --requirepass "${FOXALORA_VALKEY_PASSWORD:-foxalora-dev-valkey}" --save "" --appendonly no
  if [ "$WITH_GREENMAIL" = yes ]; then
    start foxalora-greenmail -p 3025:3025 -p 3143:3143 -e GREENMAIL_OPTS="-Dgreenmail.setup.test.smtp -Dgreenmail.setup.test.imap -Dgreenmail.hostname=0.0.0.0 -Dgreenmail.users=alice:alice123@example.com,bob:bob123@example.com -Dgreenmail.users.login=email" greenmail/standalone:2.1.2
  fi
fi

wait_for() { # description, command
  local what="$1"; shift
  printf 'Waiting for %s' "$what"
  for _ in $(seq 1 90); do
    if "$@" >/dev/null 2>&1; then echo " ok"; return; fi
    printf '.'; sleep 2
  done
  echo " timed out" >&2; exit 1
}
wait_for "PostgreSQL" docker exec foxalora-postgres pg_isready -h 127.0.0.1 -U foxalora -d foxalora
wait_for "Valkey" docker exec foxalora-valkey valkey-cli -a "${FOXALORA_VALKEY_PASSWORD:-foxalora-dev-valkey}" --no-auth-warning ping
wait_for "Postfix + Dovecot (IMAP 993, SMTP 587)" docker exec foxalora-mailserver sh -c 'nc -z localhost 993 && nc -z localhost 587'

step "Backend: install, build, migrate, seed"
cd "$ROOT/backend"
[ -d node_modules ] || npm ci --no-fund
npm run build --silent
node dist/cli.js migrate
node dist/cli.js seed:dev
node dist/cli.js seed:mail

cd "$ROOT/frontend"
[ -d node_modules ] || { step "Frontend: install"; npm ci --no-fund; }

cat <<EOF

Foxalora dev services are ready.
  Mail server : Postfix + Dovecot, IMAP 993 (TLS), SMTP 587 (STARTTLS)
  Test users  : carol@dovecot.test / carol-pass-1     dave@dovecot.test / dave-pass-1
EOF
[ "$WITH_GREENMAIL" = yes ] && echo "  GreenMail   : alice@example.com / alice123            bob@example.com / bob123"
echo "  Environment : . dev/env.sh   (database, Valkey and test CA settings for manual commands and tests)"

[ "$SERVICES_ONLY" = yes ] && exit 0

step "Starting API and web app (Ctrl+C stops both)"
# Job control gives each server its own process group, so stopping kills the whole tree
# (npm -> nest/vite -> node) and nothing else.
set -m
(cd "$ROOT/backend" && exec npm run start:dev </dev/null) & API_PID=$!
(cd "$ROOT/frontend" && exec npm run dev </dev/null) & WEB_PID=$!
set +m
stop_servers() { kill -TERM -- "-$API_PID" "-$WEB_PID" 2>/dev/null || true; }
trap stop_servers EXIT
trap 'exit 0' INT TERM
echo "  API : http://localhost:3000/api/v1"
echo "  Web : http://localhost:5173"
wait
