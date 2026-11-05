import { describe, it, expect, vi, beforeEach } from 'vitest'

const repo = vi.hoisted(() => ({ consumeRedemption: vi.fn(), releaseRedemption: vi.fn() }))
vi.mock('@/modules/offers/offers.repository', () => repo)
vi.mock('@/lib/system-config', () => ({ getConfigValue: vi.fn() }))

import { onRideCancelled, releaseForRide } from '@/modules/offers/settlement'

// Value: protects=a free cancel gives the offer back and a cancel with a fee uses it up (benefit lost);
// fails_when=the two branches swap; why_new=the DB-backed cancel tests cannot set a rate-card fee without editing shared
// data; seam=none; no_claim=the database statements (mocked repository).
const q = { query: vi.fn() } as never

beforeEach(() => vi.clearAllMocks())

describe('onRideCancelled', () => {
  it('releases the offer when no fee was charged', async () => {
    await onRideCancelled(q, 5n, false)
    expect(repo.releaseRedemption).toHaveBeenCalledWith(q, 5n, 'ride cancelled')
    expect(repo.consumeRedemption).not.toHaveBeenCalled()
  })
  it('consumes the offer when a cancellation fee applied', async () => {
    await onRideCancelled(q, 5n, true)
    expect(repo.consumeRedemption).toHaveBeenCalledWith(q, 5n)
    expect(repo.releaseRedemption).not.toHaveBeenCalled()
  })
  it('releaseForRide releases with the given reason', async () => {
    await releaseForRide(q, 7n, 'no drivers')
    expect(repo.releaseRedemption).toHaveBeenCalledWith(q, 7n, 'no drivers')
  })
})
