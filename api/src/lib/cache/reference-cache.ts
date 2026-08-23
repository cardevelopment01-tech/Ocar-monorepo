import { getJSON, setWithTTL, client as redisClient } from '@/db/redis'
import { logger } from '@/lib/logger'
import { cacheHitsTotal, cacheMissesTotal } from '@/observability/metrics'
import { singleFlight } from './single-flight'

const NEGATIVE_SENTINEL = '__NULL__'
const NEGATIVE_TTL_SECONDS = 30

function jitter(baseSeconds: number): number {
  return Math.floor(baseSeconds * (0.9 + Math.random() * 0.2))
}

/**
 * Cache-aside read with single-flight miss collapsing, TTL jitter, and negative
 * caching. `table` is a metrics label only (e.g. 'rate_cards') — it never touches
 * the cache key itself.
 */
export async function cachedRead<T>(
  table: string,
  key: string,
  ttlSeconds: number,
  fetchFn: () => Promise<T | null>
): Promise<T | null> {
  return singleFlight(key, async () => {
    // getJSON already swallows its own internal errors and resolves null on
    // failure — this catch is defense-in-depth for callers/mocks that don't.
    let cached: T | typeof NEGATIVE_SENTINEL | null
    try {
      cached = await getJSON<T | typeof NEGATIVE_SENTINEL>(key)
    } catch (err) {
      logger.warn({ err, key }, 'reference-cache: cache read failed, falling through to fetchFn')
      cached = null
    }

    if (cached === NEGATIVE_SENTINEL) {
      cacheHitsTotal.inc({ table })
      return null
    }
    if (cached !== null) {
      cacheHitsTotal.inc({ table })
      return cached
    }

    cacheMissesTotal.inc({ table })
    const value = await fetchFn()

    try {
      const ttl = jitter(value === null ? NEGATIVE_TTL_SECONDS : ttlSeconds)
      await setWithTTL(key, JSON.stringify(value === null ? NEGATIVE_SENTINEL : value), ttl)
    } catch (err) {
      logger.warn({ err, key }, 'reference-cache: failed to populate cache, serving DB value')
    }

    return value
  })
}

/** Delete-on-write invalidation. Call only after the write transaction has committed. */
export async function invalidate(...keys: string[]): Promise<void> {
  if (keys.length === 0) return
  try {
    await redisClient.del(...keys)
  } catch (err) {
    logger.warn({ err, keys }, 'reference-cache: failed to invalidate, will serve stale until TTL')
  }
}
