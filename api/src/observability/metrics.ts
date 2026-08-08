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
    for (const [name, queue] of Object.entries(queues)) {
      const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'failed')
      for (const [state, count] of Object.entries(counts)) {
        this.set({ queue: name, state }, count)
      }
    }
  },
})
