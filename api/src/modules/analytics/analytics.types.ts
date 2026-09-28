import type { KpiTotals } from './kpi-definitions'

export interface DailyPoint {
  day: string
  completed_rides: number
  gross: number
  commission: number
  cohort_completed: number
  cohort_cancelled: number
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

export interface DriverQuality {
  driver_id: string
  driver_name: string | null
  driver_code: string
  rating_avg: string | null
  offered: number
  accepted: number
  completed: number
  cancelled: number
  acceptance_rate: number | null   // accepted / offered offers in range; null when never offered
  completion_rate: number | null   // completed / (completed + cancelled); null when no trips
  cancellation_rate: number | null
  earnings: number
}

export interface CityBreakdown {
  city_name: string
  ride_count: number
  revenue: number
  cancelled_count: number
  cancellation_rate: number // cancelled / (completed + cancelled), 0 when no rides
  active_drivers: number    // active fleet snapshot (status = 'active'), not period-scoped
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

export interface FinanceTotals {
  cash_gross: number
  online_gross: number
  driver_earnings: number
  refund_count: number
  refund_amount: number       // money: stripped for ops_admin
  refunds_per_100: number     // event-window rate, working definition
  dispute_count: number
  disputes_per_100: number    // event-window rate, working definition
}

export interface CashDiscrepancyPanel {
  flagged_count: number
  not_collected_count: number
  net_gap: number // fare - collected; positive = short, negative = over-collected
}

export interface CancellationRow {
  actor: string
  stage: string
  reason_code: string
  count: number
}

export interface HeatmapCell {
  dow: number // 0 = Sunday (IST)
  hour: number // 0-23 (IST)
  count: number
}

/** Legacy shape kept for GET /analytics/summary (Reports page consumers). Money fields are absent for ops_admin (CEO E5). */
export interface AnalyticsSummary {
  period_days: number
  from: string
  to: string
  daily_revenue?: { day: string; revenue: number; ride_count: number }[]
  funnel: RideFunnel
  top_drivers: (Omit<TopDriver, 'total_earnings'> & { total_earnings?: number })[]
  city_breakdown: (Omit<CityBreakdown, 'revenue'> & { revenue?: number })[]
  category_breakdown: (Omit<CategoryBreakdown, 'revenue'> & { revenue?: number })[]
}

type MoneyOptional<T> = Omit<T, 'gross_bookings' | 'commission'> & { gross_bookings?: number; commission?: number }
type SeriesPoint = Omit<DailyPoint, 'gross' | 'commission'> & { gross?: number; commission?: number }

export interface KpisResponse {
  from: string
  to: string
  compare: 'prev' | 'off'
  generated_at: string
  totals: MoneyOptional<KpiTotals>
  previous_totals: MoneyOptional<KpiTotals> | null
  series: SeriesPoint[]
  previous_series: SeriesPoint[] | null
  // gross_bookings, commission and series gross/commission are ABSENT (not zero) for ops_admin
  money_hidden: boolean
}

export interface FinanceResponse {
  from: string
  to: string
  generated_at: string
  totals: KpiTotals
  take_rate: number
  previous_take_rate: number | null
  finance: FinanceTotals
  cash: CashDiscrepancyPanel
}

export interface DriversResponse {
  from: string
  to: string
  generated_at: string
  quality: (Omit<DriverQuality, 'earnings'> & { earnings?: number })[]
}

export interface DemandResponse {
  from: string
  to: string
  generated_at: string
  funnel: RideFunnel
  heatmap: HeatmapCell[]
  cancellations: CancellationRow[]
  cities: (Omit<CityBreakdown, 'revenue'> & { revenue?: number })[]
  categories: (Omit<CategoryBreakdown, 'revenue'> & { revenue?: number })[]
}
