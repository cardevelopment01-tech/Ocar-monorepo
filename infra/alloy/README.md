# Alloy — per-server rollout

`config.alloy` takes all credentials from env (`GRAFANA_CLOUD_*`, `ALLOY_ENV`, `ALLOY_HOSTNAME`) —
no per-server editing of the config file itself, by design (see MUST-DO #2 in
`docs/superpowers/specs/2026-08-08-observability-stack-design.md`).

## New server = 4 steps

1. Install Docker on the new host.
2. Copy `.env.prod` to the new host (same `GRAFANA_CLOUD_*` values; set `ALLOY_HOSTNAME` to this
   server's own name so its logs/metrics/traces are distinguishable from other servers).
3. Copy `docker-compose.prod.yml` and `infra/` (this directory + `nginx/`) to the new host.
4. `docker compose -f docker-compose.prod.yml up -d alloy`

No template engine, no config generator, no per-host `config.alloy` variant — env vars are the
only thing that changes between servers.
