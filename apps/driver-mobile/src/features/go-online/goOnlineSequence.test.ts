import { describe, it, expect, vi } from 'vitest'
import { runGoOnline, type GoOnlineDeps } from './goOnlineSequence'

// Value: protects=the driver reaches Home as soon as the server says they are online, background tracking is started without holding the
// screen, a tracking failure is retried and reported instead of showing "Failed to go online" for a live session, and a server refusal
// leaves nothing half-done; fails_when=a step is awaited that should not be, or its order changes; why_new=the go-online hook cannot be
// rendered in tests, so its sequence is a plain function; seam=none (every effect is injected); no_claim=that tracking really starts.

function deps(over: Partial<GoOnlineDeps> = {}): GoOnlineDeps & { calls: string[] } {
  const calls: string[] = []
  const d: GoOnlineDeps = {
    getPosition: async () => ({ coords: { latitude: 21, longitude: 86 } }),
    callApi: async (p) => { calls.push(`api:${p.lat},${p.lng}`); return { id: 's1' } },
    markOnline: (id) => { calls.push(`online:${id}`) },
    connectSocket: () => { calls.push('socket') },
    goHome: () => { calls.push('home') },
    afterOnline: () => { calls.push('after') },
    startTracking: async () => { calls.push('tracking') },
    reportTrackingFailure: () => { calls.push('report') },
    defaultPosition: { lat: 20.29, lng: 85.82 },
    retryDelayMs: 0,
    wait: async () => undefined,
    ...over,
  }
  return Object.assign(d, { calls })
}

describe('runGoOnline', () => {
  it('goes online, opens the socket and shows Home in that order', async () => {
    const d = deps()
    const out = await runGoOnline(d)
    await out.tracking
    expect(d.calls.slice(0, 5)).toEqual(['api:21,86', 'online:s1', 'socket', 'home', 'after'])
    expect(out.locationWarning).toBe(false)
  })

  it('shows Home without waiting for background tracking to start', async () => {
    let release: () => void = () => undefined
    const d = deps({ startTracking: () => new Promise<void>((r) => { release = r }) })
    const out = await runGoOnline(d) // resolves although startTracking is still pending
    expect(d.calls).toContain('home')
    release()
    await out.tracking
  })

  it('refuses without side effects when the server refuses', async () => {
    const d = deps({ callApi: async () => { throw new Error('DAILY_CHECK_REQUIRED') } })
    await expect(runGoOnline(d)).rejects.toThrow('DAILY_CHECK_REQUIRED')
    expect(d.calls).toEqual([])
  })

  it('uses the default position and says so when no position is available', async () => {
    const d = deps({ getPosition: async () => { throw new Error('no_location_available') } })
    const out = await runGoOnline(d)
    await out.tracking
    expect(d.calls[0]).toBe('api:20.29,85.82')
    expect(out.locationWarning).toBe(true)
  })

  it('retries a failed tracking start once and does not report when the retry works', async () => {
    let n = 0
    const d = deps({ startTracking: async () => { n++; if (n === 1) throw new Error('fgs'); d.calls.push('tracking') } })
    const out = await runGoOnline(d)
    await out.tracking
    expect(n).toBe(2)
    expect(d.calls).not.toContain('report')
  })

  it('reports a tracking failure that persists, without failing the go-online', async () => {
    const report = vi.fn()
    const d = deps({ startTracking: async () => { throw new Error('fgs') }, reportTrackingFailure: report })
    const out = await runGoOnline(d)
    await expect(out.tracking).resolves.toBeUndefined()
    expect(report).toHaveBeenCalledTimes(1)
    expect(d.calls).toContain('home')
  })
})
