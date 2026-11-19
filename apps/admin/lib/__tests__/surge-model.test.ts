import { describe, it, expect } from 'vitest'
import { surgeState, surgePct, fareAfterSurge, formatDuration, toLocalInput, presetWindow, windowLabel } from '../surge-model'

const at = (h: number, m = 0, day = 19) => new Date(2026, 10, day, h, m)

describe('surgeState', () => {
  const s = (status: string, start: Date, end: Date) => ({ status, starts_at: start.toISOString(), ends_at: end.toISOString() })
  it('is live inside the window even though the server keeps the status "scheduled"', () => {
    expect(surgeState(s('scheduled', at(7), at(11)), at(9).getTime())).toBe('live')
  })
  it('is upcoming before the window and ended after it', () => {
    expect(surgeState(s('scheduled', at(7), at(11)), at(6).getTime())).toBe('upcoming')
    expect(surgeState(s('scheduled', at(7), at(11)), at(11).getTime())).toBe('ended')
  })
  it('cancelled wins over the clock', () => {
    expect(surgeState(s('cancelled', at(7), at(11)), at(9).getTime())).toBe('cancelled')
  })
})

describe('fare preview', () => {
  it('shows the percentage and the surged fare', () => {
    expect(surgePct(1.5)).toBe(50)
    expect(surgePct(1.25)).toBe(25)
    expect(fareAfterSurge(500, 1.5)).toBe(750)
    expect(fareAfterSurge(333, 1.2)).toBe(400)
  })
})

describe('time helpers', () => {
  it('formats durations', () => {
    expect(formatDuration(45 * 60_000)).toBe('45 min')
    expect(formatDuration(4 * 3_600_000)).toBe('4 h')
    expect(formatDuration(90 * 60_000)).toBe('1 h 30 min')
    expect(formatDuration(27 * 3_600_000)).toBe('1 d 3 h')
    expect(formatDuration(-5)).toBe('0 min')
  })
  it('round-trips a local time through the datetime-local format', () => {
    expect(toLocalInput(at(7, 26))).toBe('2026-11-19T07:26')
  })
  it('builds a preset window that starts now', () => {
    expect(presetWindow(at(7, 26), 4)).toEqual({ starts_at: '2026-11-19T07:26', ends_at: '2026-11-19T11:26' })
  })
  it('labels a same-day window and one that crosses midnight', () => {
    const now = at(8)
    expect(windowLabel(at(7, 26).toISOString(), at(11, 26).toISOString(), now)).toBe('Today 7:26 AM to 11:26 AM')
    expect(windowLabel(at(22).toISOString(), at(3, 30, 20).toISOString(), now)).toBe('Today 10:00 PM to Tomorrow 3:30 AM')
  })
})
