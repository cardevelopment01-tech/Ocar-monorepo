# OTel Tracing + Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship OpenTelemetry request tracing (correlated into Pino logs via `trace_id`) and Prometheus-style app/host metrics, both routed through the Alloy agent already running on the VPS, to Grafana Cloud Tempo and Mimir. This is MUST-DO #4 and #5 from `docs/superpowers/specs/2026-08-08-observability-stack-design.md` (MUST-DO #6, alerting, is a deliberate follow-up once these two give alerts something real to fire on — see spec's own sequencing note).

**Architecture:** The app never talks to Grafana Cloud directly — it sends traces to the local Alloy container over the docker network (`http://alloy:4318`) and exposes a `/metrics` endpoint that Alloy scrapes (`http://api:4000/metrics`). Alloy is the only thing holding Grafana Cloud credentials, same pattern as the logging slice. `/metrics` is never proxied by nginx (confirmed: `infra/nginx/nginx.prod.conf` only has explicit `location` blocks for `/api/`, `/socket.io/`, `/health` — no catch-all — so it's internal-network-only by construction, no auth middleware needed on it).

**Assumptions (stated up front per this session's working agreement — flag if wrong):**
- The Grafana Cloud access policy created for the logging slice already has `metrics:write` and `traces:write` scopes (confirmed earlier in this session) — the same `GRAFANA_CLOUD_API_KEY` is reused for Mimir and Tempo, no new token needed.
- `api/tsconfig.json` compiles to CommonJS (confirmed) — so a literal first `import './observability/tracing'` in `server.ts` becomes the first `require()`, which is what makes OTel's monkey-patch-on-require auto-instrumentation work. If this project ever moves to ESM output, this ordering guarantee breaks and needs `node --import` instead.
- `@opentelemetry/*` package APIs drift between versions (this bit the previous plan's Alloy config with `env()` vs `sys.env()`) — every code snippet below is the intended shape, not a guaranteed exact match to whatever version `npm install` resolves. Each implementer task says explicitly to verify against the installed package's own types/README before finalizing.

**Tech Stack:** `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/resources`, `@opentelemetry/semantic-conventions`, `prom-client`, `prom/node-exporter` (Docker image), Grafana Alloy (already deployed).

---

## Task 1: Get Grafana Cloud Mimir + Tempo connection details

**This task is manual — you do this in a browser.**

**Files:** none.

- [ ] **Step 1: Get the Prometheus (Mimir) remote-write endpoint**

In the Grafana Cloud portal → your stack → **Connections** → **Add new connection** → search **"Prometheus"** (or "Hosted metrics"). Note down:
- `GRAFANA_CLOUD_PROMETHEUS_URL` — looks like `https://prometheus-prod-XX-prod-XX.grafana.net/api/prom/push`
- `GRAFANA_CLOUD_PROMETHEUS_USER` — a numeric instance ID (different number from the Loki one)

- [ ] **Step 2: Get the Tempo (traces) OTLP endpoint**

Same Connections page → search **"Tempo"**. Note down:
- `GRAFANA_CLOUD_TEMPO_URL` — looks like `https://tempo-prod-XX-prod-XX.grafana.net:443` (this plan uses it as an OTLP/HTTP target — confirm the page shows an OTLP option, not just a native-Tempo push option)
- `GRAFANA_CLOUD_TEMPO_USER` — a numeric instance ID

- [ ] **Step 3: Confirm you're reusing the existing API key**

Both pages should show your existing access policy/token as a valid auth option (since it already has `metrics:write`/`traces:write`). You do NOT need to generate a new `GRAFANA_CLOUD_API_KEY` — the one from the logging slice works here too. If the portal insists on a new token for some reason, note that down and flag it — it means the earlier access policy didn't actually get the scopes we thought.

---

## Task 2: Add `node_exporter` for host-level metrics

**Files:**
- Modify: `docker-compose.prod.yml`

- [ ] **Step 1: Add the service**

Insert after the `alloy` service block, before `volumes:`:

```yaml
  node_exporter:
    image: prom/node-exporter:v1.9.1
    container_name: ocar_node_exporter
    restart: unless-stopped
    command:
      - '--path.rootfs=/host'
    volumes:
      - /:/host:ro,rslave
    networks:
      - ocar_net
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"
```
No `ports:` — it's scraped by Alloy over `ocar_net` at `node_exporter:9100`, never needs to be reachable from outside the docker network.

- [ ] **Step 2: Validate and commit**

```bash
docker compose -f docker-compose.prod.yml config
git add docker-compose.prod.yml
git commit -m "add node_exporter for host-level metrics"
```

---

## Task 3: Extend Alloy config for metrics + traces

**Files:**
- Modify: `infra/alloy/config.alloy`

- [ ] **Step 1: Append the metrics pipeline**

```river
prometheus.scrape "api" {
  targets = [{"__address__" = "api:4000"}]
  metrics_path = "/metrics"
  forward_to = [prometheus.remote_write.grafana_cloud.receiver]
}

prometheus.scrape "node" {
  targets = [{"__address__" = "node_exporter:9100"}]
  forward_to = [prometheus.remote_write.grafana_cloud.receiver]
}

prometheus.remote_write "grafana_cloud" {
  endpoint {
    url = sys.env("GRAFANA_CLOUD_PROMETHEUS_URL")

    basic_auth {
      username = sys.env("GRAFANA_CLOUD_PROMETHEUS_USER")
      password = sys.env("GRAFANA_CLOUD_API_KEY")
    }
  }
}
```

- [ ] **Step 2: Append the traces pipeline**

The app sends traces to Alloy over OTLP/HTTP; Alloy forwards them to Tempo with basic auth attached.

```river
otelcol.receiver.otlp "default" {
  http {
    endpoint = "0.0.0.0:4318"
  }

  output {
    traces = [otelcol.exporter.otlphttp.grafana_cloud.input]
  }
}

otelcol.auth.basic "grafana_cloud" {
  username = sys.env("GRAFANA_CLOUD_TEMPO_USER")
  password = sys.env("GRAFANA_CLOUD_API_KEY")
}

otelcol.exporter.otlphttp "grafana_cloud" {
  client {
    endpoint = sys.env("GRAFANA_CLOUD_TEMPO_URL")
    auth     = otelcol.auth.basic.grafana_cloud.handler
  }
}
```

- [ ] **Step 3: Validate**

```bash
docker run --rm -v "${PWD}/infra/alloy/config.alloy:/etc/alloy/config.alloy:ro" grafana/alloy:v1.18.1 validate /etc/alloy/config.alloy
```
Expected: exit 0. If `otelcol.receiver.otlp`, `otelcol.auth.basic`, or `prometheus.scrape`/`prometheus.remote_write` argument names don't validate, check `https://grafana.com/docs/alloy/latest/reference/components/otelcol/` and `.../prometheus/` for the current component API (same drift risk as the `sys.env()` fix in the logging plan — verify, don't assume this snippet is exact) and fix.

- [ ] **Step 4: Commit**

```bash
git add infra/alloy/config.alloy
git commit -m "add metrics scrape+remote_write and OTLP trace receiver to Alloy config"
```

---

## Task 4: Add the new env vars

**Files:**
- Modify: `.env.prod.example`
- Modify (on the VPS only, NOT in this repo): `/home/ubuntu/Ocar-monorepo/.env.prod`

- [ ] **Step 1: Add placeholders**

In `.env.prod.example`, right after the existing `# ── Observability (Grafana Cloud + Alloy) ──` block, add:

```
GRAFANA_CLOUD_PROMETHEUS_URL=
GRAFANA_CLOUD_PROMETHEUS_USER=
GRAFANA_CLOUD_TEMPO_URL=
GRAFANA_CLOUD_TEMPO_USER=
```

- [ ] **Step 2: Commit**

```bash
git add .env.prod.example
git commit -m "document Grafana Cloud Prometheus/Tempo env vars"
```

- [ ] **Step 3: Add real values to the VPS's `.env.prod` — manual**

Same pattern as the logging slice: SSH in, edit `/home/ubuntu/Ocar-monorepo/.env.prod` by hand, paste in the four values from Task 1.

---

## Task 5: Add OTel tracing to the API

**Files:**
- Modify: `api/package.json`
- Create: `api/src/observability/tracing.ts`
- Test: `api/tests/unit/observability/tracing.test.ts`

- [ ] **Step 1: Add dependencies**

```bash
cd api
npm install @opentelemetry/sdk-node @opentelemetry/auto-instrumentations-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources @opentelemetry/semantic-conventions @opentelemetry/api
```

- [ ] **Step 2: Write the failing test — pg instrumentation must not capture SQL/params**

This is the one piece of real logic in this file (a security-relevant config choice, not boilerplate), so it gets a test per this repo's "non-trivial logic needs one runnable check" convention. Test the config object directly, without booting the full SDK (booting it has side effects — patches global modules — which is wrong for a unit test):

```typescript
// api/tests/unit/observability/tracing.test.ts
import { describe, it, expect } from 'vitest'
import { pgInstrumentationConfig } from '@/observability/tracing'

describe('OTel pg instrumentation config', () => {
  it('disables enhanced database reporting so SQL/params never become span attributes', () => {
    expect(pgInstrumentationConfig.enhancedDatabaseReporting).toBe(false)
  })
})
```

- [ ] **Step 3: Run it to confirm it fails**

```bash
npx vitest run tests/unit/observability/tracing.test.ts
```
Expected: FAIL — `@/observability/tracing` doesn't exist yet.

- [ ] **Step 4: Create `api/src/observability/tracing.ts`**

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node'
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'

// Exported so the test above can assert on it without booting the SDK
// (booting it patches global modules — wrong thing to do in a unit test).
// enhancedDatabaseReporting:false is load-bearing, not a default to trust —
// enabled, it puts bound SQL parameter values (OTP hashes, phone numbers,
// tokens) into span attributes, bypassing the redaction Pino already does
// for logs. See docs/superpowers/specs/2026-08-08-observability-stack-design.md
// MUST-DO #4's security-boundary note.
export const pgInstrumentationConfig = { enhancedDatabaseReporting: false }

const sdk = new NodeSDK({
  resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: 'ocar-api' }),
  traceExporter: new OTLPTraceExporter({
    url: `${process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://alloy:4318'}/v1/traces`,
  }),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-pg': pgInstrumentationConfig,
      // GPS-ping-hot-path noise — see MUST-DO #3's level-gate note, same
      // reasoning applies to trace volume as it does to log volume.
      '@opentelemetry/instrumentation-fs': { enabled: false },
    }),
  ],
})

sdk.start()

export async function shutdownTracing(): Promise<void> {
  await sdk.shutdown()
}
```

**Before finalizing this file:** verify `resourceFromAttributes`, `ATTR_SERVICE_NAME`, and the `NodeSDK`/`OTLPTraceExporter` constructor option names against whatever versions `npm install` actually resolved (check `node_modules/@opentelemetry/resources/README.md` and the SDK's TypeScript types) — these APIs have had breaking renames across major versions (e.g. `Resource` class → `resourceFromAttributes` function was one such rename). If a name doesn't exist, find the current equivalent rather than guessing.

- [ ] **Step 5: Run the test to confirm it passes**

```bash
npx vitest run tests/unit/observability/tracing.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/package.json api/package-lock.json api/src/observability/tracing.ts api/tests/unit/observability/tracing.test.ts
git commit -m "add OpenTelemetry tracing setup with pg SQL-capture disabled"
```

---

## Task 6: Wire tracing into server startup and shutdown

**Files:**
- Modify: `api/src/server.ts`

- [ ] **Step 1: Add the tracing import as the literal first line**

At the very top of `api/src/server.ts`, before `import http from 'http'`:

```typescript
import './observability/tracing'
import http from 'http'
```
This must stay the first import — it's what makes auto-instrumentation patch `express`/`pg`/`ioredis` before those modules are `require`'d by anything else in the file or its transitive imports (`./app`, `./db/client`, etc.).

- [ ] **Step 2: Import `shutdownTracing` and call it in the existing shutdown path**

`server.ts` already has a `shutdown()` function (lines 141-148 as of this plan) that closes the HTTP server, ends the pg pool, and disconnects Redis before exiting. Add tracing shutdown to the same place:

```typescript
import { shutdownTracing } from './observability/tracing'
```
(add alongside the other local imports, not at the very top — only the side-effect import in Step 1 needs to be first)

```typescript
  async function shutdown(): Promise<void> {
    logger.info('shutting down gracefully')
    httpServer.close(async () => {
      await pool.end()
      redisClient.disconnect()
      await shutdownTracing()
      process.exit(0)
    })
  }
```

- [ ] **Step 3: Typecheck**

```bash
cd api && npx tsc --noEmit
```
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add api/src/server.ts
git commit -m "wire OTel tracing into server startup and graceful shutdown"
```

---

## Task 7: Correlate `trace_id` into Pino logs

**Files:**
- Modify: `api/src/lib/logger.ts`
- Test: `api/tests/unit/lib/logger.test.ts`

- [ ] **Step 1: Write the failing test**

Add to the existing `api/tests/unit/lib/logger.test.ts` (don't create a new file — this is testing the same `buildLoggerOptions` the existing tests already cover):

```typescript
import { trace, context } from '@opentelemetry/api'

// ... inside the existing describe('logger redaction', ...) block, add:

it('includes trace_id in the log when a span is active, omits it otherwise', () => {
  const lines: string[] = []
  const stream = { write: (line: string) => { lines.push(line) } }
  const logger = pino(buildLoggerOptions('info'), stream)

  logger.info({}, 'no span active')
  const withoutSpan = JSON.parse(lines[0]!)
  expect(withoutSpan.trace_id).toBeUndefined()

  const tracer = trace.getTracer('test')
  const span = tracer.startSpan('test-span')
  context.with(trace.setSpan(context.active(), span), () => {
    logger.info({}, 'span active')
  })
  span.end()

  const withSpan = JSON.parse(lines[1]!)
  expect(withSpan.trace_id).toBe(span.spanContext().traceId)
})
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
npx vitest run tests/unit/lib/logger.test.ts
```
Expected: FAIL — `buildLoggerOptions` doesn't set `trace_id` yet, so `withSpan.trace_id` is `undefined`, not matching the real trace ID.

- [ ] **Step 3: Add the mixin**

In `api/src/lib/logger.ts`, add the import and the `mixin` option:

```typescript
import pino from 'pino'
import { trace } from '@opentelemetry/api'
import { config } from '@/config'
```

```typescript
export function buildLoggerOptions(level: string = 'info'): pino.LoggerOptions {
  const options: pino.LoggerOptions = {
    level,
    mixin() {
      const span = trace.getActiveSpan()
      return span ? { trace_id: span.spanContext().traceId } : {}
    },
    redact: {
      // ... unchanged, existing redact.paths and censor stay exactly as-is
    },
  }
  // ... rest of the function unchanged
}
```
Only add the `mixin` key — do not touch the existing `redact` block or the `NODE_ENV === 'development'` transport logic below it.

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npx vitest run tests/unit/lib/logger.test.ts
```
Expected: all tests in this file PASS, including the new one and the three pre-existing ones (redaction, phone variants, debug-level suppression) — this confirms the mixin didn't break anything already there.

- [ ] **Step 5: Commit**

```bash
git add api/src/lib/logger.ts api/tests/unit/lib/logger.test.ts
git commit -m "correlate trace_id into every Pino log line via mixin"
```

---

## Task 8: Add app + host metrics via prom-client

**Files:**
- Modify: `api/package.json`
- Create: `api/src/observability/metrics.ts`
- Test: `api/tests/unit/observability/metrics.test.ts`

- [ ] **Step 1: Add the dependency**

```bash
cd api && npm install prom-client
```

- [ ] **Step 2: Write the failing test**

```typescript
// api/tests/unit/observability/metrics.test.ts
import { describe, it, expect } from 'vitest'
import { register, httpRequestDuration } from '@/observability/metrics'

describe('metrics registry', () => {
  it('exposes the http request duration histogram under the expected name', async () => {
    httpRequestDuration.observe({ method: 'GET', route: '/health', status_code: '200' }, 0.05)
    const output = await register.metrics()
    expect(output).toContain('http_request_duration_seconds')
    expect(output).toContain('route="/health"')
  })
})
```

- [ ] **Step 3: Run it to confirm it fails**

```bash
npx vitest run tests/unit/observability/metrics.test.ts
```
Expected: FAIL — `@/observability/metrics` doesn't exist.

- [ ] **Step 4: Create `api/src/observability/metrics.ts`**

Reuses the existing `queues` map (`@/jobs/queues`) and the existing `pool` export (`@/db/client`) — no new state, no new queue/pool tracking:

```typescript
import { Registry, collectDefaultMetrics, Histogram, Gauge } from 'prom-client'
import { pool } from '@/db/client'
import { queues } from '@/jobs/queues'

export const register = new Registry()
collectDefaultMetrics({ register })

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  // route (not raw url) — same cardinality discipline as the Loki labels:
  // an unmatched/unbounded path here would blow up Mimir's series count
  // exactly the way it would have blown up Loki's index.
  labelNames: ['method', 'route', 'status_code'],
  registers: [register],
})

// eslint-disable-next-line @typescript-eslint/no-unused-vars
new Gauge({
  name: 'pg_pool_connections',
  help: 'pg.Pool connection counts by state',
  labelNames: ['state'],
  registers: [register],
  collect() {
    this.set({ state: 'total' }, pool.totalCount)
    this.set({ state: 'idle' }, pool.idleCount)
    this.set({ state: 'waiting' }, pool.waitingCount)
  },
})

// eslint-disable-next-line @typescript-eslint/no-unused-vars
new Gauge({
  name: 'bullmq_queue_job_counts',
  help: 'BullMQ job counts by queue and state',
  labelNames: ['queue', 'state'],
  registers: [register],
  async collect() {
    for (const [name, queue] of Object.entries(queues)) {
      const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed')
      for (const [state, count] of Object.entries(counts)) {
        this.set({ queue: name, state }, count)
      }
    }
  },
})
```

**Before finalizing:** verify the `Gauge` constructor's `collect` option signature (sync vs async, and whether it's called with `this` bound to the gauge instance or needs an explicit reference) against the installed `prom-client` version's types — this is the one part of this file most likely to have drifted from whatever version ships.

- [ ] **Step 5: Run the test to confirm it passes**

```bash
npx vitest run tests/unit/observability/metrics.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/package.json api/package-lock.json api/src/observability/metrics.ts api/tests/unit/observability/metrics.test.ts
git commit -m "add app/host metrics via prom-client, reusing existing pool and queues"
```

---

## Task 9: Mount `/metrics` and record request duration

**Files:**
- Modify: `api/src/app.ts`
- Test: `api/tests/integration/metrics-endpoint.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// api/tests/integration/metrics-endpoint.test.ts
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '@/app'

describe('GET /metrics', () => {
  it('returns Prometheus-format metrics including a request this test itself made', async () => {
    const app = createApp()
    await request(app).get('/health')
    const res = await request(app).get('/metrics')

    expect(res.status).toBe(200)
    expect(res.text).toContain('http_request_duration_seconds')
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

```bash
npx vitest run tests/integration/metrics-endpoint.test.ts
```
Expected: FAIL — no `/metrics` route mounted yet (404).

- [ ] **Step 3: Add the middleware and route to `api/src/app.ts`**

Add the import near the other local imports:

```typescript
import { register, httpRequestDuration } from '@/observability/metrics'
```

Add the timing middleware right after the existing `pinoHttp` block (so it wraps every route the same way request logging does), and the route itself near the `/health` route (find it in the existing file and mount alongside it — do not create a second health-check-style file for one route):

```typescript
  // Request-duration metric — route (not req.url) keeps Mimir series count
  // bounded the same way Loki labels are (see MUST-DO #2's reasoning).
  app.use((req, res, next) => {
    const start = process.hrtime.bigint()
    res.on('finish', () => {
      const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9
      httpRequestDuration.observe(
        {
          method: req.method,
          route: req.route?.path ?? 'unmatched',
          status_code: String(res.statusCode),
        },
        durationSeconds
      )
    })
    next()
  })
```

```typescript
  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', register.contentType)
    res.send(await register.metrics())
  })
```
No auth on this route — deliberate, see this plan's Architecture note on why nginx never exposes it publicly.

- [ ] **Step 4: Run the test to confirm it passes**

```bash
npx vitest run tests/integration/metrics-endpoint.test.ts
```
Expected: PASS.

- [ ] **Step 5: Run the full existing test suite to confirm nothing broke**

```bash
npx vitest run
```
Expected: all previously-passing tests still pass — this middleware runs on every request, so it's the one change in this plan with the broadest blast radius if it throws.

- [ ] **Step 6: Commit**

```bash
git add api/src/app.ts api/tests/integration/metrics-endpoint.test.ts
git commit -m "mount /metrics endpoint and record request duration per route"
```

---

## Task 10: Deploy and verify end-to-end

**This task is manual — VPS + Grafana Cloud portal access.**

**Files:** none.

- [ ] **Step 1: Merge, push, let CI deploy `api`**

Same flow as the logging slice: merge this branch to `main`, push. CI rebuilds and cuts over `api` (this time because real `api/**` code changed — the deploy is doing real work).

- [ ] **Step 2: Bring up `node_exporter` and restart `alloy` with the new config on the VPS**

```bash
ssh <user>@<vps-host>
cd /home/ubuntu/Ocar-monorepo
git pull
docker compose -f docker-compose.prod.yml up -d node_exporter alloy
docker logs ocar_alloy --tail 50
```
Expected: no `level=error` — specifically watch for auth failures on the new `prometheus.remote_write`/`otelcol.exporter.otlphttp` components (wrong Mimir/Tempo credentials show up here immediately).

- [ ] **Step 3: Confirm `/metrics` is reachable internally but not publicly**

```bash
docker exec ocar_api wget -qO- http://localhost:4000/metrics | head -20
curl -sk https://ocar-api.clienttesting.in/metrics
```
Expected: the first command shows real Prometheus-format output; the second returns nginx's 404 (confirming the Architecture note's claim that nginx never proxies this path).

- [ ] **Step 4: Verify metrics in Grafana Cloud**

Explore → switch datasource to the Prometheus/Mimir one (same dropdown pattern as Loki) → query `http_request_duration_seconds_count`. Expected: data points appear within a scrape interval or two.

- [ ] **Step 5: Verify traces in Grafana Cloud**

Hit `/health` a few times on the VPS, then Explore → Tempo datasource → search by service name `ocar-api`. Expected: traces appear, each showing spans for the HTTP request and (if it queried the DB) a child `pg` span — confirm the `pg` span does NOT show a raw SQL statement with bound values (the `enhancedDatabaseReporting: false` check from Task 5).

- [ ] **Step 6: Verify the log-trace correlation**

In Loki Explore, find a request's log line, copy its `trace_id`. In Tempo Explore, search that exact trace ID. Expected: it resolves to the same request's trace — this is the actual payoff of Task 7, confirm it works before calling this plan done.

---

## Done-state summary

After this plan: every request produces a trace routed through Alloy to Tempo, with the trace's ID embedded in the corresponding Pino log line; `/metrics` exposes request-duration, pg-pool, and BullMQ-queue-depth gauges, scraped by Alloy into Mimir; host-level CPU/mem/disk metrics flow from `node_exporter` the same way. Next slice per the spec: MUST-DO #6 (baseline alerting) now that there's real signal to alert on, then the SHOULD-DO items (RED dashboards, sampling, synthetic uptime check) based on what a couple weeks of real data shows — not built speculatively.
