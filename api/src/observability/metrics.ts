import { Registry, collectDefaultMetrics, Histogram, Gauge, Counter } from 'prom-client'
import { pool } from '@/db/client'
import { queues } from '@/jobs/queues'
import { logger } from '@/lib/logger'

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

export const cacheHitsTotal = new Counter({
  name: 'cache_hits_total',
  help: 'Reference-data cache hits by table',
  labelNames: ['table'],
  registers: [register],
})

export const cacheMissesTotal = new Counter({
  name: 'cache_misses_total',
  help: 'Reference-data cache misses by table',
  labelNames: ['table'],
  registers: [register],
})

// SQLSTATE is a small, bounded code set (unlike a raw error message), so this
// carries no unbounded-cardinality risk. Added after
// docs/INCIDENT_2026-08-25_PROD_DB_AUTH_OUTAGE.md, where a full auth outage
// (28P01) was only caught by a human reading logs -- 28P01 (invalid_password)
// and 28000 (invalid_authorization_specification) are the codes to alert on.
export const pgQueryErrorsTotal = new Counter({
  name: 'pg_query_errors_total',
  help: 'Postgres query errors by SQLSTATE error code',
  labelNames: ['code'],
  registers: [register],
})

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

new Gauge({
  name: 'bullmq_queue_job_counts',
  help: 'BullMQ job counts by queue and state',
  labelNames: ['queue', 'state'],
  registers: [register],
  async collect() {
    // register.metrics() awaits every metric's collect() and does not
    // isolate a rejection — one queue's Redis hiccup at scrape time would
    // otherwise blank the whole /metrics response, including the
    // unrelated pg_pool_connections/http_request_duration_seconds series.
    // Skip the failing queue's series for this scrape instead.
    for (const [name, queue] of Object.entries(queues)) {
      try {
        const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed')
        for (const [state, count] of Object.entries(counts)) {
          this.set({ queue: name, state }, count)
        }
      } catch (err) {
        logger.warn({ err, queue: name }, 'failed to collect queue job counts for metrics')
      }
    }
  },
})
