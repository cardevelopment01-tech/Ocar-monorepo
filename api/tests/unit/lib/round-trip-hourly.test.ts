import { describe, it, expect } from 'vitest'
import { calculateFare, estimateFare, isHourlyRoundTrip, settleRoundTripOvertime } from '@/lib/fare'

// Round-trip booked window (pricing_version 2): same-day bookings are priced per booked hour.
// Version 1 / over-24h behavior is pinned by fare.test.ts (untouched).

const card = {
  rate_per_km: 10, rate_per_min: 1.2, min_fare: 80, return_rate_per_km: 8,
  hour_rate: 18, km_per_day: 250, driver_allowance_per_day: 300,
}

function quote(over: Partial<Parameters<typeof calculateFare>[0]> = {}) {
  return calculateFare({
    rate_card: card, ride_type: 'round_trip', is_return_cab: false,
    estimated_km: 10, estimated_min: 60, stop_count: 0, charge_per_stop: 0,
    trip_hours: 4, pricing_version: 2, surge_multiplier: 1, ...over,
  })
}

describe('v2 same-day hourly quote', () => {
  // total km 10 → 100 (above min_fare 80); 112 km → 1120
  it.each([
    [4, 10, 172], [8, 10, 244], [12, 10, 316], [24, 10, 532],
    [4, 112, 1192], [8, 112, 1264], [12, 112, 1336], [24, 112, 1552],
  ])('%sh x %skm = %s', (hours, km, total) => {
    const r = quote({ trip_hours: hours, estimated_km: km })
    expect(r.total).toBe(total)
    expect(r.waiting_fare).toBe(hours * 18)
    expect(r.hour_surcharge).toBe(0) // the per-day allowance is not part of the hourly model
  })

  it('quote grows with booked hours (the flat-price bug)', () => {
    expect(quote({ trip_hours: 8 }).total).toBeGreaterThan(quote({ trip_hours: 4 }).total)
  })

  it('short trip is floored at min_fare, waiting still added on top', () => {
    const r = quote({ estimated_km: 2 }) // 20 < min_fare 80
    expect(r.base_fare).toBe(60)
    expect(r.distance_fare).toBe(20)
    expect(r.total).toBe(152) // 80 + 4h x 18
  })

  it('surge applies to km, hours and stops together', () => {
    const r = quote({ stop_count: 2, charge_per_stop: 25, surge_multiplier: 1.5 })
    // (100 + 72 + 50) = 222, surge +111
    expect(r.subtotal).toBe(222)
    expect(r.surge_fare).toBe(111)
    expect(r.total).toBe(333)
  })

  it('estimateFare passes the version through', () => {
    const r = estimateFare({ rate_card: card, ride_type: 'round_trip', is_return_cab: false,
      distance_km: 10, duration_min: 60, trip_hours: 6, pricing_version: 2 })
    expect(r.waiting_fare).toBe(108)
  })
})

describe('legacy formula is untouched', () => {
  it('version 1 (or omitted) keeps the per-day package at any hours', () => {
    const v1 = quote({ pricing_version: 1, estimated_km: 180 })
    const omitted = calculateFare({
      rate_card: card, ride_type: 'round_trip', is_return_cab: false,
      estimated_km: 180, estimated_min: 300, stop_count: 0, charge_per_stop: 0,
      trip_hours: 4, surge_multiplier: 1,
    })
    expect(v1.total).toBe(2800)
    expect(omitted.total).toBe(2800)
    expect(v1.waiting_fare).toBeUndefined()
  })

  it('24h / 25h boundary: over 24h keeps the per-day package even at version 2', () => {
    const day = quote({ trip_hours: 24, estimated_km: 10 })
    const over = quote({ trip_hours: 25, estimated_km: 10 })
    expect(day.waiting_fare).toBe(432)
    expect(over.waiting_fare).toBeUndefined()
    // days = 2: packageKm 500 x 10 + allowance 600
    expect(over.total).toBe(5600)
  })

  it('a rate card without hour_rate falls back to the package formula', () => {
    const r = quote({ rate_card: { ...card, hour_rate: null }, estimated_km: 180 })
    expect(r.waiting_fare).toBeUndefined()
    expect(r.total).toBe(2800)
  })
})

describe('isHourlyRoundTrip', () => {
  it.each([
    [{ pricing_version: 2, trip_hours: 4, hour_rate: 18 }, true],
    [{ pricing_version: 2, trip_hours: 24, hour_rate: 18 }, true],
    [{ pricing_version: 2, trip_hours: 25, hour_rate: 18 }, false],
    [{ pricing_version: 1, trip_hours: 4, hour_rate: 18 }, false],
    [{ pricing_version: undefined, trip_hours: 4, hour_rate: 18 }, false],
    [{ pricing_version: 2, trip_hours: 4, hour_rate: null }, false],
    [{ pricing_version: 2, trip_hours: 4, hour_rate: 0 }, false],
    [{ pricing_version: 2, trip_hours: 0, hour_rate: 18 }, false],
  ])('%j -> %s', (input, expected) => {
    expect(isHourlyRoundTrip(input)).toBe(expected)
  })
})

describe('settleRoundTripOvertime (6h booked, grace 5 min)', () => {
  const start = new Date('2026-10-01T06:00:00Z')
  const at = (mins: number, secs = 0) => new Date(start.getTime() + (mins * 60 + secs) * 1000)
  const settle = (completed: Date) =>
    settleRoundTripOvertime({ started_at: start, completed_at: completed, booked_hours: 6, hour_rate: 18 })

  it('finishing early or on time bills no overtime (and never refunds)', () => {
    expect(settle(at(120)).overtime_min).toBe(0)
    expect(settle(at(360)).overtime_fare).toBe(0)
  })

  it('inside the grace and exactly at its boundary: nothing', () => {
    expect(settle(at(363)).overtime_min).toBe(0)
    expect(settle(at(365)).overtime_min).toBe(0)
  })

  it('one second past the grace bills a started minute', () => {
    const r = settle(at(365, 1))
    expect(r.overtime_min).toBe(1)
    expect(r.overtime_fare).toBe(0.3) // 18 / 60
  })

  it('per-minute amount after the grace', () => {
    const r = settle(at(380)) // 15 min past the grace
    expect(r.overtime_min).toBe(15)
    expect(r.overtime_fare).toBe(4.5)
  })

  it('flags above 60 billed minutes, still billed in full; 60 exactly is not flagged', () => {
    const sixty = settle(at(425))
    expect(sixty.overtime_min).toBe(60)
    expect(sixty.review_reason).toBeNull()
    const over = settle(at(426))
    expect(over.overtime_min).toBe(61)
    expect(over.overtime_fare).toBe(18.3)
    expect(over.review_reason).toMatch(/over 60 minutes/i)
  })

  it('accepts ISO strings from the database', () => {
    const r = settleRoundTripOvertime({
      started_at: '2026-10-01T06:00:00Z', completed_at: '2026-10-01T12:20:00Z', booked_hours: 6, hour_rate: 18,
    })
    expect(r.overtime_min).toBe(15)
  })
})
