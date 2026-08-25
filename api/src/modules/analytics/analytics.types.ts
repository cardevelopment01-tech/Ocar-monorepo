export interface DailyRevenue {
  day: string
  revenue: number
  ride_count: number
}

export interface RideFunnel {
  requested: number
  accepted: number
  completed: number
  cancelled: number
}

export interface TopDriver {
  driver_id: string
  driver_name: string | null
  driver_code: string
  trip_count: number
  total_earnings: number
  rating_avg: string | null
}

export interface CityBreakdown {
  city_name: string
  ride_count: number
  revenue: number
}

export interface CategoryBreakdown {
  category_name: string
  ride_count: number
  revenue: number
}

export interface EtaAccuracy {
  origin_city: string | null
  destination_city: string | null
  leg: 'to_pickup' | 'to_destination'
  sample_count: number
  mae_min: number
  mape_pct: number | null
}

export interface DriverOnboardingFunnel {
  city_name: string
  signed_up: number
  docs_submitted: number
  activated: number
  rejected_or_banned: number
  avg_hours_to_active: number | null
  conversion_pct: number
}

export interface DriverAvailability {
  city_name: string
  total_active: number
  online_now: number
  available_now: number
  availability_pct: number
}

export interface AnalyticsSummary {
  period_days: number
  daily_revenue: DailyRevenue[]
  funnel: RideFunnel
  top_drivers: TopDriver[]
  city_breakdown: CityBreakdown[]
  category_breakdown: CategoryBreakdown[]
}
