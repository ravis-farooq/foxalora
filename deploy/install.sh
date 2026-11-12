#!/usr/bin/env bash
# Foxalora Mail installer (draft, not yet run on a real server).
# Usage:  ./deploy/install.sh mail.yourdomain.com [--self-signed]
#
# What it does: checks Docker, creates deploy/.env with fresh random secrets, copies the mail-server
# template, optionally makes a self-signed certificate (testing only), then builds and starts the stack.
# What it does NOT do: edit your mail-server mapping or obtain a real certificate for you.
set -euo pipefail

DOMAIN="${1:-}"
SELF_SIGNED="no"
[ "${2:-}" = "--self-signed" ] && SELF_SIGNED="yes"

if [ -z "$DOMAIN" ] || [ "${DOMAIN#-}" != "$DOMAIN" ]; then
  echo "Usage: $0 mail.yourdomain.com [--self-signed]" >&2
  exit 1
fi

cd "$(dirname "$0")"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Missing requirement: $1" >&2; exit 1; }; }
need docker
need openssl
docker compose version >/dev/null 2>&1 || { echo "Docker Compose v2 is required (docker compose)." >&2; exit 1; }

# 1. Environment file with generated secrets (never overwritten if it already exists)
if [ ! -f .env ]; then
  umask 077
  cat > .env <<EOF
DOMAIN=${DOMAIN}
SESSION_KEY=$(openssl rand -base64 32)
POSTGRES_PASSWORD=$(openssl rand -hex 24)
REDIS_PASSWORD=$(openssl rand -hex 24)
SESSION_IDLE_MINUTES=30
SESSION_MAX_HOURS=12
EOF
  echo "Created deploy/.env with new random secrets. Back this file up and keep it private."
else
  echo "deploy/.env already exists, leaving it unchanged."
fi

# 2. Mail server mapping (you must edit this)
if [ ! -f mail-servers.json ]; then
  cp ../backend/mail-servers.example.json mail-servers.json
  echo
  echo "ACTION NEEDED: edit deploy/mail-servers.json with your real IMAP/SMTP hosts and email domains."
  echo "Production refuses the 'none-dev-only' policy: use tls or starttls and remove the local-dev entry."
  read -r -p "Press Enter once you have edited it (or Ctrl+C to stop and run this script again later)... " _
fi

# 3. Certificates
mkdir -p certs
if [ ! -f certs/fullchain.pem ] || [ ! -f certs/privkey.pem ]; then
  if [ "$SELF_SIGNED" = "yes" ]; then
    openssl req -x509 -nodes -newkey rsa:2048 -days 30 \
      -keyout certs/privkey.pem -out certs/fullchain.pem \
      -subj "/CN=${DOMAIN}" -addext "subjectAltName=DNS:${DOMAIN}" >/dev/null 2>&1
    chmod 600 certs/privkey.pem
    echo "Created a 30-day self-signed certificate. Browsers will warn. Use it for testing only."
  else
    echo "No certificate found in deploy/certs/ (need fullchain.pem and privkey.pem)." >&2
    echo "Get one (for example with certbot) and place the files there, or re-run with --self-signed to test." >&2
    exit 1
  fi
fi

# 4. Build and start
docker compose -f docker-compose.prod.yml --env-file .env up -d --build

echo
echo "Foxalora is starting at https://${DOMAIN}"
echo "Check status:  docker compose -f deploy/docker-compose.prod.yml ps"
echo "View logs:     docker compose -f deploy/docker-compose.prod.yml logs -f app"
echo "Stop:          docker compose -f deploy/docker-compose.prod.yml down"
