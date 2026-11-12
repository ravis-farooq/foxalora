# Development environment for Foxalora. Source it:  . dev/env.sh
# Dev-only values: production uses generated secrets (deploy/install.sh), never these.
DEV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"

export NODE_ENV=development
export DATABASE_OWNER_URL="postgres://foxalora:${FOXALORA_DB_PASSWORD:-foxalora-dev-owner}@127.0.0.1:${FOXALORA_PG_PORT:-55432}/foxalora"
export DATABASE_URL="postgres://foxalora_app:${FOXALORA_APP_DB_PASSWORD:-foxalora-dev-app}@127.0.0.1:${FOXALORA_PG_PORT:-55432}/foxalora"
export VALKEY_URL="redis://:${FOXALORA_VALKEY_PASSWORD:-foxalora-dev-valkey}@127.0.0.1:${FOXALORA_VALKEY_PORT:-6379}"

# Vault key: generated once per machine and kept (git-ignored), so sessions survive restarts.
if [ ! -s "$DEV_DIR/.vault-key" ]; then
  (umask 077 && openssl rand -base64 32 > "$DEV_DIR/.vault-key")
fi
export FOXALORA_VAULT_KEYS="dev1:$(cat "$DEV_DIR/.vault-key")"

# Trust the private test CA of the local mail servers; certificate checks stay on.
export NODE_EXTRA_CA_CERTS="$DEV_DIR/mailservers/certs/ca.pem"

# Integration tests use the same services.
export FOXALORA_TEST_PG_OWNER_URL="$DATABASE_OWNER_URL"
export FOXALORA_TEST_VALKEY_URL="$VALKEY_URL"
