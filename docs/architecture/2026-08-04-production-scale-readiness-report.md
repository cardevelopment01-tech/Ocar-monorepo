# Ocar — Production Scale Readiness Report

**Prepared for:** client review / sign-off
**Date:** 2026-08-04
**Scope:** Multi-server production architecture + observability stack, sized for a marketing-driven surge of **5,000–6,000 concurrent users, ~1,000–2,000 rides/day**, Odisha-focused (Bhubaneswar/Cuttack/Puri, expanding to a few more Indian states), zero-downtime requirement.

---

## 1. Load profile (what we're actually sizing for)

- **1,000–2,000 rides/day** is a trivial write rate — a few rides per minute at peak. This is not the bottleneck.
- **5,000–6,000 concurrent users** translates mostly into **open WebSocket connections** (live driver/ride tracking via Socket.io) rather than request volume. This is what actually drives instance count and Redis throughput.
- Ongoing background load is dominated by **GPS location pings** from active drivers (every 3–5s per active ride), not by bookings themselves.

---

## 2. Recommended architecture

**Cloud:** AWS, region `ap-south-1` (Mumbai) — chosen to co-locate with the existing managed data layer (Neon Postgres, Redis Cloud) and match stated AWS preference. Single region is correct at this scale; a Odisha/India-focused audience does not justify multi-region, and multi-region would add operational cost without a real benefit here.

```
Cloudflare (DNS + CDN + WAF)
        │  HTTPS / WSS
        ▼
AWS Application Load Balancer (ap-south-1, sticky sessions)
        │
        ├── EC2 Auto Scaling Group ─── min 3 / max 5 × t3.medium (2 vCPU / 4 GB)
        │       each instance: Express API + Socket.io + BullMQ workers + Alloy agent
        │
        ├── Neon Postgres (AWS Mumbai, pooled/PgBouncer)         ← existing, unchanged
        ├── Redis Cloud (AWS Mumbai) — pinned to AWS region      ← existing, one tier bump
        │     • Socket.io Redis adapter (pub/sub across instances)
        │     • BullMQ queues (existing, unchanged)
        │     • cache / OTP / sessions
        │
        └── Grafana Cloud (free tier) + Sentry (Cloud, EU region) + UptimeRobot (free)
```

**Why 3 instances, not 1 or 10:** N+1 redundancy (survives one instance dying mid-campaign) plus headroom for rolling deploys without dropping capacity. Sized against realistic Node.js/Socket.io throughput for this load — see §5 for the numbers behind this.

**EC2 `t3.medium` (burstable), not fixed-performance:** the load profile above is low-baseline with occasional spikes (idle sockets between GPS pings, low steady ride-booking rate), exactly what AWS's burstable family is priced for. Enable **"Unlimited" burst mode** so sustained traffic pays a small surcharge instead of throttling once CPU credits run out — confirm actual credit behavior via the load test in §4 rather than trusting the estimate blind; if credits drain under real load, move to `m5.large` (fixed performance, no credit mechanic) instead.

---

## 3. Observability stack

One consolidated principle: **one lightweight agent (Grafana Alloy, ~150–200MB per instance) ships logs, metrics, and traces to one platform (Grafana Cloud free tier)** — not five separate collectors. Error tracking and uptime checks are kept intentionally separate because they do a different job than log/metric aggregation.

| Category | Tool | Why |
|---|---|---|
| Logs (library) | **Pino** + `pino-http` | Structured JSON, ~5x lower overhead than Winston. Replaces current ad-hoc `console.*` calls. |
| Log storage/search | **Grafana Cloud Loki** (via Alloy) | Free tier (50GB/mo) — sized correctly for this log volume; see §6 on why not Elasticsearch/OpenSearch. |
| Metrics (app + infra) | `prom-client` + node-exporter → **Grafana Cloud Mimir** (via Alloy) | Free tier (10k series). |
| Dashboards | **Grafana** (hosted) | One UI across logs, metrics, traces. |
| Error tracking | **Sentry Cloud, EU (Frankfurt) region** (free tier, 5k errors/mo) + `beforeSend` PII scrubbing | Stack traces, dedup, and alerting that raw logs don't give cleanly. EU region chosen since Sentry has no India data region; SDK sends errors asynchronously so region has no user-facing latency impact — see discussion notes for the full residency reasoning. Free tier's single-user limit and per-incident event cap are real constraints — see discussion notes on upgrading to the $26/mo Team plan before the campaign. |
| Alerting | **Grafana Alerting** → Slack/Discord webhook | Rules: ALB 5xx rate, p95 latency, instance CPU > 70% sustained, Redis ops/sec nearing plan cap. |
| Uptime (external) | **UptimeRobot** (free) | Pings public `/health` every minute from *outside* our infra — the one check that must not depend on our own stack, since it's the "is the whole thing dark" alarm. |
| Tracing | **OpenTelemetry SDK** → **Grafana Cloud Tempo** (via Alloy) | Follows a single request across ALB → instance → Neon/Redis. Free tier (50GB traces). Lowest priority to build. |
| Queue | **BullMQ** (existing, unchanged) | Already Redis-backed and safe across multiple instances; one job-key fix needed for repeatable/cron jobs (see §4). |

---

## 4. Build checklist (execution order)

1. **Statelessness audit** — remove any in-memory rate-limit counters, per-process caches, or `setInterval` singletons that assume a single process. Move shared state to Redis. *Prerequisite for everything else.*
2. **Socket.io Redis adapter** (`@socket.io/redis-adapter`) — the standard mechanism for Socket.io across multiple instances; Redis Cloud supports it natively.
3. **Pin BullMQ repeatable-job keys** — safe to run identically on all instances, but repeatable/cron jobs need a fixed `jobId` or multiple instances register duplicate schedules.
4. **Provision ALB + Target Group + Auto Scaling Group** — health check on `GET /health`, sticky sessions on.
5. **Convert deploy to ASG Instance Refresh** — rolling, one-at-a-time replacement gated on target-group health (`MinHealthyPercentage` ~66%), extending the existing health-check + smoke-test + auto-rollback logic already in CI/CD.
6. **Pino swap-in** — replace `console.*` calls.
7. **`prom-client` metrics + Alloy deployment** — ship logs + metrics to Grafana Cloud.
8. **Sentry SDK** in the error middleware, pointed at the EU-region project, with `beforeSend` PII scrubbing.
9. **Bump Redis Cloud to a tier with real throughput headroom** (~10k ops/sec, 1–5GB) — the pub/sub fan-out across 5–6k live sockets is the most likely real bottleneck, not app CPU.
10. **OpenTelemetry + Tempo tracing** — lowest priority, add once Alloy is already running.
11. **Grafana Alerting rules + Slack webhook.**
12. **UptimeRobot pointed at `/health`.**
13. **Load test before launch** — simulate 6,000 concurrent sockets + booking bursts (k6/artillery) against staging to confirm instance count, `t3.medium` CPU-credit behavior, and Redis tier hold up, rather than trusting the estimate.

**Autoscaling policy:** min 3, max 5, scale out on CPU > 70% sustained 3 min (secondary trigger: p95 latency > 500ms). Ride volume is too low to be a useful autoscaling signal.

---

## 5. Capacity estimate

| Metric | Per instance (t3.medium) | 3-instance fleet | Actual expected load |
|---|---|---|---|
| Concurrent WebSocket connections | 5,000–10,000 | 15,000–30,000 | 5,000–6,000 (3–5x headroom) |
| HTTP req/sec (DB-backed endpoints) | 200–500 | 600–1,500 | ~60–150 req/sec from GPS pings at peak (well under ceiling) |

This is engineering estimate reasoned from the stack, not a vendor guarantee — step 13 (load test) converts it into a confirmed number before the campaign.

**What actually strains first at this load:** not the app tier's CPU — it's **Redis** (pub/sub fan-out volume) and **Neon's connection pool** (concurrent pooled connections across 3 instances). This is why §4 step 9 matters more than instance count.

---

## 6. Why not Elasticsearch / OpenSearch

Elasticsearch/OpenSearch solves full-text search across huge log volumes (terabytes/day, hundreds of services) — a different problem than this platform's actual log volume. Loki (already in the stack, §3) is purpose-built as the lightweight equivalent for "find errors near this timestamp for this service," which is what's actually needed here, without the CPU/RAM cost of full-text indexing.

If log volume grows 50–100x later, migrating to OpenSearch is a swap, not a rebuild — logs are already structured JSON (Pino) shipped through a standard agent (Alloy).

**Separate consideration:** if "search" here actually means a product feature (e.g., admin free-text search across ride/driver records) rather than log search, that is a legitimate Elasticsearch/OpenSearch use case — but it is a product feature request, not observability infrastructure, and nothing in the current admin portal has asked for it yet.

---

## 7. Cost estimate (monthly, at this scale)

| Item | Cost |
|---|---|
| 3× EC2 t3.medium (2 vCPU/4GB) | ~$91 |
| Application Load Balancer | ~$25–40 |
| Neon Postgres (existing, usage-based) | ~$25–50 |
| Redis Cloud (bumped tier for throughput) | ~$50–100 |
| Cloudflare | $0 (Pro $20/mo optional, for managed WAF) |
| Grafana Cloud (free tier) | $0 |
| Sentry Cloud, EU region (free tier now; **$26/mo Team plan recommended before campaign** — see discussion notes) | $0–26 |
| UptimeRobot (free tier) | $0 |
| **Total** | **~$150–256/month** |

---

## 8. Scaling ceiling — what changes at 10x this load (50,000–60,000 concurrent)

- Split the WebSocket/Socket.io tier from the stateless HTTP tier so each scales independently.
- Neon moves to a Scale plan with a read replica for admin/analytics read load.
- Redis Cloud graduates to a dedicated Pro plan, possibly splitting cache / pub-sub / queue traffic onto separate instances.
- More static/media assets pushed fully to Cloudflare edge.
- Container orchestration (ECS/Fargate) becomes justified only once the team has grown enough to operate it — not before.

Nothing in the current design is a dead end; this architecture carries the platform to roughly 10,000–15,000 concurrent users before any of the above is forced.

---

## Sign-off checklist for review

- [ ] Architecture (§2) approved
- [ ] Observability tool choices (§3) approved
- [ ] Elasticsearch/OpenSearch decision (§6) — confirmed as log-search only, or flagged as a product-search feature request instead
- [ ] Sentry EU-region + free-vs-paid-tier decision approved (see discussion notes)
- [ ] Cost estimate (§7) approved
- [ ] Load test (§4, step 13) scheduled before the marketing campaign goes live
