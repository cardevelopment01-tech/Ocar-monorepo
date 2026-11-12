export interface RateCard {
  id: number
  category_id: number
  category_name: string
  category_slug: string
  ride_type: 'one_way' | 'round_trip' | 'rental'
  /** 'city' = the metered in-city card (ride_type stays one_way); 'standard' = every other card. */
  trip_mode: 'standard' | 'city'
  rate_per_km: number
  rate_per_min: number
  min_fare: number
  base_fare: number
  return_rate_per_km: number | null
  hour_rate: number | null
  km_per_day: number | null
  driver_allowance_per_day: number | null
  city_id: number | null
  city_name: string | null
  effective_from: string
  created_at: string
}

export interface RateCardHistoryRow {
  id: number
  rate_card_id: number
  category_name: string
  ride_type: string
  rate_per_km: number
  rate_per_min: number
  min_fare: number
  return_rate_per_km: number | null
  hour_rate: number | null
  km_per_day: number | null
  driver_allowance_per_day: number | null
  city_id: number | null
  city_name: string | null
  changed_by: number
  change_reason: string | null
  created_at: string
}

export interface SurgeEvent {
  id: number
  city_id: number
  city_name: string
  category_id: number | null
  category_name: string | null
  multiplier: number
  reason: string | null
  status: 'scheduled' | 'active' | 'expired' | 'cancelled'
  starts_at: string
  ends_at: string
  created_at: string
}

export interface RentalPackage {
  id: number
  category_id: number
  category_name: string
  duration_minutes: number
  km_limit: number
  package_fare: number
  extra_per_km: number
  extra_per_min: number
  /** Fees a rental is charged, kept here since migration 136 (numeric strings from Postgres). */
  stop_charge: string
  cancellation_fee: string
  is_active: boolean
  city_id: number | null
  city_name: string | null
}

export interface FareEstimateRequest {
  category_id: number
  ride_type: 'one_way' | 'round_trip' | 'rental'
  is_return_cab?: boolean
  distance_km: number
  duration_min: number
  stop_count?: number
  trip_hours?: number
  rental_package_id?: number
  city_id?: number
  /** 'city' = quote on the city ride card (ride_type stays one_way). Anything else is the standard card. */
  trip_mode?: 'standard' | 'city'
  /** Pin the round-trip formula (scheduled-ride re-quote keeps the version it was booked under). Default: current. */
  pricing_version?: 1 | 2
}

export interface FareEstimateResponse {
  /** 2 for round trips quoted under the hourly window model, else 1. Stored on the snapshot. */
  pricing_version: 1 | 2
  /** The rate card this quote used; null for a package rental, which is priced from its package alone. */
  rate_card_id: number | null
  surge_event_id: number | null
  surge_multiplier: number
  /** Flat fee per stop on the rate card this quote used (0 = free). Stops added at booking are stamped with it. */
  charge_per_stop: number
  breakdown: {
    base_fare: number
    distance_fare: number
    time_fare: number
    stop_fare: number
    hour_surcharge: number
    overage_fare: number
    overage_km?: number
    waiting_fare?: number
    surge_fare: number
    total: number
  }
  rental_hours?: number
}
