#!/usr/bin/env bash
# Turns an installed Foxalora into a test environment for testers:
#   - private test mail server for @foxalora.test mailboxes (no ports open to the internet)
#   - Mailpit inbox at https://<domain>/mailpit/ for mail sent to outside addresses
#   - shared password gate in front of the whole site
# Run after deploy/install.sh:  ./deploy/testing/enable.sh [number-of-tester-mailboxes, default 3]
# Safe to run again. NOT for customer installs.
set -euo pipefail
cd "$(dirname "$0")"
COUNT="${1:-3}"
[[ "$COUNT" =~ ^[0-9]{1,2}$ ]] || { echo "Number of tester mailboxes: 0-99" >&2; exit 1; }
[ -f ../.env ] || { echo "Run deploy/install.sh first." >&2; exit 1; }
step() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }

step "Test mail server certificate"
if [ ! -s certs/ca.pem ]; then
  mkdir -p certs
  W=$(mktemp -d); trap 'rm -rf "$W"' EXIT
  # The CA may only sign names under foxalora.test, and its key is deleted after use, so trusting it
  # in the API cannot be used to impersonate any real mail server.
  openssl req -x509 -newkey rsa:2048 -nodes -days 3650 -subj "/CN=Foxalora test-install CA" \
    -addext "basicConstraints=critical,CA:TRUE,pathlen:0" -addext "keyUsage=critical,keyCertSign,cRLSign" \
    -addext "nameConstraints=critical,permitted;DNS:foxalora.test,permitted;DNS:.foxalora.test" \
    -keyout "$W/ca-key.pem" -out certs/ca.pem 2>/dev/null
  openssl req -newkey rsa:2048 -nodes -subj "/CN=mail.foxalora.test" -keyout certs/testmail-key.pem -out "$W/req.csr" 2>/dev/null
  printf 'subjectAltName=DNS:mail.foxalora.test\nextendedKeyUsage=serverAuth\nkeyUsage=critical,digitalSignature,keyEncipherment\nbasicConstraints=CA:FALSE\n' > "$W/ext.cnf"
  openssl x509 -req -in "$W/req.csr" -CA certs/ca.pem -CAkey "$W/ca-key.pem" -CAcreateserial -CAserial "$W/ca.srl" -days 3650 \
    -extfile "$W/ext.cnf" -out "$W/leaf.pem" 2>/dev/null
  cat "$W/leaf.pem" certs/ca.pem > certs/testmail-fullchain.pem
  chmod 600 certs/testmail-key.pem
  echo "Created (CA key discarded)."
else
  echo "Exists; keeping it."
fi

step "Password gate"
if [ ! -s nginx/htpasswd ]; then
  GATE=$(./gate.sh set tester | tail -1)
else
  GATE="Gate logins kept: $(cut -d: -f1 nginx/htpasswd | paste -sd, -)"
fi
echo "$GATE"

grep -qx 'FOXALORA_TESTING=1' ../.env || echo 'FOXALORA_TESTING=1' >> ../.env

step "Starting the add-on"
../compose.sh up -d
printf 'Waiting for the test mail server'
FIRST_PASS=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-14)
FIRST_CREATED=no
for _ in $(seq 1 90); do
  [ "$(docker inspect -f '{{.State.Health.Status}}' "$(../compose.sh ps -q testmail)" 2>/dev/null)" = healthy ] && break
  # docker-mailserver waits for its first account before it reports healthy
  if [ "$FIRST_CREATED" = no ] && ! ../compose.sh exec -T testmail setup email list 2>/dev/null | grep -q '@'; then
    ./tester.sh add tester1 "$FIRST_PASS" >/dev/null 2>&1 && FIRST_CREATED=yes
  fi
  printf '.'; sleep 2
done
[ "$(docker inspect -f '{{.State.Health.Status}}' "$(../compose.sh ps -q testmail)" 2>/dev/null)" = healthy ] && echo " ok" \
  || { echo " not healthy. Check: ./deploy/compose.sh logs testmail" >&2; exit 1; }

step "Registering the test mail server in Foxalora"
TENANT_ID=$(../cli.sh tenant:list | head -1 | awk '{print $1}')
if ../cli.sh server:list "$TENANT_ID" | grep -q '^testmail:'; then
  echo "Already registered."
else
  ../cli.sh server:add "$TENANT_ID" testmail --imap mail.foxalora.test:993:tls --smtp mail.foxalora.test:587:starttls --allow-private >/dev/null
  ../cli.sh domain:map "$TENANT_ID" foxalora.test testmail
fi

step "Tester mailboxes"
EXISTING=$(../compose.sh exec -T testmail setup email list 2>/dev/null | grep -o '[a-z0-9._-]*@foxalora.test' || true)
for i in $(seq 1 "$COUNT"); do
  if [ "$i" = 1 ] && [ "$FIRST_CREATED" = yes ]; then
    echo "Mailbox  tester1@foxalora.test  password: $FIRST_PASS"
  elif echo "$EXISTING" | grep -qx "tester$i@foxalora.test"; then
    echo "tester$i@foxalora.test exists (new password: ./deploy/testing/tester.sh password tester$i)"
  else
    ./tester.sh add "tester$i"
  fi
done

DOMAIN=$(sed -n 's/^DOMAIN=//p' ../.env)
cat <<EOF

Test environment ready.
  Site     : https://${DOMAIN}         (browser asks for the gate login first)
  $GATE
  Mailpit  : https://${DOMAIN}/mailpit/  (mail sent to outside addresses lands here)
  Mailboxes: printed above; more with ./deploy/testing/tester.sh add <name>
Send testers the guide in docs/runbooks/testing.md with their mailbox and the gate login.
EOF
