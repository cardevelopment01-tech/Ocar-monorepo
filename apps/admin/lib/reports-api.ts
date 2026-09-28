import api from './api'
import { apiParams, type ReportFilters } from './reports-range'

// Response shapes of api/src/modules/analytics (see analytics.types.ts). Money fields are ABSENT
// (not zero) for ops_admin (CEO E5), so every money field is optional here and rendered as "not shown".

export interface Totals {
  gross_bookings?: number
  commission?: number
  completed_rides: number
  active_drivers: number
  cohort_completed: number
  cohort_cancelled: number
}
export interface SeriesPoint {
  day: string
  completed_rides: number
  gross?: number
  commission?: number
  cohort_completed: number
  cohort_cancelled: number
}
export interface KpisResponse {
  from: string; to: string; compare: 'prev' | 'off'; generated_at: string
  totals: Totals; previous_totals: Totals | null
  series: SeriesPoint[]; previous_series: SeriesPoint[] | null
  money_hidden: boolean
}
export interface FinanceResponse {
  from: string; to: string; generated_at: string
  totals: Required<Totals>
  take_rate: number; previous_take_rate: number | null
  finance: {
    cash_gross: number; online_gross: number; driver_earnings: number
    refund_count: number; refund_amount: number; refunds_per_100: number
    dispute_count: number; disputes_per_100: number
  }
  cash: { flagged_count: number; not_collected_count: number; net_gap: number }
}
export interface DriverQualityRow {
  driver_id: string; driver_name: string | null; driver_code: string; rating_avg: string | null
  offered: number; accepted: number; completed: number; cancelled: number
  acceptance_rate: number | null; completion_rate: number | null; cancellation_rate: number | null
  earnings?: number
}
export interface DriversResponse { from: string; to: string; generated_at: string; quality: DriverQualityRow[] }
export interface CityRow { city_name: string; ride_count: number; revenue?: number; cancelled_count: number; cancellation_rate: number; active_drivers: number }
export interface CategoryRow { category_name: string; ride_count: number; revenue?: number }
export interface DemandResponse {
  from: string; to: string; generated_at: string
  funnel: { requested: number; accepted: number; completed: number; cancelled: number }
  heatmap: { dow: number; hour: number; count: number }[]
  cancellations: { actor: string; stage: string; reason_code: string; count: number }[]
  cities: CityRow[]; categories: CategoryRow[]
}
export interface OnboardingRow {
  city_name: string; signed_up: number; docs_submitted: number; activated: number
  rejected_or_banned: number; avg_hours_to_active: number | null; conversion_pct: number
}
export interface AvailabilityRow { city_name: string; total_active: number; online_now: number; available_now: number; availability_pct: number }
export interface EtaRow {
  origin_city: string | null; destination_city: string | null; leg: 'to_pickup' | 'to_destination'
  sample_count: number; mae_min: number; mape_pct: number | null
}

// `signal` lets the caller cancel a superseded request (latest-wins, CEO Section 4).
const get = <T>(path: string, params: Record<string, string>, signal?: AbortSignal) =>
  api.get(`/api/v1/admin/analytics${path}`, { params, ...(signal ? { signal } : {}) }).then(r => r.data as T)

export const reportsApi = {
  kpis: (f: ReportFilters, signal?: AbortSignal) => get<KpisResponse>('/kpis', apiParams(f), signal),
  finance: (f: ReportFilters, signal?: AbortSignal) => get<FinanceResponse>('/finance', apiParams(f), signal),
  drivers: (f: ReportFilters, signal?: AbortSignal) => get<DriversResponse>('/drivers/quality', apiParams(f), signal),
  demand: (f: ReportFilters, signal?: AbortSignal) => get<DemandResponse>('/demand', apiParams(f), signal),
  onboarding: (f: ReportFilters, signal?: AbortSignal) => get<OnboardingRow[]>('/drivers/onboarding', apiParams(f), signal),
  eta: (f: ReportFilters, signal?: AbortSignal) => get<EtaRow[]>('/eta-accuracy', apiParams(f), signal),
  availability: (signal?: AbortSignal) => get<AvailabilityRow[]>('/drivers/availability', {}, signal),
  /** Downloads the CSV through the authenticated axios instance and hands it to the browser. */
  async exportCsv(tab: 'daily' | 'drivers' | 'cities', f: ReportFilters): Promise<string> {
    const res = await api.get(`/api/v1/admin/analytics/export/${tab}.csv`, { params: apiParams(f), responseType: 'blob' })
    const name = /filename="([^"]+)"/.exec(String(res.headers['content-disposition'] ?? ''))?.[1] ?? `ocar-${tab}.csv`
    const url = URL.createObjectURL(res.data as Blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
    return name
  },
}
