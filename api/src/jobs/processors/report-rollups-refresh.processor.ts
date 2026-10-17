import { logger } from '@/lib/logger'

const log = logger.child({ module: 'report-rollups-refresh-processor' })

// Refreshes the rpt_* views behind the Reports / Analytics pages (migration 117) and records when the refresh STARTED
// in rpt_rollup_meta: every IST day before that moment's date was over, so the reports read those days from the views
// and the days since from the raw tables. CONCURRENTLY: readers are never blocked (needs the unique indexes from 117).
// The cutoff only moves forward after ALL views refreshed, so a failed run leaves the old (still correct) cutoff.
const ADVISORY_LOCK_KEY = 8927342 // one refresher at a time across API instances (blue/green overlap); migrate.ts uses 8927341

export async function processRefreshReportRollups(): Promise<void> {
  const { analyticsPool } = await import('@/db/client')
  const { ROLLUP_VIEWS, resetRollupCutoffCache } = await import('@/modules/analytics/analytics.rollup')
  const client = await analyticsPool.connect()
  let locked = false
  try {
    locked = (await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock($1) AS ok', [ADVISORY_LOCK_KEY])).rows[0]?.ok === true
    if (!locked) {
      log.info('another instance is refreshing the report rollups, skipping')
      return
    }
    await client.query('SET statement_timeout = 300000')
    const startedAt = (await client.query<{ t: Date }>('SELECT clock_timestamp() AS t')).rows[0]!.t
    for (const view of ROLLUP_VIEWS) {
      const t0 = Date.now()
      await client.query(`REFRESH MATERIALIZED VIEW CONCURRENTLY ${view}`) // view names are a fixed constant list, never user input
      log.info({ view, ms: Date.now() - t0 }, 'report rollup refreshed')
    }
    await client.query(
      `INSERT INTO rpt_rollup_meta (id, refreshed_at) VALUES (1, $1)
       ON CONFLICT (id) DO UPDATE SET refreshed_at = GREATEST(rpt_rollup_meta.refreshed_at, EXCLUDED.refreshed_at)`,
      [startedAt],
    )
    resetRollupCutoffCache()
    log.info({ startedAt }, 'report rollups refreshed')
  } finally {
    // the session-level lock and timeout belong to this pooled connection: always hand it back clean
    if (locked) await client.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]).catch(() => undefined)
    await client.query('RESET statement_timeout').catch(() => undefined)
    client.release()
  }
}
