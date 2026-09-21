// Measures the exact thing the client asked about: after a rate-card
// invalidation, how long until the cache is "remade" -- and whether a burst
// of concurrent requests during that gap causes N separate Postgres queries
// (which could overwhelm the DB) or collapses into one via single-flight.
//
// This calls the REAL production code paths (getCurrentRateCard,
// RATE_CARD_VERSION_KEY bump) against your real dev Postgres + Redis --
// not a synthetic estimate. Run it against staging for a number you can
// quote with full confidence; dev is fine for a sanity check first.
//
// Usage:
//   cd api && pnpm tsx --env-file=.env src/db/bench-cache-invalidation.ts
//
// What it does, per iteration:
//   1. Picks a real rate_cards row (category/ride_type/city already in your DB).
//   2. Warms the cache (one read, so we start from a hit).
//   3. Bumps RATE_CARD_VERSION_KEY -- the exact invalidation rate-card writes
//      use in production (pricing.repository.ts's createRateCard). Times it.
//   4. Immediately fires CONCURRENT_READERS parallel reads for that same key --
//      simulating a burst of riders requesting a fare estimate in the same
//      instant right after an admin changes a rate card.
//   5. Times how long until ALL of those concurrent reads resolve.
//   6. Counts how many actual Postgres queries fired during that burst, by
//      wrapping pool.query -- proving (or disproving) that single-flight
//      collapsed the burst into one DB round trip instead of N.
//
// Repeats ITERATIONS times and reports min/median/p95/max, because a single
// run can be misleading (OS scheduling jitter, first-run JIT warmup, etc.) --
// the client's question deserves a distribution, not an anecdote.

import { pool } from './client'
import { client as redisClient, withTimeout } from './redis'
import { getCurrentRateCard } from '@/modules/pricing/pricing.repository'
import { RATE_CARD_VERSION_KEY } from '@/constants/redis-keys'

const ITERATIONS = Number(process.env.ITERATIONS ?? 30)
const CONCURRENT_READERS = Number(process.env.CONCURRENT_READERS ?? 20)

function percentile(sorted: number[], p: number): number {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]!
}

function summarize(label: string, samplesMs: number[]) {
  const sorted = [...samplesMs].sort((a, b) => a - b)
  const avg = samplesMs.reduce((a, b) => a + b, 0) / samplesMs.length
  console.log(
    `${label}: min=${sorted[0]!.toFixed(2)}ms  ` +
    `median=${percentile(sorted, 50).toFixed(2)}ms  ` +
    `p95=${percentile(sorted, 95).toFixed(2)}ms  ` +
    `max=${sorted[sorted.length - 1]!.toFixed(2)}ms  ` +
    `avg=${avg.toFixed(2)}ms`
  )
}

async function main() {
  const existing = await pool.query<{ category_id: number; ride_type: string; city_id: number | null }>(
    `SELECT category_id, ride_type, city_id FROM rate_cards WHERE effective_to IS NULL LIMIT 1`
  )
  if (existing.rows.length === 0) {
    throw new Error('No rate_cards rows found -- seed the DB first (016_seed.sql should have run).')
  }
  const { category_id, ride_type, city_id } = existing.rows[0]!
  console.log(`Testing against real row: category_id=${category_id} ride_type=${ride_type} city_id=${city_id}\n`)

  const invalidateSamples: number[] = []
  const rebuildSamples: number[] = []
  const dbQueryCounts: number[] = []

  // Wrap pool.query to count how many times it's actually called during the
  // burst window -- this is the direct proof of single-flight collapsing (or
  // not) the concurrent misses, not an assumption.
  const originalQuery = pool.query.bind(pool)
  let countingQueries = false
  let queryCountThisBurst = 0
  ;(pool as unknown as { query: typeof pool.query }).query = ((...args: Parameters<typeof pool.query>) => {
    if (countingQueries) queryCountThisBurst++
    return (originalQuery as (...a: unknown[]) => unknown)(...args)
  }) as typeof pool.query

  for (let i = 0; i < ITERATIONS; i++) {
    // 1. Warm the cache -- start each iteration from a confirmed hit.
    await getCurrentRateCard(category_id, ride_type, city_id)

    // 2. Invalidate -- the real production call, timed.
    const t0 = performance.now()
    await withTimeout(redisClient.incr(RATE_CARD_VERSION_KEY))
    const invalidateMs = performance.now() - t0
    invalidateSamples.push(invalidateMs)

    // 3. Immediately fire a concurrent burst of reads for the now-cold key.
    queryCountThisBurst = 0
    countingQueries = true
    const t1 = performance.now()
    await Promise.all(
      Array.from({ length: CONCURRENT_READERS }, () => getCurrentRateCard(category_id, ride_type, city_id))
    )
    const rebuildMs = performance.now() - t1
    countingQueries = false
    rebuildSamples.push(rebuildMs)
    dbQueryCounts.push(queryCountThisBurst)
  }

  console.log(`--- ${ITERATIONS} iterations, ${CONCURRENT_READERS} concurrent readers per burst ---\n`)
  summarize('Invalidation (version-key INCR)', invalidateSamples)
  summarize(`Rebuild after miss (${CONCURRENT_READERS} concurrent readers, first one after invalidation)`, rebuildSamples)

  const maxQueries = Math.max(...dbQueryCounts)
  const avgQueries = dbQueryCounts.reduce((a, b) => a + b, 0) / dbQueryCounts.length
  console.log(
    `\nPostgres queries fired per burst of ${CONCURRENT_READERS} concurrent readers: ` +
    `avg=${avgQueries.toFixed(2)}  max=${maxQueries}  ` +
    `(1 = single-flight fully collapsed the burst; ${CONCURRENT_READERS} = no collapsing happened)`
  )

  await pool.end()
  redisClient.disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
