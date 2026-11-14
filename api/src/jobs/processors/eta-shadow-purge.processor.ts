import { ETA_SHADOW_RETENTION_DAYS } from '@/constants/limits'
import { logger } from '@/lib/logger'

const log = logger.child({ module: 'eta-shadow-purge-processor' })

const BATCH = 5_000
const MAX_BATCHES = 40

// Deletes shadow ETA samples (migration 136) older than ETA_SHADOW_RETENTION_DAYS. Batched, so a large backlog never holds one long
// lock: at most BATCH x MAX_BATCHES rows per run, and the next daily run continues.
export async function processPurgeEtaShadow(): Promise<number> {
  // Dynamic import: see partition-purge.processor.ts for why (avoids a top-level @/config import crashing unrelated suites).
  const { pool } = await import('@/db/client')
  let total = 0
  for (let i = 0; i < MAX_BATCHES; i++) {
    const res = await pool.query(
      `DELETE FROM ride_eta_shadow
        WHERE id IN (SELECT id FROM ride_eta_shadow WHERE at < now() - make_interval(days => $1) LIMIT $2)`,
      [ETA_SHADOW_RETENTION_DAYS, BATCH]
    )
    total += res.rowCount ?? 0
    if ((res.rowCount ?? 0) < BATCH) break
  }
  log.info({ deleted: total, retentionDays: ETA_SHADOW_RETENTION_DAYS }, 'purged old ride_eta_shadow rows')
  return total
}
