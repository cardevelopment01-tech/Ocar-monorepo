import { describe, it, expect } from 'vitest'
import { calculateFare } from '@/lib/fare'

const sedanCard = {
  rate_per_km: 10.00,
  rate_per_min: 1.20,
  min_fare: 80.00,
  return_rate_per_km: 8.00,
  hour_rate: 18.00,
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

  it('round_trip: hour_rate applied', () => {
    const result = calculateFare({
      rate_card: sedanCard, ride_type: 'round_trip', is_return_cab: false,
      estimated_km: 15, estimated_min: 28,
      stop_count: 0, charge_per_stop: 25, trip_hours: 4, surge_multiplier: 1.0,
    })
    // 183.6 + 4×18 = 183.6+72 = 255.6
    expect(result.hour_surcharge).toBe(72.00)
    expect(result.total).toBe(255.60)
  })

  it('round_trip: trip_hours=0 produces no hour_surcharge (clamp is service responsibility)', () => {
    const result = calculateFare({
      rate_card: sedanCard, ride_type: 'round_trip', is_return_cab: false,
      estimated_km: 15, estimated_min: 28,
      stop_count: 0, charge_per_stop: 0, trip_hours: 0, surge_multiplier: 1.0,
    })
    // calculateFare is pure — it does not clamp; clampTripHours in pricing.service does
    expect(result.hour_surcharge).toBe(0)
    expect(result.total).toBe(183.60)
  })

  it('round_trip: fractional trip_hours used as-is (no rounding in calculateFare)', () => {
    const result = calculateFare({
      rate_card: sedanCard, ride_type: 'round_trip', is_return_cab: false,
      estimated_km: 15, estimated_min: 28,
      stop_count: 0, charge_per_stop: 0, trip_hours: 5.5, surge_multiplier: 1.0,
    })
    // 183.6 + 5.5×18 = 183.6+99 = 282.6
    expect(result.hour_surcharge).toBe(99.00)
    expect(result.total).toBe(282.60)
  })

  it('round_trip: hour_surcharge + surge applied in correct order', () => {
    const result = calculateFare({
      rate_card: sedanCard, ride_type: 'round_trip', is_return_cab: false,
      estimated_km: 15, estimated_min: 28,
      stop_count: 0, charge_per_stop: 0, trip_hours: 6, surge_multiplier: 1.5,
    })
    // subtotal = 183.6 + 6×18 = 291.6; surge = 291.6×0.5 = 145.8; total = 437.4
    expect(result.hour_surcharge).toBe(108.00)
    expect(result.surge_fare).toBe(145.80)
    expect(result.total).toBe(437.40)
  })

  it('round_trip: card without hour_rate produces no hour_surcharge', () => {
    const cardNoHourRate = { ...sedanCard, hour_rate: null }
    const result = calculateFare({
      rate_card: cardNoHourRate, ride_type: 'round_trip', is_return_cab: false,
      estimated_km: 15, estimated_min: 28,
      stop_count: 0, charge_per_stop: 0, trip_hours: 8, surge_multiplier: 1.0,
    })
    expect(result.hour_surcharge).toBe(0)
    expect(result.total).toBe(183.60)
  })
})
