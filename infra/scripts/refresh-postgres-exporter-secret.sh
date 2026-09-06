#!/bin/bash
# Keeps postgres_exporter's DB password in sync with RDS's Secrets-Manager-
# managed (auto-rotating) master password -- see
# docs/INCIDENT_2026-08-25_PROD_DB_AUTH_OUTAGE.md. The api app already reads
# this secret live per-connection (api/src/lib/db-secret.ts); postgres_exporter
# is a third-party Go binary with no such hook, so this script is its
# equivalent: fetch the current password, and only recreate the container
# (forcing it to re-read the password file at startup) when it actually
# changed, so routine runs are a no-op.
set -euo pipefail
cd /opt/ocar
set -a
# .env.prod is written from an SSM parameter that carries CRLF line endings
# (authored on Windows) -- a plain `source` chokes on the trailing \r on
# every line ("$'\r': command not found"), which aborts this whole script
# under `set -e` and, since user_data.sh.tpl runs this before `docker compose
# up`, prevents the API container from ever starting. Strip \r via process
# substitution instead of sourcing the file directly.
source <(tr -d '\r' < .env.prod)
set +a

SECRET_JSON=$(aws secretsmanager get-secret-value --region "$AWS_REGION" --secret-id "$DB_SECRET_ARN" --query SecretString --output text)
NEW_PASSWORD=$(printf '%s' "$SECRET_JSON" | grep -o '"password":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$NEW_PASSWORD" ]; then
  echo "refresh-postgres-exporter-secret: could not extract password from secret, leaving existing file untouched" >&2
  exit 1
fi

mkdir -p secrets
OLD_PASSWORD=$(cat secrets/pg_exporter_password 2>/dev/null || echo "")
if [ "$NEW_PASSWORD" = "$OLD_PASSWORD" ]; then
  exit 0
fi

umask 077
printf '%s' "$NEW_PASSWORD" > secrets/pg_exporter_password
docker compose -f docker-compose.prod.yml up -d --force-recreate postgres_exporter
