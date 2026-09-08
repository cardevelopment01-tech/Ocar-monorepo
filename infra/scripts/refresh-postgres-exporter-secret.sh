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

# DB_SECRET_ARN isn't in .env.prod -- deliberately kept out (same reasoning
# as deploy.yml's migration step: docs/INCIDENT_2026-08-25_PROD_DB_AUTH_OUTAGE.md,
# a copied/hand-maintained value goes stale). Derive the RDS instance
# identifier from DB_HOST (which IS in .env.prod, per docker-compose.prod.yml's
# entrypoint remap) and query the secret ARN fresh, same pattern deploy.yml uses.
#
# Extracted via grep/cut, NOT `source <(tr -d '\r' < .env.prod)` (the prior
# approach) -- sourcing executes the ENTIRE file as bash, and other values in
# it (DATABASE_URL/MIGRATION_DATABASE_URL, which embed the DB password) can
# contain shell metacharacters like `(` that RDS's auto-generated password
# is free to include, breaking the source with a syntax error and silently
# aborting this whole script before it ever writes the secret file --
# confirmed live, this is what caused postgres_exporter's persistent
# "is a directory" mount corruption (see docker-compose.prod.yml's postgres_exporter
# comment). Plain text extraction of just the one line this script needs
# never executes any of the other values, so their contents can't break it.
DB_HOST=$(grep '^DB_HOST=' .env.prod | tr -d '\r' | cut -d= -f2-)
DB_INSTANCE_ID=$(echo "$DB_HOST" | cut -d. -f1)
DB_SECRET_ARN=$(aws rds describe-db-instances --region "$AWS_REGION" --db-instance-identifier "$DB_INSTANCE_ID" --query 'DBInstances[0].MasterUserSecret.SecretArn' --output text)

SECRET_JSON=$(aws secretsmanager get-secret-value --region "$AWS_REGION" --secret-id "$DB_SECRET_ARN" --query SecretString --output text)
NEW_PASSWORD=$(printf '%s' "$SECRET_JSON" | grep -o '"password":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -z "$NEW_PASSWORD" ]; then
  echo "refresh-postgres-exporter-secret: could not extract password from secret, leaving existing file untouched" >&2
  exit 1
fi

mkdir -p secrets
OLD_PASSWORD=$(cat secrets/pg_exporter_password 2>/dev/null || echo "")
PASSWORD_CHANGED=0
if [ "$NEW_PASSWORD" != "$OLD_PASSWORD" ]; then
  PASSWORD_CHANGED=1
  umask 077
  printf '%s' "$NEW_PASSWORD" > secrets/pg_exporter_password
fi

# postgres_exporter's image runs as uid 65534 (nobody), not root -- this
# script runs as root, so a plain write above leaves the file root-owned and
# unreadable to the container ("permission denied" seen live, both here and
# on the file's very first write at boot). chown every run, not just on
# password rotation, since the file can already exist with wrong ownership
# from before this fix. Cheap and idempotent when already correct.
chown 65534:65534 secrets/pg_exporter_password

if [ "$PASSWORD_CHANGED" -eq 0 ]; then
  exit 0
fi

docker compose -f docker-compose.prod.yml up -d --force-recreate postgres_exporter
