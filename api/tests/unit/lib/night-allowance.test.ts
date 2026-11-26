import { describe, it, expect } from 'vitest'
import { countNights, earnsNightAllowance, nightAllowanceFor } from '@/lib/night-allowance'

// Times are written in IST (+05:30) so the cases read like a driver's clock.
const ist = (s: string) => new Date(`${s}+05:30`)

describe('countNights', () => {
  it('a daytime trip pays nothing', () => {
    expect(countNights(ist('2026-11-25T08:00:00'), ist('2026-11-25T18:00:00'))).toBe(0)
  })
  it('a trip that crosses 11 PM pays one night', () => {
    expect(countNights(ist('2026-11-25T21:00:00'), ist('2026-11-26T01:00:00'))).toBe(1)
  })
  it('a trip wholly inside the small hours pays one night (it started after 11 PM)', () => {
    expect(countNights(ist('2026-11-26T01:00:00'), ist('2026-11-26T04:00:00'))).toBe(1)
  })
  it('an overnight trip is one night, not two, even though it touches two calendar dates', () => {
    expect(countNights(ist('2026-11-25T22:00:00'), ist('2026-11-26T07:00:00'))).toBe(1)
  })
  it('a trip that runs through two nights pays twice', () => {
    expect(countNights(ist('2026-11-25T20:00:00'), ist('2026-11-27T08:00:00'))).toBe(2)
  })
  it('a three-day round trip with three nights pays three times', () => {
    expect(countNights(ist('2026-11-25T09:00:00'), ist('2026-11-28T09:00:00'))).toBe(3)
  })
  it('only touching the edge of the window pays nothing', () => {
    expect(countNights(ist('2026-11-25T20:00:00'), ist('2026-11-25T23:00:00'))).toBe(0)
    expect(countNights(ist('2026-11-26T06:00:00'), ist('2026-11-26T12:00:00'))).toBe(0)
  })
  it('one minute inside the window pays a night', () => {
    expect(countNights(ist('2026-11-25T20:00:00'), ist('2026-11-25T23:01:00'))).toBe(1)
    expect(countNights(ist('2026-11-26T05:59:00'), ist('2026-11-26T12:00:00'))).toBe(1)
  })
  it('does not depend on the server time zone: the same instant counts the same', () => {
    // 17:30 UTC is 23:00 IST; 19:00 UTC is 00:30 IST.
    expect(countNights(new Date('2026-11-25T17:30:00Z'), new Date('2026-11-25T19:00:00Z'))).toBe(1)
    expect(countNights(new Date('2026-11-25T01:00:00Z'), new Date('2026-11-25T05:00:00Z'))).toBe(0)
  })
  it('a missing, reversed or zero-length trip pays nothing', () => {
    expect(countNights(ist('2026-11-26T01:00:00'), ist('2026-11-25T23:30:00'))).toBe(0)
    expect(countNights(ist('2026-11-26T01:00:00'), ist('2026-11-26T01:00:00'))).toBe(0)
    expect(countNights(new Date('x'), ist('2026-11-26T01:00:00'))).toBe(0)
  })
})

describe('earnsNightAllowance', () => {
  it('one-way (which includes Return Cab) and round trip, in standard mode', () => {
    expect(earnsNightAllowance({ ride_type: 'one_way' })).toBe(true)
    expect(earnsNightAllowance({ ride_type: 'one_way', trip_mode: 'standard' })).toBe(true)
    expect(earnsNightAllowance({ ride_type: 'round_trip', trip_mode: 'standard' })).toBe(true)
  })
  it('not city rides and not rentals', () => {
    expect(earnsNightAllowance({ ride_type: 'one_way', trip_mode: 'city' })).toBe(false)
    expect(earnsNightAllowance({ ride_type: 'rental' })).toBe(false)
  })
})

describe('nightAllowanceFor', () => {
  const start = '2026-11-25T20:00:00+05:30'
  const ended = ist('2026-11-27T08:00:00') // two nights later
  it('charges nights x the rate on the card', () => {
    expect(nightAllowanceFor({ ride_type: 'round_trip', started_at: start, rate: 300 }, ended)).toEqual({ amount: 600, nights: 2 })
  })
  it('a Return Cab ride is a one-way booking, so it is charged like any one-way trip', () => {
    expect(nightAllowanceFor({ ride_type: 'one_way', trip_mode: 'standard', started_at: '2026-11-25T22:00:00+05:30', rate: 250 }, ist('2026-11-26T05:00:00'))).toEqual({ amount: 250, nights: 1 })
  })
  it('charges nothing on a card with no allowance (rate 0: every ride booked before it existed)', () => {
    expect(nightAllowanceFor({ ride_type: 'one_way', started_at: start, rate: 0 }, ended)).toEqual({ amount: 0, nights: 0 })
  })
  it('charges nothing on city rides and rentals, even at night', () => {
    expect(nightAllowanceFor({ ride_type: 'one_way', trip_mode: 'city', started_at: start, rate: 300 }, ended).amount).toBe(0)
    expect(nightAllowanceFor({ ride_type: 'rental', started_at: start, rate: 300 }, ended).amount).toBe(0)
  })
  it('charges nothing for a trip that never started, or one entirely in daylight', () => {
    expect(nightAllowanceFor({ ride_type: 'one_way', started_at: null, rate: 300 }, ended).amount).toBe(0)
    expect(nightAllowanceFor({ ride_type: 'one_way', started_at: '2026-11-25T09:00:00+05:30', rate: 300 }, ist('2026-11-25T15:00:00')).amount).toBe(0)
  })
  it('keeps paise exact on a fractional rate', () => {
    expect(nightAllowanceFor({ ride_type: 'one_way', started_at: start, rate: 99.99 }, ended).amount).toBe(199.98)
  })
})
