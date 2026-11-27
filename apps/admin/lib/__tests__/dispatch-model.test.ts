import { describe, it, expect } from 'vitest'
import { fmtDuration, dispatchState, relativeTo, earlyAssignWarning, reservationNote } from '../dispatch-model'

const NOW = new Date('2026-11-23T10:00:00Z').getTime()
const at = (minutesFromNow: number) => new Date(NOW + minutesFromNow * 60_000).toISOString()

describe('fmtDuration', () => {
  it.each([
    [30_000, 'under 1m'], [5 * 60_000, '5m'], [60 * 60_000, '1h'], [130 * 60_000, '2h 10m'],
    [24 * 3_600_000, '1d'], [28 * 3_600_000, '1d 4h'], [-12 * 60_000, '12m'],
  ])('%i ms is %s', (ms, out) => { expect(fmtDuration(ms)).toBe(out) })
})

describe('dispatchState: scheduled rides', () => {
  it('far ahead is quiet', () => {
    expect(dispatchState({ status: 'scheduled', dispatch_at: at(300) }, NOW)).toMatchObject({ kind: 'scheduled', tone: 'muted', label: 'Dispatches in 5h' })
  })
  it('within the hour is highlighted', () => {
    expect(dispatchState({ status: 'scheduled', dispatch_at: at(40) }, NOW)).toMatchObject({ kind: 'due_soon', tone: 'info', label: 'Dispatches in 40m' })
  })
  it('a dispatch time that just passed is "dispatching now", not an error yet', () => {
    expect(dispatchState({ status: 'scheduled', dispatch_at: at(-2) }, NOW).kind).toBe('dispatching')
  })
  it('five minutes late means the sweep missed it', () => {
    expect(dispatchState({ status: 'scheduled', dispatch_at: at(-12) }, NOW)).toMatchObject({ kind: 'overdue', tone: 'danger', label: 'Overdue by 12m' })
  })
})

describe('dispatchState: rides that should have a driver', () => {
  it('searching turns red after five minutes', () => {
    expect(dispatchState({ status: 'requested', dispatch_at: at(-3) }, NOW)).toMatchObject({ kind: 'searching', tone: 'warning', label: 'Searching for 3m' })
    expect(dispatchState({ status: 'requested', dispatch_at: at(-9) }, NOW).tone).toBe('danger')
  })
  it('no drivers says how long ago', () => {
    expect(dispatchState({ status: 'no_drivers', dispatch_at: at(-45) }, NOW)).toMatchObject({ kind: 'no_drivers', label: 'No drivers, 45m ago' })
  })
})

describe('relativeTo', () => {
  it('reads both directions', () => {
    expect(relativeTo(at(130), NOW)).toBe('in 2h 10m')
    expect(relativeTo(at(-5), NOW)).toBe('5m ago')
  })
})

describe('earlyAssignWarning', () => {
  it('warns when an advance booking is a long way from dispatch, and says what assigning does', () => {
    const w = earlyAssignWarning({ status: 'scheduled', dispatch_at: at(300), scheduled_for: at(315) }, NOW)!
    expect(w).toMatch(/reserves them/)
    expect(w).toMatch(/stay free for other rides/)
    expect(w).not.toMatch(/online right now/)
    expect(w).toMatch(/5h/)
  })
  it('stays quiet when dispatch is imminent or has passed', () => {
    expect(earlyAssignWarning({ status: 'scheduled', dispatch_at: at(8), scheduled_for: at(23) }, NOW)).toBeNull()
    expect(earlyAssignWarning({ status: 'scheduled', dispatch_at: at(-20), scheduled_for: at(-5) }, NOW)).toBeNull()
  })
  it('never warns for a ride that is already in dispatch', () => {
    expect(earlyAssignWarning({ status: 'no_drivers', dispatch_at: at(-30), scheduled_for: null }, NOW)).toBeNull()
    expect(earlyAssignWarning({ status: 'requested', dispatch_at: at(-30), scheduled_for: null }, NOW)).toBeNull()
  })
})

describe('reservationNote', () => {
  const base = { reserved_driver_id: '9', reserved_driver_name: 'Ravi', scheduled_for: at(300) }
  it('is null when nobody is reserved', () => {
    expect(reservationNote({ reserved_driver_id: null }, NOW)).toBeNull()
    expect(reservationNote({}, NOW)).toBeNull()
  })
  it('says confirmed (ok), or not confirmed yet (a warning far ahead, urgent inside the hour)', () => {
    expect(reservationNote({ ...base, reservation_confirmed_at: at(-5) }, NOW)).toEqual({ text: 'Ravi reserved: confirmed', tone: 'ok' })
    expect(reservationNote(base, NOW)).toEqual({ text: 'Ravi reserved: not confirmed yet', tone: 'warn' })
    expect(reservationNote({ ...base, scheduled_for: at(45) }, NOW)?.tone).toBe('danger')
  })
  it('an at-risk alert outranks everything, even a confirmation', () => {
    expect(reservationNote({ ...base, reservation_confirmed_at: at(-5), reservation_risk_alerted_at: at(-1) }, NOW)).toEqual({ text: 'Ravi reserved: at risk', tone: 'danger' })
  })
})
