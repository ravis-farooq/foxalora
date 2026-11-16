#!/usr/bin/env bash
# Renews the Let's Encrypt certificate (only when it is close to expiry) and reloads Nginx.
# Run it daily from cron, for example:
#   17 3 * * * /opt/foxalora/deploy/renew-cert.sh >> /var/log/foxalora-cert.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"
DOMAIN=$(sed -n 's/^DOMAIN=//p' .env)
[ -d "letsencrypt/live/$DOMAIN" ] || { echo "No Let's Encrypt certificate for $DOMAIN (installed with --letsencrypt?)." >&2; exit 1; }
# Nginx keeps running and serves the challenge from deploy/acme/.
docker run --rm -v "$PWD/letsencrypt:/etc/letsencrypt" -v "$PWD/acme:/var/www/acme" certbot/certbot:v5.9.0 \
  renew --webroot -w /var/www/acme --quiet
if ! cmp -s "letsencrypt/live/$DOMAIN/fullchain.pem" certs/fullchain.pem; then
  cp -L "letsencrypt/live/$DOMAIN/fullchain.pem" certs/fullchain.pem
  (umask 077 && cp -L "letsencrypt/live/$DOMAIN/privkey.pem" certs/privkey.pem)
  docker compose -f docker-compose.prod.yml --env-file .env exec -T web nginx -s reload
  echo "$(date -u +%FT%TZ) certificate renewed and Nginx reloaded"
fi
