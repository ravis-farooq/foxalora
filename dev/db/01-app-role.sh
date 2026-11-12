#!/bin/sh
# Runs once when the dev database is created (docker-entrypoint-initdb.d).
# The API connects as foxalora_app: it does not own the tables, so row-level
# security always applies to it, and it cannot change the schema.
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="$FOXALORA_APP_DB_PASSWORD" <<'SQL'
CREATE ROLE foxalora_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO foxalora_app;
SQL
