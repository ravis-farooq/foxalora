#!/usr/bin/env bash
# Starts the Exim + Dovecot test server on the standard ports (stops the Postfix+Dovecot
# container first, since both use them). Test users: erin@exim.test / erin-pass-1,
# frank@exim.test / frank-pass-1. IMAP 993 (TLS) / 143 (STARTTLS), SMTP 465 (TLS) / 587 (STARTTLS).
set -euo pipefail
cd "$(dirname "$0")"
./gen-test-ca.sh
docker rm -f foxalora-dovecot foxalora-exim >/dev/null 2>&1 || true
docker build -q -t foxalora/test-exim:dev exim >/dev/null
docker run -d --name foxalora-exim --hostname mail.exim.test \
  -v "$PWD/certs:/certs:ro" \
  -p 143:143 -p 993:993 -p 587:587 -p 465:465 \
  foxalora/test-exim:dev >/dev/null
for _ in $(seq 1 30); do
  docker exec foxalora-exim sh -c 'exec 3<>/dev/tcp/127.0.0.1/587' >/dev/null 2>&1 && break
  sleep 1
done
echo "Ready. IMAP localhost:993 / 143, SMTP localhost:465 / 587 (Exim)."
