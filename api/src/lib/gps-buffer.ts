import { logger } from '@/lib/logger'
import type { GpsTrackPayload } from '@/modules/geo/geo.types'

const log = logger.child({ module: 'gps-buffer' })

// Breadcrumb ingestion used to be one BullMQ job (~5-8 Redis commands) plus one INSERT per GPS ping. At a ping
// every ~3 s that is hundreds of jobs per second for a few hundred drivers. Pings are now buffered in memory and
// written with ONE multi-row INSERT every few seconds.
//
// Trade-off, deliberately accepted: a hard crash loses at most FLUSH_INTERVAL_MS of breadcrumbs per instance
// (graceful shutdown flushes them). They feed trail display and round-trip/rental distance billing, which already
// tolerates sparse data (it falls back / flags for review when breadcrumbs are insufficient).
const FLUSH_INTERVAL_MS = 5_000
const FLUSH_AT_SIZE = 200
// Hard cap so a database outage can't grow the buffer without bound; oldest rows are dropped first.
const MAX_BUFFERED = 5_000
const MAX_ATTEMPTS = 3

interface Buffered { row: GpsTrackPayload; attempts: number }

let buffer: Buffered[] = []
let timer: ReturnType<typeof setInterval> | null = null
let flushing: Promise<void> | null = null

export function enqueueBreadcrumb(row: GpsTrackPayload): void {
  buffer.push({ row, attempts: 0 })
  if (buffer.length > MAX_BUFFERED) {
    const dropped = buffer.length - MAX_BUFFERED
    buffer = buffer.slice(dropped)
    log.error({ dropped }, 'gps buffer overflow — dropped oldest breadcrumbs (database unavailable?)')
  }
  if (!timer) {
    timer = setInterval(() => { void flushBreadcrumbs() }, FLUSH_INTERVAL_MS)
    timer.unref() // never keeps the process alive on its own
  }
  if (buffer.length >= FLUSH_AT_SIZE) void flushBreadcrumbs()
}

export function flushBreadcrumbs(): Promise<void> {
  // One flush at a time; a caller during an in-flight flush just waits for it.
  if (flushing) return flushing
  if (buffer.length === 0) return Promise.resolve()
  const batch = buffer
  buffer = []
  flushing = (async () => {
    try {
      // Dynamic import: keeps this module (and anything importing it) free of the DB/config side effects at load.
      const [{ workerPool }, { insertGpsTracks }] = await Promise.all([
        import('@/db/client'),
        import('@/modules/geo/geo.repository'),
      ])
      await insertGpsTracks(batch.map(b => b.row), workerPool)
    } catch (err) {
      const retry = batch.filter(b => ++b.attempts < MAX_ATTEMPTS)
      log.error({ err, batch: batch.length, requeued: retry.length }, 'gps breadcrumb flush failed')
      buffer = retry.concat(buffer)
    } finally {
      flushing = null
    }
  })()
  return flushing
}

// Test hook / shutdown helper.
export function bufferedBreadcrumbCount(): number { return buffer.length }
