#!/usr/bin/env bash
# Starts a Postfix + Dovecot test server (docker-mailserver) with real TLS on the
# standard ports: IMAP 143 (STARTTLS) and 993 (TLS), submission 587 (STARTTLS) and 465 (TLS).
# Test users: carol@dovecot.test / carol-pass-1, dave@dovecot.test / dave-pass-1
set -euo pipefail
cd "$(dirname "$0")"
./gen-test-ca.sh
NAME=foxalora-dovecot
IMAGE=mailserver/docker-mailserver:16.0.1

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker run -d --name "$NAME" --hostname mail.dovecot.test \
  -e SSL_TYPE=manual \
  -e SSL_CERT_PATH=/tmp/certs/fullchain.pem -e SSL_KEY_PATH=/tmp/certs/server-key.pem \
  -e ENABLE_SPAMASSASSIN=0 -e ENABLE_CLAMAV=0 -e ENABLE_AMAVIS=0 -e ENABLE_FAIL2BAN=0 \
  -e ENABLE_POSTGREY=0 -e ENABLE_OPENDKIM=0 -e ENABLE_OPENDMARC=0 -e ENABLE_POLICYD_SPF=0 \
  -e ENABLE_RSPAMD=0 -e ENABLE_UPDATE_CHECK=0 -e LOG_LEVEL=warn \
  -v "$PWD/certs:/tmp/certs:ro" \
  -p 143:143 -p 993:993 -p 587:587 -p 465:465 \
  "$IMAGE" >/dev/null

# Dovecot only starts once at least one account exists, so create accounts first.
sleep 5
docker exec "$NAME" setup email add carol@dovecot.test carol-pass-1
docker exec "$NAME" setup email add dave@dovecot.test dave-pass-1
echo "Waiting for IMAP and SMTP to accept connections..."
for _ in $(seq 1 90); do
  docker exec "$NAME" sh -c 'nc -z localhost 993 && nc -z localhost 587' >/dev/null 2>&1 && break
  sleep 2
done
echo "Ready. IMAP localhost:993 (TLS) / 143 (STARTTLS), SMTP localhost:587 (STARTTLS) / 465 (TLS)."
