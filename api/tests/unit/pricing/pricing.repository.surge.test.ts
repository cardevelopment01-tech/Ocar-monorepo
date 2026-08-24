import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/db/client', () => ({ pool: { query: vi.fn() } }))
// getActiveSurge reads/writes through @/db/redis directly (getJSON/setWithTTL)
// plus @/lib/cache/reference-cache's `invalidate` (client.del) — without this
// mock it hits a real, reachable local Redis instead of the mocks below.
vi.mock('@/db/redis', () => ({
  getJSON: vi.fn().mockResolvedValue(null),
  setWithTTL: vi.fn().mockResolvedValue(undefined),
  client: { get: vi.fn(), del: vi.fn().mockResolvedValue(1) },
  withTimeout: (p: Promise<unknown>) => p,
}))

import { pool } from '@/db/client'
import { getJSON, setWithTTL, client } from '@/db/redis'
import { getActiveSurge, invalidateSurgeCache } from '@/modules/pricing/pricing.repository'
import { surgeKey } from '@/constants/redis-keys'

const SURGE_ROW = {
  id: 1, city_id: 1, category_id: 10, multiplier: '1.5',
  status: 'active', starts_at: '2026-01-01T00:00:00.000Z',
  ends_at: new Date(Date.now() + 600_000).toISOString(),
}

describe('getActiveSurge — cache + boundary-clamped TTL', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getJSON).mockResolvedValue(null)
  })

  it('returns the cached value on a cache hit without querying the DB', async () => {
    vi.mocked(getJSON).mockResolvedValueOnce(SURGE_ROW as never)

    const result = await getActiveSurge(1, 10)

    expect(result).toEqual(SURGE_ROW)
    expect(pool.query).not.toHaveBeenCalled()
  })

  it('fetches from the DB once on a cache miss and populates the cache', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [SURGE_ROW], rowCount: 1 } as never)

    const result = await getActiveSurge(2, 10)

    expect(result).toEqual(SURGE_ROW)
    expect(pool.query).toHaveBeenCalledTimes(1)
    expect(setWithTTL).toHaveBeenCalledTimes(1)
  })

  it('does not cache a "no active surge" result', async () => {
    vi.mocked(pool.query).mockResolvedValue({ rows: [], rowCount: 0 } as never)

    const result = await getActiveSurge(3, 10)

    expect(result).toBeNull()
    expect(setWithTTL).not.toHaveBeenCalled()
  })

  it('clamps the TTL to SURGE_BASE_TTL_SECONDS (300) when the surge ends far in the future', async () => {
    const row = { ...SURGE_ROW, ends_at: new Date(Date.now() + 3600_000).toISOString() }
    vi.mocked(pool.query).mockResolvedValue({ rows: [row], rowCount: 1 } as never)

    await getActiveSurge(4, 10)

    const ttlArg = vi.mocked(setWithTTL).mock.calls[0]![2]
    expect(ttlArg).toBeLessThanOrEqual(300)
    expect(ttlArg).toBeGreaterThan(295)
  })

  it('clamps the TTL to the surge\'s own remaining lifetime when it ends sooner than 300s', async () => {
    const row = { ...SURGE_ROW, ends_at: new Date(Date.now() + 50_000).toISOString() }
    vi.mocked(pool.query).mockResolvedValue({ rows: [row], rowCount: 1 } as never)

    await getActiveSurge(5, 10)

    const ttlArg = vi.mocked(setWithTTL).mock.calls[0]![2]
    expect(ttlArg).toBeLessThanOrEqual(50)
    expect(ttlArg).toBeGreaterThan(0)
  })

  it('collapses concurrent calls for the same (cityId, categoryId) into a single DB fetch', async () => {
    let resolveQuery!: (value: unknown) => void
    const pending = new Promise((resolve) => { resolveQuery = resolve })
    vi.mocked(pool.query).mockReturnValue(pending as never)

    const call1 = getActiveSurge(6, 10)
    const call2 = getActiveSurge(6, 10)

    resolveQuery({ rows: [SURGE_ROW], rowCount: 1 })
    const [result1, result2] = await Promise.all([call1, call2])

    expect(result1).toEqual(SURGE_ROW)
    expect(result2).toEqual(SURGE_ROW)
    expect(pool.query).toHaveBeenCalledTimes(1)
  })
})

describe('invalidateSurgeCache — write-path invalidation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invalidates just that key for a concrete-category write', async () => {
    await invalidateSurgeCache(7, 10)

    expect(client.del).toHaveBeenCalledWith(surgeKey(7, 10))
  })

  it('enumerates categories and invalidates each one for a category_id IS NULL write', async () => {
    vi.mocked(pool.query).mockResolvedValue({
      rows: [{ id: 1 }, { id: 2 }, { id: 3 }],
      rowCount: 3,
    } as never)

    await invalidateSurgeCache(7, null)

    expect(pool.query).toHaveBeenCalledWith('SELECT id FROM vehicle_categories')
    expect(client.del).toHaveBeenCalledWith(surgeKey(7, 1), surgeKey(7, 2), surgeKey(7, 3))
  })

  it('logs and does not throw when the category-enumeration query fails', async () => {
    vi.mocked(pool.query).mockRejectedValue(new Error('db down'))

    await expect(invalidateSurgeCache(7, null)).resolves.toBeUndefined()
    expect(client.del).not.toHaveBeenCalled()
  })
})
