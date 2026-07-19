// Computes which month's gps_tracks partition to pre-create, one month
// ahead of "now" — e.g. called in July, creates August's partition.
export function getNextPartitionTarget(now: Date): { year: number; month: number } {
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return { year: target.getUTCFullYear(), month: target.getUTCMonth() + 1 }
}

// Calls the create_gps_partition() SQL function (defined in
// 005_m3_geo.sql, idempotent via CREATE TABLE IF NOT EXISTS) for next
// month's gps_tracks partition. Fixes the audit finding that this
// function existed but was never called from application code — inserts
// would silently start failing once the migration's initial 4
// pre-created partitions ran out.
export async function processCreateNextPartition(): Promise<void> {
  // Dynamic import: a static top-level `import { pool } from '@/db/client'` here
  // transitively pulls in `@/config`, whose eager process.exit(1) on invalid env
  // crashes unrelated Vitest suites sharing this test run's worker pool. Keep dynamic.
  const { pool } = await import('@/db/client')
  const { year, month } = getNextPartitionTarget(new Date())
  await pool.query('SELECT create_gps_partition($1, $2)', [year, month])
}
