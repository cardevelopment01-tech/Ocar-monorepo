# Pino Structured Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace all 77 ad-hoc `console.*` calls across `api/src` with structured Pino logging (JSON to stdout, consumed by the already-planned Grafana Alloy → Loki pipeline), with request/socket/job correlation and PII redaction, with zero added overhead on the GPS-ping hot path.

**Architecture:** One shared `pino` instance (`api/src/lib/logger.ts`) writing NDJSON to stdout (no file transport, no worker thread — Alloy already tails stdout, adding a second transport layer just burns CPU on a t3.medium for no benefit). `pino-http` wraps every HTTP request, reusing the app's existing `req.requestId` instead of minting a second ID. Socket.io gets a per-connection child logger bound to `{ socketId, userId, role }`. BullMQ workers get a per-worker child logger bound to `{ worker: name }`, with the ride-broadcast processor propagating a `correlationId` into job data so a request → broadcast → driver-socket chain is traceable end to end. GPS pings (the dominant background load — every 3-5s per active ride) are never logged on the success path; only failures log, at `error` level, so Pino's level-gate keeps the hot path at effectively zero logging cost.

**Tech Stack:** `pino` (core), `pino-http` (Express middleware), `pino-pretty` (dev-only transport, devDependency only — never runs in prod).

---

## Why this shape (context for whoever executes this)

- **Transport = stdout, not `pino/file`/`pino-roll`/`pino.transport()` worker thread.** Grafana Alloy (already the agreed shipping agent per the production-readiness report) tails container/process stdout. A file transport or a `pino.transport()` worker thread adds buffering and a second thread competing for CPU on the same 2-vCPU instance the ALB/Redis/BullMQ are also fighting over — for no gain, since Alloy already does the "ship it somewhere" job. Default `pino()` already writes async-batched to fd 1; nothing extra to configure.
- **Levels, not sampling, for the GPS hot path.** GPS location pings arrive every 3-5s per active ride via Socket.io (`socket.server.ts`) and are flushed via a 20-concurrency, 500/sec-limited BullMQ worker (`gps-flush.worker.ts`). Logging every ping — even to a queue — would itself become the bottleneck at 5-6k concurrent drivers. Pino's level check happens *before* any serialization work, so gating GPS-path logs to `debug` (compiled out entirely at prod's `info` default) costs nothing at runtime. Nothing on the GPS success path gets a new log line in this plan — only the existing failure-path `console.error` calls become `logger.error`.
- **Redaction, not manual field-stripping.** Pino's `redact` option walks the log object and replaces matched paths with `[REDACTED]` before serialization — cheaper and harder to forget than remembering to omit fields at every call site. Applied globally once in `logger.ts`.
- **`exactOptionalPropertyTypes: true`** (per this repo's `tsconfig.json` and `CLAUDE.md` convention) means the Pino options object must be built first, then `options.transport = ...` conditionally assigned — never `transport: undefined` inline.

---

## Task 1: Add dependencies + `LOG_LEVEL` config

**Files:**
- Modify: `api/package.json`
- Modify: `api/src/config/index.ts:82-84`

- [ ] **Step 1: Install pino, pino-http, pino-pretty**

```bash
cd api && pnpm add pino pino-http && pnpm add -D pino-pretty
```

- [ ] **Step 2: Add `LOG_LEVEL` to the env schema**

In `api/src/config/index.ts`, immediately before the closing `})` of `envSchema` (after the `DEMO_MODE` line at 83):

```typescript
  // Demo — set DEMO_MODE=true on staging/demo VPS to unlock demo-force endpoints
  DEMO_MODE: z.enum(['true', 'false']).default('false'),

  // Logging — 'info' in prod keeps GPS-ping-path debug logs compiled out;
  // bump to 'debug' locally when tracing socket/queue correlation.
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
})
```

- [ ] **Step 3: Verify config still loads**

Run: `cd api && npx tsc --noEmit`
Expected: no new type errors.

- [ ] **Step 4: Commit**

```bash
git add api/package.json api/pnpm-lock.yaml api/src/config/index.ts
git commit -m "chore(logging): add pino/pino-http deps and LOG_LEVEL config"
```

---

## Task 2: Create the shared logger module

**Files:**
- Create: `api/src/lib/logger.ts`
- Test: `api/tests/unit/lib/logger.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// api/tests/unit/lib/logger.test.ts
import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { buildLoggerOptions } from '@/lib/logger'

describe('logger redaction', () => {
  it('redacts phone, otp, password, and auth header fields', () => {
    const lines: string[] = []
    const stream = { write: (line: string) => { lines.push(line) } }
    const logger = pino(buildLoggerOptions('info'), stream)

    logger.info({
      req: { headers: { authorization: 'Bearer secret-token' } },
      phone: '9876543210',
      otp: '1234',
      password: 'hunter2',
    }, 'test event')

    const logged = JSON.parse(lines[0]!)
    expect(logged.req.headers.authorization).toBe('[REDACTED]')
    expect(logged.phone).toBe('[REDACTED]')
    expect(logged.otp).toBe('[REDACTED]')
    expect(logged.password).toBe('[REDACTED]')
    expect(logged.msg).toBe('test event')
  })

  it('does not emit debug logs when level is info', () => {
    const lines: string[] = []
    const stream = { write: (line: string) => { lines.push(line) } }
    const logger = pino(buildLoggerOptions('info'), stream)

    logger.debug({ sessionId: 'abc' }, 'gps ping received')

    expect(lines.length).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd api && npx vitest run tests/unit/lib/logger.test.ts`
Expected: FAIL — `Cannot find module '@/lib/logger'` (or no export `buildLoggerOptions`).

- [ ] **Step 3: Write the logger module**

```typescript
// api/src/lib/logger.ts
import pino from 'pino'
import { config } from '@/config'

// Exported separately from the singleton so the redaction/level logic is
// unit-testable without booting the full app config.
export function buildLoggerOptions(level: string): pino.LoggerOptions {
  const options: pino.LoggerOptions = {
    level,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.body.otp',
        'req.body.password',
        'req.body.phone',
        'req.body.token',
        '*.otp',
        '*.phone',
        '*.password',
        '*.token',
        '*.start_otp_hash',
        '*.end_otp_hash',
        '*.razorpay_signature',
        '*.account_number',
        '*.accountNumber',
        '*.bank_account_number',
      ],
      censor: '[REDACTED]',
    },
  }
  // exactOptionalPropertyTypes: build first, assign conditionally — never
  // `transport: undefined` (see CLAUDE.md optional-field convention).
  if (config.NODE_ENV === 'development') {
    options.transport = {
      target: 'pino-pretty',
      options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
    }
  }
  return options
}

export const logger = pino(buildLoggerOptions(config.LOG_LEVEL))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd api && npx vitest run tests/unit/lib/logger.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add api/src/lib/logger.ts api/tests/unit/lib/logger.test.ts
git commit -m "feat(logging): add shared Pino logger with redaction and level gating"
```

---

## Task 3: Mount `pino-http`, reusing the existing `requestId`

**Files:**
- Modify: `api/src/app.ts:1-36`

- [ ] **Step 1: Add the import and mount pino-http right after the requestId middleware**

In `api/src/app.ts`, add to the imports (after the `helmet`/`cors` imports at line 2-3):

```typescript
import pinoHttp from 'pino-http'
import { logger } from '@/lib/logger'
```

Then, immediately after the existing requestId block (lines 32-36), insert:

```typescript
  // 1. Attach requestId to every request
  app.use((req, _res, next) => {
    req.requestId = crypto.randomUUID()
    next()
  })

  // 1b. Structured request/response logging — reuses requestId (not a second
  // genReqId) so error responses and log lines correlate on the same field.
  app.use(pinoHttp({
    logger,
    genReqId: (req) => (req as import('express').Request).requestId,
    customLogLevel: (_req, res, err) => {
      if (res.statusCode >= 500 || err) return 'error'
      if (res.statusCode >= 400) return 'warn'
      return 'info'
    },
  }))

  // 2. Security headers
  app.use(helmet())
```

- [ ] **Step 2: Run the existing integration suite to confirm nothing broke**

Run: `cd api && npx vitest run tests/integration/m01.test.ts`
Expected: PASS — `GET /health` still returns 200 with the same body shape (pino-http only adds `req.log`/logging side effects, doesn't touch the response).

- [ ] **Step 3: Manually verify structured output**

Run: `cd api && pnpm dev` then in another shell `curl http://localhost:4000/health`
Expected: server stdout shows one pretty-printed (dev transport) log line per request with `reqId` matching the pattern of a UUID, method, url, status, and response time.

- [ ] **Step 4: Commit**

```bash
git add api/src/app.ts
git commit -m "feat(logging): mount pino-http bound to the existing requestId"
```

---

## Task 4: Convert the global error middleware

**Files:**
- Modify: `api/src/middleware/error.middleware.ts:47`

- [ ] **Step 1: Replace the console.error call**

Old (line 47):
```typescript
  if (status >= 500) console.error(`[${requestId}] Error:`, err)
```

New:
```typescript
  if (status >= 500) req.log?.error({ err }, 'unhandled request error')
```

`req.log` is attached by `pino-http` (Task 3) and is already scoped with the same `requestId` used in the JSON response body — no need to pass `requestId` again. The `?.` guards the handful of unit-test call sites that construct a bare `req` object without going through the full Express middleware chain (check with grep in Step 2 below).

- [ ] **Step 2: Check nothing constructs a bare `req` for this middleware in tests**

Run: `cd api && grep -rn "errorMiddleware(" tests/`
Expected: no direct unit-test calls (error middleware is only exercised indirectly via `supertest` hitting real routes that throw, which always goes through `pino-http` first — confirmed by the app.ts middleware order in Task 3). If any direct call turns up, keep the `?.` as-is; it's already safe.

- [ ] **Step 3: Run the full test suite for a regression check**

Run: `cd api && npx vitest run`
Expected: PASS (same pass/fail count as before this change — this edit only changes where the 5xx log line goes, not response behavior).

- [ ] **Step 4: Commit**

```bash
git add api/src/middleware/error.middleware.ts
git commit -m "feat(logging): route 5xx error logging through req.log"
```

---

## Task 5: Correlate Socket.io connections

**Files:**
- Modify: `api/src/websocket/socket.server.ts` (5 call sites: lines 65, 108, 143, 181, 199)

- [ ] **Step 1: Add the logger import**

At the top of `api/src/websocket/socket.server.ts`, add:

```typescript
import { logger } from '@/lib/logger'
```

- [ ] **Step 2: Bind a per-connection child logger and replace the connect/disconnect logs**

Old (line 63-65):
```typescript
  io.on('connection', (socket) => {
    const user = socket.data.user as { sub: string; role: string } | undefined
    console.log(`Socket connected: ${user?.sub} (${user?.role})`)
```

New:
```typescript
  io.on('connection', (socket) => {
    const user = socket.data.user as { sub: string; role: string } | undefined
    const log = logger.child({ socketId: socket.id, userId: user?.sub, role: user?.role })
    log.info('socket connected')
```

Old (line 180-182):
```typescript
    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${user?.sub} (${user?.role})`)
    })
```

New:
```typescript
    socket.on('disconnect', () => {
      log.info('socket disconnected')
    })
```

- [ ] **Step 3: Replace the two failure-path console.error calls (these stay error-level, no new hot-path logging)**

Old (line 107-109, inside the `location:update` handler — the GPS hot path):
```typescript
        updateLocation(BigInt(user.sub), input).catch((err: unknown) => {
          console.error(`location:update failed for driver ${user.sub}:`, err)
        })
```

New:
```typescript
        updateLocation(BigInt(user.sub), input).catch((err: unknown) => {
          log.error({ err, sessionId: data.sessionId }, 'location:update failed')
        })
```

Old (line 142-144):
```typescript
        .catch((err: unknown) => {
          console.error(`Reconnect sync failed for driver ${user.sub}:`, err)
        })
```

New:
```typescript
        .catch((err: unknown) => {
          log.error({ err }, 'reconnect sync failed')
        })
```

- [ ] **Step 4: Replace the module-level warn (no per-connection logger available here — it's outside `io.on('connection')`)**

Old (line 197-200, inside `getIO()`):
```typescript
export function getIO(): Server {
  if (!io) {
    console.warn('Socket.io not initialised — dropping real-time emit')
    return NOOP_IO
  }
```

New:
```typescript
export function getIO(): Server {
  if (!io) {
    logger.warn('socket.io not initialised — dropping real-time emit')
    return NOOP_IO
  }
```

- [ ] **Step 5: Run the existing websocket test to confirm no regression**

Run: `cd api && npx vitest run tests/unit/websocket/connection-state-recovery.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add api/src/websocket/socket.server.ts
git commit -m "feat(logging): correlate socket.io connect/disconnect/GPS-failure logs per socket"
```

---

## Task 6: Shared worker-logger helper + BullMQ `on('failed')` handlers

**Files:**
- Create: `api/src/lib/worker-logger.ts`
- Modify: `api/src/jobs/workers/gps-flush.worker.ts:47-49`
- Modify: `api/src/jobs/workers/settlements.worker.ts:28`
- Modify: `api/src/jobs/workers/dispatch.worker.ts:23`
- Modify: `api/src/jobs/workers/partition-maintenance.worker.ts:24`
- Modify: `api/src/jobs/workers/cleanup.worker.ts:56`
- Modify: `api/src/jobs/workers/audit.worker.ts:30`
- Modify: `api/src/jobs/workers/payment-reconcile.worker.ts:14`
- Modify: `api/src/jobs/workers/scheduler.worker.ts:33`
- Modify: `api/src/jobs/workers/notifications.worker.ts:47,107,142,182,212,216`

- [ ] **Step 1: Write the failing test for the helper**

```typescript
// api/tests/unit/lib/worker-logger.test.ts
import { describe, it, expect } from 'vitest'
import pino from 'pino'
import { buildLoggerOptions } from '@/lib/logger'
import { createWorkerLogger } from '@/lib/worker-logger'

describe('createWorkerLogger', () => {
  it('binds the worker name to every log line', () => {
    const lines: string[] = []
    const stream = { write: (line: string) => { lines.push(line) } }
    const base = pino(buildLoggerOptions('info'), stream)
    const log = createWorkerLogger(base, 'gps-flush')

    log.error({ err: new Error('boom'), jobId: '42' }, 'job failed')

    const logged = JSON.parse(lines[0]!)
    expect(logged.worker).toBe('gps-flush')
    expect(logged.jobId).toBe('42')
    expect(logged.err.message).toBe('boom')
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd api && npx vitest run tests/unit/lib/worker-logger.test.ts`
Expected: FAIL — `Cannot find module '@/lib/worker-logger'`

- [ ] **Step 3: Write the helper**

```typescript
// api/src/lib/worker-logger.ts
import type pino from 'pino'
import { logger } from '@/lib/logger'

// One child logger per BullMQ worker, tagged with the worker name so a Loki
// query can filter to `worker="gps-flush"` etc. Accepts an optional base
// logger only so it's unit-testable against an isolated stream.
export function createWorkerLogger(base: pino.Logger = logger, workerName: string): pino.Logger {
  return base.child({ worker: workerName })
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `cd api && npx vitest run tests/unit/lib/worker-logger.test.ts`
Expected: PASS

- [ ] **Step 5: Apply to `gps-flush.worker.ts`** (the highest-volume worker — 20 concurrency, 500/sec limiter — this is a failure-path-only change, no new success-path logging is added)

Add import: `import { createWorkerLogger } from '@/lib/worker-logger'`
Add after the existing imports: `const log = createWorkerLogger(undefined, 'gps-flush')`

Old (lines 47-49):
```typescript
gpsFlushWorker.on('failed', (job, err) => {
  console.error(`[gps-flush] job ${job?.id} failed:`, err)
})
```

New:
```typescript
gpsFlushWorker.on('failed', (job, err) => {
  log.error({ err, jobId: job?.id }, 'gps-flush job failed')
})
```

- [ ] **Step 6: Apply to `settlements.worker.ts`**

Add import: `import { createWorkerLogger } from '@/lib/worker-logger'`
Add: `const log = createWorkerLogger(undefined, 'settlements')`

Old (line 28):
```typescript
  console.error(`[settlements] job ${job?.id} (${job?.name}) failed:`, err)
```

New:
```typescript
  log.error({ err, jobId: job?.id, jobName: job?.name }, 'settlements job failed')
```

- [ ] **Step 7: Apply the identical pattern to the remaining single-call-site workers**

For each file below: add the same two lines (import + `const log = createWorkerLogger(undefined, '<name>')`), then replace the one `console.error` line with `log.error({ err, jobId: job?.id, jobName: job?.name }, '<name> job failed')` (drop `jobName` if the original message didn't include `job?.name`).

| File | Line | Worker name | Original message included `job?.name`? |
|---|---|---|---|
| `api/src/jobs/workers/dispatch.worker.ts` | 23 | `dispatch` | yes |
| `api/src/jobs/workers/partition-maintenance.worker.ts` | 24 | `partition-maintenance` | yes |
| `api/src/jobs/workers/cleanup.worker.ts` | 56 | `cleanup` | no |
| `api/src/jobs/workers/audit.worker.ts` | 30 | `audit` | no |
| `api/src/jobs/workers/payment-reconcile.worker.ts` | 14 | `payment-reconcile` | no |
| `api/src/jobs/workers/scheduler.worker.ts` | 33 | `scheduler` | yes |

- [ ] **Step 8: Apply to `notifications.worker.ts`** (6 call sites — this worker has per-notification-type try/catch blocks plus a top-level `on('failed')` and `on('error')`)

Add import: `import { createWorkerLogger } from '@/lib/worker-logger'`
Add: `const log = createWorkerLogger(undefined, 'notifications')`

Replace each of the 4 per-event catch blocks (lines 47, 107, 142, 182) — pattern is identical, only the event name in the message changes:

Old (line 47):
```typescript
        console.error('[Worker] notify failed for driver_submitted_for_review:', err)
```
New:
```typescript
        log.error({ err }, 'notify failed for driver_submitted_for_review')
```

Old (line 107): `console.error('[Worker] notify failed for sos_alert:', err)` → `log.error({ err }, 'notify failed for sos_alert')`
Old (line 142): `console.error('[Worker] notify failed for ride_accepted:', err)` → `log.error({ err }, 'notify failed for ride_accepted')`
Old (line 182): `console.error('[Worker] notify failed for ride_completed:', err)` → `log.error({ err }, 'notify failed for ride_completed')`

Old (line 212):
```typescript
  console.error(`[Worker] Job failed: ${job?.name ?? 'unknown'} id=${job?.id}`, err)
```
New:
```typescript
  log.error({ err, jobId: job?.id, jobName: job?.name }, 'notifications job failed')
```

Old (line 216):
```typescript
  console.error('[Worker] Notifications worker error:', err)
```
New:
```typescript
  log.error({ err }, 'notifications worker error')
```

- [ ] **Step 9: Run the jobs/notifications unit test suites**

Run: `cd api && npx vitest run tests/unit/jobs tests/unit/notifications`
Expected: PASS (same count as baseline — these tests exercise success paths and don't assert on console output)

- [ ] **Step 10: Full typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 11: Commit**

```bash
git add api/src/lib/worker-logger.ts api/tests/unit/lib/worker-logger.test.ts api/src/jobs/workers/
git commit -m "feat(logging): tag BullMQ worker failure logs with worker name via child logger"
```

---

## Task 7: Processors (not `Worker` instances — plain functions invoked by workers)

**Files:**
- Modify: `api/src/jobs/processors/broadcast.processor.ts` (lines 36, 103, 177)
- Modify: `api/src/jobs/processors/ack-check.processor.ts:81`
- Modify: `api/src/jobs/processors/partition-purge.processor.ts:50`

- [ ] **Step 1: Add a module-scoped child logger to `broadcast.processor.ts`**

Add import: `import { logger } from '@/lib/logger'`
Add after imports: `const log = logger.child({ module: 'broadcast-processor' })`

Old (line 36): `console.log(\`Broadcast skipped: ride ${data.rideId} no longer active\`)`
New: `log.info({ rideId: data.rideId }, 'broadcast skipped: ride no longer active')`

Old (line 103): `console.log(\`Ride ${data.rideId}: no_drivers\`)`
New: `log.info({ rideId: data.rideId }, 'no drivers available after max broadcast rounds')`

Old (lines 177-179):
```typescript
  console.log(
    `Broadcast round ${data.broadcastRound}: sent to ${drivers.length} drivers for ride ${data.rideId}`
  )
```
New:
```typescript
  log.info(
    { rideId: data.rideId, broadcastRound: data.broadcastRound, driverCount: drivers.length },
    'broadcast round sent'
  )
```

- [ ] **Step 2: Same pattern for `ack-check.processor.ts`**

Add import + `const log = logger.child({ module: 'ack-check-processor' })`

Old (line 81):
```typescript
      console.error('[ACK-CHECK] fallback push failed:', err instanceof Error ? err.message : 'unknown error')
```
New:
```typescript
      log.error({ err }, 'fallback push failed')
```

- [ ] **Step 3: Same pattern for `partition-purge.processor.ts`**

Add import + `const log = logger.child({ module: 'partition-purge-processor' })`

Old (line 50):
```typescript
    console.log(`[gps-partition-purge] dropped ${name} (older than ${GPS_TRAIL_RETENTION_DAYS} days)`)
```
New:
```typescript
    log.info({ partition: name, retentionDays: GPS_TRAIL_RETENTION_DAYS }, 'dropped gps partition')
```

- [ ] **Step 4: Run the partition/ack-check unit tests**

Run: `cd api && npx vitest run tests/unit/jobs/partition-purge.test.ts tests/unit/jobs/ack-check-fallback-push.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add api/src/jobs/processors/
git commit -m "feat(logging): convert job processors to structured module-scoped logging"
```

---

## Task 8: Remaining module-level `console.error` in service/route modules

**Files:**
- Modify: `api/src/modules/notifications/notifications.service.ts` (lines 21, 48, 54, 79, 91)
- Modify: `api/src/modules/notifications/providers/push.provider.ts` (lines 38, 90 — leave line 50's `[PUSH DEV]` log alone, see Task 10)
- Modify: `api/src/modules/payments/payments.service.ts` (lines 153, 764)
- Modify: `api/src/modules/payments/submodules/settlements/settlements.service.ts:370`
- Modify: `api/src/modules/payments/submodules/settlements/settlements.admin.routes.ts:88`
- Modify: `api/src/modules/safety/sos.service.ts:48`
- Modify: `api/src/modules/rides/rides.service.ts` (lines 919, 1210, 1609)

- [ ] **Step 1: Add a module-scoped logger to each file**

Each file gets, near its top-level imports:
```typescript
import { logger } from '@/lib/logger'
```
and, after imports:
```typescript
const log = logger.child({ module: '<module-name>' })
```
using these module names: `notifications-service`, `push-provider`, `payments-service`, `settlements-service`, `settlements-admin-routes`, `sos-service`, `rides-service`.

- [ ] **Step 2: `notifications.service.ts` replacements**

Old (line 21): `console.error('[PUSH] pushToTokens failed:', err instanceof Error ? err.message : 'unknown error')`
New: `log.error({ err }, 'pushToTokens failed')`

Old (line 48): `console.error('[NOTIFY] push leg failed:', err instanceof Error ? err.message : 'unknown error')`
New: `log.error({ err }, 'notify push leg failed')`

Old (line 54): `console.error('[NOTIFY] socket leg failed:', err instanceof Error ? err.message : 'unknown error')`
New: `log.error({ err }, 'notify socket leg failed')`

Old (line 79): `console.error('[NOTIFY] admin push leg failed:', err instanceof Error ? err.message : 'unknown error')`
New: `log.error({ err }, 'notify admin push leg failed')`

Old (line 91): `console.error('[NOTIFY] admin socket leg failed:', err instanceof Error ? err.message : 'unknown error')`
New: `log.error({ err }, 'notify admin socket leg failed')`

Note: passing `{ err }` (the full Error object) instead of `err.message` is intentional — Pino's `err` serializer captures the stack trace, which the old code was throwing away. Nothing here leaks to an HTTP response; this is a fire-and-forget notification side-effect logged server-side only.

- [ ] **Step 3: `push.provider.ts` replacements** (only lines 38 and 90 — line 50 is a dev-only bypass log, see Task 10)

Old (line 38): `console.error('[PUSH] Failed to initialize FCM — push disabled:', err instanceof Error ? err.message : 'unknown error')`
New: `log.error({ err }, 'failed to initialize FCM — push disabled')`

Old (line 90): `console.error('[PUSH] sendEachForMulticast failed:', err instanceof Error ? err.message : 'unknown error')`
New: `log.error({ err }, 'sendEachForMulticast failed')`

- [ ] **Step 4: `payments.service.ts` replacements**

Old (line 153): `console.error('[WALLET] low-balance notify failed:', err instanceof Error ? err.message : 'unknown error')`
New: `log.error({ err }, 'low-balance notify failed')`

Old (line 764): `console.error(\`[reconcile] ride ${row.ride_id} failed:\`, err)`
New: `log.error({ err, rideId: row.ride_id }, 'payment reconcile failed')`

- [ ] **Step 5: `settlements.service.ts` and `settlements.admin.routes.ts` replacements**

`settlements.service.ts` old (line 370): `console.error(\`[settlements] payout submit failed for settlement ${row.id}:\`, err)`
New: `log.error({ err, settlementId: row.id }, 'payout submit failed')`

`settlements.admin.routes.ts` old (line 88): `console.error(\`[settlements] bank account ${req.params['id']} verification gateway step failed:\`, result.error)`
New: `log.error({ err: result.error, bankAccountId: req.params['id'] }, 'bank account verification gateway step failed')`

- [ ] **Step 6: `sos.service.ts` replacement**

Old (line 48): `console.error('Failed to enqueue sos_alert job:', err)`
New: `log.error({ err }, 'failed to enqueue sos_alert job')`

- [ ] **Step 7: `rides.service.ts` replacements**

Old (line 919): `console.error('[NOTIFY] stop_added notification failed:', err instanceof Error ? err.message : 'unknown error')`
New: `log.error({ err }, 'stop_added notification failed')`

Old (line 1210): `console.error(\`Payment post-processing failed for early-ended ride ${rideId}:\`, err)`
New: `log.error({ err, rideId }, 'payment post-processing failed for early-ended ride')`

Old (line 1609): `console.error(\`Payment post-processing failed for ride ${rideId}:\`, err)`
New: `log.error({ err, rideId }, 'payment post-processing failed for ride')`

- [ ] **Step 8: Run the affected unit test suites**

Run: `cd api && npx vitest run tests/unit/notifications tests/unit/payments tests/unit/rides tests/unit/settlements`
Expected: PASS (same count as baseline)

- [ ] **Step 9: Full typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 10: Commit**

```bash
git add api/src/modules/
git commit -m "feat(logging): convert module-level error logging to structured Pino logs"
```

---

## Task 9: Server bootstrap and DB/Redis clients

**Files:**
- Modify: `api/src/server.ts` (all `console.*` calls: lines 21, 24, 28, 38, 40, 42, 44, 46, 54, 62, 80, 88, 106, 112, 125)
- Modify: `api/src/db/redis.ts` (lines 24, 28)
- Modify: `api/src/db/client.ts:50`

- [ ] **Step 1: Add the logger import to `server.ts`**

```typescript
import { logger } from '@/lib/logger'
```

- [ ] **Step 2: Replace each `console.*` call 1:1, same message text, swapping to structured calls**

This file is a linear startup/shutdown sequence — every call site keeps its existing message text, just moves to the logger with matching level (`console.error` → `log.error`, `console.log` → `log.info`). Read the current file, and for each line listed above, apply the mechanical substitution:
- `console.error('ERROR: Could not connect to database. Exiting.')` → `logger.error('could not connect to database, exiting')`
- `console.log('Database connected')` → `logger.info('database connected')`
- `console.error('ERROR: Could not connect to Redis. Exiting.')` → `logger.error('could not connect to redis, exiting')`
- Each `console.log('[Worker] X worker started')` → `logger.info('X worker started')` (drop the `[Worker]` prefix — that's now redundant with structured output; keep the worker name in the message)
- The startup summary block (~line 106) and `'Shutting down gracefully...'` (line 112) → `logger.info(...)` with the same text
- The final catch-all (line 125) `console.error(err)` → `logger.fatal({ err }, 'server startup failed')` (use `fatal` — this is the top-level catch that precedes process exit)

- [ ] **Step 3: Replace `db/redis.ts` call sites**

Add import: `import { logger } from '@/lib/logger'`

Old (line 24): `console.error('Redis error:', err)`
New: `logger.error({ err }, 'redis error')`

Old (line 28): `console.log('Redis connected')`
New: `logger.info('redis connected')`

- [ ] **Step 4: Replace `db/client.ts:50`**

Add import: `import { logger } from '@/lib/logger'`

Old (line 50): `console.warn(\`Slow query (${duration}ms): ${text}\`)`
New: `logger.warn({ durationMs: duration, query: text }, 'slow query')`

- [ ] **Step 5: Run the full suite + manual boot check**

Run: `cd api && npx vitest run`
Expected: PASS (same count as baseline)

Run: `cd api && pnpm dev` (let it boot, then Ctrl+C)
Expected: startup log lines appear as structured JSON (or pretty-printed in dev), no crash, `/health` still respondable while running.

- [ ] **Step 6: Commit**

```bash
git add api/src/server.ts api/src/db/redis.ts api/src/db/client.ts
git commit -m "feat(logging): convert server bootstrap and db/redis client logs to Pino"
```

---

## Task 10: Deliberately-unconverted call sites (document, don't touch)

**Files:** none modified in this task — this is a record of what's left as `console.*` and why.

- [ ] **Step 1: Confirm these stay as `console.*`, and add one comment where the reason isn't obvious from context**

| File | Why it stays `console.*` |
|---|---|
| `api/src/config/index.ts:91-97` (`loadConfig` catch block) | Runs *before* `config` exists — the logger needs `config.LOG_LEVEL`, so this is a chicken-and-egg case. It only fires on a fatal boot-time misconfiguration, process exits immediately after (line 98). Not a production runtime path. |
| `api/src/db/migrate.ts` (9 call sites) | One-off CLI script (`pnpm migrate`), never runs inside the long-lived server process Alloy is tailing. Its own stdout is the point — a human runs it interactively. |
| `api/src/db/seed-admin.ts` (4 call sites) | Same as `migrate.ts` — one-off CLI seed script, not server runtime. |
| `api/src/providers/sms.provider.ts:5` (`[SMS DEV]`) | Dev-only bypass path (fires only when SMS credentials are empty, per this repo's documented dev-bypass convention) — informational for a developer running locally, not a production log. |
| `api/src/lib/email.ts:14` (`[EMAIL DEV]`) | Same dev-bypass pattern as the SMS provider. |
| `api/src/modules/notifications/providers/push.provider.ts:50` (`[PUSH DEV]`) | Same dev-bypass pattern — fires only in the FCM dev-bypass branch. |

No code changes in this task. This table exists so a future contributor doesn't "complete the sweep" by converting CLI-script or dev-bypass logs that were deliberately left alone.

---

## Task 11: Final verification pass

**Files:** none — verification only.

- [ ] **Step 1: Full typecheck**

Run: `cd api && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 2: Full test suite**

Run: `cd api && npx vitest run`
Expected: all tests pass, same total count as the pre-change baseline (record the baseline count before Task 1 if not already known, e.g. `npx vitest run 2>&1 | tail -5`)

- [ ] **Step 3: Confirm no remaining `console.*` outside the Task 10 allowlist**

Run: `cd api && grep -rn "console\.\(log\|error\|warn\|info\|debug\)" src/ | grep -v -E "config/index\.ts|db/migrate\.ts|db/seed-admin\.ts|providers/sms\.provider\.ts|lib/email\.ts|providers/push\.provider\.ts:50"`
Expected: empty output

- [ ] **Step 4: Manual smoke test — verify request correlation end to end**

Run: `cd api && pnpm dev`, then `curl http://localhost:4000/health`
Expected: one log line for the request carrying a `reqId`; confirm the same field name (`reqId`) would appear in an error-path log if you trigger a 500 (e.g. temporarily stop the DB container and hit an endpoint that queries it) — both should share the value from `req.requestId`, confirming HTTP-side correlation works before this ships.

- [ ] **Step 5: Commit** (only if Steps 1-4 surfaced fixes; otherwise this task is verification-only, nothing to commit)

---

## Deliberately out of scope (say so if it comes up again)

- **Grafana Alloy agent install/config** — separate infra task from the production-readiness report (§4 step 7), not part of converting the logging library itself.
- **OpenTelemetry tracing** — report §4 marks this lowest priority, layered on top of Alloy once it's running; Pino/structured logging doesn't block it but isn't it either.
- **Sampling GPS-ping logs** — deliberately not built. Level-gating (this plan) already reduces the hot-path cost to zero at `info` level; add sampling only if a real incident shows `debug`-level tracing is needed in production at volume (ponytail: level-gate is the ceiling here, sampling infrastructure is the upgrade path if that ceiling is ever hit).
