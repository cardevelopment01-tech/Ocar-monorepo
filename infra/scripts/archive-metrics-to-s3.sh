#!/bin/bash
# Snapshots every exporter's raw /metrics text and uploads it to the
# staging-only metrics-archive S3 bucket (s3-metrics-archive.tf) -- full,
# uncapped fidelity independent of what Grafana Cloud's free-tier
# active-series limit accepts or drops. Staging-only: only installed by
# user_data.sh.tpl when environment == "staging".
#
# Key layout groups by exporter first so "give me everything postgres saw"
# is a single prefix list, not a scan:
#   s3://<bucket>/<exporter>/<host>/<color>/<yyyy-mm-dd>/<unix-ts>.prom.gz
set -euo pipefail
cd /opt/ocar

# Extracted via grep/cut, not `source <(tr -d '\r' < .env.prod)` -- sourcing
# executes the ENTIRE file as bash, and DATABASE_URL/MIGRATION_DATABASE_URL
# embed the RDS auto-generated password, free to contain shell metacharacters
# that break the source outright (see refresh-postgres-exporter-secret.sh's
# same fix -- confirmed live, this exact bug silently killed that script too).
# tail -1, not just grep -- .env.prod can carry a stale ALLOY_HOSTNAME line
# from the base api-env content in addition to the real per-instance one
# user_data.sh.tpl appends at the very end. Sourcing (the old approach)
# tolerated this naturally, last assignment wins; a bare grep returns BOTH
# matching lines, corrupting the value with an embedded newline (confirmed
# live: broke every S3 key built from it). tail -1 restores the same
# last-wins semantics without executing the file.
ALLOY_HOSTNAME=$(grep '^ALLOY_HOSTNAME=' .env.prod | tail -1 | tr -d '\r' | cut -d= -f2-)
ALLOY_COLOR=$(grep '^ALLOY_COLOR=' .env.prod | tail -1 | tr -d '\r' | cut -d= -f2-)

DATE="$(date -u +%Y-%m-%d)"
TS="$(date -u +%s)"

# container:port, not localhost:port -- only `api` publishes a host port
# (docker-compose.prod.yml). node_exporter/cadvisor/postgres_exporter are
# reachable only on the Docker network, the same way Alloy scrapes them by
# container DNS name. This script runs at the host level (systemd), not
# inside a container, so it resolves each container's actual bridge IP
# instead (confirmed live: localhost:9100/8080/9187 all refused connection).
declare -A EXPORTERS=(
  [api]="ocar_api:4000"
  [node_exporter]="ocar_node_exporter:9100"
  [cadvisor]="ocar_cadvisor:8080"
  [postgres_exporter]="ocar_postgres_exporter:9187"
)

for name in "${!EXPORTERS[@]}"; do
  container="${EXPORTERS[$name]%%:*}"
  port="${EXPORTERS[$name]##*:}"
  # Plain JSON parse, not `docker inspect --format` -- Go template syntax's
  # double-brace delimiters can't survive a round-trip through SSM Parameter
  # Store ("Parameter value can't nest another parameter", confirmed live).
  ip=$(docker inspect "$container" 2>/dev/null | python3 -c "
import json, sys
try:
    nets = json.load(sys.stdin)[0]['NetworkSettings']['Networks']
    print(next(iter(nets.values()))['IPAddress'])
except Exception:
    pass
" || true)
  if [ -z "$ip" ]; then
    echo "archive-metrics-to-s3: could not resolve $container's IP, skipping this round" >&2
    continue
  fi
  body="$(curl -sS --max-time 10 "http://$ip:$port/metrics" || true)"
  if [ -z "$body" ]; then
    echo "archive-metrics-to-s3: $name at $container:$port returned nothing, skipping this round" >&2
    continue
  fi
  key="$name/$ALLOY_HOSTNAME/$ALLOY_COLOR/$DATE/$TS.prom.gz"
  printf '%s' "$body" | gzip -c | aws s3 cp - "s3://$METRICS_ARCHIVE_BUCKET/$key" \
    --region "$AWS_REGION" --content-encoding gzip --content-type text/plain \
    || echo "archive-metrics-to-s3: upload failed for $name" >&2
done
