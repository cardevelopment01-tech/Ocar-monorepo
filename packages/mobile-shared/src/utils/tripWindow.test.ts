import { describe, expect, it } from 'vitest'
import cases from './tripWindow.cases.json'
import { formatClock, formatTimeLeft, tripWindow, tripWindowCopy } from './tripWindow'

// The same table runs in apps/driver and apps/user (their copies of tripWindow.ts), so all four
// clients cross each boundary at the same instant.
describe('tripWindow boundary table', () => {
  const base = new Date(cases.bookedUntil).getTime()
  it.each(cases.inputs)('$name', (c) => {
    const input = {
      bookedUntil: 'bookedUntil' in c ? c.bookedUntil : cases.bookedUntil,
      graceMin: 'graceMin' in c ? c.graceMin : cases.graceMin,
      overtimeRate: 'overtimeRate' in c ? c.overtimeRate : cases.overtimeRate,
      now: base + c.nowOffsetMs,
    }
    expect(tripWindow(input)).toEqual(c.expect)
  })
})

describe('formatting', () => {
  it('time left rounds up to a started minute and drops zero parts', () => {
    expect(formatTimeLeft(200 * 60_000)).toBe('3h 20m')
    expect(formatTimeLeft(2 * 3_600_000)).toBe('2h')
    expect(formatTimeLeft(12 * 60_000)).toBe('12 min')
    expect(formatTimeLeft(1)).toBe('1 min')
  })
  it('clock is m:ss', () => {
    expect(formatClock(252_000)).toBe('4:12')
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(-5)).toBe('0:00')
  })
})

describe('tripWindowCopy', () => {
  const rupees = (n: number) => `₹${n}`
  it('driver and rider words per state, icon and tone never rely on colour alone', () => {
    const grace = { kind: 'grace', msToOvertime: 252_000 } as const
    expect(tripWindowCopy(grace, 'driver', { rupees })).toMatchObject({
      icon: 'bell', tone: 'warning', label: 'Booked time ended · Overtime starts in', value: '4:12',
    })
    expect(tripWindowCopy(grace, 'rider', { rupees })).toMatchObject({ label: 'Extra time starts in', value: '4:12' })

    const ot = { kind: 'overtime', overtimeMs: 12_000, billedMin: 1, amount: 4 } as const
    expect(tripWindowCopy(ot, 'driver', { rupees })).toMatchObject({ icon: 'plus-circle', label: 'Overtime', value: '0:12 · ₹4' })
    expect(tripWindowCopy(ot, 'rider', { rupees })).toMatchObject({ label: 'Extra time', value: '0:12 · ₹4 so far' })
  })
  it('rider sees the rate from the final 15 minutes on; the driver does not', () => {
    const final = { kind: 'final', msLeft: 12 * 60_000 } as const
    expect(tripWindowCopy(final, 'rider', { rupees, overtimeRate: 60 })?.note).toBe('Extra time is ₹60 an hour, billed by the minute.')
    expect(tripWindowCopy(final, 'driver', { rupees, overtimeRate: 60 })?.note).toBeUndefined()
  })
  it('none has no copy', () => {
    expect(tripWindowCopy({ kind: 'none' }, 'driver', { rupees })).toBeNull()
  })
})
