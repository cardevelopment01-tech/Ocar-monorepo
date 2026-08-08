# Alloy Log Shipping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the API/nginx containers' existing structured Pino JSON logs off the VPS into Grafana Cloud Loki via one Alloy agent, with low-cardinality labels only — no app code changes.

**Architecture:** One `alloy` container added to `docker-compose.prod.yml` on the existing single VPS. Alloy discovers running Docker containers, tails their stdout (which is already Pino JSON for `api` and access-log lines for `nginx`), attaches exactly three labels (`service`, `env`, `host`), and forwards to Grafana Cloud's Loki endpoint over HTTPS. This is Task 1 (MUST-DO #1+#2) and Task 7 (MUST-DO #7, billing alert) of `docs/superpowers/specs/2026-08-08-observability-stack-design.md` — the self-contained, testable-on-its-own slice: "logs exist somewhere searchable."

**Tech Stack:** `grafana/alloy` Docker image, Grafana Cloud free tier (Loki), Docker Compose (existing).

---

## Task 1: Create the Grafana Cloud stack and get credentials

**This task is manual — you do this in a browser, not me.** I have no access to create the account.

**Files:** none.

- [ ] **Step 1: Create a free Grafana Cloud account**

Go to https://grafana.com/auth/sign-up/create-user and sign up (no credit card required for the free tier: 10k series, 50GB logs, 50GB traces, 14-day retention).

- [ ] **Step 2: Create a stack (if one wasn't auto-created)**

In the Grafana Cloud portal, create a stack in a region close to your VPS (e.g. `ap-south-1`/Asia if offered, otherwise the closest available).

- [ ] **Step 3: Get the Loki endpoint + credentials**

In the stack's page, find "Loki" under "Send data" (or Connections → Add new connection → Loki). Note down three values — you'll need them in Task 4:
- `GRAFANA_CLOUD_LOKI_URL` — the push endpoint, looks like `https://logs-prod-XXX.grafana.net/loki/api/v1/push`
- `GRAFANA_CLOUD_LOKI_USER` — a numeric instance ID shown on that page
- `GRAFANA_CLOUD_API_KEY` — generate an API token/key scoped to `logs:write` (Administration → API Keys, or the "Generate now" button on the Loki connection page)

- [ ] **Step 4: Confirm you have all three values written down**

You'll paste these into the VPS's `.env.prod` in Task 4 — they are secrets, never commit them to the repo.

---

## Task 2: Write the Alloy config file

**Files:**
- Create: `infra/alloy/config.alloy`

- [ ] **Step 1: Create the directory and config file**

```river
// infra/alloy/config.alloy
//
// Discovers all containers on this host, tails their stdout, attaches
// exactly three labels (service, env, host) to keep Loki's index small —
// see docs/superpowers/specs/2026-08-08-observability-stack-design.md
// MUST-DO #2. Everything else (requestId, userId, rideId, etc.) stays in
// the JSON log body untouched — Loki can still full-text/JSON-filter on it,
// it just isn't part of the indexed label set.

discovery.docker "containers" {
  host = "unix:///var/run/docker.sock"
}

discovery.relabel "containers" {
  targets = discovery.docker.containers.targets

  rule {
    source_labels = ["__meta_docker_container_name"]
    regex         = "/(.*)"
    target_label  = "container"
  }

  rule {
    target_label = "service"
    replacement   = "ocar"
  }

  rule {
    target_label = "env"
    replacement   = env("ALLOY_ENV")
  }

  rule {
    target_label = "host"
    replacement   = env("ALLOY_HOSTNAME")
  }
}

loki.source.docker "containers" {
  host             = "unix:///var/run/docker.sock"
  targets          = discovery.relabel.containers.output
  forward_to       = [loki.write.grafana_cloud.receiver]
  relabel_rules    = discovery.relabel.containers.rules
}

loki.write "grafana_cloud" {
  endpoint {
    url = env("GRAFANA_CLOUD_LOKI_URL")

    basic_auth {
      username = env("GRAFANA_CLOUD_LOKI_USER")
      password = env("GRAFANA_CLOUD_API_KEY")
    }
  }
}
```

- [ ] **Step 2: Sanity-check the config with Alloy's built-in validator**

Run (from repo root, no server needed — this just parses the file):
```powershell
docker run --rm -v "${PWD}/infra/alloy/config.alloy:/etc/alloy/config.alloy:ro" grafana/alloy:latest validate /etc/alloy/config.alloy
```
Expected: no output / exit code 0. If it errors on `discovery.relabel` or `loki.source.docker` argument names, the Alloy component API changed since this plan was written — run `docker run --rm grafana/alloy:latest --help` and check `grafana.com/docs/alloy/latest/reference/components/` for the current `loki.source.docker` and `discovery.relabel` argument names, and fix the config to match.

- [ ] **Step 3: Commit**

```bash
git add infra/alloy/config.alloy
git commit -m "add Alloy config for shipping container logs to Grafana Cloud Loki"
```

---

## Task 3: Add the Alloy service to docker-compose.prod.yml

**Files:**
- Modify: `docker-compose.prod.yml`

- [ ] **Step 1: Read the current file to confirm the insertion point**

The file currently has `api`, `nginx`, `volumes`, and `networks` top-level keys (verified 2026-08-08). Add `alloy` as a third service, alongside `api` and `nginx`, before the `volumes:` key.

- [ ] **Step 2: Add the service block**

```yaml
  alloy:
    image: grafana/alloy:latest
    container_name: ocar_alloy
    restart: unless-stopped
    env_file: .env.prod
    volumes:
      - ./infra/alloy/config.alloy:/etc/alloy/config.alloy:ro
      - /var/run/docker.sock:/var/run/docker.sock:ro
    command: run --server.http.listen-addr=127.0.0.1:12345 /etc/alloy/config.alloy
    networks:
      - ocar_net
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"
```
Insert this immediately after the `nginx` service block (which ends right before `volumes:`), so the file reads `api` → `nginx` → `alloy` → `volumes:` → `networks:`.

Note: `--server.http.listen-addr=127.0.0.1:12345` binds Alloy's own debug UI to localhost-only inside the container (not published via `ports:`) — it's a diagnostic UI, not meant to be internet-reachable, and this repo doesn't expose it through nginx.

- [ ] **Step 3: Commit**

```bash
git add docker-compose.prod.yml
git commit -m "add alloy service to docker-compose.prod.yml"
```

---

## Task 4: Add the required env vars

**Files:**
- Modify: `.env.prod.example`
- Modify (on the VPS only, NOT in this repo): `/home/ubuntu/Ocar-monorepo/.env.prod`

- [ ] **Step 1: Add placeholders to the committed example file**

In `.env.prod.example`, after the `# ── Docker Compose ──` section at the bottom, add:

```
# ── Observability (Grafana Cloud + Alloy) ───────────
# From Grafana Cloud stack → Loki connection page (see
# docs/superpowers/plans/2026-08-08-alloy-log-shipping.md Task 1).
GRAFANA_CLOUD_LOKI_URL=
GRAFANA_CLOUD_LOKI_USER=
GRAFANA_CLOUD_API_KEY=
# Static labels attached to every shipped log line — keep these as the ONLY
# per-host/per-env labels (see spec MUST-DO #2). ALLOY_HOSTNAME must be unique
# per server once you add a second VPS.
ALLOY_ENV=production
ALLOY_HOSTNAME=ocar-vps-1
```

- [ ] **Step 2: Commit the example file**

```bash
git add .env.prod.example
git commit -m "document Grafana Cloud/Alloy env vars in .env.prod.example"
```

- [ ] **Step 3: Add the real values to the VPS's `.env.prod` — manual, on the server**

SSH to the VPS (same host `secrets.VPS_HOST` in CI targets) and edit `/home/ubuntu/Ocar-monorepo/.env.prod` directly, pasting in the three real credentials from Task 1 plus `ALLOY_ENV=production` and `ALLOY_HOSTNAME=ocar-vps-1`. This file is never committed and CI never writes to it — it's edited by hand today, same as every other secret in it (e.g. `RAZORPAY_KEY_SECRET`).

---

## Task 5: Deploy Alloy on the VPS

**Files:** none (this is the one-time manual bring-up; ongoing deploys via CI never touch `alloy` since the CI script runs `up -d --no-deps api` — only the `api` service).

- [ ] **Step 1: Pull the latest repo state on the VPS**

```bash
ssh <user>@<VPS_HOST>
cd /home/ubuntu/Ocar-monorepo
git pull
```

- [ ] **Step 2: Bring up just the alloy service**

```bash
docker compose -f docker-compose.prod.yml up -d alloy
```
Expected: Docker pulls `grafana/alloy:latest` and starts `ocar_alloy` alongside the already-running `ocar_api`/`ocar_nginx`.

- [ ] **Step 3: Check Alloy's own logs for startup errors**

```bash
docker logs ocar_alloy --tail 50
```
Expected: no `level=error` lines about the Loki endpoint (auth failures show up here immediately as `401`/`403` from the `loki.write` component) or the Docker socket (permission errors show up as `dial unix /var/run/docker.sock`).

---

## Task 6: Verify logs actually arrive in Grafana Cloud

**Files:** none — this is the acceptance test for the whole slice.

- [ ] **Step 1: Generate a known log line**

From the VPS, hit the health endpoint a couple of times to produce fresh `pino-http` request logs:
```bash
curl -s http://localhost:4000/health
curl -s http://localhost:4000/api/v1/geo/cities > /dev/null
```

- [ ] **Step 2: Query Grafana Cloud Logs Explore**

In the Grafana Cloud portal → Explore → select the Loki datasource, run:
```logql
{service="ocar", env="production", host="ocar-vps-1"}
```
Expected: log lines appear within ~10-30 seconds, each with a JSON body containing `requestId`, `level`, `msg`, and the request path — confirming the label discipline from Task 2 (only `service`/`env`/`host`/`container` as labels) and that `requestId` is still present, just inside the body rather than as a label.

- [ ] **Step 3: Confirm label cardinality is what was intended**

Still in Explore, run:
```logql
{service="ocar"}
```
and check the label list shown in the UI sidebar — it should show only `service`, `env`, `host`, `container` as available labels. If `requestId` or any UUID-shaped value shows up as a label, the relabel rule in `infra/alloy/config.alloy` is wrong — fix it before moving on to Task 7, since a cardinality mistake here compounds once traces/metrics (later plans) are added.

- [ ] **Step 4: Confirm redaction survived the trip**

Search for a request that would have touched a redacted field (e.g. any OTP-flow log). Confirm the value still reads `[REDACTED]` in Grafana Cloud, not the raw secret — Alloy ships the JSON as-is, so this should already be true given `logger.ts`'s existing `redact` config, but this is the one step in this whole plan where a mistake would leak a secret off-box, so it's worth the explicit check rather than assuming.

---

## Task 7: Set the billing/usage alert

**Files:** none — Grafana Cloud portal config only.

- [ ] **Step 1: Open usage & billing**

In the Grafana Cloud portal, go to the org's "Billing" or "Usage" page.

- [ ] **Step 2: Set an alert at ~80% of the free-tier log cap**

Set a usage alert (email notification is enough at this stage) for Logs ingest approaching 40GB (80% of the 50GB free-tier cap) within the current billing period. If the portal only offers hard thresholds, pick the closest one below 50GB.

- [ ] **Step 3: Note the retention limit**

Confirm the stack's log retention is set to 14 days (free tier default) — no action needed unless you intend to pay for longer retention now, just confirm it's not silently shorter.

---

## Done-state summary

After this plan: every log line the `api` and `nginx` containers already write to stdout is searchable in Grafana Cloud within seconds, with `service`/`env`/`host` as the only indexed labels and everything else (including `requestId`) still queryable as JSON body content. No app code changed. Next plan in sequence: OpenTelemetry tracing + `trace_id` log correlation + app/host metrics (spec MUST-DO #4-#6).
