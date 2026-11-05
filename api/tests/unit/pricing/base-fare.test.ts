import { describe, it, expect } from 'vitest'
import { calculateFare, type FareInput } from '@/lib/fare'

const card = { rate_per_km: 10, rate_per_min: 1, min_fare: 500, km_per_day: 300, driver_allowance_per_day: 0 }
const base = (o: Partial<FareInput> & { base_fare?: number }): FareInput => ({
  rate_card: { ...card, ...(o.base_fare != null ? { base_fare: o.base_fare } : {}), ...(o.rate_card ?? {}) },
  ride_type: 'one_way', is_return_cab: false, estimated_km: 100, estimated_min: 0,
  stop_count: 0, charge_per_stop: 0, trip_hours: 0, surge_multiplier: 1, ...o,
})

describe('rate card base_fare', () => {
  it('is 0 / omitted: fare unchanged', () => {
    expect(calculateFare(base({})).total).toBe(1000)
    expect(calculateFare(base({ base_fare: 0 })).total).toBe(1000)
  })
  it('one-way: added on top of the km fare, shown as base_fare', () => {
    const f = calculateFare(base({ base_fare: 100 }))
    expect(f.total).toBe(1100)
    expect(f.base_fare).toBe(100)
  })
  it('one-way: stacks with the min-fare top-up and is surged', () => {
    const f = calculateFare(base({ base_fare: 100, estimated_km: 10, surge_multiplier: 2 }))
    // floored 500 + base 100 = 600, surge doubles
    expect(f.subtotal).toBe(600)
    expect(f.total).toBe(1200)
    expect(f.base_fare).toBe(100 + 400) // base + min-fare top-up
  })
  it('round-trip package: added once; lines add up to the total', () => {
    const f = calculateFare(base({ base_fare: 150, ride_type: 'round_trip', estimated_km: 200, trip_hours: 10 }))
    expect(f.total).toBe(300 * 10 + 150) // package 300km floor
    expect(f.base_fare + f.distance_fare + f.overage_fare + f.hour_surcharge + f.stop_fare).toBe(f.subtotal)
  })
  it('rental package fare ignores it', () => {
    const f = calculateFare(base({ base_fare: 150, ride_type: 'rental', package_fare: 800 }))
    expect(f.total).toBe(800)
  })
})
