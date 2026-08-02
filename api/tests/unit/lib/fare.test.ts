import { describe, it, expect } from 'vitest'
import { calculateFare } from '@/lib/fare'

const sedanCard = {
  rate_per_km: 10.00,
  rate_per_min: 1.20,
  min_fare: 80.00,
  return_rate_per_km: 8.00,
  hour_rate: 18.00,
  km_per_day: 250,
  driver_allowance_per_day: 300,
}

describe('calculateFare', () => {
  it('one_way: short ride uses min_fare floor', () => {
    const result = calculateFare({
      rate_card: sedanCard, ride_type: 'one_way', is_return_cab: false,
      estimated_km: 2, estimated_min: 10,
      stop_count: 0, charge_per_stop: 25, trip_hours: 0, surge_multiplier: 1.0,
    })
    // 2×10 + 10×1.2 = 32 < min_fare 80 → total = 80
    expect(result.total).toBe(80.00)
  })

  it('one_way: long ride exceeds min_fare', () => {
    const result = calculateFare({
      rate_card: sedanCard, ride_type: 'one_way', is_return_cab: false,
      estimated_km: 15, estimated_min: 28,
      stop_count: 0, charge_per_stop: 25, trip_hours: 0, surge_multiplier: 1.0,
    })
    // 15×10 + 28×1.2 = 150+33.6 = 183.6
    expect(result.total).toBe(183.60)
    expect(result.distance_fare).toBe(150.00)
    expect(result.time_fare).toBe(33.60)
  })

  it('one_way: surge multiplier applied correctly', () => {
    const result = calculateFare({
      rate_card: sedanCard, ride_type: 'one_way', is_return_cab: false,
      estimated_km: 15, estimated_min: 28,
      stop_count: 0, charge_per_stop: 25, trip_hours: 0, surge_multiplier: 1.5,
    })
    // subtotal = 183.6, surge = 183.6×0.5 = 91.8, total = 275.4
    expect(result.total).toBe(275.40)
    expect(result.surge_fare).toBe(91.80)
  })

  it('one_way: return_cab uses discounted rate', () => {
    const result = calculateFare({
      rate_card: sedanCard, ride_type: 'one_way', is_return_cab: true,
      estimated_km: 15, estimated_min: 28,
      stop_count: 0, charge_per_stop: 25, trip_hours: 0, surge_multiplier: 1.0,
    })
    // 15×8 + 28×1.2 = 120+33.6 = 153.6
    expect(result.total).toBe(153.60)
    expect(result.distance_fare).toBe(120.00)
  })

  it('one_way: stop charges added correctly', () => {
    const result = calculateFare({
      rate_card: sedanCard, ride_type: 'one_way', is_return_cab: false,
      estimated_km: 15, estimated_min: 28,
      stop_count: 2, charge_per_stop: 25, trip_hours: 0, surge_multiplier: 1.0,
    })
    // 183.6 + 2×25 = 233.6
    expect(result.stop_fare).toBe(50.00)
    expect(result.total).toBe(233.60)
  })

  it('rental: uses package_fare with no overage', () => {
    const result = calculateFare({
      rate_card: sedanCard, ride_type: 'rental', is_return_cab: false,
      estimated_km: 20, estimated_min: 120,
      stop_count: 0, charge_per_stop: 0, trip_hours: 0, surge_multiplier: 1.0,
      package_fare: 280.00, extra_per_km: 12.00, extra_per_min: 1.50,
      overage_km: 0, overage_min: 0,
    })
    expect(result.total).toBe(280.00)
    expect(result.overage_fare).toBe(0)
  })

  it('rental: overage km and min charged correctly', () => {
    const result = calculateFare({
      rate_card: sedanCard, ride_type: 'rental', is_return_cab: false,
      estimated_km: 20, estimated_min: 120,
      stop_count: 0, charge_per_stop: 0, trip_hours: 0, surge_multiplier: 1.0,
      package_fare: 280.00, extra_per_km: 12.00, extra_per_min: 1.50,
      overage_km: 5, overage_min: 10,
    })
    // overage = 5×12 + 10×1.5 = 60+15 = 75, total = 355
    expect(result.overage_fare).toBe(75.00)
    expect(result.total).toBe(355.00)
  })

  it('rental: surge applied on top of package_fare + overage', () => {
    const result = calculateFare({
      rate_card: sedanCard, ride_type: 'rental', is_return_cab: false,
      estimated_km: 20, estimated_min: 120,
      stop_count: 0, charge_per_stop: 0, trip_hours: 0, surge_multiplier: 1.5,
      package_fare: 200.00, extra_per_km: 10.00, extra_per_min: 1.00,
      overage_km: 10, overage_min: 0,
    })
    // subtotal = 200 + 10×10 = 300; surge = 300×0.5 = 150; total = 450
    expect(result.overage_fare).toBe(100.00)
    expect(result.surge_fare).toBe(150.00)
    expect(result.total).toBe(450.00)
  })

  it('rental: zero-distance booking (estimate at booking time) uses package_fare only', () => {
    const result = calculateFare({
      rate_card: sedanCard, ride_type: 'rental', is_return_cab: false,
      estimated_km: 0, estimated_min: 0,
      stop_count: 0, charge_per_stop: 0, trip_hours: 0, surge_multiplier: 1.0,
      package_fare: 350.00, extra_per_km: 12.00, extra_per_min: 1.50,
      overage_km: 0, overage_min: 0,
    })
    // At booking time distance=0 — no distance/time fare, just package
    expect(result.distance_fare).toBe(0)
    expect(result.time_fare).toBe(0)
    expect(result.overage_fare).toBe(0)
    expect(result.total).toBe(350.00)
  })

  it('rental: missing package_fare falls back to distance+time fare', () => {
    const result = calculateFare({
      rate_card: sedanCard, ride_type: 'rental', is_return_cab: false,
      estimated_km: 15, estimated_min: 28,
      stop_count: 0, charge_per_stop: 0, trip_hours: 0, surge_multiplier: 1.0,
      // no package_fare supplied → falls back to distance+time
    })
    // 15×10 + 28×1.2 = 150+33.6 = 183.6 ≥ min_fare 80
    expect(result.total).toBe(183.60)
    expect(result.overage_fare).toBe(0)
  })

  it('round_trip: actual km under package allowance still bills the guaranteed minimum (GMB)', () => {
    const result = calculateFare({
      rate_card: sedanCard, ride_type: 'round_trip', is_return_cab: false,
      estimated_km: 180, estimated_min: 300,
      stop_count: 0, charge_per_stop: 0, trip_hours: 4, surge_multiplier: 1.0,
    })
    // days = ceil(4/24) = 1, packageKm = 250. 180 < 250 → billed at packageKm.
    expect(result.distance_fare).toBe(2500.00)
    expect(result.overage_km).toBe(0)
    expect(result.overage_fare).toBe(0)
    expect(result.hour_surcharge).toBe(300.00)
    expect(result.total).toBe(2800.00)
  })

  it('round_trip: km beyond the package allowance is billed as overage', () => {
    const result = calculateFare({
      rate_card: sedanCard, ride_type: 'round_trip', is_return_cab: false,
      estimated_km: 300, estimated_min: 400,
      stop_count: 0, charge_per_stop: 0, trip_hours: 4, surge_multiplier: 1.0,
    })
    // packageKm = 250, overage = 300-250 = 50km × ₹10
    expect(result.distance_fare).toBe(2500.00)
    expect(result.overage_km).toBe(50)
    expect(result.overage_fare).toBe(500.00)
    expect(result.total).toBe(3300.00)
  })

  it('round_trip: multi-day trip scales package km and driver allowance by day count', () => {
    const result = calculateFare({
      rate_card: sedanCard, ride_type: 'round_trip', is_return_cab: false,
      estimated_km: 400, estimated_min: 600,
      stop_count: 0, charge_per_stop: 0, trip_hours: 30, surge_multiplier: 1.0,
    })
    // days = ceil(30/24) = 2, packageKm = 500 (400 < 500, no overage)
    expect(result.distance_fare).toBe(5000.00)
    expect(result.hour_surcharge).toBe(600.00)
    expect(result.total).toBe(5600.00)
  })

  it('round_trip: card with no km_per_day/driver_allowance_per_day configured falls back to plain per-km billing', () => {
    const cardNoPackage = { ...sedanCard, km_per_day: null, driver_allowance_per_day: null }
    const result = calculateFare({
      rate_card: cardNoPackage, ride_type: 'round_trip', is_return_cab: false,
      estimated_km: 30, estimated_min: 40,
      stop_count: 0, charge_per_stop: 0, trip_hours: 4, surge_multiplier: 1.0,
    })
    expect(result.distance_fare).toBe(0)
    expect(result.overage_km).toBe(30)
    expect(result.overage_fare).toBe(300.00)
    expect(result.hour_surcharge).toBe(0)
    expect(result.total).toBe(300.00)
  })

  it('round_trip: min_fare floor still applies when package is unconfigured and distance is small', () => {
    const cardNoPackage = { ...sedanCard, km_per_day: null, driver_allowance_per_day: null }
    const result = calculateFare({
      rate_card: cardNoPackage, ride_type: 'round_trip', is_return_cab: false,
      estimated_km: 2, estimated_min: 10,
      stop_count: 0, charge_per_stop: 0, trip_hours: 4, surge_multiplier: 1.0,
    })
    expect(result.total).toBe(80.00)
  })

  it('round_trip: surge multiplier applies to the full subtotal including driver allowance', () => {
    const result = calculateFare({
      rate_card: sedanCard, ride_type: 'round_trip', is_return_cab: false,
      estimated_km: 180, estimated_min: 300,
      stop_count: 0, charge_per_stop: 0, trip_hours: 6, surge_multiplier: 1.5,
    })
    expect(result.subtotal).toBe(2800.00)
    expect(result.surge_fare).toBe(1400.00)
    expect(result.total).toBe(4200.00)
  })

  it('round_trip: stop charges are added on top of the package fare', () => {
    const result = calculateFare({
      rate_card: sedanCard, ride_type: 'round_trip', is_return_cab: false,
      estimated_km: 180, estimated_min: 300,
      stop_count: 2, charge_per_stop: 25, trip_hours: 4, surge_multiplier: 1.0,
    })
    // 2500 (package) + 0 (overage) + 50 (stops) + 300 (allowance) = 2850
    expect(result.total).toBe(2850.00)
  })

  it('round_trip: overage_fare is computed from the unrounded overage km, not the displayed rounded value', () => {
    const result = calculateFare({
      rate_card: sedanCard, ride_type: 'round_trip', is_return_cab: false,
      estimated_km: 257.505, estimated_min: 400,
      stop_count: 0, charge_per_stop: 0, trip_hours: 4, surge_multiplier: 1.0,
    })
    // packageKm = 250. Raw overage = 257.505 - 250 = 7.505 (actually 7.5049999999999955 in
    // float64) × ₹10/km = 75.049999... → rounds to 75.05.
    // A two-pass implementation would round the km first (7.5049999... → 7.5 for display,
    // since it's below the .005 halfway point in float64) then multiply: 7.5 × 10 = 75.00 —
    // a cent off from the correct 75.05. This pins that overage_fare is derived from
    // estimated_km directly, not from the pre-rounded overage_km.
    expect(result.overage_km).toBe(7.5) // rounded for display
    expect(result.overage_fare).toBe(75.05) // from raw 7.5049999...km, not rounded 7.5km
    expect(result.total).toBe(2875.05) // 2500 + 75.05 + 300 allowance
  })
})
