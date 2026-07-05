export interface RateCardInput {
  rate_per_km: number
  rate_per_min: number
  min_fare: number
  return_rate_per_km?: number | null
  hour_rate?: number | null
}

export interface FareInput {
  rate_card: RateCardInput
  ride_type: 'one_way' | 'round_trip' | 'rental'
  is_return_cab: boolean
  estimated_km: number
  estimated_min: number
  stop_count: number
  charge_per_stop: number
  trip_hours: number
  surge_multiplier: number
  overage_km?: number
  overage_min?: number
  extra_per_km?: number
  extra_per_min?: number
  package_fare?: number | null
}

export interface FareBreakdown {
  base_fare: number
  distance_fare: number
  time_fare: number
  stop_fare: number
  hour_surcharge: number
  overage_fare: number
  surge_fare: number
  subtotal: number
  total: number
}

export function calculateFare(input: FareInput): FareBreakdown {
  const {
    rate_card,
    ride_type,
    is_return_cab,
    estimated_km,
    estimated_min,
    stop_count,
    charge_per_stop,
    trip_hours,
    surge_multiplier,
    overage_km = 0,
    overage_min = 0,
    extra_per_km = 0,
    extra_per_min = 0,
    package_fare = null,
  } = input

  // ── Rental with fixed package ────────────────────────────
  if (ride_type === 'rental' && package_fare != null) {
    const overage_fare = round2(overage_km * extra_per_km + overage_min * extra_per_min)
    const subtotal     = round2(package_fare + overage_fare)
    const surge_fare   = round2(subtotal * (surge_multiplier - 1))
    const total        = round2(subtotal + surge_fare)
    return {
      base_fare: package_fare,
      distance_fare: 0,
      time_fare: 0,
      stop_fare: 0,
      hour_surcharge: 0,
      overage_fare,
      surge_fare,
      subtotal,
      total,
    }
  }

  // ── Standard calculation ─────────────────────────────────
  const per_km       = (is_return_cab && rate_card.return_rate_per_km)
    ? rate_card.return_rate_per_km
    : rate_card.rate_per_km

  // Round trip covers origin→destination→origin; charge both legs
  const effective_km   = ride_type === 'round_trip' ? estimated_km * 2 : estimated_km
  const distance_fare  = round2(effective_km * per_km)
  const time_fare      = round2(estimated_min * rate_card.rate_per_min)
  const stop_fare      = round2(stop_count    * charge_per_stop)
  const hour_surcharge = (ride_type === 'round_trip' && rate_card.hour_rate)
    ? round2(trip_hours * rate_card.hour_rate)
    : 0

  // Apply min_fare floor to distance+time only; stop and hour charges are always added
  const metered   = round2(distance_fare + time_fare)
  const floored   = round2(Math.max(metered, rate_card.min_fare))
  const subtotal  = round2(floored + stop_fare + hour_surcharge)
  const surge_fare = round2(subtotal * (surge_multiplier - 1))
  const total      = round2(subtotal + surge_fare)

  return {
    base_fare:     round2(Math.max(rate_card.min_fare - metered, 0)),
    distance_fare,
    time_fare,
    stop_fare,
    hour_surcharge,
    overage_fare:  0,
    surge_fare,
    subtotal,
    total,
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export function estimateFare(params: {
  rate_card: RateCardInput
  ride_type: 'one_way' | 'round_trip' | 'rental'
  is_return_cab: boolean
  distance_km: number
  duration_min: number
  stop_count?: number
  charge_per_stop?: number
  trip_hours?: number
  surge_multiplier?: number
  package_fare?: number | null
  extra_per_km?: number
  extra_per_min?: number
}): FareBreakdown {
  const input: FareInput = {
    rate_card:        params.rate_card,
    ride_type:        params.ride_type,
    is_return_cab:    params.is_return_cab,
    estimated_km:     params.distance_km,
    estimated_min:    params.duration_min,
    stop_count:       params.stop_count     ?? 0,
    charge_per_stop:  params.charge_per_stop ?? 0,
    trip_hours:       params.trip_hours      ?? 0,
    surge_multiplier: params.surge_multiplier ?? 1.0,
    extra_per_km:     params.extra_per_km    ?? 0,
    extra_per_min:    params.extra_per_min   ?? 0,
  }
  if (params.package_fare !== undefined) input.package_fare = params.package_fare
  return calculateFare(input)
}
