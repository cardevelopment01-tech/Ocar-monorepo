export interface RateCard {
  id: number
  category_id: number
  category_name: string
  category_slug: string
  ride_type: 'one_way' | 'round_trip' | 'rental'
  rate_per_km: number
  rate_per_min: number
  min_fare: number
  return_rate_per_km: number | null
  hour_rate: number | null
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
  duration_hours: number
  km_limit: number
  package_fare: number
  extra_per_km: number
  extra_per_min: number
  is_active: boolean
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
}

export interface FareEstimateResponse {
  rate_card_id: number
  surge_event_id: number | null
  surge_multiplier: number
  breakdown: {
    base_fare: number
    distance_fare: number
    time_fare: number
    stop_fare: number
    hour_surcharge: number
    overage_fare: number
    surge_fare: number
    total: number
  }
}
