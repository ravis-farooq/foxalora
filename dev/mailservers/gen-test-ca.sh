#!/usr/bin/env bash
# Creates a private test CA and a server certificate for "localhost" (dev only).
# The API trusts the CA through NODE_EXTRA_CA_CERTS, so TLS verification stays on.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p certs
cd certs
[ -f ca.pem ] && { echo "certs/ already exists; delete it to regenerate."; exit 0; }

openssl req -x509 -newkey rsa:2048 -nodes -days 365 -subj "/CN=Foxalora Dev Test CA" \
  -keyout ca-key.pem -out ca.pem 2>/dev/null
openssl req -newkey rsa:2048 -nodes -subj "/CN=localhost" -keyout server-key.pem -out server.csr 2>/dev/null
printf 'subjectAltName=DNS:localhost\nextendedKeyUsage=serverAuth\nkeyUsage=digitalSignature,keyEncipherment\n' > ext.cnf
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -days 365 -extfile ext.cnf \
  -out server.pem 2>/dev/null
cat server.pem ca.pem > fullchain.pem
chmod 600 ca-key.pem server-key.pem
rm -f server.csr ext.cnf ca.srl
echo "Created dev/mailservers/certs (test CA + localhost certificate)."
