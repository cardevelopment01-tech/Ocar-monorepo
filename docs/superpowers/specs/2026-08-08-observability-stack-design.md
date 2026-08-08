# Observability Stack — Logs, Metrics, Traces (Grafana Cloud + Alloy)

**Date:** 2026-08-08
**Driver:** Follow-up to `2026-08-05-pino-structured-logging.md`. That plan converted `console.*` to structured Pino JSON — necessary but not sufficient, because nothing ships that JSON anywhere searchable, and there is zero metrics/tracing coverage. This spec is the shipping + metrics + tracing layer, sized for a project expecting a real traffic surge and eventual multi-server deployment, without taking on more operational surface area than a team with no dedicated ops person can carry.

**Scope:** Spec only. No code/infra changes yet — this is the ranked plan to implement from.

**Method:** Read the actual current state (`api/src/lib/logger.ts`, `api/src/app.ts`'s `pinoHttp` wiring, `docker-compose.prod.yml`, `api/package.json`) rather than assuming the CLAUDE.md summary was still accurate — it wasn't, on one detail (corrected below). Backed by 2026 research on Grafana Alloy, Grafana Cloud pricing/limits, OpenTelemetry Node.js instrumentation, and Loki cardinality practice (sources at bottom).

---

## Verified current state (the foundation this builds on)

- **Logging:** Pino ^10.3.1 + pino-http ^11.0.0, JSON to stdout. `api/src/lib/logger.ts` already redacts phone/OTP/password/token/bank-account fields globally via `redact.paths` — this redaction list is the one that must also gate what an APM span is allowed to carry (see MUST-DO #4).
- **Correlation:** `app.ts` generates one `req.requestId` (`crypto.randomUUID()`) and feeds it into `pinoHttp`'s `genReqId` so every HTTP log line and error response share the same ID. **Correction to CLAUDE.md:** there is no separate `correlationId` field in the code — it's `requestId` end-to-end. Socket.io and BullMQ correlation exist in spirit (per the M10 module notes) but weren't verified here; treat as unconfirmed until checked against `socket.server.ts` / the worker files.
- **Shipping:** none. `docker-compose.prod.yml` sets `logging: driver: json-file, max-size: 10m, max-file: 5` on both `api` and `nginx` — bounded, but wiped on every container recreate/deploy. This is the literal problem statement: logs exist, are structured, and go nowhere durable or searchable.
- **Metrics:** none. No `prom-client`, no `/metrics` endpoint, no host metrics collection.
- **Traces:** none. No OpenTelemetry SDK in `api/package.json`.
- **Topology today:** one VM, Docker Compose, `nginx` in front of `api`. Multi-server is anticipated, not yet built — this spec is written so server #2+ is "run the same agent config again," not a redesign.
- **On-call/alerting:** none currently wired to anything external.

**Bottom line:** the Pino work gave you the *shape* of good logs. The gap is entirely **shipping + correlation + the other two signals** — and that gap is what "reading Pino output is impossible" actually means: there's no query layer, just a scrolling stdout stream.

---

## The architecture decision (why this shape, not another)

**Managed Grafana Cloud + one Alloy agent per host — not self-hosted LGTM, not per-signal agents.**

- Self-hosting Loki + Mimir + Tempo means owning four stateful services' storage, upgrades, and failure modes yourselves. Grafana OnCall OSS was archived in March 2026 with users pointed at Grafana Cloud IRM — even the alerting escape hatch from self-hosting is gone. For a team without a dedicated ops person, this is exactly the complexity CLAUDE.md already rejected for logs alone; it applies harder once metrics and traces are added too.
- **Alloy** is Grafana's OpenTelemetry-Collector distribution — one binary per server handling logs, metrics, and traces together, instead of Promtail + Prometheus + a separate OTel Collector. That's the lower-overhead claim, and it's the thing that makes multi-server actually consistent: server #2 runs the identical Alloy config with one label changed, full stop.
- **Grafana Cloud's unified OTLP endpoint** (one authenticated HTTPS endpoint per stack that accepts logs + metrics + traces together) is the modern path — it collapses what used to be three separate exporters (Loki push, Prometheus remote_write, Tempo OTLP) into one `otelcol.exporter.otlp` block in Alloy. Use this over wiring three legacy exporters by hand.
- **Free tier is real runway, not a toy:** 10,000 metric series, 50GB logs, 50GB traces, 14-day retention, 3 users, no card required. Paid Pro is $19/mo + $6.50/1k series over 10k + $0.45/GB over 50GB logs/traces + $8/extra user. Launch on free, add a billing alert (MUST-DO #7), decide on Pro from real numbers.

---

## MUST-DO before this is "done"

### 1. Deploy one Alloy instance on the prod host, ship existing Pino logs to Loki
**Problem:** structured logs currently die with the container. This is the single highest-value, zero-app-code-change fix.
**Fix:** Alloy's `loki.source.docker` component reads container stdout via the Docker Engine API (mount `/var/run/docker.sock:ro`), parses the JSON Pino already emits, and forwards to Grafana Cloud's OTLP/Loki endpoint. Add as a service in `docker-compose.prod.yml`:
```yaml
alloy:
  image: grafana/alloy:latest
  container_name: ocar_alloy
  restart: unless-stopped
  volumes:
    - ./infra/alloy/config.alloy:/etc/alloy/config.alloy:ro
    - /var/run/docker.sock:/var/run/docker.sock:ro
  env_file: .env.prod   # GRAFANA_CLOUD_* credentials only — never commit them
  command: run /etc/alloy/config.alloy
  networks:
    - ocar_net
```
**Effort: low · Impact: high · Type: infra config, no app code.**

### 2. Enforce low-cardinality Loki labels; move IDs to structured metadata
**Problem:** Loki indexes by label. A label with unbounded values (`requestId`, `rideId`, `userId`, timestamps) creates one log stream per value — this is the single most common way teams accidentally make Loki fall over, and it's an easy mistake to make when your logs already carry those IDs as JSON fields.
**Fix:** Alloy's Loki pipeline gets exactly these labels: `service` (`api`/`nginx`), `env` (`prod`), `host` (server name — this is what makes multi-server work later). Everything else — `requestId`, `userId`, `driverId`, `rideId` — stays in the log line/JSON body, or is promoted to Loki *structured metadata* (indexed for filtering, not counted toward stream cardinality) if you need to search on it directly without a full-text scan.
**Effort: low · Impact: high · Type: infra config.**

### 3. Confirm the GPS-ping hot path stays level-gated before it hits Loki
**Problem:** the Pino spec already deliberately level-gated GPS-ping logging to zero cost at `info` (documented as the ceiling, with sampling as the noted upgrade path if ever needed). Shipping logs off-box doesn't change that ceiling, but it does turn any accidental `debug`-level flip in prod into a real ingest bill, not just noisy stdout.
**Fix:** No code change — just confirm `LOG_LEVEL=info` in prod env, and treat any request to lower it as a deliberate, reviewed decision, not a debugging reflex.
**Effort: none (verification only) · Impact: med · Type: process guardrail.**

### 4. Add OpenTelemetry tracing with `trace_id` injected into every log line
**Problem:** logs, and (once added) metrics and traces are three disconnected views unless something ties them to the same request. Without this, "click from a slow log line to the trace that explains it" doesn't exist — you're back to grepping.
**Fix:**
- Add `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/exporter-trace-otlp-http` (check current versions at implementation time — this stack ships frequently). `auto-instrumentations-node` patches `http`, `express`, `pg`, `ioredis` with zero manual spans.
- New file `api/src/observability/tracing.ts`, imported as the **very first line** of `src/server.ts` — before Express or anything else loads, per OTel Node's own requirement for patching to work.
- In `api/src/lib/logger.ts`, add a `mixin` that pulls the active span's `trace_id` from `@opentelemetry/api` and merges it into every log object:
  ```typescript
  import { trace } from '@opentelemetry/api'

  export function buildLoggerOptions(level: string = 'info'): pino.LoggerOptions {
    const options: pino.LoggerOptions = {
      level,
      mixin() {
        const span = trace.getActiveSpan()
        return span ? { trace_id: span.spanContext().traceId } : {}
      },
      redact: { /* unchanged */ },
    }
    // ...
  }
  ```
- **Security boundary:** span attributes are a separate redaction surface from Pino's `redact.paths` — auto-instrumentation for `pg` will capture SQL text as a span attribute by default. Explicitly disable SQL statement capture (`enhancedDatabaseReporting: false` on the pg instrumentation, or the equivalent option at whatever version ships) so OTP hashes, phone numbers, and tokens bound as query parameters never leave the process as trace data. This is the same non-negotiable as the existing Pino redaction list — it just needs re-applying to a new signal type.
**Effort: med · Impact: high · Type: app code (new file + logger.ts + server.ts entry order).**

### 5. Add application + host metrics, scraped by Alloy
**Problem:** no visibility into request rate, latency, error rate, queue depth, or DB pool saturation until something is already on fire.
**Fix:**
- App metrics: `prom-client`, exposing `/metrics` on the API (histogram for request duration by route+status, gauge for the BullMQ pool sizes already documented in `jobs/queues/index.ts`, gauge for `pg.Pool` active/idle connections).
- Host metrics: `node_exporter` container per server (CPU, memory, disk, network) — the thing that tells you "the box is the bottleneck," not just "the app is slow."
- Alloy's `prometheus.scrape` component pulls both locally and forwards via the same unified OTLP exporter as logs/traces — one config file, three signals.
**Effort: med · Impact: high · Type: app code (`/metrics` route) + infra config.**

### 6. Wire baseline alerting — Grafana Cloud Alerting, not IRM/OnCall
**Problem:** dashboards you have to remember to look at aren't observability, they're archaeology.
**Fix:** A handful of alert rules on the signals that actually predict an outage before users feel it: error-rate spike on `/api/v1/rides/*` and `/api/v1/payments/*`, `pg.Pool` exhaustion, `driver_location_snapshots` write latency, disk usage on the host. Route to a Slack webhook or email contact point via Grafana Cloud's built-in Alerting (free-tier included) — this is deliberately *not* Grafana Cloud IRM/on-call rotation, which is a paid, heavier tool for when there's an actual rotation to manage (see NICE-TO-HAVE).
**Effort: low · Impact: high · Type: Grafana Cloud config, no app code.**

### 7. Set a Grafana Cloud billing alert before the free tier is a surprise
**Problem:** the exact scenario CLAUDE.md's Pending Ops Actions note already warned about for a bare logging pipeline — a marketing-driven traffic surge can blow past 50GB logs/traces or 10k metric series inside the first real spike, and the first anyone hears about it is an invoice or a hard cutoff.
**Fix:** Grafana Cloud's usage dashboard + a billing/usage alert at ~80% of the free-tier caps (series, log GB, trace GB) before enabling Pro. This is a five-minute dashboard click, not a code change — do it the same day Alloy goes live, not after the first surge.
**Effort: low · Impact: high · Type: Grafana Cloud config.**

---

## SHOULD-DO (before real user-facing load, not strictly before "it's wired up")

### 8. Document the per-server Alloy rollout as copy-paste, not tribal knowledge
**Problem:** the whole point of choosing Alloy was "server #2 is the same config." That's only true if the config is templated and documented, not hand-tuned once and forgotten.
**Fix:** `infra/alloy/config.alloy` takes `HOSTNAME`/`GRAFANA_CLOUD_*` from env (already true if #1 is built that way) — add one paragraph to this repo's ops docs: "new server = install Docker, drop `.env.prod`, `docker compose up alloy`, done." No template engine, no config generator — env vars are enough at this scale.
**Effort: low · Impact: med · Type: docs.**

### 9. Head-based trace sampling once volume is non-trivial
**Problem:** unlike logs (already level-gated) and metrics (bounded by cardinality), traces have no volume control yet — at real request volume, 100% trace capture will burn through the 50GB free tier fastest of the three signals.
**Fix:** Not now — build it when `pg_stat_statements`-equivalent trace volume data says so. When needed: OTel's `TraceIdRatioBasedSampler` (e.g., sample 100% of error/slow traces via a tail-sampling processor in Alloy, 10-20% of healthy ones) is the standard move — don't build it speculatively before there's a real number to size it against.
**Effort: med · Impact: med (later) · Type: app code + Alloy config — deferred.**

### 10. Golden-signal dashboards (RED method), not ad-hoc panels
**Problem:** a Grafana instance full of one-off graphs someone built while debugging a specific incident isn't a dashboard practice.
**Fix:** One dashboard per major flow (ride booking, dispatch, payments) tracking **Rate, Errors, Duration** — the industry-standard minimum for "can I tell if this service is healthy at a glance." Build these from the metrics added in #5, not before.
**Effort: med · Impact: med · Type: Grafana dashboard config.**

### 11. Synthetic uptime check against `/health`
**Problem:** internal metrics tell you the app thinks it's healthy; nothing currently checks from outside whether users can actually reach it (DNS, TLS, nginx, network path).
**Fix:** Grafana Cloud Synthetic Monitoring's free tier covers a basic HTTP check on `/health` from multiple regions — cheap insurance, catches the class of outage internal metrics structurally can't see.
**Effort: low · Impact: med · Type: Grafana Cloud config.**

---

## NICE-TO-HAVE / explicitly PREMATURE — do NOT do now

- **Self-hosted Loki/Mimir/Tempo/Alloy backend** — rejected. Four stateful services to operate, patch, and capacity-plan with no dedicated ops person, for a cost saving that only matters well past the free/Pro tier crossover this team hasn't hit yet.
- **Grafana Cloud IRM / on-call rotation tooling** — premature. There's no on-call rotation to manage yet; a Slack webhook alert (MUST-DO #6) is the right size until there is one, and OnCall OSS is dead anyway (archived March 2026).
- **Continuous profiling (Pyroscope)** — premature. Answers "which function is burning CPU," which is a real question only once metrics (#5) have already pointed at a specific service being CPU-bound. Nothing in this codebase has surfaced that yet.
- **Tail-based sampling collector tier / dedicated sampling infra** — premature, see #9. Head-based sampling with error/slow-path bias is enough until real trace volume proves otherwise.
- **Kubernetes-native tooling (kube-state-metrics, k8s service discovery in Alloy, etc.)** — not applicable. This is Docker Compose on VMs, not Kubernetes; don't import k8s-shaped observability patterns for an orchestrator that isn't in use.
- **A second logging pipeline for Socket.io/BullMQ "correlationId"** — don't build until the unconfirmed claim in Verified Current State is actually checked. If `requestId` doesn't already propagate through sockets/jobs, that's a small, separate fix to the existing Pino work, not part of this shipping layer.

---

## One-glance priority table

| # | Item | Effort | Impact | Type | Bucket |
|---|------|--------|--------|------|--------|
| 1 | Alloy on prod host, ship Pino logs to Loki | low | high | infra | MUST |
| 2 | Low-cardinality labels; IDs → structured metadata | low | high | infra | MUST |
| 3 | Confirm `LOG_LEVEL=info` stays the guardrail in prod | none | med | process | MUST |
| 4 | OTel tracing + `trace_id` mixin in Pino + span redaction | med | high | app code | MUST |
| 5 | App + host metrics via `prom-client` + `node_exporter` | med | high | app+infra | MUST |
| 6 | Baseline alerting (Grafana Cloud Alerting, not IRM) | low | high | Grafana config | MUST |
| 7 | Billing/usage alert at ~80% of free-tier caps | low | high | Grafana config | MUST |
| 8 | Document per-server Alloy rollout as copy-paste | low | med | docs | SHOULD |
| 9 | Head-based trace sampling once volume is real | med | med (later) | app+infra | SHOULD |
| 10 | RED-method golden-signal dashboards | med | med | Grafana config | SHOULD |
| 11 | Synthetic `/health` uptime check | low | med | Grafana config | SHOULD |

**Recommended sequencing:** #1 and #2 first — they're pure infra config, ship the logs that already exist, and establish the label discipline everything else builds on. Then #7 (five-minute click, protects against the exact surge scenario driving this whole spec) before anything else goes live. Then #4 and #5 together as one PR (tracing needs `server.ts` load-order care; metrics is additive) — this is the one with real app code. #6 once #4/#5 give alerts something real to fire on. Run it in production for a couple of weeks, then pick #8–#11 based on what actually showed up, not speculatively.

---

## Sources

- [Introduction to Grafana Alloy](https://grafana.com/docs/alloy/latest/introduction/)
- [Grafana Cloud Pricing In 2026](https://www.cloudzero.com/blog/grafana-cloud-pricing/)
- [Grafana Cloud Pricing 2026 — MonitoringCost](https://monitoringcost.com/grafana-cloud-pricing)
- [Grafana Alternatives 2026 — SigNoz](https://signoz.io/blog/grafana-alternatives/)
- [OpenTelemetry Node.js Setup Guide 2026 — Encore](https://encore.dev/articles/opentelemetry-nodejs-guide)
- [Label best practices — Grafana Loki docs](https://grafana.com/docs/loki/latest/get-started/labels/bp-labels/)
- [What is structured metadata — Grafana Loki docs](https://grafana.com/docs/loki/latest/get-started/labels/structured-metadata/)
