import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetJSON = vi.fn()
const mockSetWithTTL = vi.fn()
const mockDel = vi.fn()
vi.mock('@/db/redis', () => ({
  getJSON: (...a: unknown[]) => mockGetJSON(...a),
  setWithTTL: (...a: unknown[]) => mockSetWithTTL(...a),
  client: { del: (...a: unknown[]) => mockDel(...a) },
  withTimeout: (p: Promise<unknown>) => p,
}))

const mockHitsInc = vi.fn()
const mockMissesInc = vi.fn()
vi.mock('@/observability/metrics', () => ({
  cacheHitsTotal: { inc: (...a: unknown[]) => mockHitsInc(...a) },
  cacheMissesTotal: { inc: (...a: unknown[]) => mockMissesInc(...a) },
}))

import { cachedRead, invalidate } from './reference-cache'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('cachedRead', () => {
  it('returns the cached value on a hit without calling fetchFn', async () => {
    mockGetJSON.mockResolvedValue({ id: 1 })
    const fetchFn = vi.fn()

    const result = await cachedRead('rate_cards', 'ref:v1:test:1', 3600, fetchFn)

    expect(result).toEqual({ id: 1 })
    expect(fetchFn).not.toHaveBeenCalled()
    expect(mockHitsInc).toHaveBeenCalledWith({ table: 'rate_cards' })
  })

  it('fetches and populates the cache on a miss', async () => {
    mockGetJSON.mockResolvedValue(null)
    const fetchFn = vi.fn().mockResolvedValue({ id: 2 })

    const result = await cachedRead('rate_cards', 'ref:v1:test:2', 3600, fetchFn)

    expect(result).toEqual({ id: 2 })
    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(mockMissesInc).toHaveBeenCalledWith({ table: 'rate_cards' })
    expect(mockSetWithTTL).toHaveBeenCalledWith(
      'ref:v1:test:2',
      JSON.stringify({ id: 2 }),
      expect.any(Number)
    )
  })

  it('falls through to fetchFn when getJSON rejects (redis down)', async () => {
    mockGetJSON.mockRejectedValue(new Error('redis down'))
    const fetchFn = vi.fn().mockResolvedValue({ id: 3 })

    const result = await cachedRead('rate_cards', 'ref:v1:test:3', 3600, fetchFn)

    expect(result).toEqual({ id: 3 })
  })

  it('still returns the fetched value when the cache write fails', async () => {
    mockGetJSON.mockResolvedValue(null)
    mockSetWithTTL.mockRejectedValue(new Error('redis down'))
    const fetchFn = vi.fn().mockResolvedValue({ id: 4 })

    const result = await cachedRead('rate_cards', 'ref:v1:test:4', 3600, fetchFn)

    expect(result).toEqual({ id: 4 })
  })

  it('caches a negative result and does not call fetchFn again while it is cached', async () => {
    mockGetJSON.mockResolvedValueOnce(null).mockResolvedValueOnce('__NULL__')
    const fetchFn = vi.fn().mockResolvedValue(null)

    const first = await cachedRead('rate_cards', 'ref:v1:test:5', 3600, fetchFn)
    expect(first).toBeNull()
    expect(mockSetWithTTL).toHaveBeenCalledWith(
      'ref:v1:test:5',
      JSON.stringify('__NULL__'),
      expect.any(Number)
    )

    const second = await cachedRead('rate_cards', 'ref:v1:test:5', 3600, fetchFn)
    expect(second).toBeNull()
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('uses the shorter negative TTL (~30s) for a null result, not the positive TTL', async () => {
    mockGetJSON.mockResolvedValue(null)
    const fetchFn = vi.fn().mockResolvedValue(null)

    await cachedRead('rate_cards', 'ref:v1:test:6', 3600, fetchFn)

    const [, , ttlUsed] = mockSetWithTTL.mock.calls[0]
    expect(ttlUsed).toBeLessThan(60)
  })

  it('collapses concurrent misses for the same key into one fetchFn call', async () => {
    mockGetJSON.mockResolvedValue(null)
    let resolveFetch: (v: unknown) => void
    const fetchFn = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve }))

    const p1 = cachedRead('rate_cards', 'ref:v1:test:7', 3600, fetchFn)
    const p2 = cachedRead('rate_cards', 'ref:v1:test:7', 3600, fetchFn)
    // fetchFn only runs after the cache-miss check resolves (a microtask away),
    // so give the pending getJSON() await a tick before fetchFn is invoked.
    await new Promise((resolve) => setImmediate(resolve))
    resolveFetch!({ id: 7 })

    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1).toEqual({ id: 7 })
    expect(r2).toEqual({ id: 7 })
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('applies TTL jitter within +/-10% of the base TTL', async () => {
    mockGetJSON.mockResolvedValue(null)
    const fetchFn = vi.fn().mockResolvedValue({ id: 8 })

    await cachedRead('rate_cards', 'ref:v1:test:8', 1000, fetchFn)

    const [, , ttlUsed] = mockSetWithTTL.mock.calls[0]
    expect(ttlUsed).toBeGreaterThanOrEqual(900)
    expect(ttlUsed).toBeLessThanOrEqual(1100)
  })
})

describe('invalidate', () => {
  it('calls redis DEL with the given keys', async () => {
    await invalidate('ref:v1:a', 'ref:v1:b')
    expect(mockDel).toHaveBeenCalledWith('ref:v1:a', 'ref:v1:b')
  })

  it('swallows redis errors instead of throwing', async () => {
    mockDel.mockRejectedValue(new Error('redis down'))
    await expect(invalidate('ref:v1:a')).resolves.toBeUndefined()
  })

  it('is a no-op when called with zero keys', async () => {
    await invalidate()
    expect(mockDel).not.toHaveBeenCalled()
  })
})
