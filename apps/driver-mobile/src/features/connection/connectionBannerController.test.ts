import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createConnectionBannerController, SHOW_AFTER_MS, RESTORED_VISIBLE_MS, type ConnectionBannerKind } from './connectionBannerController'

let seen: ConnectionBannerKind[]
const make = () => createConnectionBannerController((k) => seen.push(k))

beforeEach(() => { vi.useFakeTimers(); seen = [] })
afterEach(() => { vi.useRealTimers() })

describe('connection banner timing', () => {
  it('stays quiet while connected', () => {
    const c = make(); c.setActive(true); c.setConnected(true)
    vi.advanceTimersByTime(60_000)
    expect(seen).toEqual([])
  })

  it('a short blip never shows anything (a tunnel, a signal flicker)', () => {
    const c = make(); c.setActive(true)
    c.setConnected(false)
    vi.advanceTimersByTime(SHOW_AFTER_MS - 1)
    c.setConnected(true)
    vi.advanceTimersByTime(60_000)
    expect(seen).toEqual([])
  })

  it('shows "lost" only after the connection has been down for the full delay', () => {
    const c = make(); c.setActive(true); c.setConnected(false)
    vi.advanceTimersByTime(SHOW_AFTER_MS)
    expect(seen).toEqual(['lost'])
  })

  it('moves to "reconnecting" when the app retries, then "restored" and hides itself', () => {
    const c = make(); c.setActive(true); c.setConnected(false)
    vi.advanceTimersByTime(SHOW_AFTER_MS)
    c.reconnectAttempt()
    c.setConnected(true)
    vi.advanceTimersByTime(RESTORED_VISIBLE_MS)
    expect(seen).toEqual(['lost', 'reconnecting', 'restored', 'hidden'])
  })

  it('"restored" only follows a banner that was actually shown', () => {
    const c = make(); c.setActive(true); c.setConnected(false)
    vi.advanceTimersByTime(1000)
    c.setConnected(true)
    vi.advanceTimersByTime(10_000)
    expect(seen).not.toContain('restored')
  })

  it('a retry before the banner is shown does not skip ahead', () => {
    const c = make(); c.setActive(true); c.setConnected(false)
    c.reconnectAttempt()
    expect(seen).toEqual([])
  })

  it('shows nothing when the driver is not online or the app is in the background', () => {
    const c = make(); c.setActive(false); c.setConnected(false)
    vi.advanceTimersByTime(60_000)
    expect(seen).toEqual([])
  })

  it('going to the background hides a banner that is showing', () => {
    const c = make(); c.setActive(true); c.setConnected(false)
    vi.advanceTimersByTime(SHOW_AFTER_MS)
    c.setActive(false)
    expect(seen).toEqual(['lost', 'hidden'])
  })

  it('dropping again while "restored" is showing goes straight back to counting down', () => {
    const c = make(); c.setActive(true); c.setConnected(false)
    vi.advanceTimersByTime(SHOW_AFTER_MS)
    c.setConnected(true)               // restored
    c.setConnected(false)              // flaps
    expect(seen.at(-1)).toBe('hidden')
    vi.advanceTimersByTime(SHOW_AFTER_MS)
    expect(seen.at(-1)).toBe('lost')
  })

  it('dispose cancels pending timers', () => {
    const c = make(); c.setActive(true); c.setConnected(false)
    c.dispose()
    vi.advanceTimersByTime(60_000)
    expect(seen).toEqual([])
  })
})
