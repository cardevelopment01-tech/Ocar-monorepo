export interface RateCardInput {
  rate_per_km: number
  rate_per_min: number
  min_fare: number
  return_rate_per_km?: number | null
  /** @deprecated for round_trip — see km_per_day / driver_allowance_per_day */
  hour_rate?: number | null
  /** round_trip only: guaranteed-minimum km billed per day. */
  km_per_day?: number | null
  /** round_trip only: flat per-day driver bata (food/stay). */
  driver_allowance_per_day?: number | null
}

export interface FareInput {
  rate_card: RateCardInput
  ride_type: 'one_way' | 'round_trip' | 'rental'
  is_return_cab: boolean
  /**
   * one_way/rental: the leg distance.
   * round_trip: the TOTAL to-and-fro km to bill — callers double the one-way
   * leg distance themselves for the booking-time estimate (see
   * pricing.service.ts); at trip completion this is the driver-app-reported
   * actual total driven km, already a round-trip total.
   */
  estimated_km: number
  estimated_min: number
  stop_count: number
  charge_per_stop: number
  /**
   * round_trip: hours to bill for. Booked trip_hours at estimate time,
   * actual elapsed hours (actual_duration_min / 60) at completion.
   */
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
  /** round_trip: holds the per-day driver allowance (days × driver_allowance_per_day). */
  hour_surcharge: number
  overage_fare: number
  surge_fare: number
  subtotal: number
  total: number
  /** round_trip only: km driven beyond the guaranteed package allowance (display). */
  overage_km?: number
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
    overage_km: rentalOverageKm = 0,
    overage_min: rentalOverageMin = 0,
    extra_per_km = 0,
    extra_per_min = 0,
    package_fare = null,
  } = input

  // ── Rental with fixed package ────────────────────────────
  if (ride_type === 'rental' && package_fare != null) {
    const overage_fare = round2(rentalOverageKm * extra_per_km + rentalOverageMin * extra_per_min)
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

  const per_km = (is_return_cab && rate_card.return_rate_per_km)
    ? rate_card.return_rate_per_km
    : rate_card.rate_per_km

  // ── Round trip: guaranteed-minimum-km package + per-day driver allowance ──
  // Industry-standard outstation model (Ola Outstation / Uber Intercity):
  // billed for at least `days * km_per_day` regardless of actual km driven,
  // plus real overage beyond that, plus a flat per-day allowance for the
  // driver's food/stay. No separate per-minute meter — that's covered by the
  // per-day package, matching how outstation cabs are actually priced.
  if (ride_type === 'round_trip') {
    const days      = Math.max(1, Math.ceil(trip_hours / 24))
    const packageKm = round2(days * (rate_card.km_per_day ?? 0))
    const overageKmRaw = Math.max(0, estimated_km - packageKm)
    const overageKm     = round2(overageKmRaw)

    const distance_fare  = round2(packageKm * per_km)
    const overage_fare   = round2(overageKmRaw * per_km)
    const stop_fare      = round2(stop_count * charge_per_stop)
    const driver_allowance = round2(days * (rate_card.driver_allowance_per_day ?? 0))

    const metered  = round2(distance_fare + overage_fare)
    const floored  = round2(Math.max(metered, rate_card.min_fare))
    const subtotal = round2(floored + stop_fare + driver_allowance)
    const surge_fare = round2(subtotal * (surge_multiplier - 1))
    const total      = round2(subtotal + surge_fare)

    return {
      base_fare: 0,
      distance_fare,
      time_fare: 0,
      stop_fare,
      hour_surcharge: driver_allowance,
      overage_fare,
      surge_fare,
      subtotal,
      total,
      overage_km: overageKm,
    }
  }

  // ── One-way ───────────────────────────────────────────────
  const distance_fare = round2(estimated_km * per_km)
  const time_fare      = round2(estimated_min * rate_card.rate_per_min)
  const stop_fare      = round2(stop_count    * charge_per_stop)

  const metered   = round2(distance_fare + time_fare)
  const floored   = round2(Math.max(metered, rate_card.min_fare))
  const subtotal  = round2(floored + stop_fare)
  const surge_fare = round2(subtotal * (surge_multiplier - 1))
  const total      = round2(subtotal + surge_fare)

  return {
    base_fare:     round2(Math.max(rate_card.min_fare - metered, 0)),
    distance_fare,
    time_fare,
    stop_fare,
    hour_surcharge: 0,
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
