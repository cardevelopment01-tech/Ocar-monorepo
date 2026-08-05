import { GPS_TRAIL_RETENTION_DAYS } from '@/constants/limits'
import { logger } from '@/lib/logger'

const log = logger.child({ module: 'partition-purge-processor' })

const PARTITION_NAME_RE = /^gps_tracks_(\d{4})_(\d{2})$/

// A partition is eligible for purge only once its FULL date range is
// older than the retention window — i.e. the start of the month AFTER
// the partition (its upper bound) has already passed the cutoff.
export function selectPartitionsToPurge(
  partitionNames: string[],
  now: Date,
  retentionDays: number
): string[] {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000)
  return partitionNames.filter((name) => {
    const match = PARTITION_NAME_RE.exec(name)
    if (!match) return false
    const year = Number(match[1])
    const month = Number(match[2])
    const partitionEnd = new Date(Date.UTC(year, month, 1))
    return partitionEnd <= cutoff
  })
}

// Drops gps_tracks partitions older than GPS_TRAIL_RETENTION_DAYS.
// Reads the partition list from information_schema rather than a
// hardcoded list, so it can't drift out of sync with what's actually
// in the database. Implements the retention policy ADR-003 specified
// but never built — DROP TABLE is a metadata-only operation, unlike a
// DELETE over the same row volume (see ADR-003 for the benchmark).
export async function processPurgeOldPartitions(): Promise<void> {
  // Dynamic import: a static top-level `import { pool } from '@/db/client'` here
  // transitively pulls in `@/config`, whose eager process.exit(1) on invalid env
  // crashes unrelated Vitest suites sharing this test run's worker pool. Keep dynamic.
  // (Same issue and same fix as api/src/jobs/processors/partition-creator.processor.ts.)
  const { pool } = await import('@/db/client')

  const res = await pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name ~ '^gps_tracks_[0-9]{4}_[0-9]{2}$'`
  )
  const partitionNames = res.rows.map((r) => r.table_name)
  const toPurge = selectPartitionsToPurge(partitionNames, new Date(), GPS_TRAIL_RETENTION_DAYS)

  for (const name of toPurge) {
    // Defense in depth: re-validate immediately before building DDL from
    // a string, even though `name` already came from a regex-filtered
    // system catalog query, not user input.
    if (!PARTITION_NAME_RE.test(name)) continue
    await pool.query(`DROP TABLE IF EXISTS ${name}`)
    log.info({ partition: name, retentionDays: GPS_TRAIL_RETENTION_DAYS }, 'dropped gps partition')
  }
}
