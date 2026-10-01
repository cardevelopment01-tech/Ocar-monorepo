import { describe, it, expect } from 'vitest'
import { tripWindowFields, withTripWindow } from '@/lib/trip-window'
import { ROUND_TRIP_OVERTIME_GRACE_MIN } from '@/constants/limits'

const STARTED = '2026-10-01T06:00:00.000Z'
const hourly = {
  ride_type: 'round_trip', status: 'in_progress', started_at: STARTED, trip_hours: 6,
  pricing_version: 2, round_trip_hour_rate: 60,
}

describe('tripWindowFields', () => {
  it('hourly round trip: bookedUntil = started_at + booked hours, rate and grace from the server', () => {
    expect(tripWindowFields(hourly)).toEqual({
      bookedUntil: '2026-10-01T12:00:00.000Z',
      overtimeRate: 60,
      overtimeGraceMin: ROUND_TRIP_OVERTIME_GRACE_MIN,
      overtimeMin: null,
      overtimeFare: null,
    })
  })

  it('bookedUntil is null until the trip starts, but the rate and grace are already known', () => {
    const f = tripWindowFields({ ...hourly, status: 'accepted', started_at: null })
    expect(f.bookedUntil).toBeNull()
    expect(f.overtimeGraceMin).toBe(ROUND_TRIP_OVERTIME_GRACE_MIN)
  })

  it('accepts a Date and numeric strings from pg', () => {
    const f = tripWindowFields({ ...hourly, started_at: new Date(STARTED), trip_hours: '6.00', round_trip_hour_rate: '60.00' })
    expect(f.bookedUntil).toBe('2026-10-01T12:00:00.000Z')
    expect(f.overtimeRate).toBe(60)
  })

  it('settled overtime appears only once the ride is completed', () => {
    const live = tripWindowFields({ ...hourly, overtime_min: 9, overtime_fare: '9.00' })
    expect(live.overtimeMin).toBeNull()
    const done = tripWindowFields({ ...hourly, status: 'completed', overtime_min: 9, overtime_fare: '9.00' })
    expect(done.overtimeMin).toBe(9)
    expect(done.overtimeFare).toBe(9)
  })

  it.each([
    ['one_way', { ride_type: 'one_way' }],
    ['rental', { ride_type: 'rental' }],
    ['legacy version 1', { pricing_version: 1 }],
    ['over 24h', { trip_hours: 30 }],
    ['no hour_rate', { round_trip_hour_rate: null }],
  ])('%s has no window: every field is null (no clock)', (_name, over) => {
    expect(tripWindowFields({ ...hourly, ...over })).toEqual({
      bookedUntil: null, overtimeRate: null, overtimeGraceMin: null, overtimeMin: null, overtimeFare: null,
    })
  })

  it('withTripWindow keeps every existing ride field', () => {
    const out = withTripWindow({ ...hourly, id: 7, driver_name: 'A' })
    expect(out).toMatchObject({ id: 7, driver_name: 'A', bookedUntil: '2026-10-01T12:00:00.000Z' })
  })
})
