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

export interface AnalyticsSummary {
  period_days: number
  daily_revenue: DailyRevenue[]
  funnel: RideFunnel
  top_drivers: TopDriver[]
  city_breakdown: CityBreakdown[]
  category_breakdown: CategoryBreakdown[]
}
