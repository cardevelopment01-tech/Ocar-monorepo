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
set -a
source <(tr -d '\r' < .env.prod)
set +a

DATE="$(date -u +%Y-%m-%d)"
TS="$(date -u +%s)"

declare -A EXPORTERS=(
  [api]="localhost:4000"
  [node_exporter]="localhost:9100"
  [cadvisor]="localhost:8080"
  [postgres_exporter]="localhost:9187"
)

for name in "${!EXPORTERS[@]}"; do
  addr="${EXPORTERS[$name]}"
  body="$(curl -sS --max-time 10 "http://$addr/metrics" || true)"
  if [ -z "$body" ]; then
    echo "archive-metrics-to-s3: $name at $addr returned nothing, skipping this round" >&2
    continue
  fi
  key="$name/$ALLOY_HOSTNAME/$ALLOY_COLOR/$DATE/$TS.prom.gz"
  printf '%s' "$body" | gzip -c | aws s3 cp - "s3://$METRICS_ARCHIVE_BUCKET/$key" \
    --region "$AWS_REGION" --content-encoding gzip --content-type text/plain \
    || echo "archive-metrics-to-s3: upload failed for $name" >&2
done
