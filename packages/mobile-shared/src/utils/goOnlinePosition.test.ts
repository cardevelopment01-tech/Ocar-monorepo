import { describe, it, expect, vi } from 'vitest'
import { resolveGoOnlinePosition } from './goOnlinePosition'

// Value: protects=going online does not wait for a fresh GPS fix when the OS already has a recent one (the wait was up to 8 s while the
// server answers in about 30 ms); fails_when=the fresh-fix request is made although a recent fix exists, or a missing/slow fix is not
// handled; why_new=the go-online wait was invisible to every other test; seam=none (the expo-location calls are injected);
// no_claim=how accurate the OS position is.
const P = (n: number) => ({ coords: { latitude: n, longitude: n } })

describe('resolveGoOnlinePosition', () => {
  it('uses a recent OS fix straight away, without asking for a fresh one', async () => {
    const fresh = vi.fn(async () => P(2))
    const last = vi.fn(async () => P(3))
    const out = await resolveGoOnlinePosition({ recent: async () => P(1), fresh, last })
    expect(out).toEqual(P(1))
    expect(fresh).not.toHaveBeenCalled()
    expect(last).not.toHaveBeenCalled()
  })

  it('asks for a fresh fix when there is no recent one', async () => {
    const out = await resolveGoOnlinePosition({ recent: async () => null, fresh: async () => P(2), last: async () => P(3) })
    expect(out).toEqual(P(2))
  })

  it('falls back to any last-known fix when the fresh one fails or times out', async () => {
    const out = await resolveGoOnlinePosition({
      recent: async () => null,
      fresh: async () => { throw new Error('location_timeout') },
      last: async () => P(3),
    })
    expect(out).toEqual(P(3))
  })

  it('throws no_location_available when nothing is known, so the caller can use its default', async () => {
    await expect(resolveGoOnlinePosition({
      recent: async () => null,
      fresh: async () => { throw new Error('location_timeout') },
      last: async () => null,
    })).rejects.toThrow('no_location_available')
  })

  it('treats a failing recent lookup as no recent fix', async () => {
    const out = await resolveGoOnlinePosition({
      recent: async () => { throw new Error('boom') },
      fresh: async () => P(2),
      last: async () => P(3),
    })
    expect(out).toEqual(P(2))
  })

  it('does not wait for a recent-fix lookup that never answers', async () => {
    vi.useFakeTimers()
    try {
      const never = new Promise<never>(() => undefined)
      const p = resolveGoOnlinePosition({ recent: () => never, fresh: async () => P(2), last: async () => P(3) }, { lookupCapMs: 500 })
      await vi.advanceTimersByTimeAsync(600)
      await expect(p).resolves.toEqual(P(2))
    } finally { vi.useRealTimers() }
  })

  it('does not wait for a last-known lookup that never answers either', async () => {
    vi.useFakeTimers()
    try {
      const never = new Promise<never>(() => undefined)
      const p = resolveGoOnlinePosition({ recent: async () => null, fresh: async () => { throw new Error('location_timeout') }, last: () => never }, { lookupCapMs: 500 })
      const assertion = expect(p).rejects.toThrow('no_location_available')
      await vi.advanceTimersByTimeAsync(600)
      await assertion
    } finally { vi.useRealTimers() }
  })

  it('treats a lookup that throws immediately as no fix', async () => {
    const out = await resolveGoOnlinePosition({
      recent: () => { throw new Error('sync boom') },
      fresh: async () => P(2),
      last: async () => P(3),
    })
    expect(out).toEqual(P(2))
  })
})
